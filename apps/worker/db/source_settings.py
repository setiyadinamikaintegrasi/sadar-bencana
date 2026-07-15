"""Resolve official source settings with custom > environment > public default priority."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

logger = logging.getLogger(__name__)


class MissingSourceSettingError(RuntimeError):
    """The control plane exists but has no row for a required source."""


@dataclass(frozen=True)
class ResolvedSourceSetting:
    source_name: str
    enabled: bool
    api_url: str | None
    api_token: str | None
    mode: str
    attribution: str
    run_mode: str
    adapter_version: str
    field_mapping: dict[str, str]
    config_version: int
    poll_interval_seconds: int
    expected_interval_seconds: int
    last_polled_at: datetime | None


_ENV_URLS = {
    "bmkg_air_quality": "BMKG_AIR_QUALITY_FEED_URL",
    "inatews": "INATEWS_FEED_URL",
    "pvmbg": "PVMBG_FEED_URL",
    "bnpb": "BNPB_FEED_URL",
    "inarisk": "INARISK_FEED_URL",
}

_WORKER_SHADOW_COUNT_SQL = {
    "official_alerts": "SELECT count(*) FROM official_alerts WHERE source = $1",
    "air_quality_observations": (
        "SELECT count(*) FROM air_quality_observations WHERE source = $1"
    ),
    "ews_notification_log": (
        "SELECT count(*) FROM ews_notification_log WHERE source = $1"
    ),
    "source_records": "SELECT count(*) FROM source_records WHERE source_name = $1",
    "disaster_observability_events": (
        "SELECT count(*) FROM disaster_observability_events WHERE source_name = $1"
    ),
}

_PERSISTED_SOURCE_NAMES = {
    ("bmkg_air_quality", "air_quality_observations"): "bmkg",
}

_RESERVE_POLL_SQL = """
INSERT INTO connector_health (
    name, last_polled_at, items_fetched, error_message, updated_at
)
SELECT $1, $3, 0, NULL, now()
FROM official_source_settings source_setting
WHERE source_setting.source_name = $1
  AND source_setting.enabled = TRUE
  AND source_setting.run_mode IN ('active', 'dry_run')
  AND source_setting.config_version = $2
ON CONFLICT (name) DO UPDATE SET
    last_polled_at = EXCLUDED.last_polled_at,
    items_fetched = 0,
    error_message = NULL,
    updated_at = now()
WHERE connector_health.last_polled_at IS NULL
   OR connector_health.last_polled_at
      <= EXCLUDED.last_polled_at - ($4 * interval '1 second')
RETURNING TRUE
"""

_RESERVE_LEGACY_POLL_SQL = """
INSERT INTO connector_health (
    name, last_polled_at, items_fetched, error_message, updated_at
)
VALUES ($1, $2, 0, NULL, now())
ON CONFLICT (name) DO UPDATE SET
    last_polled_at = EXCLUDED.last_polled_at,
    items_fetched = 0,
    error_message = NULL,
    updated_at = now()
WHERE connector_health.last_polled_at IS NULL
   OR connector_health.last_polled_at
      <= EXCLUDED.last_polled_at - ($3 * interval '1 second')
RETURNING TRUE
"""


async def resolve_source_setting(
    pool: asyncpg.Pool,
    source_name: str,
) -> ResolvedSourceSetting | None:
    key = os.getenv("OFFICIAL_SOURCE_SETTINGS_KEY", "")
    try:
        async with pool.acquire() as conn:
            try:
                row = await conn.fetchrow(
                    """SELECT source_name, enabled, mode, default_api_url, custom_api_url,
                          attribution, run_mode, adapter_version, field_mapping,
                          config_version, poll_interval_seconds,
                          expected_interval_seconds,
                          (SELECT last_polled_at FROM connector_health
                           WHERE name = oss.source_name) AS last_polled_at,
                          CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
                            THEN pgp_sym_decrypt(api_token_encrypted, $2) END AS api_token
                       FROM official_source_settings oss WHERE oss.source_name=$1""",
                    source_name,
                    key,
                )
            except asyncpg.UndefinedColumnError:
                row = await conn.fetchrow(
                    """SELECT source_name, enabled, mode, default_api_url, custom_api_url,
                              attribution, run_mode, adapter_version, field_mapping,
                              config_version, 600 AS poll_interval_seconds,
                              expected_interval_seconds,
                              (SELECT last_polled_at FROM connector_health
                               WHERE name = oss.source_name) AS last_polled_at,
                              CASE WHEN api_token_encrypted IS NOT NULL AND $2 <> ''
                                THEN pgp_sym_decrypt(api_token_encrypted, $2) END AS api_token
                       FROM official_source_settings oss WHERE oss.source_name=$1""",
                    source_name,
                    key,
                )
    except asyncpg.UndefinedTableError:
        # A pre-control-plane database intentionally uses legacy environment
        # configuration. All other read/decryption failures remain fail-closed.
        return None
    if row is None:
        raise MissingSourceSettingError(
            f"official source setting row is missing: {source_name}"
        )
    mode = row["mode"]
    environment_url = os.getenv(_ENV_URLS.get(source_name, ""), "").strip() or None
    if mode == "custom_api":
        api_url = row["custom_api_url"]
    elif mode == "default_public":
        api_url = row["default_api_url"]
    else:
        api_url = row["custom_api_url"] or environment_url or row["default_api_url"]
    run_mode = str(row.get("run_mode") or ("active" if row["enabled"] else "disabled"))
    raw_mapping = row.get("field_mapping") or {}
    if isinstance(raw_mapping, str):
        raw_mapping = json.loads(raw_mapping)
    mapping: dict[str, str] = {
        str(key): str(value)
        for key, value in dict(raw_mapping).items()
    }
    return ResolvedSourceSetting(
        source_name=source_name,
        enabled=bool(row["enabled"]) and run_mode != "disabled",
        api_url=api_url,
        api_token=row["api_token"],
        mode=mode,
        attribution=row["attribution"],
        run_mode=run_mode,
        adapter_version=str(row.get("adapter_version") or "v1"),
        field_mapping=mapping,
        config_version=int(row.get("config_version") or 1),
        poll_interval_seconds=int(row.get("poll_interval_seconds") or 600),
        expected_interval_seconds=int(row.get("expected_interval_seconds") or 600),
        last_polled_at=row.get("last_polled_at"),
    )


async def source_write_is_allowed(
    connection: asyncpg.Connection,
    source_name: str,
    config_version: int,
) -> bool:
    """Lock and verify the active config before writes in the same transaction."""
    row = await connection.fetchrow(
        """SELECT enabled, run_mode, config_version
           FROM official_source_settings
           WHERE source_name = $1
           FOR SHARE""",
        source_name,
    )
    if row is None:
        return False
    return (
        bool(row["enabled"])
        and str(row["run_mode"]) == "active"
        and int(row["config_version"]) == config_version
    )


async def reserve_source_poll_slot(
    pool: asyncpg.Pool,
    source_name: str,
    *,
    config_version: int | None,
    poll_interval_seconds: int,
    now: datetime | None = None,
) -> bool:
    """Atomically reserve one source poll across all worker replicas."""
    reserved_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    async with pool.acquire() as connection:
        if config_version is None:
            reserved = await connection.fetchval(
                _RESERVE_LEGACY_POLL_SQL,
                source_name,
                reserved_at,
                poll_interval_seconds,
            )
        else:
            reserved = await connection.fetchval(
                _RESERVE_POLL_SQL,
                source_name,
                config_version,
                reserved_at,
                poll_interval_seconds,
            )
    return bool(reserved)


async def record_worker_shadow_evidence(
    pool: asyncpg.Pool,
    setting: ResolvedSourceSetting,
    *,
    success: bool,
    item_count: int,
    errors: list[str],
    persistence_counts: dict[str, int],
) -> None:
    """Record config-qualified worker dry-run evidence for activation gates."""
    normalized_counts = {
        table: int(persistence_counts.get(table, 0))
        for table in _WORKER_SHADOW_COUNT_SQL
    }
    zero_persistence = all(count == 0 for count in normalized_counts.values())
    evidence_errors = list(errors)
    if not zero_persistence:
        evidence_errors.append("unexpected_shadow_persistence")
    metadata = json.dumps(
        {
            "stage": "worker_shadow",
            "config_version": setting.config_version,
            "adapter_version": setting.adapter_version,
            "item_count": item_count,
            "error_count": len(evidence_errors),
            "errors": evidence_errors[:3],
            "zero_persistence": zero_persistence,
            "persistence_counts": normalized_counts,
        },
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    try:
        async with pool.acquire() as connection:
            await connection.execute(
                """INSERT INTO official_source_setting_audit
                 (source_name, action, config_version, success, actor_email, metadata)
               VALUES ($1, 'dry_run', $2, $3, $4, $5::jsonb)""",
                setting.source_name,
                setting.config_version,
                success and zero_persistence,
                "worker@sadarbencana.local",
                metadata,
            )
    except asyncpg.UndefinedTableError:
        logger.warning(
            "worker-shadow audit table unavailable for source %s",
            setting.source_name,
        )


async def capture_worker_shadow_persistence_counts(
    pool: asyncpg.Pool,
    source_name: str,
) -> dict[str, int]:
    """Measure source-scoped persistence tables used by the activation gate."""
    async with pool.acquire() as connection:
        counts: dict[str, int] = {}
        for table, sql in _WORKER_SHADOW_COUNT_SQL.items():
            persisted_source = _PERSISTED_SOURCE_NAMES.get(
                (source_name, table),
                source_name,
            )
            counts[table] = int(
                await connection.fetchval(sql, persisted_source)
            )
        return counts


def worker_shadow_persistence_deltas(
    before: dict[str, int],
    after: dict[str, int],
) -> dict[str, int]:
    return {
        table: int(after.get(table, 0)) - int(before.get(table, 0))
        for table in _WORKER_SHADOW_COUNT_SQL
    }


__all__ = [
    "MissingSourceSettingError",
    "ResolvedSourceSetting",
    "capture_worker_shadow_persistence_counts",
    "record_worker_shadow_evidence",
    "reserve_source_poll_slot",
    "resolve_source_setting",
    "source_write_is_allowed",
    "worker_shadow_persistence_deltas",
]
