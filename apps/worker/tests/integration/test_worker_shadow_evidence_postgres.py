"""PostgreSQL coverage for config-qualified worker-shadow evidence."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import asyncpg
import pytest

import main as worker_main
from db.source_settings import record_worker_shadow_evidence


TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not TEST_DATABASE_URL,
    reason="TEST_DATABASE_URL is required for PostgreSQL integration tests",
)


@asynccontextmanager
async def isolated_audit_database():
    schema = f"worker_shadow_{uuid4().hex}"
    admin = await asyncpg.connect(TEST_DATABASE_URL)
    pool = None
    try:
        await admin.execute(f'CREATE SCHEMA "{schema}"')
        pool = await asyncpg.create_pool(
            TEST_DATABASE_URL,
            min_size=1,
            max_size=1,
            server_settings={"search_path": f'"{schema}", public'},
        )
        async with pool.acquire() as connection:
            await connection.execute(
                """CREATE TABLE official_source_setting_audit (
                     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                     source_name TEXT NOT NULL,
                     action TEXT NOT NULL,
                     actor_email TEXT NOT NULL,
                     config_version INT,
                     success BOOLEAN NOT NULL,
                     metadata JSONB NOT NULL,
                     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                   )"""
            )
        yield pool
    finally:
        if pool is not None:
            await pool.close()
        await admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await admin.close()


@pytest.mark.asyncio
async def test_worker_shadow_evidence_satisfies_activation_metadata_contract():
    setting = SimpleNamespace(
        source_name="bmkg_air_quality",
        config_version=17,
        adapter_version="v1",
    )
    async with isolated_audit_database() as pool:
        await record_worker_shadow_evidence(
            pool,
            setting,
            success=True,
            item_count=4,
            errors=[],
        )
        async with pool.acquire() as connection:
            row = await connection.fetchrow(
                """SELECT action, actor_email, config_version, success, metadata
                   FROM official_source_setting_audit"""
            )

    metadata = row["metadata"]
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    assert dict(row)["action"] == "dry_run"
    assert dict(row)["actor_email"] == "worker@sadarbencana.local"
    assert dict(row)["config_version"] == 17
    assert dict(row)["success"] is True
    assert metadata["stage"] == "worker_shadow"
    assert metadata["zero_persistence"] is True
    assert set(metadata["persistence_counts"].values()) == {0}
    assert {
        "official_alerts",
        "air_quality_observations",
        "ews_notification_log",
        "ews_delivery_queue",
        "source_evidence",
    } <= set(metadata["persistence_counts"])


@pytest.mark.asyncio
async def test_worker_shadow_uses_postgis_topology_validation_without_writes():
    alert = SimpleNamespace(
        source_alert_id="self-intersection",
        area_geojson={
            "type": "Polygon",
            "coordinates": [[
                [106.0, -6.0],
                [108.0, -8.0],
                [108.0, -6.0],
                [106.0, -8.0],
                [106.0, -6.0],
            ]],
        },
    )
    async with isolated_audit_database() as pool:
        errors = await worker_main._official_alert_topology_errors(pool, [alert])
        async with pool.acquire() as connection:
            writes = await connection.fetchval(
                "SELECT count(*) FROM official_source_setting_audit"
            )

    assert errors == [
        "warning self-intersection: area_geojson topology is invalid"
    ]
    assert writes == 0
