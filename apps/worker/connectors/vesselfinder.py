"""VesselFinder API connector — REST-based vessel position lookup.

VesselFinder uses a credit-based REST API:
- Endpoint: https://api.vesselfinder.com/vessels
- Auth: userkey query parameter
- Query by MMSI and/or IMO (comma-separated lists)
- 1 credit per terrestrial position, 10 credits per satellite position

For experimentation, we define a watchlist of MMSI numbers representing
vessels commonly transiting Indonesian waters (Strait of Malacca, Sunda
Strait, Makassar Strait). The watchlist is configurable via env var
VESSELFINDER_WATCHLIST or a JSON file.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import aiohttp

logger = logging.getLogger(__name__)

# Default watchlist: well-known vessels that frequently transit Indonesian waters.
# These MMSI numbers can be updated via VESSELFINDER_WATCHLIST env var.
# Format: comma-separated MMSI numbers, e.g. "5250190,5250212,477123456"
DEFAULT_WATCHLIST: list[int] = [
    5250190,    # Indonesia-flagged vessels (example MMSIs)
    5250212,
    5250213,
    5250215,
    5250220,
    5250222,
    5250225,
    5250230,
    5250235,
    5250240,
]

VESSELFINDER_BASE_URL = "https://api.vesselfinder.com/vessels"


@dataclass
class VesselFinderPosition:
    """Normalized vessel position from VesselFinder API."""

    mmsi: int
    name: str
    ship_type: int
    latitude: float
    longitude: float
    sog: float          # Speed over ground (knots)
    cog: float          # Course over ground (degrees)
    heading: int        # True heading (511 = not available)
    nav_status: int     # Navigation status
    imo: int
    callsign: str
    draught: float
    destination: str
    eta: str | None
    source: str         # TER (terrestrial) or SAT (satellite)
    timestamp: datetime

    def to_vessel_position(self):
        """Convert to VesselPosition (duck-type compatible with upsert_vessels)."""
        from connectors.aisstream import VesselPosition

        return VesselPosition(
            mmsi=str(self.mmsi),
            name=self.name or None,
            ship_type=_ais_type_to_text(self.ship_type),
            latitude=self.latitude,
            longitude=self.longitude,
            sog=self.sog,
            cog=self.cog,
            heading=float(self.heading) if self.heading != 511 else None,
            nav_status=str(self.nav_status),
            timestamp=self.timestamp,
            source=f"vesselfinder:{self.source}",
        )


def _parse_timestamp(ts_str: str) -> datetime:
    """Parse VesselFinder timestamp like '2017-08-11 11:15:15 UTC'."""
    try:
        clean = ts_str.replace(" UTC", "+00:00").replace(" GMT", "+00:00")
        # Try ISO format
        return datetime.fromisoformat(clean)
    except (ValueError, AttributeError):
        logger.warning("Unparseable timestamp: %s, using now()", ts_str)
        return datetime.now(timezone.utc)


def _ais_type_to_text(type_code: int) -> str:
    """Map AIS type code to readable text (simplified)."""
    # Full mapping at https://api.vesselfinder.com/docs/ref-aistypes.html
    type_map = {
        0: "Not available",
        20: "Wing in ground",
        30: "Fishing",
        31: "Towing",
        32: "Towing large",
        33: "Dredging",
        34: "Diving",
        35: "Military",
        36: "Sailing",
        37: "Pleasure craft",
        40: "High-speed craft",
        50: "Pilot vessel",
        51: "Search and rescue",
        52: "Tug",
        53: "Port tender",
        54: "Anti-pollution",
        55: "Law enforcement",
        58: "Medical transport",
        59: "Noncombatant",
        60: "Passenger",
        70: "Cargo",
        80: "Tanker",
        90: "Other",
    }
    return type_map.get(type_code, f"Type {type_code}")


def _get_watchlist() -> list[int]:
    """Get MMSI watchlist from env var or default."""
    env_list = os.environ.get("VESSELFINDER_WATCHLIST", "")
    if env_list:
        try:
            return [int(x.strip()) for x in env_list.split(",") if x.strip()]
        except ValueError:
            logger.warning("Invalid VESSELFINDER_WATCHLIST format, using default")
    return DEFAULT_WATCHLIST


class VesselFinderConnector:
    """REST connector for VesselFinder Vessels API."""

    def __init__(
        self,
        api_key: str | None = None,
        watchlist: list[int] | None = None,
        timeout: float = 15.0,
        interval_minutes: int = 60,
    ):
        self.api_key = api_key or os.environ.get("VESSELFINDER_API_KEY", "")
        self.watchlist = watchlist or _get_watchlist()
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.interval_minutes = interval_minutes
        self._session: aiohttp.ClientSession | None = None

    @property
    def configured(self) -> bool:
        """Check if API key is set."""
        return bool(self.api_key)

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def fetch_positions(self) -> list[VesselFinderPosition]:
        """Fetch latest positions for all vessels in the watchlist.

        VesselFinder API accepts comma-separated MMSI lists.
        We batch them to stay within reasonable URL length limits.
        """
        if not self.configured:
            logger.warning("VesselFinder API key not set — skipping fetch")
            return []

        if not self.watchlist:
            logger.warning("VesselFinder watchlist is empty — skipping fetch")
            return []

        all_positions: list[VesselFinderPosition] = []

        # Batch MMSIs in groups of 20 to keep URLs reasonable
        batch_size = 20
        for i in range(0, len(self.watchlist), batch_size):
            batch = self.watchlist[i : i + batch_size]
            mmsi_str = ",".join(str(m) for m in batch)

            params = {
                "userkey": self.api_key,
                "format": "json",
                "interval": str(self.interval_minutes),
            }
            # VesselFinder accepts both imo and mmsi params; mmsi is more common
            params["mmsi"] = mmsi_str

            try:
                session = await self._get_session()
                async with session.get(VESSELFINDER_BASE_URL, params=params) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        logger.error(
                            "VesselFinder API error %d: %s", resp.status, body[:200]
                        )
                        continue

                    data = await resp.json()

                    # VesselFinder returns {"error": "..."} on failure
                    if isinstance(data, dict) and "error" in data:
                        logger.error(
                            "VesselFinder API error: %s (check API key / credits)",
                            data["error"],
                        )
                        continue

                    if not isinstance(data, list):
                        data = [data] if data else []

                    for entry in data:
                        ais = entry.get("AIS", {})
                        if not ais:
                            continue

                        ts = _parse_timestamp(ais.get("TIMESTAMP", ""))
                        pos = VesselFinderPosition(
                            mmsi=ais.get("MMSI", 0),
                            name=ais.get("NAME", "").strip(),
                            ship_type=ais.get("TYPE", 0),
                            latitude=float(ais.get("LATITUDE", 0.0)),
                            longitude=float(ais.get("LONGITUDE", 0.0)),
                            sog=float(ais.get("SPEED", 0.0)),
                            cog=float(ais.get("COURSE", 0.0)),
                            heading=ais.get("HEADING", 511),
                            nav_status=ais.get("NAVSTAT", 0),
                            imo=ais.get("IMO", 0),
                            callsign=ais.get("CALLSIGN", "").strip(),
                            draught=float(ais.get("DRAUGHT", 0.0)),
                            destination=ais.get("DESTINATION", "").strip(),
                            eta=ais.get("ETA") or None,
                            source=ais.get("SRC", "TER"),
                            timestamp=ts,
                        )
                        all_positions.append(pos)

                    logger.info(
                        "VesselFinder batch %d: got %d positions",
                        i // batch_size + 1,
                        len(data),
                    )

            except asyncio.TimeoutError:
                logger.warning("VesselFinder API timeout for batch starting at %d", i)
            except Exception as e:
                logger.error("VesselFinder fetch error: %s", e)

        logger.info("VesselFinder total positions: %d", len(all_positions))
        return all_positions
