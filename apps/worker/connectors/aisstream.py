"""AISStream.io connector — maritime vessel positions via WebSocket.

Connects to wss://stream.aisstream.io/v0/stream and collects PositionReport
messages for vessels within the Indonesia bbox. Requires an API key
(AISSTREAM_API_KEY env var). If no key is present, the connector logs a
warning and no-ops so the system degrades gracefully.

Since WebSocket is a continuous stream, this connector buffers messages
in memory and flushes them on demand (every poll cycle the scheduler
calls `drain()` to get all buffered positions).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

_WS_URL = "wss://stream.aisstream.io/v0/stream"

# Indonesia bbox
LAMIN = -11.0
LOMIN = 92.0
LAMAX = 8.0
LOMAX = 142.0


@dataclass
class VesselPosition:
    mmsi: str
    name: str | None
    ship_type: str | None
    latitude: float
    longitude: float
    sog: float | None
    cog: float | None
    heading: float | None
    nav_status: str | None
    timestamp: datetime
    source: str = "aisstream"


class AISStreamConnector:
    """Collects AIS vessel positions via WebSocket.

    Usage:
      connector = AISStreamConnector()
      await connector.start()      # connects WS in background
      vessels = await connector.drain()  # get buffered positions
      await connector.stop()
    """

    def __init__(self) -> None:
        self._api_key = os.environ.get("AISSTREAM_API_KEY", "")
        self._buffer: dict[str, VesselPosition] = {}
        self._task: asyncio.Task | None = None
        self._ws = None
        self._running = False

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def start(self) -> None:
        if not self.is_configured:
            logger.warning("AISStream: no API key — maritime tracking disabled")
            return

        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        """Background task that maintains the WebSocket connection."""

        import websockets

        bbox = [[LAMIN, LOMIN], [LAMAX, LOMAX]]
        sub_msg = json.dumps({
            "APIKey": self._api_key,
            "BoundingBoxes": [bbox],
            "FilterMessageTypes": ["PositionReport"],
        })

        while self._running:
            try:
                async with websockets.connect(_WS_URL) as ws:
                    await ws.send(sub_msg)
                    logger.info("AISStream: WebSocket connected & subscribed")

                    async for raw in ws:
                        if not self._running:
                            break
                        try:
                            self._process_message(raw)
                        except Exception as e:
                            logger.debug("AISStream parse error: %s", e)

            except Exception as e:
                logger.warning("AISStream WS error: %s — reconnecting in 10s", e)
                await asyncio.sleep(10)

    def _process_message(self, raw: str | bytes) -> None:
        """Parse an AIS message and buffer the latest position per MMSI."""

        msg = json.loads(raw)
        meta = msg.get("MetaData", {})
        ais = msg.get("Message", {}).get("PositionReport", {})

        mmsi = str(meta.get("MMSI", 0))
        if not mmsi or mmsi == "0":
            return

        lat = meta.get("latitude") or ais.get("Latitude")
        lon = meta.get("longitude") or ais.get("Longitude")
        if lat is None or lon is None:
            return

        self._buffer[mmsi] = VesselPosition(
            mmsi=mmsi,
            name=meta.get("ShipName"),
            ship_type=None,
            latitude=float(lat),
            longitude=float(lon),
            sog=float(ais.get("Sog")) if ais.get("Sog") is not None else None,
            cog=float(ais.get("Cog")) if ais.get("Cog") is not None else None,
            heading=float(ais.get("TrueHeading")) if ais.get("TrueHeading") is not None else None,
            nav_status=None,
            timestamp=datetime.now(timezone.utc),
        )

    def drain(self) -> list[VesselPosition]:
        """Return all buffered positions and clear the buffer."""

        positions = list(self._buffer.values())
        self._buffer.clear()
        return positions

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
