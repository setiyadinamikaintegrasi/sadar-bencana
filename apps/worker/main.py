"""FastAPI entrypoint for the worker service."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from connectors.usgs import USGSConnector
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

app = FastAPI(title="Reinsurance Risk Monitor Worker", version="0.1.0")


@app.on_event("startup")
async def startup_event() -> None:
    """Log a cheap startup message without performing network I/O."""

    logger.info("Worker startup complete; ingestion is configured to run on-demand.")


@app.get("/health")
async def health() -> dict[str, str]:
    """Return a basic health status."""

    return {"status": "ok", "service": "worker"}


@app.get("/api/v1/worker/status")
async def worker_status() -> dict[str, str]:
    """Return worker runtime status metadata."""

    return {"service": "worker", "status": "running", "version": "0.1.0"}


@app.get("/api/v1/worker/events")
async def worker_events() -> dict[str, int | list[dict[str, object]] | str]:
    """Fetch recent events from USGS and return a small response payload."""

    connector = USGSConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
        return {
            "count": len(events),
            "events": [event.model_dump() for event in events[:20]],
        }
    except Exception as exc:
        return {"count": 0, "events": [], "error": str(exc)}
    finally:
        await connector.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
