import { useState } from 'react'
import { getRegionalHistory, type RegionalHistoryProfile } from '../../lib/api/client'

export default function RegionalHistoryPage() {
  const [code, setCode] = useState('31.71')
  const [profile, setProfile] = useState<RegionalHistoryProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setProfile(await getRegionalHistory(code))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat profil wilayah.')
    } finally {
      setLoading(false)
    }
  }

  const maxCount = Math.max(1, ...(profile?.timeline.map((item) => item.event_count) ?? [1]))
  return (
    <section className="mx-auto max-w-6xl space-y-5" aria-labelledby="history-title">
      <header>
        <h1 id="history-title" className="text-2xl font-bold">Profil Historis Wilayah</h1>
        <p className="mt-1 text-sm text-slate-400">Statistik backend berdasarkan kode administrasi, bukan pencocokan nama.</p>
      </header>
      <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row">
        <label className="flex-1 text-sm">Kode administrasi
          <input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" />
        </label>
        <button onClick={load} disabled={loading} className="rounded-lg bg-indigo-500 px-5 py-2 font-semibold sm:self-end">
          {loading ? 'Memuat…' : 'Tampilkan'}
        </button>
      </div>
      {error ? <p role="alert" className="text-rose-300">{error}</p> : null}
      {profile ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Periode</p><p>{profile.period.from}—{profile.period.to}</p></article>
            <article className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Korban meninggal</p><p className="text-2xl font-bold">{profile.impact.deaths}</p></article>
            <article className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Mengungsi/terdampak</p><p className="text-2xl font-bold">{profile.impact.displaced}</p></article>
          </div>
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="font-semibold">Tren kejadian per tahun dan peril</h2>
            <div className="mt-4 space-y-3">
              {profile.timeline.map((item) => (
                <div key={`${item.year}-${item.peril}`}>
                  <div className="flex justify-between text-xs"><span>{item.year} · {item.peril}</span><span>{item.event_count} kejadian</span></div>
                  <div className="mt-1 h-3 rounded bg-slate-800"><div className="h-3 rounded bg-indigo-400" style={{ width: `${item.event_count / maxCount * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </article>
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="font-semibold">Coverage dan keterbatasan</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-300">
              {profile.source_coverage.map((source) => <li key={`${source.source}-${source.dataset_version}`}>{source.source} · {source.dataset_version} · {source.event_count} event</li>)}
              {profile.limitations.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Freshness: {profile.data_freshness ?? 'belum tersedia'} · Metode: {profile.method}</p>
          </article>
        </>
      ) : null}
    </section>
  )
}
