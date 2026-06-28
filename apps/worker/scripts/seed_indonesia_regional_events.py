"""Seed representative Indonesian earthquake events for regional coverage tests.

Purpose:
- Prove BMKG-style place names across several Indonesian regions are matched by
  exposure rules and produce alerts correctly.
- Reusable for demos / regression checks after connector or evaluator changes.

Usage:
    set -a && . /tmp/rrm-runtime.env && set +a
    source .venv/bin/activate
    python scripts/seed_indonesia_regional_events.py
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from alerts.evaluator import evaluate_alerts
from db.events import upsert_events
from db.pool import close_pool, get_pool, init_pool
from models.event import EarthquakeEvent
from scoring.risk import score_events


BASE_TIME = datetime.now(timezone.utc).replace(microsecond=0)


def build_seed_events() -> list[EarthquakeEvent]:
    rows = [
        {
            "event_id": "seed-id:sukabumi-20260621-m61",
            "magnitude": 6.1,
            "latitude": -7.01,
            "longitude": 106.55,
            "place": "68 km BaratDaya SUKABUMI-JABAR (Tidak berpotensi tsunami)",
        },
        {
            "event_id": "seed-id:mentawai-20260621-m59",
            "magnitude": 5.9,
            "latitude": -2.85,
            "longitude": 99.91,
            "place": "112 km BaratLaut MENTAWAI-SUMBAR (Tidak berpotensi tsunami)",
        },
        {
            "event_id": "seed-id:banda-20260621-m64",
            "magnitude": 6.4,
            "latitude": 4.52,
            "longitude": 129.89,
            "place": "155 km Tenggara BANDA-MALUKU (Tidak berpotensi tsunami)",
        },
        {
            "event_id": "seed-id:sumba-20260621-m57",
            "magnitude": 5.7,
            "latitude": -9.84,
            "longitude": 119.21,
            "place": "47 km TimurLaut SUMBA-NTT (Tidak berpotensi tsunami)",
        },
        {
            "event_id": "seed-id:aceh-20260621-m63",
            "magnitude": 6.3,
            "latitude": 5.41,
            "longitude": 95.96,
            "place": "36 km BaratDaya ACEH BESAR-ACEH (Tidak berpotensi tsunami)",
        },
    ]

    events: list[EarthquakeEvent] = []
    for i, row in enumerate(rows):
        ts = (BASE_TIME - timedelta(minutes=i * 7)).isoformat()
        events.append(
            EarthquakeEvent(
                event_id=row["event_id"],
                source="seed-bmkg",
                event_type="earthquake",
                magnitude=row["magnitude"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                place=row["place"],
                time=ts,
                url="https://example.local/seed/indonesia-regional-test",
                created_at=ts,
            )
        )
    return events


async def main() -> None:
    await init_pool()
    pool = get_pool()
    events = build_seed_events()

    upserted = await upsert_events(pool, events)
    scored = await score_events(pool, events)
    alerts = await evaluate_alerts(pool, events)

    print("=== Seed Indonesia Regional Coverage ===")
    print(f"events_seeded  : {len(events)}")
    print(f"events_upserted: {upserted}")
    print(f"events_scored  : {scored}")
    print(f"alerts_created : {len(alerts)}")
    print()

    for event in events:
        matched = [a for a in alerts if event.place in a.get("message", "")]
        status = "ALERT" if matched else "NO-ALERT"
        print(f"- {status:8} | {event.event_id:34} | M{event.magnitude:.1f} | {event.place}")

    await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
