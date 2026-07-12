import { request } from './client'

export type LearningStats = {
  user_id: string
  total_xp: number
  current_streak_days: number
  longest_streak_days: number
  last_activity_date: string | null
  level: number
}

export type LearningModuleProgress = {
  module_id: string
  status: 'not_started' | 'in_progress' | 'completed'
  quiz_score: number
  quiz_max_score: number
  checklist_completed: boolean
  xp_earned: number
  completed_at: string | null
}

export type LearningBadge = {
  id: string
  name: string
  description: string
  criteria: string
  unlocked_at?: string | null
}

export type LearningState = {
  stats: LearningStats
  progress: LearningModuleProgress[]
  badges: LearningBadge[]
}

export type LearningCompletionBody = {
  quiz_score: number
  quiz_max_score: number
  checklist_completed: boolean
}

export async function getLearningState(): Promise<LearningState> {
  const response = await request<{ data: LearningState }>('/learning/me')
  return response.data
}

export async function completeLearningModule(
  moduleId: string,
  body: LearningCompletionBody,
): Promise<LearningState> {
  const response = await request<{ data: LearningState }>(
    `/learning/modules/${encodeURIComponent(moduleId)}/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  return response.data
}
