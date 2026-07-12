import { useMemo, useState } from 'react'
import type { LearningState } from '../../lib/api/learning'
import { completeLearningModule } from '../../lib/api/learning'
import { SAFETY_NOTE, type LearningModule } from './learningContent'

type LessonPlayerProps = {
  module: LearningModule
  onComplete: (state: LearningState) => void
}

export default function LessonPlayer({ module, onComplete }: LessonPlayerProps) {
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null)
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const checklistDone = useMemo(
    () => module.checklist.every((_item, index) => checkedItems[index]),
    [checkedItems, module.checklist],
  )
  const quizAnswered = selectedAnswer !== null
  const quizCorrect = selectedAnswer === module.quiz.answerIndex

  const finish = async () => {
    if (!quizAnswered || !checklistDone) return
    setSaving(true)
    setError(null)
    try {
      const next = await completeLearningModule(module.id, {
        quiz_score: quizCorrect ? 1 : 0,
        quiz_max_score: 1,
        checklist_completed: checklistDone,
      })
      onComplete(next)
    } catch {
      setError('Progress belum tersimpan. Coba simpan lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">{module.context} · {module.estimatedMinutes} menit</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-50">{module.title}</h2>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">+50 XP dasar</span>
      </div>

      <div className="mt-5 space-y-3">
        {module.lesson.map((item, index) => (
          <p key={item} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm leading-6 text-slate-300">
            <b className="text-slate-100">{index + 1}.</b> {item}
          </p>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950 p-4">
        <p className="text-sm font-semibold text-slate-100">{module.quiz.question}</p>
        <div className="mt-3 grid gap-2">
          {module.quiz.options.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => setSelectedAnswer(index)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                selectedAnswer === index
                  ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {quizAnswered && (
          <p className={`mt-3 text-sm ${quizCorrect ? 'text-emerald-200' : 'text-amber-200'}`}>
            {quizCorrect ? 'Benar. ' : 'Belum tepat. '} {module.quiz.explanation}
          </p>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950 p-4">
        <p className="text-sm font-semibold text-slate-100">Checklist tindakan nyata</p>
        <div className="mt-3 space-y-2">
          {module.checklist.map((item, index) => (
            <label key={item} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(checkedItems[index])}
                onChange={(event) => setCheckedItems((current) => ({ ...current, [index]: event.target.checked }))}
                className="mt-1"
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{error}</p>}
      <p className="mt-4 text-xs text-slate-500">{SAFETY_NOTE}</p>
      <button
        type="button"
        onClick={finish}
        disabled={!quizAnswered || !checklistDone || saving}
        className="mt-5 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Menyimpan…' : 'Selesaikan Modul'}
      </button>
    </section>
  )
}
