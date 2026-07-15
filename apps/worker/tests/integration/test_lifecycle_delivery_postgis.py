"""PostGIS integration coverage for official-alert lifecycle delivery."""

from __future__ import annotations

import json
import os
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import asyncpg
import pytest

from alerts import lifecycle_delivery
from alerts.lifecycle_delivery import (
    enqueue_official_alert_revision,
    expire_and_enqueue_official_alert_revisions,
    process_due_deliveries,
)
from db.official_alerts import expire_official_alert_revisions, upsert_official_alert
from models.official_alert import OfficialAlertInput


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
SELF_INTERSECTING_MULTIPOLYGON = {
    "type": "MultiPolygon",
    "coordinates": [SELF_INTERSECTING_POLYGON["coordinates"]],
}
MALFORMED_POLYGON = {
    "type": "Polygon",
    "coordinates": "not-an-array",
}
POINT_GEOJSON = {
    "type": "Point",
    "coordinates": [106.85, -6.15],
}

SCHEMA_SQL = """
CREATE TABLE official_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(64) NOT NULL,
    source_alert_id VARCHAR(255) NOT NULL,
    revision INT NOT NULL,
    message_type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    headline TEXT,
    description TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_checksum CHAR(64) NOT NULL,
    previous_alert_id UUID REFERENCES official_alerts(id) ON DELETE SET NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    peril_type VARCHAR(32),
    severity VARCHAR(16),
    category TEXT,
    area_name TEXT,
    area_geojson JSONB,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source_url TEXT,
    UNIQUE (source, source_alert_id, revision),
    UNIQUE (source, source_alert_id, payload_checksum)
);

CREATE TABLE official_source_settings (
    source_name VARCHAR(64) PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    run_mode VARCHAR(16) NOT NULL
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY,
    message TEXT,
    severity TEXT,
    alert_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ews_subscribers (
    id UUID PRIMARY KEY,
    email TEXT,
    telegram_chat_id BIGINT,
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
    alert_id UUID REFERENCES alerts(id),
    source VARCHAR(64),
    source_alert_id VARCHAR(255),
    alert_revision INT,
    lifecycle_action VARCHAR(16),
    next_attempt_at TIMESTAMPTZ,
    attempt_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    dead_lettered_at TIMESTAMPTZ,
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    provider_id TEXT,
    delivery_latency_ms BIGINT,
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
            await conn.execute(
                "INSERT INTO official_source_settings "
                "(source_name, enabled, run_mode) "
                "VALUES ('bmkg_cap', TRUE, 'active')"
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
    sent_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> dict[str, object]:
    alert_id = uuid4()
    await conn.execute(
        """
        INSERT INTO official_alerts (
            id, source, source_alert_id, revision, message_type, status,
            sent_at, expires_at, raw_payload, payload_checksum, peril_type,
            severity, area_geojson, latitude, longitude
        ) VALUES (
            $1, 'bmkg_cap', $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
            $10, $11, $12::jsonb, $13, $14
        )
        """,
        alert_id,
        source_alert_id,
        revision,
        message_type,
        status,
        sent_at or datetime.now(timezone.utc),
        expires_at,
        json.dumps({"source_alert_id": source_alert_id, "revision": revision}),
        alert_id.hex * 2,
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


def official_alert_input(
    *,
    source_alert_id: str,
    sent_at: datetime,
) -> OfficialAlertInput:
    return OfficialAlertInput(
        source="bmkg_cap",
        source_alert_id=source_alert_id,
        message_type="update",
        status="active",
        sent_at=sent_at,
        effective_at=sent_at,
        expires_at=sent_at + timedelta(hours=1),
        headline="Updated warning",
        description="Updated official warning",
        area_geojson=JAKARTA_POLYGON,
        raw_payload={
            "source_alert_id": source_alert_id,
            "sent_at": sent_at.isoformat(),
        },
        peril_type="weather",
        severity="High",
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
        "INSERT INTO ews_subscribers (id, email) VALUES ($1, $2)",
        subscriber_id,
        f"{subscriber_id}@example.test",
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


class BlockingAdapter:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls = 0

    async def send(self, *_args, **_kwargs):
        self.calls += 1
        self.started.set()
        await self.release.wait()
        return {"success": True, "provider_id": f"provider-{self.calls}"}


class FirstSendBlockingAdapter:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.messages: list[str] = []

    async def send(self, _recipient, message, **_kwargs):
        self.messages.append(message)
        if len(self.messages) == 1:
            self.started.set()
            await self.release.wait()
        return {"success": True, "provider_id": f"provider-{len(self.messages)}"}


def cap_lifecycle_input(
    identifier: str,
    *,
    sent_at: datetime,
    message_type: str = "alert",
    referenced_identifier: str | None = None,
) -> OfficialAlertInput:
    references = []
    if referenced_identifier is not None:
        references = [{
            "sender": "nowcast@bmkg.go.id",
            "identifier": referenced_identifier,
            "sent": (sent_at - timedelta(minutes=1)).isoformat(),
        }]
    return OfficialAlertInput(
        source="bmkg_cap",
        source_alert_id=identifier,
        message_type=message_type,
        status="cancelled" if message_type == "cancel" else "active",
        sent_at=sent_at,
        effective_at=None if message_type == "cancel" else sent_at,
        expires_at=None if message_type == "cancel" else sent_at + timedelta(hours=1),
        headline=None if message_type == "cancel" else f"Warning {identifier}",
        description=None,
        area_geojson=None if message_type == "cancel" else JAKARTA_POLYGON,
        raw_payload={
            "message_identifier": identifier,
            "references": references,
            "referenced_message_identifiers": (
                [referenced_identifier] if referenced_identifier else []
            ),
        },
        peril_type="weather",
        severity="High",
    )


def migration_geometry_validation_sql() -> str:
    migration = MIGRATION_040.read_text(encoding="utf-8")
    block_start = migration.index(
        "ALTER TABLE official_alerts\n"
        "    DROP CONSTRAINT IF EXISTS official_alerts_area_geojson_valid_check;"
    )
    trigger_start = migration.index(
        "CREATE TRIGGER official_alerts_area_geojson_validation",
        block_start,
    )
    block_end = migration.index(";", trigger_start) + 1
    block = migration[block_start:block_end]
    assert "BEFORE INSERT OR UPDATE OF area_geojson" in block
    assert "ST_IsValid" in block
    assert "NOT VALID" not in block
    return block


@pytest.mark.asyncio
async def test_geometry_validation_does_not_block_historical_alert_lifecycle():
    now = datetime(2026, 7, 15, 4, 0, tzinfo=timezone.utc)
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            superseded = await insert_alert(
                conn,
                source_alert_id="historical-superseded",
                area_geojson=SELF_INTERSECTING_POLYGON,
                sent_at=now - timedelta(minutes=10),
                expires_at=now + timedelta(hours=1),
            )
            expiring = await insert_alert(
                conn,
                source_alert_id="historical-expiring",
                area_geojson=SELF_INTERSECTING_POLYGON,
                sent_at=now - timedelta(hours=1),
                expires_at=now - timedelta(minutes=1),
            )
            validation_sql = migration_geometry_validation_sql()
            await conn.execute(validation_sql)
            await conn.execute(validation_sql)
            trigger_definitions = await conn.fetch(
                """
                SELECT pg_get_triggerdef(oid) AS definition
                FROM pg_trigger
                WHERE tgrelid = 'official_alerts'::regclass
                  AND tgname = 'official_alerts_area_geojson_validation'
                  AND NOT tgisinternal
                """
            )

        replacement, created = await upsert_official_alert(
            pool,
            official_alert_input(
                source_alert_id="historical-superseded",
                sent_at=now,
            ),
            now=now,
        )
        expired = await expire_official_alert_revisions(pool, now=now)

        async with pool.acquire() as conn:
            historical = await conn.fetchrow(
                "SELECT status, is_current FROM official_alerts WHERE id = $1",
                superseded["id"],
            )

        assert created is True
        assert replacement["revision"] == 2
        assert dict(historical) == {"status": "updated", "is_current": False}
        assert [row["id"] for row in expired] == [expiring["id"]]
        assert len(trigger_definitions) == 1
        assert "BEFORE INSERT OR UPDATE OF area_geojson" in trigger_definitions[0][
            "definition"
        ]


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
    ("message_type", "status", "expected_action"),
    [
        ("update", "active", "update"),
        ("cancel", "cancelled", "cancellation"),
    ],
)
async def test_lifecycle_change_before_first_send_supersedes_stale_queue(
    message_type: str,
    status: str,
    expected_action: str,
):
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            initial = await insert_alert(
                conn,
                source_alert_id="before-first-send",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, initial) == 1

        async with pool.acquire() as conn:
            changed = await insert_alert(
                conn,
                source_alert_id="before-first-send",
                revision=2,
                message_type=message_type,
                status=status,
                area_geojson=TOKYO_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, changed) == 1

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT alert_revision, lifecycle_action, status
                FROM ews_notification_log
                ORDER BY alert_revision
                """
            )
        assert [dict(row) for row in rows] == [
            {"alert_revision": 1, "lifecycle_action": "alert", "status": "skipped"},
            {
                "alert_revision": 2,
                "lifecycle_action": expected_action,
                "status": "pending",
            },
        ]


@pytest.mark.asyncio
async def test_parallel_workers_claim_and_send_a_delivery_once(monkeypatch):
    adapter = BlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="parallel-claim",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, alert) == 1

        first = asyncio.create_task(process_due_deliveries(pool))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        second_result = await process_due_deliveries(pool)
        adapter.release.set()
        first_result = await asyncio.wait_for(first, timeout=2)

        assert adapter.calls == 1
        assert second_result == {"sent": 0, "failed": 0, "dead_letter": 0}
        assert first_result == {"sent": 1, "failed": 0, "dead_letter": 0}


@pytest.mark.asyncio
async def test_second_row_superseded_while_first_sends_is_never_sent(monkeypatch):
    adapter = FirstSendBlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            await insert_recipient(conn)
            initial = await insert_alert(
                conn,
                source_alert_id="second-row-superseded",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, initial) == 2

        sending = asyncio.create_task(process_due_deliveries(pool, batch_size=2))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE official_alerts SET is_current=FALSE WHERE id=$1",
                initial["id"],
            )
            changed = await insert_alert(
                conn,
                source_alert_id="second-row-superseded",
                revision=2,
                message_type="update",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, changed) == 2
        adapter.release.set()
        await asyncio.wait_for(sending, timeout=3)

        assert sum(message.startswith("[PERINGATAN]") for message in adapter.messages) == 1


@pytest.mark.asyncio
async def test_second_row_disabled_while_first_sends_is_never_sent(monkeypatch):
    adapter = FirstSendBlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="second-row-disabled",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, alert) == 2

        sending = asyncio.create_task(process_due_deliveries(pool, batch_size=2))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE official_source_settings "
                "SET enabled=FALSE, run_mode='disabled' "
                "WHERE source_name='bmkg_cap'"
            )
        adapter.release.set()
        await asyncio.wait_for(sending, timeout=3)

        assert len(adapter.messages) == 1


@pytest.mark.asyncio
async def test_delivery_lease_is_renewed_for_channel_timeout(monkeypatch):
    adapter = BlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="lease-renewal",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, alert) == 1

        sending = asyncio.create_task(process_due_deliveries(pool))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        async with pool.acquire() as conn:
            remaining = await conn.fetchval(
                "SELECT next_attempt_at - now() FROM ews_notification_log"
            )
        adapter.release.set()
        await asyncio.wait_for(sending, timeout=2)

        expected = (
            lifecycle_delivery.CHANNEL_SEND_TIMEOUT_SECONDS["email"]
            + lifecycle_delivery.DELIVERY_LEASE_MARGIN_SECONDS
            - 2
        )
        assert remaining.total_seconds() >= expected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("message_type", "status", "expected_action"),
    [("update", "active", "update"), ("cancel", "cancelled", "cancellation")],
)
async def test_inflight_delivery_cannot_overwrite_superseding_revision(
    monkeypatch,
    message_type: str,
    status: str,
    expected_action: str,
):
    adapter = BlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            initial = await insert_alert(
                conn,
                source_alert_id="inflight-change",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, initial) == 1

        sending = asyncio.create_task(process_due_deliveries(pool))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE official_alerts SET is_current=FALSE WHERE id=$1",
                initial["id"],
            )
            changed = await insert_alert(
                conn,
                source_alert_id="inflight-change",
                revision=2,
                message_type=message_type,
                status=status,
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, changed) == 1

        adapter.release.set()
        result = await asyncio.wait_for(sending, timeout=2)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT alert_revision, lifecycle_action, status "
                "FROM ews_notification_log ORDER BY alert_revision"
            )

        assert result == {"sent": 1, "failed": 0, "dead_letter": 0}
        assert [dict(row) for row in rows] == [
            {"alert_revision": 1, "lifecycle_action": "alert", "status": "skipped"},
            {
                "alert_revision": 2,
                "lifecycle_action": expected_action,
                "status": "sent",
            },
        ]


@pytest.mark.asyncio
async def test_disabled_source_skips_pending_delivery_without_send(monkeypatch):
    adapter = AsyncMock()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="disabled-pending",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, alert) == 1
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE official_source_settings "
                "SET enabled=FALSE, run_mode='disabled' "
                "WHERE source_name='bmkg_cap'"
            )

        result = await process_due_deliveries(pool)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, error_message FROM ews_notification_log"
            )

        assert result == {"sent": 0, "failed": 0, "dead_letter": 0}
        adapter.send.assert_not_awaited()
        assert dict(row) == {
            "status": "skipped",
            "error_message": "source_disabled_or_not_active",
        }


@pytest.mark.asyncio
async def test_disable_during_send_prevents_success_callback(monkeypatch):
    adapter = BlockingAdapter()
    monkeypatch.setitem(lifecycle_delivery.CHANNELS, "email", adapter)
    monkeypatch.setattr(lifecycle_delivery, "record_observation", AsyncMock())
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            alert = await insert_alert(
                conn,
                source_alert_id="disabled-inflight",
                area_geojson=JAKARTA_POLYGON,
            )
        assert await enqueue_official_alert_revision(pool, alert) == 1

        sending = asyncio.create_task(process_due_deliveries(pool))
        await asyncio.wait_for(adapter.started.wait(), timeout=2)
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE official_source_settings "
                "SET enabled=FALSE, run_mode='disabled' "
                "WHERE source_name='bmkg_cap'"
            )
        adapter.release.set()
        result = await asyncio.wait_for(sending, timeout=2)

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, error_message, sent_at FROM ews_notification_log"
            )
        assert result == {"sent": 0, "failed": 0, "dead_letter": 0}
        assert dict(row) == {
            "status": "skipped",
            "error_message": "source_disabled_or_not_active",
            "sent_at": None,
        }


@pytest.mark.asyncio
async def test_disabled_source_is_not_expired_or_enqueued():
    now = datetime(2026, 7, 15, 5, 0, tzinfo=timezone.utc)
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            alert = await insert_alert(
                conn,
                source_alert_id="disabled-expiry",
                expires_at=now - timedelta(minutes=1),
            )
            await conn.execute(
                "UPDATE official_source_settings "
                "SET enabled=FALSE, run_mode='disabled' "
                "WHERE source_name='bmkg_cap'"
            )

        expired = await expire_and_enqueue_official_alert_revisions(
            pool,
            delivery_enabled=True,
            now=now,
        )
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status FROM official_alerts WHERE id=$1",
                alert["id"],
            )
            queue_count = await conn.fetchval("SELECT count(*) FROM ews_notification_log")

        assert expired == []
        assert row["status"] == "active"
        assert queue_count == 0


@pytest.mark.asyncio
async def test_cap_reference_chain_resolves_to_one_lifecycle_and_queue():
    now = datetime(2026, 7, 15, 5, 0, tzinfo=timezone.utc)
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)

        inputs = [
            cap_lifecycle_input("A", sent_at=now),
            cap_lifecycle_input(
                "B", sent_at=now + timedelta(minutes=1),
                message_type="update", referenced_identifier="A",
            ),
            cap_lifecycle_input(
                "C", sent_at=now + timedelta(minutes=2),
                message_type="update", referenced_identifier="B",
            ),
            cap_lifecycle_input(
                "D", sent_at=now + timedelta(minutes=3),
                message_type="cancel", referenced_identifier="C",
            ),
        ]
        for alert_input in inputs:
            row, created = await upsert_official_alert(pool, alert_input, now=now)
            assert created is True
            await enqueue_official_alert_revision(pool, row)

        async with pool.acquire() as conn:
            alerts = await conn.fetch(
                "SELECT source_alert_id, revision, is_current, status, "
                "raw_payload->>'message_identifier' AS message_identifier "
                "FROM official_alerts ORDER BY revision"
            )
            queue = await conn.fetch(
                "SELECT alert_revision, lifecycle_action, status "
                "FROM ews_notification_log ORDER BY alert_revision"
            )

        assert [row["source_alert_id"] for row in alerts] == ["A"] * 4
        assert [row["revision"] for row in alerts] == [1, 2, 3, 4]
        assert [row["message_identifier"] for row in alerts] == ["A", "B", "C", "D"]
        assert [row["is_current"] for row in alerts] == [False, False, False, True]
        assert alerts[-1]["status"] == "cancelled"
        assert [dict(row) for row in queue] == [
            {"alert_revision": 1, "lifecycle_action": "alert", "status": "skipped"},
            {"alert_revision": 2, "lifecycle_action": "update", "status": "skipped"},
            {"alert_revision": 3, "lifecycle_action": "update", "status": "skipped"},
            {"alert_revision": 4, "lifecycle_action": "cancellation", "status": "pending"},
        ]


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
async def test_historical_invalid_polygon_is_quarantined_and_bad_writes_are_rejected():
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)
            historical_invalid = await insert_alert(
                conn,
                source_alert_id="historical-invalid",
                area_geojson=SELF_INTERSECTING_POLYGON,
            )
            await conn.execute(migration_geometry_validation_sql())

            for source_alert_id, area_geojson in (
                ("new-invalid-polygon", SELF_INTERSECTING_POLYGON),
                ("new-invalid-multipolygon", SELF_INTERSECTING_MULTIPOLYGON),
                ("new-malformed-polygon", MALFORMED_POLYGON),
                ("new-point", POINT_GEOJSON),
            ):
                with pytest.raises(asyncpg.CheckViolationError):
                    await insert_alert(
                        conn,
                        source_alert_id=source_alert_id,
                        area_geojson=area_geojson,
                    )

            valid = await insert_alert(
                conn,
                source_alert_id="valid-after-invalid",
                area_geojson=JAKARTA_POLYGON,
            )
            with pytest.raises(asyncpg.CheckViolationError):
                await conn.execute(
                    "UPDATE official_alerts SET area_geojson = $1::jsonb WHERE id = $2",
                    json.dumps(SELF_INTERSECTING_POLYGON),
                    valid["id"],
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
