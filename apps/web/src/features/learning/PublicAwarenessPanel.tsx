import { useMemo, useState } from 'react'
import { DAILY_AWARENESS, MINI_CHALLENGE, SAFETY_NOTE } from './learningContent'

export default function PublicAwarenessPanel() {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const answeredCount = Object.keys(answers).length
  const score = useMemo(
    () => MINI_CHALLENGE.reduce((sum, item, index) => sum + (answers[index] === item.answerIndex ? 1 : 0), 0),
    [answers],
  )
  const finished = answeredCount === MINI_CHALLENGE.length

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-200">{DAILY_AWARENESS.title}</p>
        <h2 className="mt-3 text-lg font-semibold text-slate-50">{DAILY_AWARENESS.question}</h2>
        <p className="mt-3 text-sm font-medium text-emerald-100">{DAILY_AWARENESS.answer}</p>
        <p className="mt-2 text-sm text-slate-300">{DAILY_AWARENESS.note}</p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">Mini Challenge 3 Menit</h2>
            <p className="text-sm text-slate-400">Jawab 3 skenario cepat untuk mengukur refleks kesiapsiagaan.</p>
          </div>
          {finished && (
            <span className="rounded-full bg-indigo-500/20 px-3 py-1 text-sm font-semibold text-indigo-100">
              Skor {score}/{MINI_CHALLENGE.length}
            </span>
          )}
        </div>

        <div className="mt-5 space-y-4">
          {MINI_CHALLENGE.map((item, index) => (
            <div key={item.question} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm font-semibold text-slate-100">{index + 1}. {item.question}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {item.options.map((option, optionIndex) => {
                  const selected = answers[index] === optionIndex
                  const correct = finished && optionIndex === item.answerIndex
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAnswers((current) => ({ ...current, [index]: optionIndex }))}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        correct
                          ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-100'
                          : selected
                            ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {option}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-lg border border-slate-800 bg-slate-950 p-4">
          <p className="text-sm text-slate-300">
            {finished
              ? 'Masuk untuk menyimpan XP, streak, badge, dan lanjut ke learning path Evakuasi Praktis.'
              : 'Selesaikan challenge singkat ini, lalu masuk untuk menyimpan progress belajar.'}
          </p>
          <p className="mt-2 text-xs text-slate-500">{SAFETY_NOTE}</p>
        </div>
      </section>
    </div>
  )
}
