"""Order-independent CAP lifecycle reconciliation against PostgreSQL."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from alerts.lifecycle_delivery import (
    enqueue_official_alert_revision,
    persist_official_alert_revision,
)
from db.official_alerts import upsert_official_alert
from tests.integration.test_lifecycle_delivery_postgis import (
    cap_lifecycle_input,
    insert_recipient,
    isolated_lifecycle_database,
)


NOW = datetime(2026, 7, 15, 5, 0, tzinfo=timezone.utc)


def cap_chain():
    return {
        "A": cap_lifecycle_input("A", sent_at=NOW),
        "B": cap_lifecycle_input(
            "B",
            sent_at=NOW + timedelta(minutes=1),
            message_type="update",
            referenced_identifier="A",
        ),
        "C": cap_lifecycle_input(
            "C",
            sent_at=NOW + timedelta(minutes=2),
            message_type="update",
            referenced_identifier="B",
        ),
        "D": cap_lifecycle_input(
            "D",
            sent_at=NOW + timedelta(minutes=3),
            message_type="cancel",
            referenced_identifier="C",
        ),
    }


async def lifecycle_rows(pool):
    async with pool.acquire() as conn:
        return await conn.fetch(
            """
            SELECT source_alert_id, revision, message_type, status, is_current,
                   raw_payload->>'message_identifier' AS message_identifier,
                   previous_alert_id,
                   id
            FROM official_alerts
            ORDER BY revision
            """
        )


def assert_reconciled_chain(rows):
    assert [row["source_alert_id"] for row in rows] == ["A"] * 4
    assert [row["revision"] for row in rows] == [1, 2, 3, 4]
    assert [row["message_identifier"] for row in rows] == ["A", "B", "C", "D"]
    assert [row["is_current"] for row in rows] == [False, False, False, True]
    assert [row["status"] for row in rows] == [
        "updated",
        "updated",
        "updated",
        "cancelled",
    ]
    assert rows[0]["previous_alert_id"] is None
    assert [row["previous_alert_id"] for row in rows[1:]] == [
        row["id"] for row in rows[:-1]
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("ingestion_order", [("A", "B", "C", "D"), ("D", "C", "B", "A")])
async def test_cap_chain_reconciles_independently_of_ingestion_order(ingestion_order):
    inputs = cap_chain()
    async with isolated_lifecycle_database() as pool:
        for identifier in ingestion_order:
            row, created = await upsert_official_alert(pool, inputs[identifier], now=NOW)
            assert created is True

        assert_reconciled_chain(await lifecycle_rows(pool))


@pytest.mark.asyncio
async def test_missing_predecessor_reconciles_existing_descendants_when_it_arrives():
    inputs = cap_chain()
    async with isolated_lifecycle_database() as pool:
        await upsert_official_alert(pool, inputs["D"], now=NOW)
        await upsert_official_alert(pool, inputs["C"], now=NOW)

        partial = await lifecycle_rows(pool)
        assert [row["source_alert_id"] for row in partial] == ["B", "B"]
        assert [row["message_identifier"] for row in partial] == ["C", "D"]
        assert [row["is_current"] for row in partial] == [False, True]

        await upsert_official_alert(pool, inputs["B"], now=NOW)
        before_root = await lifecycle_rows(pool)
        assert [row["source_alert_id"] for row in before_root] == ["A"] * 3

        root, created = await upsert_official_alert(pool, inputs["A"], now=NOW)
        assert created is True
        assert root["source_alert_id"] == "A"
        assert root["revision"] == 4
        assert root["message_type"] == "cancel"
        assert root["is_current"] is True
        assert_reconciled_chain(await lifecycle_rows(pool))


@pytest.mark.asyncio
async def test_newest_first_bridge_enqueues_reconciled_cancellation_once():
    inputs = cap_chain()
    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)

        initial, _ = await upsert_official_alert(pool, inputs["A"], now=NOW)
        assert await enqueue_official_alert_revision(pool, initial) == 1
        async with pool.acquire() as conn:
            await conn.execute("UPDATE ews_notification_log SET status = 'sent'")

        returned = []
        for identifier in ("D", "C", "B", "A"):
            row, created, allowed = await persist_official_alert_revision(
                pool,
                inputs[identifier],
                delivery_enabled=True,
            )
            assert allowed is True
            returned.append((identifier, row, created))

        bridge_row = next(row for identifier, row, _ in returned if identifier == "B")
        bridge_payload = bridge_row["raw_payload"]
        if isinstance(bridge_payload, str):
            bridge_payload = json.loads(bridge_payload)
        assert bridge_payload["message_identifier"] == "D"
        assert bridge_row["revision"] == 4
        assert bridge_row["is_current"] is True

        duplicate_root = returned[-1]
        assert duplicate_root[2] is False
        duplicate_payload = duplicate_root[1]["raw_payload"]
        if isinstance(duplicate_payload, str):
            duplicate_payload = json.loads(duplicate_payload)
        assert duplicate_payload["message_identifier"] == "D"

        async with pool.acquire() as conn:
            deliveries = await conn.fetch(
                """
                SELECT source_alert_id, alert_revision, lifecycle_action, status
                FROM ews_notification_log
                ORDER BY alert_revision
                """
            )
        assert [dict(row) for row in deliveries] == [
            {
                "source_alert_id": "A",
                "alert_revision": 1,
                "lifecycle_action": "alert",
                "status": "sent",
            },
            {
                "source_alert_id": "A",
                "alert_revision": 4,
                "lifecycle_action": "cancellation",
                "status": "pending",
            },
        ]


@pytest.mark.asyncio
async def test_multiple_references_choose_oldest_root_not_first_list_entry():
    candidate = cap_lifecycle_input(
        "revision-c",
        sent_at=NOW + timedelta(minutes=2),
        message_type="update",
        referenced_identifier="revision-b",
    )
    candidate = candidate.model_copy(
        update={
            "raw_payload": {
                **candidate.raw_payload,
                "references": [
                    {
                        "sender": "nowcast@bmkg.go.id",
                        "identifier": "revision-b",
                        "sent": (NOW + timedelta(minutes=1)).isoformat(),
                    },
                    {
                        "sender": "nowcast@bmkg.go.id",
                        "identifier": "original-a",
                        "sent": NOW.isoformat(),
                    },
                ],
                "referenced_message_identifiers": ["revision-b", "original-a"],
            }
        }
    )

    async with isolated_lifecycle_database() as pool:
        row, created = await upsert_official_alert(pool, candidate, now=NOW)

    assert created is True
    assert row["source_alert_id"] == "original-a"


@pytest.mark.asyncio
async def test_adjacent_revisions_from_two_replicas_serialize_and_keep_prior_recipient():
    inputs = cap_chain()
    first_locked = asyncio.Event()
    release_first = asyncio.Event()

    async with isolated_lifecycle_database() as pool:
        async with pool.acquire() as conn:
            await insert_recipient(conn)

        initial, _ = await upsert_official_alert(pool, inputs["A"], now=NOW)
        assert await enqueue_official_alert_revision(pool, initial) == 1
        async with pool.acquire() as conn:
            await conn.execute("UPDATE ews_notification_log SET status = 'sent'")

        async def first_replica():
            async with pool.acquire() as conn:
                async with conn.transaction():
                    result = await upsert_official_alert(
                        pool,
                        inputs["B"],
                        now=NOW,
                        connection=conn,
                    )
                    first_locked.set()
                    await release_first.wait()
                    return result

        async def second_replica():
            await first_locked.wait()
            async with pool.acquire() as conn:
                async with conn.transaction():
                    return await upsert_official_alert(
                        pool,
                        inputs["C"],
                        now=NOW,
                        connection=conn,
                    )

        first_task = asyncio.create_task(first_replica())
        await first_locked.wait()
        second_task = asyncio.create_task(second_replica())
        await asyncio.sleep(0.05)
        assert second_task.done() is False
        release_first.set()
        first_result, second_result = await asyncio.gather(first_task, second_task)
        assert first_result[1] is True
        assert second_result[1] is True

        cancellation, _ = await upsert_official_alert(pool, inputs["D"], now=NOW)
        assert await enqueue_official_alert_revision(pool, cancellation) == 1

        rows = await lifecycle_rows(pool)
        assert_reconciled_chain(rows)
        async with pool.acquire() as conn:
            deliveries = await conn.fetch(
                """
                SELECT source_alert_id, alert_revision, lifecycle_action, status
                FROM ews_notification_log
                ORDER BY alert_revision
                """
            )
        assert [dict(row) for row in deliveries] == [
            {
                "source_alert_id": "A",
                "alert_revision": 1,
                "lifecycle_action": "alert",
                "status": "sent",
            },
            {
                "source_alert_id": "A",
                "alert_revision": 4,
                "lifecycle_action": "cancellation",
                "status": "pending",
            },
        ]
