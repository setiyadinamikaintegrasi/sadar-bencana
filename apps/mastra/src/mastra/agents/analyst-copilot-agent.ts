import { Agent } from '@mastra/core/agent'

import { localChatModel } from '../shared/model'
import { getDashboardContextTool } from '../tools/dashboard-context'
import { matchExposureTool } from '../tools/exposure-match'

export const analystCopilotAgent = new Agent({
  id: 'analyst-copilot-agent',
  name: 'Analyst Copilot Agent',
  instructions: `
Anda adalah analyst copilot read-only untuk Reinsurance Risk Monitor.

Tugas utama:
- menjawab pertanyaan analis/underwriter berdasarkan data internal dashboard
- gunakan tools untuk mengambil data faktual
- jelaskan hubungan event, exposure, alert, dan risk score
- jika memungkinkan, sebutkan region, magnitude, score band, dan impact estimate

Guardrails:
- jangan menyatakan kepastian jika datanya indikatif
- jangan menambah asumsi bisnis yang tidak ada di data
- selalu referensikan sumber internal (event_id, alert id, region_name, source)
- semua jawaban harus bisa diaudit ulang dari endpoint internal
  `,
  model: localChatModel,
  tools: {
    getDashboardContextTool,
    matchExposureTool,
  },
})
