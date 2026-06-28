# Risk Monitor — Mastra Integration

Layer ini menambahkan **AI orchestration** ke project existing tanpa mengganti aplikasi inti.

## Tujuan
- executive briefing yang lebih terstruktur
- analyst copilot read-only
- workflow briefing yang dapat dipicu on-demand
- tool wrapper ke API Go dan worker FastAPI existing

## Struktur
- `src/mastra/agents/` — agents untuk briefing dan copilot
- `src/mastra/tools/` — wrapper read-only ke endpoint internal
- `src/mastra/workflows/` — workflow briefing
- `src/mastra/shared/` — config dan helper HTTP

## Default endpoint internal
- API Go: `http://127.0.0.1:8001/api/v1`
- Worker FastAPI: `http://127.0.0.1:8002/api/v1/worker`

## Environment variables
Lihat `.env.example`.

Yang penting:
- `RRM_API_BASE_URL`
- `RRM_WORKER_BASE_URL`
- `MASTRA_MODEL`
- `OPENAI_API_KEY`

## Script
```bash
npm run dev:mastra
```

## Catatan desain
- Mastra hanya sebagai orchestration layer
- tidak menjadi source of record
- write operation sensitif tetap lewat service domain existing
- output AI harus tetap mengacu ke source internal
