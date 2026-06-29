"""Alert evaluator: inspects events against thresholds and exposure rules."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

from alerts.dispatcher import dispatch_alert
from db.alerts import create_alert, has_alert
from models.event import EarthquakeEvent
from scoring.risk import classify_severity_by_type

logger = logging.getLogger(__name__)

# Risk-score threshold for generating risk_score alerts.
_RISK_SCORE_THRESHOLD = 80

_MIN_ALERT_MAGNITUDE_BY_TYPE: dict[str, float] = {
    "earthquake": 5.0,
    "flood": 3.0,
    "volcano": 3.0,
    "wildfire": 4.0,
}

_OFFICIAL_SOURCES = {"bmkg"}
_CORROBORATED_SOURCES = {
    "usgs",
    "gdacs_fl",
    "gdacs_vo",
    "gvp",
    "nasa_firms",
}

_LOAD_EXPOSURE_SQL = """
SELECT region_name, region_keywords, total_exposure, currency,
       risk_multiplier, portfolio_name
FROM exposure_rules
"""

_LOAD_HIGH_RISK_SQL = """
SELECT rs.entity_id, e.place, e.magnitude
FROM risk_scores rs
JOIN events e ON rs.entity_id = e.event_id
WHERE rs.entity_type = 'event' AND rs.score >= $1
"""

_RESOLVE_EVENT_UUID_SQL = """
SELECT id FROM events WHERE event_id = $1 LIMIT 1
"""


def _should_alert_event(event_type: str, magnitude: float) -> bool:
    """Return whether a peril-specific magnitude/proxy crosses its alert floor."""
    threshold = _MIN_ALERT_MAGNITUDE_BY_TYPE.get(event_type)
    return threshold is not None and magnitude >= threshold


def _severity_for_event(event_type: str, magnitude: float) -> str:
    """Classify without changing the existing earthquake escalation bands."""
    if event_type == "earthquake":
        if magnitude >= 6.5:
            return "Critical"
        if magnitude >= 5.5:
            return "High"
        return "Moderate"
    return classify_severity_by_type(magnitude, event_type)


def _verification_status_for_source(source: str) -> str:
    """Map current structured sources to a conservative verification status."""
    normalized = source.lower()
    if normalized in _OFFICIAL_SOURCES:
        return "official"
    if normalized in _CORROBORATED_SOURCES:
        return "corroborated"
    return "unverified"


async def _load_exposure_rules(
    pool: asyncpg.Pool,
) -> list[dict[str, Any]]:
    """Fetch all exposure rules as a list of dicts with lowercased keywords."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_LOAD_EXPOSURE_SQL)
    return [
        {
            "region_name": r["region_name"],
            "keywords": [k.lower() for k in r["region_keywords"] or []],
            "total_exposure": float(r["total_exposure"]),
            "currency": r["currency"],
            "risk_multiplier": float(r["risk_multiplier"]),
            "portfolio_name": r["portfolio_name"],
        }
        for r in rows
    ]


def _match_region(
    place: str, rules: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Return the first exposure rule whose keywords appear in *place*."""
    place_lower = place.lower()
    for rule in rules:
        if any(kw in place_lower for kw in rule["keywords"]):
            return rule
    return None


async def evaluate_alerts(
    pool: asyncpg.Pool, events: list[EarthquakeEvent]
) -> list[dict[str, Any]]:
    """Evaluate events against thresholds + exposure rules, create alerts.

    For each event crossing its peril-specific threshold:
      - Match the event place against exposure rule keywords.
      - Classify severity by magnitude.
      - Dedup against existing alerts (event_id + alert_type).
      - Persist a new alert and optionally send a Telegram notification.

    Also checks the risk_scores table for scores >= 80 and creates
    risk_score alerts for those events (deduped separately).

    Returns the list of newly-created alert records.
    """

    rules = await _load_exposure_rules(pool)
    created: list[dict[str, Any]] = []

    for event in events:
        magnitude = float(event.magnitude)
        event_type = (event.event_type or "").lower()
        if not _should_alert_event(event_type, magnitude):
            continue

        place = event.place or ""
        event_uuid = event.event_id
        if not event_uuid:
            continue

        rule = _match_region(place, rules)
        if rule is None:
            continue

        alert_type = event_type

        # Resolve the internal UUID from the external event_id string.
        async with pool.acquire() as conn:
            uuid_row = await conn.fetchrow(_RESOLVE_EVENT_UUID_SQL, event_uuid)
        if uuid_row is None:
            logger.warning("Event %s not found in DB, skipping", event_uuid)
            continue
        internal_uuid = uuid_row["id"]

        if await has_alert(pool, internal_uuid, alert_type):
            continue

        severity = _severity_for_event(event_type, magnitude)
        estimated_impact = rule["total_exposure"] * rule["risk_multiplier"]
        peril_label = event_type.replace("_", " ")
        message = (
            f"{severity} {peril_label} signal {magnitude:.1f} near {place} — "
            f"potential impact on {rule['portfolio_name']} portfolio "
            f"({rule['currency']} {estimated_impact:,.0f})"
        )

        record = await create_alert(
            pool,
            internal_uuid,
            alert_type,
            severity,
            message,
            verification_status=_verification_status_for_source(event.source),
            source_names=[event.source],
        )
        if record:
            created.append(record)
            logger.info(
                "Alert created: %s M%.1f %s → %s",
                severity,
                magnitude,
                place,
                rule["portfolio_name"],
            )
            await dispatch_alert(pool, record, {
                "latitude": event.latitude,
                "longitude": event.longitude,
                "magnitude": magnitude,
                "event_type": event_type,
                "source": event.source,
            })

    # Risk-score alerts (score >= 80).
    async with pool.acquire() as conn:
        high_risk_rows = await conn.fetch(_LOAD_HIGH_RISK_SQL, _RISK_SCORE_THRESHOLD)

    for row in high_risk_rows:
        ext_event_id = row["entity_id"]

        # Resolve internal UUID for the FK constraint.
        async with pool.acquire() as conn:
            uuid_row = await conn.fetchrow(_RESOLVE_EVENT_UUID_SQL, ext_event_id)
        if uuid_row is None:
            continue
        internal_uuid = uuid_row["id"]

        if await has_alert(pool, internal_uuid, "risk_score"):
            continue

        magnitude = float(row["magnitude"] or 0)
        place = row["place"] or "unknown"
        message = (
            f"High risk score for M{magnitude:.1f} near {place} — "
            f"automated risk assessment exceeded threshold"
        )
        record = await create_alert(
            pool,
            internal_uuid,
            "risk_score",
            "High",
            message,
            verification_status="unverified",
            source_names=["risk_engine"],
        )
        if record:
            created.append(record)
            logger.info("Risk-score alert: %s", ext_event_id)
            await dispatch_alert(pool, record, {
                "latitude": None,  # risk-score alerts may not have geo
                "longitude": None,
                "magnitude": magnitude,
                "event_type": "risk_score",
            })

    return created


# Alias so main.py can import either name.
evaluate_and_create_alerts = evaluate_alerts
