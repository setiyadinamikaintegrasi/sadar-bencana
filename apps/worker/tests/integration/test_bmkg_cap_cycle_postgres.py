"""Database-backed dry-run and active cycle coverage for BMKG CAP."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from uuid import uuid4

import asyncpg
import pytest

import main as worker_main
from connectors.bmkg_cap import parse_bmkg_cap


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)

CAP_XML = """\
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>task11-cap-cycle</identifier>
  <sender>bmkg.go.id</sender>
  <sent>2099-07-15T08:00:00+07:00</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>id-ID</language>
    <category>Met</category>
    <event>Peringatan Dini Cuaca</event>
    <severity>Severe</severity>
    <effective>2099-07-15T08:00:00+07:00</effective>
    <expires>2099-07-15T12:00:00+07:00</expires>
    <headline>Hujan lebat dan angin kencang</headline>
    <description>Waspada cuaca buruk.</description>
    <area>
      <areaDesc>Jawa Barat</areaDesc>
      <polygon>-6.9,107.5 -6.7,107.8 -7.1,107.9</polygon>
    </area>
  </info>
</alert>
"""

SCHEMA_SQL = """
CREATE TABLE official_source_settings (
    source_name TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    mode TEXT NOT NULL,
    default_api_url TEXT,
    custom_api_url TEXT,
    attribution TEXT NOT NULL,
    run_mode TEXT NOT NULL,
    adapter_version TEXT NOT NULL,
    field_mapping JSONB NOT NULL,
    config_version INT NOT NULL,
    expected_interval_seconds INT NOT NULL,
    api_token_encrypted BYTEA
);

CREATE TABLE connector_health (
    name TEXT PRIMARY KEY,
    last_polled_at TIMESTAMPTZ,
    items_fetched INT NOT NULL,
    error_message TEXT,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE source_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    origin_source_name TEXT,
    source_url TEXT,
    attribution TEXT,
    observed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    raw_payload JSONB NOT NULL,
    payload_checksum CHAR(64) NOT NULL,
    UNIQUE (source_name, source_record_id, payload_checksum)
);

CREATE TABLE disaster_observability_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id UUID NOT NULL,
    stage TEXT NOT NULL,
    source_name TEXT,
    peril_type TEXT,
    severity TEXT,
    success BOOLEAN NOT NULL,
    duration_ms INT,
    error_code TEXT,
    metadata JSONB NOT NULL
);

CREATE TABLE official_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(64) NOT NULL,
    source_alert_id VARCHAR(255) NOT NULL,
    revision INT NOT NULL,
    message_type VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    effective_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    headline TEXT,
    description TEXT,
    area_geojson JSONB,
    raw_payload JSONB NOT NULL,
    payload_checksum CHAR(64) NOT NULL,
    previous_alert_id UUID REFERENCES official_alerts(id),
    is_current BOOLEAN NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    peril_type VARCHAR(32),
    severity VARCHAR(16),
    category TEXT,
    area_name TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source_url TEXT,
    UNIQUE (source, source_alert_id, revision),
    UNIQUE (source, source_alert_id, payload_checksum)
);

CREATE TABLE air_quality_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(64) NOT NULL
);

CREATE TABLE ews_notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    official_alert_id UUID REFERENCES official_alerts(id),
    source VARCHAR(64)
);

INSERT INTO official_source_settings (
    source_name, enabled, mode, default_api_url, custom_api_url, attribution,
    run_mode, adapter_version, field_mapping, config_version,
    expected_interval_seconds
) VALUES (
    'bmkg_cap', TRUE, 'custom_api', NULL,
    'https://www.bmkg.go.id/alerts/nowcast/id',
    'BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
    'dry_run', 'v1', '{}'::jsonb, 41, 600
);
"""


@asynccontextmanager
async def isolated_cap_cycle_database():
    schema = f"task11_cap_{uuid4().hex}"
    admin = await asyncpg.connect(TEST_DATABASE_URL)
    pool = None
    try:
        await admin.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public")
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        pool = await asyncpg.create_pool(
            TEST_DATABASE_URL,
            min_size=1,
            max_size=2,
            server_settings={"search_path": f'"{schema}", public'},
        )
        async with pool.acquire() as connection:
            await connection.execute(SCHEMA_SQL)
        yield pool
    finally:
        if pool is not None:
            await pool.close()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()


async def fixture_cap_fetch(_connector):
    return [
        parse_bmkg_cap(
            CAP_XML,
            "https://warning.bmkg.go.id/cap/task11-cap-cycle.xml",
        )
    ], []


async def persistence_counts(pool: asyncpg.Pool) -> tuple[int, int, int, int]:
    async with pool.acquire() as connection:
        return (
            await connection.fetchval("SELECT count(*) FROM source_records"),
            await connection.fetchval(
                "SELECT count(*) FROM disaster_observability_events"
            ),
            await connection.fetchval("SELECT count(*) FROM official_alerts"),
            await connection.fetchval("SELECT count(*) FROM ews_notification_log"),
        )


@pytest.mark.asyncio
async def test_cap_dry_run_and_active_cycle_use_real_persistence(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        worker_main.BMKGCAPConnector,
        "fetch_active",
        fixture_cap_fetch,
    )
    monkeypatch.delenv("CONNECTOR_BMKG_CAP_ENABLED", raising=False)
    monkeypatch.delenv("EWS_LIFECYCLE_DELIVERY_ENABLED", raising=False)

    async with isolated_cap_cycle_database() as pool:
        dry_run_created = await worker_main._bmkg_cap_cycle(pool)

        assert dry_run_created == 0
        assert await persistence_counts(pool) == (0, 0, 0, 0)
        async with pool.acquire() as connection:
            health = await connection.fetchrow(
                "SELECT items_fetched, error_message FROM connector_health "
                "WHERE name='bmkg_cap'"
            )
            assert dict(health) == {"items_fetched": 1, "error_message": None}
            await connection.execute(
                "UPDATE official_source_settings "
                "SET run_mode='active', enabled=TRUE, config_version=42 "
                "WHERE source_name='bmkg_cap'"
            )
            await connection.execute(
                "UPDATE connector_health SET last_polled_at=NULL "
                "WHERE name='bmkg_cap'"
            )

        active_created = await worker_main._bmkg_cap_cycle(pool)

        assert active_created == 1
        assert await persistence_counts(pool) == (1, 2, 1, 0)
        async with pool.acquire() as connection:
            alert = await connection.fetchrow(
                "SELECT source, peril_type, severity, area_name, source_url "
                "FROM official_alerts"
            )
            assert dict(alert) == {
                "source": "bmkg_cap",
                "peril_type": "weather",
                "severity": "High",
                "area_name": "Jawa Barat",
                "source_url": (
                    "https://warning.bmkg.go.id/cap/task11-cap-cycle.xml"
                ),
            }
