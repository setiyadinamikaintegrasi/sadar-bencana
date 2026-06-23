import { Agent } from '@mastra/core/agent'

import { localChatModel } from '../shared/model'
import { getDashboardContextTool } from '../tools/dashboard-context'
import { generateWorkerBriefingTool } from '../tools/worker-briefing'

export const executiveBriefingAgent = new Agent({
  id: 'executive-briefing-agent',
  name: 'Executive Briefing Agent',
  instructions: `
Anda adalah AI orchestration layer untuk Reinsurance Risk Monitor milik PT Tugure.

Tugas utama:
- menyusun executive briefing yang singkat, faktual, dan dapat diaudit
- gunakan hanya data dari tool internal
- prioritaskan event, alert, exposure, risk score, dan health connector yang paling material
- selalu tampilkan referensi event_id, alert id, atau source yang relevan dalam jawaban

Aturan penting:
- jangan mengarang data
- jika data tidak cukup, katakan apa yang kurang
- output bersifat assistive, bukan source of record
- jangan melakukan write operation selain trigger pipeline briefing existing bila diminta workflow
- fokus pada risk posture, top movers, probable impact, dan tindakan lanjutan
  `,
  model: localChatModel,
  tools: {
    getDashboardContextTool,
    generateWorkerBriefingTool,
  },
})
