"""FastAPI entrypoint for the worker service."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from alerts import evaluate_and_create_alerts
from connectors.aisstream import AISStreamConnector
from connectors.hazard import HazardConnector
from connectors.multi_source import MultiSourceConnector
from connectors.opensky import OpenSkyConnector
from connectors.rss_news import RSSNewsConnector
from connectors.vesselfinder import VesselFinderConnector
from db.assets import fetch_aircraft, fetch_vessels, upsert_aircraft, upsert_vessels
from db.briefings import save_briefing
from db.events import fetch_top_events, upsert_events
from db.news import fetch_news, upsert_news_items
from db.pool import close_pool, get_pool, init_pool
from models.event import EarthquakeEvent
from schedulers.assets import AssetScheduler
from schedulers.briefing import BriefingScheduler
from schedulers.ingest import IngestScheduler
from schedulers.news import NewsScheduler
from scoring.risk import score_events

logger = logging.getLogger(__name__)

app = FastAPI(title="Reinsurance Risk Monitor Worker", version="0.1.0")

# Module-level scheduler instances. Created lazily in the startup hook so
# they bind to the running event loop. Captured module-level so the
# shutdown hook can stop them.
_scheduler: IngestScheduler | None = None
_briefing_scheduler: BriefingScheduler | None = None
_asset_scheduler: AssetScheduler | None = None
_news_scheduler: NewsScheduler | None = None
_ais_connector: AISStreamConnector | None = None
_vf_connector: VesselFinderConnector | None = None


async def _ingest_cycle(pool: asyncpg.Pool) -> dict[str, int]:
    """Run one fetch -> upsert -> score cycle against an active pool.

    Shared by both the on-demand ingest endpoint and the background
    scheduler so they execute identical logic. The caller is responsible
    for acquiring the pool (and mapping failures to HTTP status codes
    where applicable). Raises on any failure.
    """

    connector = MultiSourceConnector()
    hazard_connector = HazardConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
    finally:
        await connector.close()

    try:
        hazard_events: list[EarthquakeEvent] = await hazard_connector.fetch_recent()
    finally:
        await hazard_connector.close()

    all_events = events + hazard_events

    upserted = await upsert_events(pool, all_events)
    scored = await score_events(pool, all_events)
    alerts = await evaluate_and_create_alerts(pool, all_events)

    return {
        "fetched": len(all_events),
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


async def _asset_poll_cycle() -> dict[str, int]:
    """Poll OpenSky (REST) + drain AIS buffer + poll VesselFinder, then upsert to DB.

    Called every 60s by the AssetScheduler. Degrades gracefully:
    if any source is unreachable or unconfigured, it logs and continues.
    """
    pool = get_pool()

    # --- Aviation (OpenSky REST) ---
    aircraft_count = 0
    try:
        sky = OpenSkyConnector()
        states = await sky.fetch_states()
        if states:
            aircraft_count = await upsert_aircraft(pool, states)
    except Exception as e:
        logger.warning("OpenSky poll failed: %s", e)

    # --- Marine: AISStream (WebSocket buffer drain) ---
    vessel_count = 0
    if _ais_connector and _ais_connector.is_configured:
        try:
            vessels = _ais_connector.drain()
            if vessels:
                vessel_count = await upsert_vessels(pool, vessels)
        except Exception as e:
            logger.warning("AIS drain failed: %s", e)

    # --- Marine: VesselFinder (REST) ---
    if _vf_connector and _vf_connector.configured:
        try:
            vf_positions = await _vf_connector.fetch_positions()
            if vf_positions:
                converted = [p.to_vessel_position() for p in vf_positions]
                vf_count = await upsert_vessels(pool, converted)
                vessel_count += vf_count
        except Exception as e:
            logger.warning("VesselFinder poll failed: %s", e)

    return {"vessels": vessel_count, "aircraft": aircraft_count}


async def _news_poll_cycle() -> int:
    """Poll configured RSS feeds and upsert them into news_items."""

    pool = get_pool()
    connector = RSSNewsConnector()
    try:
        items = await connector.fetch_all()
        id_map = await upsert_news_items(pool, items)
        return len(id_map)
    finally:
        await connector.close()


@app.on_event("startup")
async def startup_event() -> None:
    """Bring up long-lived resources: PostgreSQL pool + schedulers.

    The DB is optional for some endpoints (health/status), so a failed
    pool init is logged as a warning rather than crashing the app. The
    schedulers are started regardless: even with a degraded DB they will
    simply log failures each tick and recover once the pool is available.
    """

    global _scheduler, _briefing_scheduler, _asset_scheduler, _news_scheduler, _ais_connector, _vf_connector

    try:
        await init_pool()
        logger.info("PostgreSQL connection pool initialized.")
    except Exception as exc:  # pragma: no cover
        logger.warning("Could not initialize DB pool at startup: %s", exc)

    # Start the background ingest loop (every 5 minutes by default).
    _scheduler = IngestScheduler(ingest_fn=_ingest_once)
    _scheduler.start()

    # Start the background briefing loop (every 6 hours by default).
    _briefing_scheduler = BriefingScheduler(briefing_fn=_generate_briefing_once)
    _briefing_scheduler.start()

    # Start AIS WebSocket connector (background, continuous stream).
    _ais_connector = AISStreamConnector()
    await _ais_connector.start()

    # Start VesselFinder REST connector (credit-based, on-demand polling).
    _vf_connector = VesselFinderConnector()

    # Start asset position polling (OpenSky REST + AIS drain + VesselFinder, every 60s).
    _asset_scheduler = AssetScheduler(poll_fn=_asset_poll_cycle, interval_seconds=60)
    _asset_scheduler.start()

    # Start RSS news polling (every 15 minutes).
    _news_scheduler = NewsScheduler(poll_fn=_news_poll_cycle)
    _news_scheduler.start()

    logger.info(
        "Worker startup complete; background ingestion, auto-briefing, "
        "asset tracking, and RSS news polling are enabled."
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Stop the schedulers and release the PostgreSQL connection pool."""

    global _scheduler, _briefing_scheduler, _asset_scheduler, _news_scheduler, _ais_connector, _vf_connector
    if _scheduler is not None:
        await _scheduler.stop()
        _scheduler = None

    if _briefing_scheduler is not None:
        await _briefing_scheduler.stop()
        _briefing_scheduler = None

    if _asset_scheduler is not None:
        await _asset_scheduler.stop()
        _asset_scheduler = None

    if _news_scheduler is not None:
        await _news_scheduler.stop()
        _news_scheduler = None

    if _ais_connector is not None:
        await _ais_connector.stop()
        _ais_connector = None

    if _vf_connector is not None:
        await _vf_connector.close()
        _vf_connector = None

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
    """Fetch recent earthquake + hazard events and return a small response payload."""

    connector = MultiSourceConnector()
    hazard_connector = HazardConnector()
    try:
        events: list[EarthquakeEvent] = await connector.fetch_recent()
        hazard_events: list[EarthquakeEvent] = await hazard_connector.fetch_recent()
        all_events = events + hazard_events
        return {
            "count": len(all_events),
            "events": [event.model_dump() for event in all_events[:20]],
        }
    except Exception as exc:
        return {"count": 0, "events": [], "error": str(exc)}
    finally:
        await connector.close()
        await hazard_connector.close()


@app.post("/api/v1/worker/ingest")
async def worker_ingest() -> JSONResponse:
    """Fetch earthquake + hazard events, upsert them, and compute risk scores.

    Returns ``{"fetched": N, "upserted": M, "scored": K, "alerts_created": A}`` on success.
    Distinct failure modes map to distinct HTTP status codes:
      * 503 — DB pool not ready
      * 502 — upstream connector fetch failed
      * 500 — upsert or scoring failed
    """

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(
            status_code=503,
            content={"fetched": 0, "upserted": 0, "scored": 0, "alerts_created": 0, "error": str(exc)},
        )

    try:
        result = await _ingest_cycle(pool)
    except Exception as exc:
        message = str(exc)
        status_code = 500
        if "All sources failed" in message or "All hazard sources failed" in message:
            status_code = 502
        return JSONResponse(
            status_code=status_code,
            content={
                "fetched": 0,
                "upserted": 0,
                "scored": 0,
                "alerts_created": 0,
                "error": message,
            },
        )

    return JSONResponse(status_code=200, content=result)


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


@app.get("/api/v1/worker/news")
async def worker_news_latest() -> dict[str, Any]:
    """Return the most recent news items from the database."""

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}

    try:
        rows = await fetch_news(pool, limit=100)
        for row in rows:
            for key, value in list(row.items()):
                if hasattr(value, "isoformat"):
                    row[key] = value.isoformat()
        return {"data": rows, "meta": {"count": len(rows)}}
    except Exception as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}


# ---------------------------------------------------------------------------
# M9: Asset tracking endpoints (marine + aviation)
# ---------------------------------------------------------------------------

@app.get("/api/v1/assets/marine")
async def assets_marine() -> dict:
    """Return latest vessel positions from the database."""

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}

    try:
        rows = await fetch_vessels(pool)
        return {"data": rows, "meta": {"count": len(rows)}}
    except Exception as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}


@app.get("/api/v1/assets/aviation")
async def assets_aviation() -> dict:
    """Return latest aircraft positions from the database."""

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}

    try:
        rows = await fetch_aircraft(pool)
        return {"data": rows, "meta": {"count": len(rows)}}
    except Exception as exc:
        return {"data": [], "meta": {"count": 0}, "error": str(exc)}


@app.post("/api/v1/worker/assets/poll")
async def worker_asset_poll() -> JSONResponse:
    """Manually trigger an asset poll (OpenSky + AIS drain + DB upsert).

    Useful for testing without waiting for the 60s scheduler interval.
    """

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})

    try:
        result = await _asset_poll_cycle()
        return JSONResponse(status_code=200, content=result)
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
