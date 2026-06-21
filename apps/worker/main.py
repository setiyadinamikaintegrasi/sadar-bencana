"""FastAPI entrypoint for the worker service."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from alerts import evaluate_and_create_alerts
from connectors.usgs import USGSConnector
from db.briefings import save_briefing
from db.events import fetch_top_events, upsert_events
from db.pool import close_pool, get_pool, init_pool
from models.event import EarthquakeEvent
from schedulers.briefing import BriefingScheduler
from schedulers.ingest import IngestScheduler
from scoring.risk import score_events

logger = logging.getLogger(__name__)

app = FastAPI(title="Reinsurance Risk Monitor Worker", version="0.1.0")

# Module-level scheduler instances. Created lazily in the startup hook so
# they bind to the running event loop. Captured module-level so the
# shutdown hook can stop them.
_scheduler: IngestScheduler | None = None
_briefing_scheduler: BriefingScheduler | None = None


async def _ingest_cycle(pool: asyncpg.Pool) -> dict[str, int]:
    """Run one fetch -> upsert -> score cycle against an active pool.

    Shared by both the on-demand ingest endpoint and the background
    scheduler so they execute identical logic. The caller is responsible
    for acquiring the pool (and mapping failures to HTTP status codes
    where applicable). Raises on any failure.
    """

    connector = USGSConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
    finally:
        await connector.close()

    upserted = await upsert_events(pool, events)
    scored = await score_events(pool, events)
    alerts = await evaluate_and_create_alerts(pool, events)

    return {
        "fetched": len(events),
        "upserted": upserted,
        "scored": scored,
        "alerts_created": len(alerts),
    }


async def _ingest_once() -> dict[str, int]:
    """Resolve the pool and run one full ingest + scoring cycle.

    This is the entry point used by the background scheduler. It raises
    on any failure (pool unavailable, USGS fetch error, DB error); the
    scheduler logs and swallows such exceptions so the loop survives.
    """

    pool = get_pool()
    return await _ingest_cycle(pool)


async def _briefing_cycle(pool: asyncpg.Pool) -> dict[str, Any]:
    """Run one fetch -> generate -> save briefing cycle against a pool.

    Shared by both the on-demand briefing endpoint and the background
    scheduler so they execute identical logic. Reuses
    :func:`db.events.fetch_top_events`, :func:`ai.briefing.generate_briefing`,
    and :func:`db.briefings.save_briefing` rather than duplicating any
    briefing-generation logic. Raises on any failure.
    """

    # Local import keeps the heavy LLM/httpx import lazy, matching the
    # style of the on-demand endpoint above.
    from ai.briefing import generate_briefing
    from ai.briefing import LLM_MODEL

    events, event_uuids = await fetch_top_events(pool, limit=10)

    if not events:
        logger.info("No events to summarize; skipping briefing generation.")
        return {
            "event_count": 0,
            "model": LLM_MODEL,
            "id": None,
            "skipped": True,
        }

    summary = await generate_briefing(events)
    saved = await save_briefing(
        pool,
        briefing_type="daily",
        summary=summary,
        event_ids=event_uuids,
        event_count=len(events),
        model=LLM_MODEL,
    )

    return {
        "event_count": len(events),
        "model": LLM_MODEL,
        "id": saved["id"],
        "skipped": False,
    }


async def _generate_briefing_once() -> dict[str, Any]:
    """Resolve the pool and run one briefing generation cycle.

    This is the entry point used by the background briefing scheduler. It
    raises on any failure (pool unavailable, LLM error, DB error); the
    scheduler logs and swallows such exceptions so the loop survives.
    """

    pool = get_pool()
    return await _briefing_cycle(pool)


@app.on_event("startup")
async def startup_event() -> None:
    """Bring up long-lived resources: PostgreSQL pool + schedulers.

    The DB is optional for some endpoints (health/status), so a failed
    pool init is logged as a warning rather than crashing the app. The
    schedulers are started regardless: even with a degraded DB they will
    simply log failures each tick and recover once the pool is available.
    """

    global _scheduler, _briefing_scheduler

    try:
        await init_pool()
        logger.info("PostgreSQL connection pool initialized.")
    except Exception as exc:  # pragma: no cover — depends on runtime DB availability
        logger.warning("Could not initialize DB pool at startup: %s", exc)

    # Start the background ingest loop (every 5 minutes by default).
    _scheduler = IngestScheduler(ingest_fn=_ingest_once)
    _scheduler.start()

    # Start the background briefing loop (every 6 hours by default).
    _briefing_scheduler = BriefingScheduler(briefing_fn=_generate_briefing_once)
    _briefing_scheduler.start()

    logger.info(
        "Worker startup complete; background ingestion and auto-briefing are enabled."
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Stop the schedulers and release the PostgreSQL connection pool."""

    global _scheduler, _briefing_scheduler
    if _scheduler is not None:
        await _scheduler.stop()
        _scheduler = None

    if _briefing_scheduler is not None:
        await _briefing_scheduler.stop()
        _briefing_scheduler = None

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
    """Fetch USGS events, upsert them, and compute risk scores.

    Returns ``{"fetched": N, "upserted": M, "scored": K, "alerts_created": A}`` on success.
    Distinct failure modes map to distinct HTTP status codes:
      * 503 — DB pool not ready
      * 502 — USGS fetch failed
      * 500 — upsert or scoring failed
    """

    # 1. Acquire the DB pool.
    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(
            status_code=503,
            content={"fetched": 0, "upserted": 0, "scored": 0, "alerts_created": 0, "error": str(exc)},
        )

    # 2. Fetch events from USGS.
    connector = USGSConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"fetched": 0, "upserted": 0, "scored": 0, "alerts_created": 0, "error": str(exc)},
        )
    finally:
        await connector.close()

    # 3. Upsert + score. Both run inside the same step so a scoring
    #    failure surfaces as 500 (the events were fetched, but persistence
    #    did not complete cleanly).
    try:
        upserted = await upsert_events(pool, events)
        scored = await score_events(pool, events)
        alerts = await evaluate_and_create_alerts(pool, events)
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "fetched": len(events),
                "upserted": 0,
                "scored": 0,
                "alerts_created": 0,
                "error": str(exc),
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "fetched": len(events),
            "upserted": upserted,
            "scored": scored,
            "alerts_created": len(alerts),
        },
    )


@app.post("/api/v1/worker/briefings/generate")
async def worker_generate_briefing() -> JSONResponse:
    """Generate a reinsurance briefing from recent events using local LLM.

    Flow:
      1. Acquire DB pool (503 if not ready).
      2. Fetch top events by magnitude from PostgreSQL.
      3. Call Gemma4-E4B (localhost:8080) for summary generation.
      4. Persist to briefings table.
      5. Return briefing payload.

    Error codes: 503 (DB), 500 (generation/persistence).
    """

    from ai.briefing import generate_briefing
    from ai.briefing import LLM_MODEL

    # 1. Acquire pool.
    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})

    # 2. Fetch recent events (top 10 by magnitude DESC).
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, event_id, source, event_type, magnitude,
                       latitude, longitude, place, event_time, url
                FROM events
                ORDER BY magnitude DESC NULLS LAST
                LIMIT 10
                """
            )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})

    if not rows:
        return JSONResponse(
            status_code=200,
            content={"summary": "No events to summarize.", "event_count": 0},
        )

    # Build EarthquakeEvent instances from DB rows.
    events: list[EarthquakeEvent] = []
    event_uuids: list[str] = []
    for r in rows:
        events.append(EarthquakeEvent(
            event_id=r["event_id"],
            source=r["source"],
            event_type=r["event_type"] or "earthquake",
            magnitude=float(r["magnitude"] or 0.0),
            latitude=float(r["latitude"] or 0.0),
            longitude=float(r["longitude"] or 0.0),
            place=r["place"] or "",
            time=str(r["event_time"] or ""),
            url=r["url"] or "",
        ))
        event_uuids.append(str(r["id"]))

    # 3. Generate briefing via LLM.
    try:
        summary = await generate_briefing(events)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})

    # 4. Persist to briefings table.
    try:
        saved = await save_briefing(
            pool,
            briefing_type="daily",
            summary=summary,
            event_ids=event_uuids,
            event_count=len(rows),
            model=LLM_MODEL,
        )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})

    # 5. Return.
    return JSONResponse(
        status_code=200,
        content={
            "id": saved["id"],
            "summary": summary,
            "event_count": len(rows),
            "model": LLM_MODEL,
            "created_at": saved["created_at"].isoformat() if saved["created_at"] else None,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
