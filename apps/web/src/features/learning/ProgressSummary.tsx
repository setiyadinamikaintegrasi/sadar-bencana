import type { LearningState } from '../../lib/api/learning'

export default function ProgressSummary({ state }: { state: LearningState }) {
  const unlocked = state.badges.filter((badge) => badge.unlocked_at)

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-500">XP</p>
        <p className="mt-1 text-2xl font-semibold text-slate-50">{state.stats.total_xp}</p>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-500">Streak</p>
        <p className="mt-1 text-2xl font-semibold text-amber-200">{state.stats.current_streak_days} hari</p>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-500">Level</p>
        <p className="mt-1 text-2xl font-semibold text-indigo-200">{state.stats.level}</p>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:col-span-3">
        <p className="text-xs text-slate-500">Badge terbuka</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {unlocked.length === 0 ? (
            <span className="text-sm text-slate-500">Belum ada badge. Selesaikan modul pertama untuk membuka badge.</span>
          ) : (
            unlocked.map((badge) => (
              <span key={badge.id} className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                {badge.name}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
