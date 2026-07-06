# Worker App

Calon worker untuk ingestion, normalization, scoring, dan AI briefing.

## Target responsibilities
- BMKG / USGS / GDACS connectors
- RSS/news normalization
- risk scoring
- alert generation
- local AI summarization

## Recommended runtime
- Python + FastAPI + scheduled jobs

## Production security

- Set `API_ENV=hosted` atau `production`.
- Set `WORKER_API_TOKEN` dengan nilai acak minimal 32 karakter.
- Semua endpoint `/api/v1/*` membutuhkan bearer token; `/health` tetap publik
  untuk probe internal.
- Swagger, ReDoc, dan OpenAPI dinonaktifkan di production.
- Jangan reverse proxy port Worker langsung ke internet.
- EWS hanya mendukung Telegram dan email (Resend SMTP).
- Set `EWS_DELIVERY_ENABLED=true` hanya setelah migration 037 dan test-send
  kedua provider berhasil.
- Delivery alert biasa dan official lifecycle menggunakan queue dengan lima
  percobaan sebelum `dead_letter`.
- `ASSET_POLL_INTERVAL_SECONDS` mengatur drain aset streaming (default 60 detik).
- `OPENSKY_POLL_INTERVAL_SECONDS` mengatur polling OpenSky terpisah (default
  300 detik). Respons `429` memicu exponential backoff dari
  `OPENSKY_BACKOFF_INITIAL_SECONDS` hingga `OPENSKY_BACKOFF_MAX_SECONDS`.
