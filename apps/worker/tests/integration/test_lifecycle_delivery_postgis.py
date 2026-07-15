"""PostGIS integration coverage for official-alert lifecycle delivery."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from alerts.lifecycle_delivery import enqueue_official_alert_revision


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostGIS integration tests",
)

MIGRATION_040 = (
    Path(__file__).resolve().parents[4]
    / "db/schema/040_bmkg_warning_and_air_quality.sql"
)

JAKARTA_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [106.70, -6.30],
            [107.00, -6.30],
            [107.00, -6.00],
            [106.70, -6.00],
            [106.70, -6.30],
        ]
    ],
}
TOKYO_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [139.50, 35.50],
            [139.90, 35.50],
            [139.90, 35.90],
            [139.50, 35.90],
            [139.50, 35.50],
        ]
    ],
}
SELF_INTERSECTING_POLYGON = {
    "type": "Polygon",
    "coordinates": [
        [
            [106.70, -6.30],
            [107.00, -6.00],
            [106.70, -6.00],
            [107.00, -6.30],
            [106.70, -6.30],
        ]
    ],
}

SCHEMA_SQL = """
CREATE TABLE official_alerts (
    id UUID PRIMARY KEY,
    source VARCHAR(64) NOT NULL,
    source_alert_id VARCHAR(255) NOT NULL,
    revision INT NOT NULL,
    message_type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    peril_type VARCHAR(32),
    severity VARCHAR(16),
    area_geojson JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION
);

CREATE TABLE ews_subscribers (
    id UUID PRIMARY KEY,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ews_notification_prefs (
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id),
    channel TEXT NOT NULL,
    min_severity TEXT NOT NULL,
    alert_types TEXT[] NOT NULL DEFAULT '{}',
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (subscriber_id, channel)
);

CREATE TABLE ews_channel_settings (
    channel TEXT PRIMARY KEY,
    is_enabled BOOLEAN NOT NULL
);

CREATE TABLE ews_watch_zones (
    id UUID PRIMARY KEY,
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_km NUMERIC(8, 2) NOT NULL,
    peril_types TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ews_notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id UUID NOT NULL REFERENCES ews_subscribers(id),
    official_alert_id UUID REFERENCES official_alerts(id),
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    source VARCHAR(64),
    source_alert_id VARCHAR(255),
    alert_revision INT,
    lifecycle_action VARCHAR(16),
    next_attempt_at TIMESTAMPTZ,
    correlation_id UUID,
    delivery_kind TEXT NOT NULL,
    matched_watch_zone_id UUID REFERENCES ews_watch_zones(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_ews_official_revision_delivery
    ON ews_notification_log (
        subscriber_id, channel, source, source_alert_id, alert_revision,
        lifecycle_action
    )
    WHERE source IS NOT NULL;
"""


@asynccontextmanager
async def isolated_lifecycle_database():
    schema = f"task4_{uuid4().hex}"
    admin = await asyncpg.connect(TEST_DATABASE_URL)
    pool = None
    try:
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        pool = await asyncpg.create_pool(
            TEST_DATABASE_URL,
            min_size=1,
            max_size=2,
            server_settings={"search_path": f'"{schema}", public'},
        )
        async with pool.acquire() as conn:
            await conn.execute(SCHEMA_SQL)
            await conn.execute(
                "INSERT INTO ews_channel_settings (channel, is_enabled) "
                "VALUES ('email', TRUE), ('telegram', TRUE)"
            )
        yield pool
    finally:
        if pool is not None:
            await pool.close()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()


def alert_row(
    *,
    alert_id: UUID,
    source_alert_id: str,
    revision: int = 1,
    message_type: str = "alert",
    status: str = "active",
) -> dict[str, object]:
    return {
        "id": alert_id,
        "source": "bmkg_cap",
        "source_alert_id": source_alert_id,
        "revision": revision,
        "message_type": message_type,
        "status": status,
    }


async def insert_alert(
    conn: asyncpg.Connection,
    *,
    source_alert_id: str,
    revision: int = 1,
    message_type: str = "alert",
    status: str = "active",
    peril_type: str = "weather",
    severity: str = "High",
    area_geojson: dict[str, object] | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
) -> dict[str, object]:
    alert_id = uuid4()
    await conn.execute(
        """
        INSERT INTO official_alerts (
            id, source, source_alert_id, revision, message_type, status,
            peril_type, severity, area_geojson, latitude, longitude
        ) VALUES ($1, 'bmkg_cap', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
        """,
        alert_id,
        source_alert_id,
        revision,
        message_type,
        status,
        peril_type,
        severity,
        json.dumps(area_geojson) if area_geojson is not None else None,
        latitude,
        longitude,
    )
    return alert_row(
        alert_id=alert_id,
        source_alert_id=source_alert_id,
        revision=revision,
        message_type=message_type,
        status=status,
    )


async def insert_recipient(
    conn: asyncpg.Connection,
    *,
    latitude: float = -6.15,
    longitude: float = 106.85,
    radius_km: float = 25,
    zone_perils: list[str] | None = None,
    min_severity: str = "Moderate",
    alert_types: list[str] | None = None,
    pref_enabled: bool = True,
    zone_created_at: datetime | None = None,
) -> tuple[UUID, UUID]:
    subscriber_id = uuid4()
    zone_id = uuid4()
    await conn.execute(
        "INSERT INTO ews_subscribers (id) VALUES ($1)", subscriber_id
    )
    await conn.execute(
        """
        INSERT INTO ews_notification_prefs (
            subscriber_id, channel, min_severity, alert_types, is_enabled
        ) VALUES ($1, 'email', $2, $3, $4)
        """,
        subscriber_id,
        min_severity,
        alert_types or [],
        pref_enabled,
    )
    await conn.execute(
        """
        INSERT INTO ews_watch_zones (
            id, subscriber_id, latitude, longitude, radius_km, peril_types,
            created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        zone_id,
        subscriber_id,
        latitude,
        longitude,
        radius_km,
        zone_perils or [],
        zone_created_at or datetime.now(timezone.utc),
    )
    return subscriber_id, zone_id


def migration_geometry_constraint_sql() -> str:
    migration = MIGRATION_040.read_text(encoding="utf-8")
    marker = "official_alerts_area_geojson_valid_check"
    marker_at = migration.index(marker)
    statement_start = migration.rfind("ALTER TABLE official_alerts", 0, marker_at)
    statement_end = migration.index(";", marker_at) + 1
    statement = migration[statement_start:statement_end]
    assert "ST_IsValid" in statement
    assert "NOT VALID" in statement
    return statement


@pytest.mark.asyncio
async def test_polygon_and_point_matches_respect_zone_distance():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            polygon_inside = await insert_alert(
                conn,
                source_alert_id="polygon-inside",
                area_geojson=JAKARTA_POLYGON,
            )
            polygon_outside = await insert_alert(
                conn,
                source_alert_id="polygon-outside",
                area_geojson=TOKYO_POLYGON,
            )
            point_inside = await insert_alert(
                conn,
                source_alert_id="point-inside",
                latitude=-6.16,
                longitude=106.86,
            )
            point_outside = await insert_alert(
                conn,
                source_alert_id="point-outside",
                latitude=35.68,
                longitude=139.69,
            )

        assert await enqueue_official_alert_revision(pool, polygon_inside) == 1
        assert await enqueue_official_alert_revision(pool, polygon_outside) == 0
        assert await enqueue_official_alert_revision(pool, point_inside) == 1
        assert await enqueue_official_alert_revision(pool, point_outside) == 0


@pytest.mark.asyncio
async def test_competing_zones_choose_oldest_deterministic_match():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            subscriber_id, expected_zone_id = await insert_recipient(
                conn,
                zone_created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
            await conn.execute(
                """
                INSERT INTO ews_watch_zones (
                    id, subscriber_id, latitude, longitude, radius_km,
                    peril_types, created_at
                ) VALUES ($1, $2, -6.15, 106.85, 25, '{}', $3)
                """,
                uuid4(),
                subscriber_id,
                datetime(2026, 1, 2, tzinfo=timezone.utc),
            )
            alert = await insert_alert(
                conn,
                source_alert_id="competing-zones",
                area_geojson=JAKARTA_POLYGON,
            )

        assert await enqueue_official_alert_revision(pool, alert) == 1
        async with pool.acquire() as conn:
            assert await conn.fetchval(
                "SELECT matched_watch_zone_id FROM ews_notification_log"
            ) == expected_zone_id


@pytest.mark.asyncio
async def test_peril_severity_and_preference_exclusions():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn, zone_perils=["air_quality"])
            await insert_recipient(conn, min_severity="Critical")
            await insert_recipient(conn, alert_types=["air_quality"])
            await insert_recipient(conn, pref_enabled=False)
            alert = await insert_alert(
                conn,
                source_alert_id="excluded",
                severity="High",
                peril_type="weather",
                area_geojson=JAKARTA_POLYGON,
            )

        assert await enqueue_official_alert_revision(pool, alert) == 0


@pytest.mark.asyncio
async def test_on_conflict_deduplicates_same_revision():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="dedup",
                area_geojson=JAKARTA_POLYGON,
            )

        assert await enqueue_official_alert_revision(pool, alert) == 1
        assert await enqueue_official_alert_revision(pool, alert) == 0
        async with pool.acquire() as conn:
            assert await conn.fetchval(
                "SELECT count(*) FROM ews_notification_log"
            ) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("revision", "message_type", "status", "expected_action"),
    [
        (2, "update", "active", "update"),
        (3, "cancel", "cancelled", "cancellation"),
        (4, "alert", "expired", "expiry"),
    ],
)
async def test_lifecycle_changes_retain_prior_recipient_zone(
    revision: int,
    message_type: str,
    status: str,
    expected_action: str,
):
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            subscriber_id, prior_zone_id = await insert_recipient(conn)
            initial = await insert_alert(
                conn,
                source_alert_id="retention",
                area_geojson=JAKARTA_POLYGON,
            )
            assert await enqueue_official_alert_revision(pool, initial) == 1
            await conn.execute(
                "UPDATE ews_notification_log SET status = 'sent'"
            )
            changed = await insert_alert(
                conn,
                source_alert_id="retention",
                revision=revision,
                message_type=message_type,
                status=status,
                area_geojson=TOKYO_POLYGON,
            )

        assert await enqueue_official_alert_revision(pool, changed) == 1
        async with pool.acquire() as conn:
            retained = await conn.fetchrow(
                """
                SELECT subscriber_id, matched_watch_zone_id, lifecycle_action
                FROM ews_notification_log
                WHERE alert_revision = $1
                """,
                revision,
            )
        assert dict(retained) == {
            "subscriber_id": subscriber_id,
            "matched_watch_zone_id": prior_zone_id,
            "lifecycle_action": expected_action,
        }


@pytest.mark.asyncio
async def test_historical_invalid_polygon_is_quarantined_without_aborting_batch():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            historical_invalid = await insert_alert(
                conn,
                source_alert_id="historical-invalid",
                area_geojson=SELF_INTERSECTING_POLYGON,
            )
            await conn.execute(migration_geometry_constraint_sql())

            with pytest.raises(asyncpg.CheckViolationError):
                await insert_alert(
                    conn,
                    source_alert_id="new-invalid",
                    area_geojson=SELF_INTERSECTING_POLYGON,
                )

            valid = await insert_alert(
                conn,
                source_alert_id="valid-after-invalid",
                area_geojson=JAKARTA_POLYGON,
            )

        assert await enqueue_official_alert_revision(pool, historical_invalid) == 0
        assert await enqueue_official_alert_revision(pool, valid) == 1
        async with pool.acquire() as conn:
            assert await conn.fetchval(
                """
                SELECT count(*)
                FROM ews_notification_log
                WHERE official_alert_id = $1
                """,
                historical_invalid["id"],
            ) == 0
