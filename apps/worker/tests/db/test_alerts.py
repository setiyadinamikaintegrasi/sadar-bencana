"""Persistence contract tests for alert verification metadata."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from db.alerts import create_alert


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    return pool


@pytest.mark.asyncio
async def test_create_alert_persists_verification_and_sources():
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "id": "alert-id",
        "verification_status": "official",
        "source_names": ["bmkg"],
    }
    pool = _pool_with_conn(conn)

    created = await create_alert(
        pool,
        "event-id",
        "earthquake",
        "High",
        "Gempa terverifikasi",
        verification_status="official",
        source_names=["bmkg"],
    )

    args = conn.fetchrow.await_args.args
    assert args[5] == "official"
    assert args[6] == ["bmkg"]
    assert created["verification_status"] == "official"


@pytest.mark.asyncio
async def test_create_alert_defaults_to_unverified_without_sources():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "alert-id"}
    pool = _pool_with_conn(conn)

    await create_alert(
        pool,
        "event-id",
        "risk_score",
        "High",
        "Automated assessment",
    )

    args = conn.fetchrow.await_args.args
    assert args[5] == "unverified"
    assert args[6] == []


@pytest.mark.asyncio
async def test_create_alert_persists_manual_override_audit():
    conn = AsyncMock()
    conn.fetchrow.return_value = {"id": "alert-id"}
    pool = _pool_with_conn(conn)

    await create_alert(
        pool,
        "event-id",
        "earthquake",
        "High",
        "Manual verification",
        confidence_class="confirmed_event",
        policy_version="alert-policy-v1",
        manual_override_by="analyst@example.test",
        manual_override_reason="confirmed by operations centre",
    )

    args = conn.fetchrow.await_args.args
    assert args[10] == "analyst@example.test"
    assert args[11] == "confirmed by operations centre"
