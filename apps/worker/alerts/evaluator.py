"""Alert evaluator: inspects events against thresholds and exposure rules."""

from __future__ import annotations

import logging
from typing import Any

import asyncpg

from alerts.notifier import send_telegram
from db.alerts import create_alert, has_alert
from models.event import EarthquakeEvent

logger = logging.getLogger(__name__)

# Magnitude thresholds for alert severity classification.
_MAG_CRITICAL = 6.5
_MAG_HIGH = 5.5
_MAG_MODERATE = 5.0

# Risk-score threshold for generating risk_score alerts.
_RISK_SCORE_THRESHOLD = 80

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


def _severity_for(magnitude: float) -> str:
    """Map magnitude to alert severity string."""
    if magnitude >= _MAG_CRITICAL:
        return "Critical"
    if magnitude >= _MAG_HIGH:
        return "High"
    return "Moderate"


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

    For each event with magnitude >= 5.0:
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
        if magnitude < _MAG_MODERATE:
            continue

        place = event.place or ""
        event_uuid = event.event_id
        if not event_uuid:
            continue

        rule = _match_region(place, rules)
        if rule is None:
            continue

        alert_type = "earthquake"

        # Resolve the internal UUID from the external event_id string.
        async with pool.acquire() as conn:
            uuid_row = await conn.fetchrow(_RESOLVE_EVENT_UUID_SQL, event_uuid)
        if uuid_row is None:
            logger.warning("Event %s not found in DB, skipping", event_uuid)
            continue
        internal_uuid = uuid_row["id"]

        if await has_alert(pool, internal_uuid, alert_type):
            continue

        severity = _severity_for(magnitude)
        estimated_impact = rule["total_exposure"] * rule["risk_multiplier"]
        message = (
            f"{severity} earthquake M{magnitude:.1f} near {place} — "
            f"potential impact on {rule['portfolio_name']} portfolio "
            f"({rule['currency']} {estimated_impact:,.0f})"
        )

        record = await create_alert(
            pool, internal_uuid, alert_type, severity, message
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
            await send_telegram(message)

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
            pool, internal_uuid, "risk_score", "High", message
        )
        if record:
            created.append(record)
            logger.info("Risk-score alert: %s", ext_event_id)
            await send_telegram(message)

    return created


# Alias so main.py can import either name.
evaluate_and_create_alerts = evaluate_alerts
