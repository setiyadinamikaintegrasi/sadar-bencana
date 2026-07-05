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
