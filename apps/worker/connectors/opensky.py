"""OpenSky Network connector — aviation state vectors via REST API.

Polls https://opensky-network.org/api/states/all with a bounding box
covering Indonesia and surrounding waters. Free tier (anonymous):
rate-limited to 1 request / 10s, which is fine for a 60s poll cycle.

Authentication is optional. If OPENSESKY_USER / OPENSEKY_PASS are set in
the environment, HTTP Basic Auth is used for higher rate limits.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

# Indonesia bbox (conservative, covers EEZ)
LAMIN = -11.0
LOMIN = 92.0
LAMAX = 8.0
LOMAX = 142.0

_API_URL = "https://opensky-network.org/api/states/all"
_TIMEOUT = 15.0


@dataclass
class AircraftPosition:
    icao24: str
    callsign: str | None
    origin_country: str
    latitude: float
    longitude: float
    altitude: float | None
    velocity: float | None
    heading: float | None
    on_ground: bool
    vertical_rate: float | None
    timestamp: datetime


class OpenSkyConnector:
    """Fetch live aircraft state vectors for the Indonesia region."""

    def __init__(self) -> None:
        self._user = os.environ.get("OPENSEKY_USER", "")
        self._pass = os.environ.get("OPENSEKY_PASS", "")

    @property
    def auth(self) -> httpx.BasicAuth | None:
        if self._user and self._pass:
            return httpx.BasicAuth(self._user, self._pass)
        return None

    async def fetch_states(self) -> list[AircraftPosition]:
        """Fetch all state vectors within the Indonesia bbox."""

        params = {
            "lamin": LAMIN,
            "lomin": LOMIN,
            "lamax": LAMAX,
            "lomax": LOMAX,
        }

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(_API_URL, params=params, auth=self.auth)
            resp.raise_for_status()

        body = resp.json()
        states = body.get("states") or []
        ts_raw = body.get("time")
        ts = datetime.fromtimestamp(ts_raw, tz=timezone.utc) if ts_raw else datetime.now(timezone.utc)

        results: list[AircraftPosition] = []
        for s in states:
            # OpenSky state vector indices (see API docs):
            # 0=icao24, 1=callsign, 2=origin_country, 5=lon, 6=lat,
            # 7=baro_alt, 8=on_ground, 9=velocity, 10=true_track,
            # 11=vertical_rate
            try:
                lat = s[6]
                lon = s[5]
                if lat is None or lon is None:
                    continue
                results.append(AircraftPosition(
                    icao24=str(s[0]).strip(),
                    callsign=str(s[1]).strip() if s[1] else None,
                    origin_country=str(s[2] or ""),
                    latitude=float(lat),
                    longitude=float(lon),
                    altitude=float(s[7]) if s[7] is not None else None,
                    velocity=float(s[9]) if s[9] is not None else None,
                    heading=float(s[10]) if s[10] is not None else None,
                    on_ground=bool(s[8]) if s[8] is not None else False,
                    vertical_rate=float(s[11]) if s[11] is not None else None,
                    timestamp=ts,
                ))
            except (IndexError, TypeError, ValueError) as e:
                logger.debug("Skipping malformed OpenSky state: %s", e)
                continue

        logger.info("OpenSky: fetched %d aircraft in Indonesia bbox", len(results))
        return results
