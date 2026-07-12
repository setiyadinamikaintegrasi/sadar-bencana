import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth/AuthProvider'
import type { LearningState } from '../../lib/api/learning'
import { getLearningState } from '../../lib/api/learning'
import LearningDashboard from './LearningDashboard'
import LessonPlayer from './LessonPlayer'
import PublicAwarenessPanel from './PublicAwarenessPanel'
import { LEARNING_MODULES, SAFETY_NOTE } from './learningContent'

export default function LearningPage() {
  const { session, loading } = useAuth()
  const [state, setState] = useState<LearningState | null>(null)
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) {
      setState(null)
      return
    }
    setBusy(true)
    setError(null)
    getLearningState()
      .then(setState)
      .catch(() => setError('Progress belajar belum bisa dimuat. Konten tetap bisa dibaca.'))
      .finally(() => setBusy(false))
  }, [session])

  const selectedModule = useMemo(
    () => LEARNING_MODULES.find((module) => module.id === selectedModuleId) ?? null,
    [selectedModuleId],
  )

  if (loading) {
    return <p className="py-12 text-center text-sm text-slate-400">Memeriksa sesi…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Belajar Siaga</h1>
          <p className="max-w-3xl text-sm text-slate-400">
            Latihan singkat untuk membangun kesiapan evakuasi di rumah, kantor/sekolah, dan tempat umum.
          </p>
        </div>
        {session && (
          <button
            type="button"
            onClick={() => setSelectedModuleId(null)}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
          >
            Dashboard
          </button>
        )}
      </div>

      {!session ? (
        <PublicAwarenessPanel />
      ) : busy ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">Memuat progress belajar…</p>
      ) : selectedModule ? (
        <LessonPlayer module={selectedModule} onComplete={(next) => {
          setState(next)
          setSelectedModuleId(null)
        }} />
      ) : state ? (
        <LearningDashboard state={state} onStartModule={setSelectedModuleId} />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm text-amber-200">{error ?? 'Progress belajar belum tersedia.'}</p>
          <p className="mt-2 text-xs text-slate-500">{SAFETY_NOTE}</p>
        </div>
      )}
    </div>
  )
}
