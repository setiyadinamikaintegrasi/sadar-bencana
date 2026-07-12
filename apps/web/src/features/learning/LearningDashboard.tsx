import type { LearningState } from '../../lib/api/learning'
import { LEARNING_MODULES } from './learningContent'
import ProgressSummary from './ProgressSummary'

type LearningDashboardProps = {
  state: LearningState
  onStartModule: (moduleId: string) => void
}

export default function LearningDashboard({ state, onStartModule }: LearningDashboardProps) {
  const progressByModule = new Map(state.progress.map((item) => [item.module_id, item]))

  return (
    <div className="space-y-4">
      <ProgressSummary state={state} />
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold text-slate-50">Learning Path: Evakuasi Praktis</h2>
        <p className="mt-1 text-sm text-slate-400">Selesaikan tiga konteks awal agar rencana evakuasi Anda lebih siap dipakai.</p>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {LEARNING_MODULES.map((module) => {
            const progress = progressByModule.get(module.id)
            const done = progress?.status === 'completed'
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => onStartModule(module.id)}
                className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-left transition hover:border-indigo-400/70"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">{module.context} · {module.estimatedMinutes} menit</p>
                <h3 className="mt-2 text-base font-semibold text-slate-50">{module.title}</h3>
                <p className="mt-3 text-sm text-slate-400">{module.lesson[0]}</p>
                <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  done ? 'bg-emerald-500/15 text-emerald-100' : 'bg-slate-800 text-slate-300'
                }`}>
                  {done ? `Selesai · ${progress?.xp_earned ?? 0} XP` : 'Mulai modul'}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
