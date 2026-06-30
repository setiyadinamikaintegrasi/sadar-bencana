"""Load event-linked or spatial risk context into risk scoring v2."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg

from models.event import EarthquakeEvent
from scoring.risk import RiskScoringContext


def point_in_geojson(latitude: float, longitude: float, geometry: dict[str, Any] | None) -> bool:
    if not geometry:
        return False
    polygons = (
        [geometry.get("coordinates", [])]
        if geometry.get("type") == "Polygon"
        else geometry.get("coordinates", [])
        if geometry.get("type") == "MultiPolygon"
        else []
    )
    for polygon in polygons:
        if not polygon:
            continue
        ring = polygon[0]
        inside = False
        for index, current in enumerate(ring):
            previous = ring[index - 1]
            x1, y1 = current
            x2, y2 = previous
            crosses = (y1 > latitude) != (y2 > latitude) and longitude < (
                (x2 - x1) * (latitude - y1) / ((y2 - y1) or 1e-12) + x1
            )
            if crosses:
                inside = not inside
        if inside:
            return True
    return False


def build_scoring_context(
    event: EarthquakeEvent,
    rows: list[dict[str, Any]],
    evidence_confidence: float | None = None,
) -> RiskScoringContext:
    values: dict[str, Any] = {}
    vintages: list[str] = []
    for row in sorted(rows, key=lambda item: item.get("created_at") or datetime.min.replace(tzinfo=timezone.utc)):
        if row.get("event_id") is not None or point_in_geojson(event.latitude, event.longitude, row.get("area_geojson")):
            values.update(row.get("values") or {})
            if row.get("data_vintage"):
                vintages.append(str(row["data_vintage"]))
    return RiskScoringContext(
        depth_km=values.get("depth_km"),
        mmi=values.get("mmi"),
        pga_g=values.get("pga_g"),
        population_exposed=values.get("population_exposed"),
        vulnerability_index=values.get("vulnerability_index"),
        evidence_confidence=evidence_confidence,
        freshness=values.get("freshness"),
        data_vintage=max(vintages) if vintages else None,
    )


async def load_risk_scoring_contexts(
    pool: asyncpg.Pool,
    events: list[EarthquakeEvent],
) -> dict[str, RiskScoringContext]:
    if not events:
        return {}
    contexts: dict[str, RiskScoringContext] = {}
    async with pool.acquire() as conn:
        for event in events:
            internal_id = await conn.fetchval(
                "SELECT id FROM events WHERE source=$1 AND event_id=$2 LIMIT 1",
                event.source,
                event.event_id,
            )
            rows = await conn.fetch(
                """SELECT event_id, values, area_geojson, data_vintage, created_at
                   FROM risk_context
                   WHERE (event_id=$1 OR event_id IS NULL)
                     AND (peril_type=$2 OR peril_type IS NULL)
                   ORDER BY created_at DESC LIMIT 500""",
                internal_id,
                event.event_type,
            )
            confidence = await conn.fetchval(
                """SELECT max(confidence) FROM event_evidence
                   WHERE event_id=$1 AND relation_type='supports'
                     AND (freshness_expires_at IS NULL OR freshness_expires_at > now())""",
                internal_id,
            )
            contexts[event.event_id] = build_scoring_context(
                event,
                [dict(row) for row in rows],
                float(confidence) if confidence is not None else None,
            )
    return contexts


__all__ = ["build_scoring_context", "load_risk_scoring_contexts", "point_in_geojson"]
