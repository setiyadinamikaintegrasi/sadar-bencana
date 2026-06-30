"""FastAPI entrypoint for the worker service."""

from __future__ import annotations

import logging
import os
from typing import Any

import asyncpg
from fastapi import FastAPI
from pydantic import BaseModel
from uuid import UUID
from fastapi.responses import JSONResponse

from alerts import evaluate_and_create_alerts
from alerts.lifecycle_delivery import (
    enqueue_official_alert_revision,
    process_due_deliveries,
)
from connectors.aisstream import AISStreamConnector
from connectors.bmkg import BMKGConnector
from connectors.bmkg_cap import BMKG_ATTRIBUTION, BMKGCAPConnector
from connectors.gdacs_flood import GDACSFloodConnector
from connectors.gdacs_volcano import GDACSVolcanoConnector
from connectors.gvp_volcano import GVPVolcanoConnector
from connectors.hazard import HazardConnector
from connectors.multi_source import MultiSourceConnector, is_in_indonesia
from connectors.official_feeds import (
    ApprovedJSONFeedConnector,
    extract_official_records,
    normalize_bnpb_impact,
    normalize_inarisk_context,
    normalize_inatews,
    normalize_pvmbg,
    validate_adapter_record,
)
from connectors.nasa_firms import NASAFIRMSConnector
from connectors.opensky import OpenSkyConnector
from connectors.petabencana_flood import PetaBencanaFloodConnector
from connectors.rss_news import RSSNewsConnector
from connectors.usgs import USGSConnector
from connectors.vesselfinder import VesselFinderConnector
from correlation_pipeline import correlate_ingested_events
from db.health import upsert_connector_health
from db.assets import fetch_aircraft, fetch_vessels, upsert_aircraft, upsert_vessels
from db.briefings import save_briefing
from db.events import fetch_top_events, upsert_events
from db.evidence import create_impact_report, create_risk_context, create_source_record
from normalizers.events import merge_events_by_proximity
from db.news import fetch_news, upsert_news_items
from db.official_alerts import expire_official_alert_revisions
from db.official_alerts import upsert_official_alert
from db.pool import close_pool, get_pool, init_pool
from db.source_settings import resolve_source_setting
from db.scoring_context import load_risk_scoring_contexts
from geo.locator import extract_location
from models.event import EarthquakeEvent
from models.evidence import ImpactReportInput, RiskContextInput, SourceRecordInput
from news_alerts import process_news_alerts
from observability import disaster_correlation_id, record_observation
from schedulers.assets import AssetScheduler
from schedulers.briefing import BriefingScheduler
from schedulers.ingest import IngestScheduler
from schedulers.news import NewsScheduler
from schedulers.official_alerts import OfficialAlertExpiryScheduler
from scoring.risk import score_events

logger = logging.getLogger(__name__)

app = FastAPI(title="Risk Monitor Worker", version="0.1.0")

# Module-level scheduler instances. Created lazily in the startup hook so
# they bind to the running event loop. Captured module-level so the
# shutdown hook can stop them.
_scheduler: IngestScheduler | None = None
_briefing_scheduler: BriefingScheduler | None = None
_asset_scheduler: AssetScheduler | None = None
_news_scheduler: NewsScheduler | None = None
_official_alert_expiry_scheduler: OfficialAlertExpiryScheduler | None = None
_lifecycle_delivery_scheduler: IngestScheduler | None = None
_ais_connector: AISStreamConnector | None = None
_vf_connector: VesselFinderConnector | None = None


def _env_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


async def _bmkg_cap_cycle(pool: asyncpg.Pool) -> int:
    setting = await resolve_source_setting(pool, "bmkg_cap")
    if setting is not None:
        if not setting.enabled or not setting.api_url:
            return 0
        rss_url, api_token = setting.api_url, setting.api_token
    else:
        if not _env_enabled("CONNECTOR_BMKG_CAP_ENABLED"):
            return 0
        rss_url, api_token = "https://www.bmkg.go.id/alerts/nowcast/id", None

    connector = BMKGCAPConnector(rss_url=rss_url, api_token=api_token)
    try:
        alerts, detail_errors = await connector.fetch_active()
        created = 0
        for alert in alerts:
            source_url = str(alert.raw_payload.get("source_url") or "")
            correlation_id = disaster_correlation_id(
                alert.source,
                alert.source_alert_id,
            )
            await create_source_record(
                pool,
                SourceRecordInput(
                    source_name="bmkg_cap",
                    source_record_id=alert.source_alert_id,
                    source_type="official",
                    source_url=source_url or None,
                    attribution=BMKG_ATTRIBUTION,
                    observed_at=alert.effective_at,
                    published_at=alert.sent_at,
                    raw_payload=alert.raw_payload,
                ),
            )
            await record_observation(
                pool,
                correlation_id=correlation_id,
                stage="raw_source_ingested",
                source_name=alert.source,
                peril_type="weather",
            )
            official_row, was_created = await upsert_official_alert(pool, alert)
            created += int(was_created)
            await record_observation(
                pool,
                correlation_id=correlation_id,
                stage="official_alert_revision",
                source_name=alert.source,
                peril_type="weather",
                metadata={
                    "revision": official_row.get("revision"),
                    "created": was_created,
                },
            )
            if was_created and _env_enabled("EWS_LIFECYCLE_DELIVERY_ENABLED"):
                await enqueue_official_alert_revision(pool, official_row)

        error_message = "; ".join(detail_errors[:3]) if detail_errors else None
        await upsert_connector_health(
            pool,
            "bmkg_cap",
            len(alerts),
            error_message,
        )
        return created
    except Exception as exc:
        await upsert_connector_health(pool, "bmkg_cap", 0, str(exc))
        logger.warning("BMKG CAP fetch failed: %s", exc)
        return 0
    finally:
        await connector.close()


async def _remaining_official_sources_cycle(pool: asyncpg.Pool) -> int:
    created = 0
    configurations = [
        ("inatews", "CONNECTOR_INATEWS_ENABLED", "INATEWS_FEED_URL"),
        ("pvmbg", "CONNECTOR_PVMBG_ENABLED", "PVMBG_FEED_URL"),
        ("bnpb", "CONNECTOR_BNPB_ENABLED", "BNPB_FEED_URL"),
        ("inarisk", "CONNECTOR_INARISK_ENABLED", "INARISK_FEED_URL"),
    ]
    for source, flag, url_name in configurations:
        setting = await resolve_source_setting(pool, source)
        if setting is not None:
            if not setting.enabled or not setting.api_url:
                continue
            url, api_token, attribution = setting.api_url, setting.api_token, setting.attribution
            run_mode = setting.run_mode
            adapter_version = setting.adapter_version
            field_mapping = setting.field_mapping
        else:
            if not _env_enabled(flag):
                continue
            url = os.getenv(url_name, "").strip()
            api_token, attribution = None, source.upper()
            run_mode, adapter_version, field_mapping = "active", "v1", {}
        connector = ApprovedJSONFeedConnector(source, url, api_token=api_token)
        try:
            payload = await connector.fetch_payload()
            records = extract_official_records(payload, field_mapping)
            valid_count = 0
            errors: list[str] = []
            for record in records:
                try:
                    validate_adapter_record(source, adapter_version, record)
                    normalized = (
                        normalize_inatews(record) if source == "inatews"
                        else normalize_pvmbg(record) if source == "pvmbg"
                        else normalize_bnpb_impact(record) if source == "bnpb"
                        else normalize_inarisk_context(record)
                    )
                    valid_count += 1
                    if run_mode == "dry_run":
                        continue
                    native_value = (
                        record.get("event_group_id")
                        or record.get("volcano_id")
                        or record.get("report_id")
                        or record.get("layer_id")
                    )
                    native_id = str(native_value)
                    source_row, _ = await create_source_record(
                        pool,
                        SourceRecordInput(
                            source_name=source,
                            source_record_id=native_id,
                            source_type="official",
                            source_url=url,
                            attribution=str(record.get("attribution") or attribution),
                            raw_payload=record,
                        ),
                    )
                    if source in {"inatews", "pvmbg"}:
                        _, was_created = await upsert_official_alert(pool, normalized)
                        created += int(was_created)
                    elif source == "bnpb":
                        await create_impact_report(
                            pool,
                            ImpactReportInput(source_record_id=source_row["id"], **normalized),
                        )
                    else:
                        await create_risk_context(
                            pool,
                            RiskContextInput(source_record_id=source_row["id"], **normalized),
                        )
                except Exception as exc:
                    errors.append(str(exc))
                    logger.warning("%s record rejected by %s: %s", source, adapter_version, exc)
            health_error = "; ".join(errors[:3]) if errors else None
            await upsert_connector_health(pool, source, valid_count, health_error)
            logger.info(
                "%s adapter=%s mode=%s valid=%d rejected=%d",
                source, adapter_version, run_mode, valid_count, len(errors),
            )
        except Exception as exc:
            await upsert_connector_health(pool, source, 0, str(exc))
            logger.warning("%s approved feed failed: %s", source, exc)
        finally:
            await connector.close()
    return created


async def _ingest_cycle(pool: asyncpg.Pool) -> dict[str, int]:
    """Run one fetch -> upsert -> score cycle against an active pool.

    Shared by both the on-demand ingest endpoint and the background
    scheduler so they execute identical logic. Tracks health per
    sub-connector in the connector_health table. Raises on any failure.
    """
    official_alerts = await _bmkg_cap_cycle(pool)
    official_alerts += await _remaining_official_sources_cycle(pool)

    # ---- Earthquake sources (BMKG + USGS with geo-aware merge) ----
    bmkg_setting = await resolve_source_setting(pool, "bmkg")
    bmkg_enabled = bmkg_setting is None or bmkg_setting.enabled
    bmkg_custom_url = (
        bmkg_setting.api_url
        if bmkg_setting is not None and bmkg_setting.mode == "custom_api"
        else None
    )
    bmkg_conn = BMKGConnector(feed_url=bmkg_custom_url)
    bmkg_events: list[EarthquakeEvent] = []
    bmkg_error: str | None = None if bmkg_enabled else "disabled"
    try:
        if bmkg_enabled:
            bmkg_events = await bmkg_conn.fetch_recent()
            await upsert_connector_health(pool, "bmkg", len(bmkg_events))
    except Exception as exc:
        bmkg_error = str(exc)
        await upsert_connector_health(pool, "bmkg", 0, bmkg_error)
        logger.warning("BMKG fetch failed: %s", exc)
    finally:
        await bmkg_conn.close()

    usgs_conn = USGSConnector()
    usgs_events: list[EarthquakeEvent] = []
    try:
        usgs_events = await usgs_conn.fetch_recent()
        await upsert_connector_health(pool, "usgs", len(usgs_events))
    except Exception as exc:
        await upsert_connector_health(pool, "usgs", 0, str(exc))
        logger.warning("USGS fetch failed: %s", exc)
    finally:
        await usgs_conn.close()

    # Merge with geo-aware dedup: BMKG wins for Indonesia bbox
    merged: dict[str, EarthquakeEvent] = {}
    for ev in bmkg_events:
        merged[ev.event_id] = ev
    for ev in usgs_events:
        if is_in_indonesia(ev.latitude, ev.longitude) and bmkg_error is None:
            continue
        merged.setdefault(ev.event_id, ev)
    earthquake_events = list(merged.values())

    # ---- Hazard sources (flood, volcano, NASA FIRMS) ----
    # Flood: GDACS (major alerts) + PetaBencana (real-time Indonesia reports).
    gdacs_fl_conn = GDACSFloodConnector()
    gdacs_flood_events: list[EarthquakeEvent] = []
    try:
        gdacs_flood_events = await gdacs_fl_conn.fetch_recent()
        await upsert_connector_health(pool, "gdacs_fl", len(gdacs_flood_events))
    except Exception as exc:
        await upsert_connector_health(pool, "gdacs_fl", 0, str(exc))
        logger.warning("GDACS flood fetch failed: %s", exc)
    finally:
        await gdacs_fl_conn.close()

    petabencana_conn = PetaBencanaFloodConnector()
    petabencana_flood_events: list[EarthquakeEvent] = []
    try:
        petabencana_flood_events = await petabencana_conn.fetch_recent()
        await upsert_connector_health(pool, "petabencana", len(petabencana_flood_events))
    except Exception as exc:
        await upsert_connector_health(pool, "petabencana", 0, str(exc))
        logger.warning("PetaBencana flood fetch failed: %s", exc)
    finally:
        await petabencana_conn.close()

    # PetaBencana points are the fresher signal; GDACS area centroids fill gaps.
    flood_events = merge_events_by_proximity(petabencana_flood_events, gdacs_flood_events)

    # Volcano: GVP weekly report (fresh, Indonesia-rich) + GDACS VO (alerts).
    gvp_vo_conn = GVPVolcanoConnector()
    gvp_volcano_events: list[EarthquakeEvent] = []
    try:
        gvp_volcano_events = await gvp_vo_conn.fetch_recent()
        await upsert_connector_health(pool, "gvp", len(gvp_volcano_events))
    except Exception as exc:
        await upsert_connector_health(pool, "gvp", 0, str(exc))
        logger.warning("GVP volcano fetch failed: %s", exc)
    finally:
        await gvp_vo_conn.close()

    gdacs_vo_conn = GDACSVolcanoConnector()
    gdacs_volcano_events: list[EarthquakeEvent] = []
    try:
        gdacs_volcano_events = await gdacs_vo_conn.fetch_recent()
        await upsert_connector_health(pool, "gdacs_vo", len(gdacs_volcano_events))
    except Exception as exc:
        await upsert_connector_health(pool, "gdacs_vo", 0, str(exc))
        logger.warning("GDACS volcano fetch failed: %s", exc)
    finally:
        await gdacs_vo_conn.close()

    # GVP refreshes weekly and is preferred; drop GDACS duplicates of the same volcano.
    volcano_events = merge_events_by_proximity(gvp_volcano_events, gdacs_volcano_events)

    nasa_conn = NASAFIRMSConnector()
    wildfire_events: list[EarthquakeEvent] = []
    try:
        wildfire_events = await nasa_conn.fetch_recent()
        await upsert_connector_health(pool, "nasa_firms", len(wildfire_events))
    except Exception as exc:
        await upsert_connector_health(pool, "nasa_firms", 0, str(exc))
        logger.warning("NASA FIRMS fetch failed: %s", exc)
    finally:
        await nasa_conn.close()

    all_events = earthquake_events + flood_events + volcano_events + wildfire_events

    upserted = await upsert_events(pool, all_events)
    correlations = 0
    if _env_enabled("EVIDENCE_CORRELATION_ENABLED"):
        try:
            correlation_result = await correlate_ingested_events(pool, all_events)
            correlations = correlation_result["recorded"]
        except Exception as exc:
            logger.warning("Evidence correlation shadow mode failed: %s", exc)
    try:
        scoring_contexts = await load_risk_scoring_contexts(pool, all_events)
    except Exception as exc:
        logger.warning("Risk context loading failed; using scoring defaults: %s", exc)
        scoring_contexts = {}
    scored = await score_events(pool, all_events, scoring_contexts)
    alerts = await evaluate_and_create_alerts(pool, all_events)

    return {
        "fetched": len(all_events),
        "upserted": upserted,
        "scored": scored,
        "alerts_created": len(alerts),
        "official_alerts": official_alerts,
        "correlations": correlations,
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
        await upsert_connector_health(pool, "opensky", aircraft_count)
    except Exception as e:
        logger.warning("OpenSky poll failed: %s", e)
        await upsert_connector_health(pool, "opensky", 0, str(e))

    # --- Marine: AISStream (WebSocket buffer drain) ---
    vessel_count = 0
    if _ais_connector and _ais_connector.is_configured:
        try:
            vessels = _ais_connector.drain()
            if vessels:
                vessel_count = await upsert_vessels(pool, vessels)
            await upsert_connector_health(pool, "aisstream", vessel_count)
        except Exception as e:
            logger.warning("AIS drain failed: %s", e)
            await upsert_connector_health(pool, "aisstream", 0, str(e))

    # --- Marine: VesselFinder (REST) ---
    if _vf_connector and _vf_connector.configured:
        try:
            vf_positions = await _vf_connector.fetch_positions()
            vf_count = 0
            if vf_positions:
                converted = [p.to_vessel_position() for p in vf_positions]
                vf_count = await upsert_vessels(pool, converted)
                vessel_count += vf_count
            await upsert_connector_health(pool, "vesselfinder", vf_count)
        except Exception as e:
            logger.warning("VesselFinder poll failed: %s", e)
            await upsert_connector_health(pool, "vesselfinder", 0, str(e))

    return {"vessels": vessel_count, "aircraft": aircraft_count}


async def _news_poll_cycle() -> int:
    """Poll configured RSS feeds, geolocate, upsert, and create alerts."""

    pool = get_pool()
    connector = RSSNewsConnector()
    try:
        items, health_results = await connector.fetch_all()

        for source_name, health_val in health_results.items():
            if isinstance(health_val, int):
                await upsert_connector_health(pool, source_name, health_val)
            else:
                await upsert_connector_health(pool, source_name, 0, health_val)

        for item in items:
            loc = await extract_location(item.title, item.summary, pool)
            if loc:
                item.lat = loc[1]
                item.lon = loc[2]
                setattr(item, "place_name", loc[0])

        id_map = await upsert_news_items(pool, items)

        for item in items:
            db_uuid = id_map.get(item.item_id)
            if getattr(item, "lat", None) is not None and db_uuid:
                await process_news_alerts(pool, item, db_uuid)

        return len(id_map)
    finally:
        await connector.close()


async def _expire_official_alerts_once() -> int:
    pool = get_pool()
    expired = await expire_official_alert_revisions(pool)
    if _env_enabled("EWS_LIFECYCLE_DELIVERY_ENABLED"):
        for revision in expired:
            await enqueue_official_alert_revision(pool, revision)
    return len(expired)


async def _process_lifecycle_deliveries_once() -> dict[str, int]:
    return await process_due_deliveries(get_pool())


@app.on_event("startup")
async def startup_event() -> None:
    """Bring up long-lived resources: PostgreSQL pool + schedulers.

    The DB is optional for some endpoints (health/status), so a failed
    pool init is logged as a warning rather than crashing the app. The
    schedulers are started regardless: even with a degraded DB they will
    simply log failures each tick and recover once the pool is available.
    """

    global _scheduler, _briefing_scheduler, _asset_scheduler, _news_scheduler
    global _official_alert_expiry_scheduler, _lifecycle_delivery_scheduler
    global _ais_connector, _vf_connector

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

    _official_alert_expiry_scheduler = OfficialAlertExpiryScheduler(
        expire_fn=_expire_official_alerts_once,
    )
    _official_alert_expiry_scheduler.start()

    if _env_enabled("EWS_LIFECYCLE_DELIVERY_ENABLED"):
        _lifecycle_delivery_scheduler = IngestScheduler(
            ingest_fn=_process_lifecycle_deliveries_once,
            interval_seconds=30,
            name="ews-lifecycle-delivery",
        )
        _lifecycle_delivery_scheduler.start()

    logger.info(
        "Worker startup complete; background ingestion, auto-briefing, "
        "asset tracking, and RSS news polling are enabled."
    )


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """Stop the schedulers and release the PostgreSQL connection pool."""

    global _scheduler, _briefing_scheduler, _asset_scheduler, _news_scheduler
    global _official_alert_expiry_scheduler, _lifecycle_delivery_scheduler
    global _ais_connector, _vf_connector
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

    if _official_alert_expiry_scheduler is not None:
        await _official_alert_expiry_scheduler.stop()
        _official_alert_expiry_scheduler = None

    if _lifecycle_delivery_scheduler is not None:
        await _lifecycle_delivery_scheduler.stop()
        _lifecycle_delivery_scheduler = None

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


class RegionalAnalysisRequest(BaseModel):
    question: str
    snapshot: dict[str, Any]


@app.post("/api/v1/worker/ai/regional-analysis")
async def regional_analysis(request: RegionalAnalysisRequest) -> dict[str, Any]:
    from ai.regional_analyst import analyze_regional_snapshot
    from db.regional_analysis import save_regional_analysis

    output = analyze_regional_snapshot(request.snapshot, request.question)
    await save_regional_analysis(get_pool(), request.question, request.snapshot, output)
    return {"data": output}


@app.post("/api/v1/worker/historical/backfill/{job_id}")
async def historical_backfill(job_id: UUID) -> dict[str, Any]:
    from historical_backfill import run_backfill_job
    return {"data": await run_backfill_job(get_pool(), job_id)}


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

    Returns counters for fetched events, persistence, scoring, generated
    alerts, and ingested official alerts.
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
            content={
                "fetched": 0,
                "upserted": 0,
                "scored": 0,
                "alerts_created": 0,
                "official_alerts": 0,
                "correlations": 0,
                "error": str(exc),
            },
        )

    try:
        result = await _ingest_cycle(pool)
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "fetched": 0,
                "upserted": 0,
                "scored": 0,
                "alerts_created": 0,
                "official_alerts": 0,
                "correlations": 0,
                "error": str(exc),
            },
        )

    return JSONResponse(status_code=200, content=result)


@app.post("/api/v1/worker/briefings/generate")
async def worker_generate_briefing() -> JSONResponse:
    """Generate a risk monitoring briefing from recent events using local LLM.

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


@app.post("/api/v1/worker/news")
async def worker_news_poll() -> JSONResponse:
    """Manually trigger an RSS news poll cycle."""

    try:
        upserted = await _news_poll_cycle()
        return JSONResponse(status_code=200, content={"upserted": upserted})
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


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


# ---------------------------------------------------------------------------
# EWS: Early Warning System test dispatch
# ---------------------------------------------------------------------------

@app.post("/api/v1/worker/ews/test-dispatch/{subscriber_id}")
async def ews_test_dispatch(subscriber_id: str) -> JSONResponse:
    """Send a test notification to a subscriber via all their active channels."""

    from alerts.channels import CHANNELS
    from db.subscribers import fetch_active_subscribers, fetch_subscriber_prefs

    try:
        pool = get_pool()
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})

    subscribers = await fetch_active_subscribers(pool)
    target = next(
        (s for s in subscribers if str(s["id"]) == subscriber_id), None
    )
    if not target:
        return JSONResponse(
            status_code=404, content={"error": "subscriber not found"}
        )

    message = (
        f"[Sadar Bencana EWS] Test notification for {target['name']}. "
        f"If you received this, EWS is working correctly."
    )

    prefs = await fetch_subscriber_prefs(pool, target["id"])
    results: list[dict[str, Any]] = []
    for pref in prefs:
        channel = pref["channel"]
        adapter = CHANNELS.get(channel)
        if not adapter:
            continue
        recipient = None
        if channel == "telegram":
            recipient = str(target.get("telegram_chat_id") or "") or None
        elif channel == "whatsapp":
            recipient = target.get("phone_whatsapp")
        elif channel == "email":
            recipient = target.get("email")
        if not recipient:
            results.append(
                {"channel": channel, "status": "skipped", "reason": "no_address"}
            )
            continue
        res = await adapter.send(recipient, message)
        results.append({
            "channel": channel,
            "status": "sent" if res["success"] else "failed",
            "error": res.get("error"),
        })

    return JSONResponse(
        status_code=200,
        content={"subscriber": target["name"], "results": results},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)
