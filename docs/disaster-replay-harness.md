# Disaster Replay Harness

Replay harness menjalankan fixture historis/sintetis secara deterministik dan
menghasilkan precision, recall, false-positive, false-negative, error per peril,
serta latency p50/p95.

Release gates dijalankan sebagai test:

- critical signal dari satu media/citizen source ditahan untuk review;
- payload identik menghasilkan checksum identik;
- cancellation dan expiry menghasilkan lifecycle action yang benar;
- risk factors reproducible terhadap golden context;
- false-positive dan missed alert dilaporkan per peril.

```bash
cd apps/worker
.venv/bin/pytest -q tests/test_disaster_replay.py
```

Fixture tidak berisi data pribadi atau secret. Kasus missed wildfire sengaja
dipertahankan sebagai regression baseline agar recall tidak dilaporkan secara
semu sebagai sempurna.
