"""Lifecycle and idempotency tests for authoritative alerts."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from db.official_alerts import (
    expire_official_alerts,
    payload_checksum,
    upsert_official_alert,
)
from models.official_alert import OfficialAlertInput

NOW = datetime(2026, 6, 30, 8, 0, tzinfo=timezone.utc)


def _alert(**overrides) -> OfficialAlertInput:
    values = {
        "source": "bmkg",
        "source_alert_id": "BMKG-001",
        "message_type": "alert",
        "status": "active",
        "sent_at": NOW,
        "effective_at": NOW,
        "expires_at": NOW + timedelta(hours=2),
        "headline": "Peringatan dini cuaca",
        "description": "Hujan lebat berpotensi terjadi.",
        "area_geojson": {"type": "Polygon", "coordinates": []},
        "raw_payload": {"identifier": "BMKG-001", "severity": "Severe"},
    }
    values.update(overrides)
    return OfficialAlertInput(**values)


def _pool_with_conn(conn: AsyncMock) -> MagicMock:
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock(return_value=None)
    transaction.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=transaction)
    return pool


def test_payload_checksum_is_stable_for_key_order():
    assert payload_checksum({"a": 1, "b": 2}) == payload_checksum({"b": 2, "a": 1})


def test_model_rejects_naive_timestamps():
    with pytest.raises(ValidationError):
        _alert(sent_at=datetime(2026, 6, 30, 8, 0))


@pytest.mark.asyncio
async def test_duplicate_payload_returns_existing_revision_without_insert():
    conn = AsyncMock()
    existing = {"id": "existing", "revision": 1, "status": "active"}
    conn.fetchrow.side_effect = [existing]
    pool = _pool_with_conn(conn)

    row, created = await upsert_official_alert(pool, _alert(), now=NOW)

    assert row == existing
    assert created is False
    assert conn.fetchrow.await_count == 1


@pytest.mark.asyncio
async def test_first_payload_creates_revision_one():
    conn = AsyncMock()
    inserted = {"id": "new", "revision": 1, "status": "active"}
    conn.fetchrow.side_effect = [None, None, inserted]
    conn.fetchval.return_value = 1
    pool = _pool_with_conn(conn)

    row, created = await upsert_official_alert(pool, _alert(), now=NOW)

    assert created is True
    assert row["revision"] == 1
    insert_args = conn.fetchrow.await_args_list[2].args
    assert insert_args[3] == 1
    assert insert_args[5] == "active"
    assert insert_args[14] is None
    assert insert_args[15] is True


@pytest.mark.asyncio
async def test_cancel_creates_linked_revision_and_supersedes_current():
    conn = AsyncMock()
    previous = {
        "id": "previous-id",
        "revision": 1,
        "status": "active",
        "sent_at": NOW - timedelta(minutes=5),
    }
    inserted = {
        "id": "cancel-id",
        "revision": 2,
        "status": "cancelled",
        "previous_alert_id": "previous-id",
    }
    conn.fetchrow.side_effect = [None, previous, inserted]
    conn.fetchval.return_value = 2
    pool = _pool_with_conn(conn)

    row, created = await upsert_official_alert(
        pool,
        _alert(
            message_type="cancel",
            status="cancelled",
            raw_payload={"identifier": "BMKG-001", "messageType": "Cancel"},
        ),
        now=NOW,
    )

    assert created is True
    assert row["status"] == "cancelled"
    assert conn.execute.await_count == 2
    insert_args = conn.fetchrow.await_args_list[2].args
    assert insert_args[3] == 2
    assert insert_args[5] == "cancelled"
    assert insert_args[14] == "previous-id"
    assert insert_args[15] is True


@pytest.mark.asyncio
async def test_already_expired_payload_is_inserted_as_expired():
    conn = AsyncMock()
    inserted = {"id": "expired", "revision": 1, "status": "expired"}
    conn.fetchrow.side_effect = [None, None, inserted]
    conn.fetchval.return_value = 1
    pool = _pool_with_conn(conn)

    row, _ = await upsert_official_alert(
        pool,
        _alert(expires_at=NOW - timedelta(minutes=1)),
        now=NOW,
    )

    assert row["status"] == "expired"
    assert conn.fetchrow.await_args_list[2].args[5] == "expired"


@pytest.mark.asyncio
async def test_out_of_order_payload_is_retained_without_replacing_current():
    conn = AsyncMock()
    previous = {
        "id": "current-id",
        "revision": 2,
        "status": "active",
        "sent_at": NOW,
    }
    inserted = {
        "id": "late-id",
        "revision": 3,
        "status": "updated",
        "is_current": False,
    }
    conn.fetchrow.side_effect = [None, previous, inserted]
    conn.fetchval.return_value = 3
    pool = _pool_with_conn(conn)

    row, created = await upsert_official_alert(
        pool,
        _alert(
            sent_at=NOW - timedelta(hours=1),
            raw_payload={"identifier": "BMKG-001", "late": True},
        ),
        now=NOW,
    )

    assert created is True
    assert row["is_current"] is False
    assert conn.execute.await_count == 1  # advisory lock only
    insert_args = conn.fetchrow.await_args_list[2].args
    assert insert_args[5] == "updated"
    assert insert_args[15] is False


@pytest.mark.asyncio
async def test_expire_returns_updated_row_count():
    conn = AsyncMock()
    conn.fetch.return_value = [{"id": "one"}, {"id": "two"}]
    pool = _pool_with_conn(conn)

    count = await expire_official_alerts(pool, now=NOW)

    assert count == 2
    assert conn.fetch.await_args.args[1] == NOW
