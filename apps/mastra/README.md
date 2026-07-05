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
- `SADAR_API_BASE_URL`
- `SADAR_WORKER_BASE_URL`
- `WORKER_API_TOKEN`
- `MASTRA_API_TOKEN`
- `API_ENV` (`hosted` atau `production` untuk fail-closed)
- `MASTRA_AI_PROVIDER` (`deepseek` untuk hosted, `local` untuk local/community)
- `DEEPSEEK_API_KEY` (wajib dan harus berformat `sk-...` pada hosted)
- `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com/v1`)
- `DEEPSEEK_MODEL` (default `deepseek-v4-flash`)
- `MASTRA_AI_MAX_OUTPUT_TOKENS` (default `2048`)
- `MASTRA_AI_MAX_STEPS` (default `6`)
- `MASTRA_MODEL`, `OPENAI_API_KEY`, dan `OPENAI_BASE_URL` hanya untuk provider local

## Script
```bash
npm run dev:mastra
```

## Catatan desain
- Mastra hanya sebagai orchestration layer
- tidak menjadi source of record
- write operation sensitif tetap lewat service domain existing
- output AI harus tetap mengacu ke source internal
- production Mastra hanya boleh diakses oleh Go API melalui bearer token dan
  tidak boleh dipublikasikan sebagai subdomain terbuka
- Executive Briefing dan Analyst Copilot memakai provider/model yang sama;
  hosted default menggunakan `deepseek-v4-flash` non-thinking untuk menekan
  biaya dan latency
