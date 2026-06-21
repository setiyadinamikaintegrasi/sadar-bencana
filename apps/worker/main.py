"""FastAPI entrypoint for the worker service."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from connectors.usgs import USGSConnector
from db.events import upsert_events
from db.pool import close_pool, get_pool, init_pool
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

app = FastAPI(title="Reinsurance Risk Monitor Worker", version="0.1.0")


@app.on_event("startup")
async def startup_event() -> None:
    """Bring up long-lived resources: PostgreSQL connection pool.

    The DB is optional for some endpoints (health/status), so a failed
    init is logged as a warning rather than crashing the app. Endpoints
    that need the pool will surface a clean 503 via :func:`get_pool`.
    """

    logger.info("Worker startup complete; ingestion is configured to run on-demand.")
    try:
        await init_pool()
        logger.info("PostgreSQL connection pool initialized.")
    except Exception as exc:  # pragma: no cover — depends on runtime DB availability
        logger.warning("Could not initialize DB pool at startup: %s", exc)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Release the PostgreSQL connection pool on shutdown."""

    await close_pool()


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


@app.post("/api/v1/worker/ingest")
async def worker_ingest() -> JSONResponse:
    """Fetch USGS events and upsert them into PostgreSQL.

    Returns ``{"fetched": N, "upserted": M}`` on success. Distinct
    failure modes map to distinct HTTP status codes:
      * 503 — DB pool not ready
      * 502 — USGS fetch failed
      * 500 — upsert failed
    """

    # 1. Acquire the DB pool.
    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(
            status_code=503,
            content={"fetched": 0, "upserted": 0, "error": str(exc)},
        )

    # 2. Fetch events from USGS.
    connector = USGSConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"fetched": 0, "upserted": 0, "error": str(exc)},
        )
    finally:
        await connector.close()

    # 3. Upsert into PostgreSQL.
    try:
        upserted = await upsert_events(pool, events)
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"fetched": len(events), "upserted": 0, "error": str(exc)},
        )

    return JSONResponse(
        status_code=200,
        content={"fetched": len(events), "upserted": upserted},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
