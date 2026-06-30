import { useEffect, useState } from 'react'
import {
  getOfficialSourceSettings,
  updateOfficialSourceSetting,
  type OfficialSourceSetting,
} from '../../lib/api/client'

export default function OfficialSourcesSettingsPage() {
  const [items, setItems] = useState<OfficialSourceSetting[]>([])
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = async () => {
    try { setItems(await getOfficialSourceSettings()); setError(null) }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal memuat pengaturan.') }
  }
  useEffect(() => { void load() }, [])

  const patchItem = (source: string, patch: Partial<OfficialSourceSetting>) =>
    setItems((current) => current.map((item) => item.source_name === source ? { ...item, ...patch } : item))

  const save = async (item: OfficialSourceSetting) => {
    setSaving(item.source_name)
    try {
      await updateOfficialSourceSetting(item.source_name, {
        enabled: item.enabled,
        mode: item.mode,
        custom_api_url: item.custom_api_url,
        api_token: tokens[item.source_name] || undefined,
        poll_interval_seconds: item.poll_interval_seconds,
      })
      setTokens((current) => ({ ...current, [item.source_name]: '' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally { setSaving(null) }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Pengaturan Sumber Resmi</h1>
        <p className="mt-1 text-sm text-slate-400">Auto memilih Custom API, environment, lalu endpoint publik bawaan. Token tersimpan terenkripsi dan tidak ditampilkan kembali.</p>
      </header>
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-rose-300">{error}</p> : null}
      <div className="space-y-4">
        {items.map((item) => (
          <article key={item.source_name} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-semibold">{item.display_name}</h2><p className="text-xs text-slate-500">{item.attribution}</p></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={item.enabled} onChange={(e) => patchItem(item.source_name, { enabled: e.target.checked })} />
                Aktif
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-400">{item.notes}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">Mode
                <select value={item.mode} onChange={(e) => patchItem(item.source_name, { mode: e.target.value as OfficialSourceSetting['mode'] })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2">
                  <option value="auto">Auto</option><option value="default_public">Default Public</option><option value="custom_api">Custom API</option>
                </select>
              </label>
              <label className="text-sm">Interval polling (detik)
                <input type="number" min={60} max={86400} value={item.poll_interval_seconds} onChange={(e) => patchItem(item.source_name, { poll_interval_seconds: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2" />
              </label>
              <label className="text-sm md:col-span-2">Custom API URL
                <input type="url" placeholder={item.default_api_url ?? 'https://... API resmi'} value={item.custom_api_url ?? ''} onChange={(e) => patchItem(item.source_name, { custom_api_url: e.target.value || null })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2" />
              </label>
              <label className="text-sm md:col-span-2">API token {item.has_api_token ? '(sudah tersimpan; kosongkan untuk mempertahankan)' : ''}
                <input type="password" autoComplete="new-password" value={tokens[item.source_name] ?? ''} onChange={(e) => setTokens((current) => ({ ...current, [item.source_name]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2" />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-between">
              {item.terms_url ? <a href={item.terms_url} target="_blank" rel="noreferrer" className="text-xs text-sky-300">Ketentuan sumber ↗</a> : <span />}
              <button onClick={() => save(item)} disabled={saving === item.source_name} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving === item.source_name ? 'Menyimpan…' : 'Simpan'}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
