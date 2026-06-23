## Gap Analysis — Mastra Feature Improvements

### 1️⃣ Analyst Copilot — Chat Queryable via UI ⭐ HIGHEST VALUE
**Existing:** `analystCopilotAgent` terdaftar di Mastra index dengan tools `getDashboardContextTool` + `matchExposureTool`.
**Gap:** Tidak ada endpoint SSE di Go backend, tidak ada UI frontend.
**Implementation path:**
1. Go backend: handler SSE `POST /api/v1/ai/copilot/query` → stream dari Mastra `analystCopilotAgent`
2. Frontend: komponen chat ringan di bawah BriefingPage
3. Pola persis seperti executive briefing yang sudah bekerja

### 2️⃣ RAG — Query Historical Briefings via pgvector
**Existing:** Storage LibSQL sudah ada, PostgreSQL + pgvector aktif di project.
**Gap:** Tidak ada tool retrieval di Mastra untuk query briefing historis.
**Implementation path:**
1. Tool baru di Mastra: `search-historical-briefings(embedding) → chunks`
2. Agent copilot bisa panggil saat user tanya "Apa kata briefing kemarin?"

### 3️⃣ Workflow Scheduler — Cron-driven AI Briefing
**Existing:** Briefing di-trigger oleh user action di UI.
**Gap:** Tidak ada automatic scheduled run.
**Implementation path:**
1. Gunakan Hermes cronjob + Mastra trigger → generate briefing otomatis

### 4️⃣ Agent-to-Agent — Copilot delegates ke Briefing Agent
**Existing:** Dua agent terpisah, tidak saling tahu.
**Gap:** Copilot bisa panggil executiveBriefingAgent untuk narasi.
**Implementation path:** Mastra Agent `llms` atau tool delegasi.

---

## Recommendation

Start with **#1 — Analyst Copilot via SSE**. Impact tertinggi:
- Langsung bisa dipakai user di UI
- Pola identik dengan executive briefing → implementasi cepat
- Membuka jalur untuk future improvements (#2, #4)
