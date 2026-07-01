import { useEffect, useState } from 'react'
import {
  activateOfficialSource,
  dryRunOfficialSource,
  getOfficialSourceHistory,
  getOfficialSourceSettings,
  previewOfficialSource,
  previewBMKGDataOnlineWorkbook,
  rollbackOfficialSource,
  testOfficialSource,
  updateOfficialSourceSetting,
  type OfficialSourceHistory,
  type OfficialSourcePreview,
  type OfficialSourceSetting,
  type BMKGWorkbookPreview,
} from '../../lib/api/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from '../ews/LoginGate'

const inputClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2'

export default function OfficialSourcesSettingsPage() {
  const { session, loading, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" />
      </div>
    )
  }
  if (!session) {
    return (
      <LoginGate
        title="Pengaturan Sumber Resmi"
        subtitleIn="Masuk dengan akun admin untuk mengelola konektor sumber resmi."
        subtitleUp="Akses halaman ini hanya diberikan kepada admin yang disetujui."
      />
    )
  }

  return (
    <OfficialSourcesSettingsContent
      email={session.user.email ?? 'admin'}
      onSignOut={() => { void signOut() }}
    />
  )
}

function OfficialSourcesSettingsContent({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [items, setItems] = useState<OfficialSourceSetting[]>([])
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>({})
  const [changeReasons, setChangeReasons] = useState<Record<string, string>>({})
  const [rollbackReasons, setRollbackReasons] = useState<Record<string, string>>({})
  const [previews, setPreviews] = useState<Record<string, OfficialSourcePreview>>({})
  const [history, setHistory] = useState<Record<string, OfficialSourceHistory>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [bmkgFile, setBmkgFile] = useState<File | null>(null)
  const [bmkgPreview, setBmkgPreview] = useState<BMKGWorkbookPreview | null>(null)

  const load = async () => {
    try {
      const loaded = await getOfficialSourceSettings()
      setItems(loaded)
      setMappingDrafts(Object.fromEntries(
        loaded.map((item) => [item.source_name, JSON.stringify(item.field_mapping ?? {}, null, 2)]),
      ))
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat pengaturan.'
      setError(message.includes('403')
        ? `Akun ${email} tidak memiliki akses admin untuk pengaturan sumber resmi.`
        : message)
    }
  }
  useEffect(() => { void load() }, [])

  const patchItem = (source: string, patch: Partial<OfficialSourceSetting>) =>
    setItems((current) => current.map((item) => item.source_name === source ? { ...item, ...patch } : item))

  const mappingFor = (source: string) => {
    const value = JSON.parse(mappingDrafts[source] || '{}') as unknown
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Mapping harus berupa JSON object.')
    if (Object.values(value).some((path) => typeof path !== 'string')) throw new Error('Setiap nilai mapping harus berupa path string.')
    return value as Record<string, string>
  }

  const run = async (source: string, action: () => Promise<void>) => {
    setBusy(source)
    setError(null)
    try { await action() } catch (err) {
      setError(err instanceof Error ? err.message : 'Operasi gagal.')
    } finally { setBusy(null) }
  }

  const save = (item: OfficialSourceSetting) => run(item.source_name, async () => {
    await updateOfficialSourceSetting(item.source_name, {
      enabled: item.run_mode !== 'disabled',
      run_mode: item.run_mode,
      mode: item.mode,
      adapter_version: item.adapter_version,
      field_mapping: mappingFor(item.source_name),
      custom_api_url: item.custom_api_url,
      api_token: tokens[item.source_name] || undefined,
      poll_interval_seconds: item.poll_interval_seconds,
      change_reason: changeReasons[item.source_name] || undefined,
    })
    setTokens((current) => ({ ...current, [item.source_name]: '' }))
    setMessages((current) => ({ ...current, [item.source_name]: 'Konfigurasi tersimpan sebagai versi baru.' }))
    await load()
  })

  const preview = (item: OfficialSourceSetting) => run(item.source_name, async () => {
    const result = await previewOfficialSource(item.source_name, {
      mode: item.mode,
      custom_api_url: item.custom_api_url,
      api_token: tokens[item.source_name] || undefined,
      adapter_version: item.adapter_version,
      field_mapping: mappingFor(item.source_name),
    })
    setPreviews((current) => ({ ...current, [item.source_name]: result }))
    setMessages((current) => ({
      ...current,
      [item.source_name]: result.contract_valid ? 'Preview valid; payload tidak disimpan.' : 'Preview menemukan kontrak yang belum valid.',
    }))
  })

  const dryRun = (source: string) => run(source, async () => {
    const result = await dryRunOfficialSource(source)
    setPreviews((current) => ({ ...current, [source]: result }))
    setMessages((current) => ({
      ...current,
      [source]: result.contract_valid ? 'Dry-run berhasil. Sumber siap diaktifkan.' : 'Dry-run gagal; perbaiki mapping.',
    }))
    await load()
  })

  const activate = (source: string) => run(source, async () => {
    await activateOfficialSource(source)
    setMessages((current) => ({ ...current, [source]: 'Sumber diaktifkan dari konfigurasi dry-run yang tervalidasi.' }))
    await load()
  })

  const showHistory = (source: string) => run(source, async () => {
    const loaded = await getOfficialSourceHistory(source)
    setHistory((current) => ({ ...current, [source]: loaded }))
  })

  const rollback = (source: string, version: number) => run(source, async () => {
    const reason = rollbackReasons[source]?.trim()
    if (!reason) throw new Error('Alasan rollback wajib diisi.')
    await rollbackOfficialSource(source, version, reason)
    setMessages((current) => ({ ...current, [source]: `Rollback ke v${version} dibuat sebagai versi baru.` }))
    await load()
    const loaded = await getOfficialSourceHistory(source)
    setHistory((current) => ({ ...current, [source]: loaded }))
  })

  const testConnection = (source: string) => run(source, async () => {
    const result = await testOfficialSource(source)
    setMessages((current) => ({
      ...current,
      [source]: result.contract_valid
        ? `Koneksi valid · ${result.latency_ms ?? 0} ms`
        : `Terjangkau, tetapi kontrak belum valid (${result.status_code ?? '-'})`,
    }))
  })

  const previewBMKGWorkbook = async () => {
    if (!bmkgFile) {
      setError('Pilih file XLSX hasil unduhan BMKG Data Online.')
      return
    }
    setBusy('bmkg-data-online')
    setError(null)
    try {
      setBmkgPreview(await previewBMKGDataOnlineWorkbook(bmkgFile))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview XLSX BMKG gagal.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pengaturan Sumber Resmi</h1>
          <p className="mt-1 text-sm text-slate-400">
            Preview tidak menyimpan payload. Konfigurasi baru wajib melewati dry-run pada versi yang sama sebelum aktivasi.
          </p>
          <p className="mt-1 text-xs text-slate-500">{email}</p>
        </div>
        <button type="button" onClick={onSignOut} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-600">
          Logout
        </button>
      </header>
      {error ? <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-rose-300">{error}</p> : null}
      <article className="rounded-xl border border-sky-500/30 bg-slate-900 p-5">
        <h2 className="font-semibold">BMKG Data Online — Historical XLSX</h2>
        <p className="mt-1 text-xs text-slate-400">
          Preview membaca workbook di memori dan tidak menyimpan payload. Impor dinonaktifkan sampai administrative boundary resmi tersedia.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            aria-label="File XLSX BMKG Data Online"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setBmkgFile(event.target.files?.[0] ?? null)
              setBmkgPreview(null)
            }}
            className="max-w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200"
          />
          <button
            type="button"
            onClick={() => { void previewBMKGWorkbook() }}
            disabled={!bmkgFile || busy === 'bmkg-data-online'}
            className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200 disabled:opacity-40"
          >
            {busy === 'bmkg-data-online' ? 'Memeriksa…' : 'Preview XLSX'}
          </button>
        </div>
        {bmkgPreview ? (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs">
            <p className="text-emerald-300">
              {bmkgPreview.record_count} record valid · {bmkgPreview.error_count} invalid · header baris {bmkgPreview.header_row} · payload_stored=false
            </p>
            <p className="mt-1 text-amber-300">
              Boundary: {bmkgPreview.boundary_status}. Record belum dapat diimpor ke warehouse sebelum kode wilayah terselesaikan.
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer">Contoh hasil normalisasi</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-slate-400">{JSON.stringify(bmkgPreview.sample, null, 2)}</pre>
            </details>
          </div>
        ) : null}
      </article>
      <div className="space-y-4">
        {items.map((item) => {
          const result = previews[item.source_name]
          const sourceHistory = history[item.source_name]
          return (
            <article key={item.source_name} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{item.display_name}</h2>
                  <p className="text-xs text-slate-500">{item.attribution} · config v{item.config_version}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  item.run_mode === 'active' ? 'bg-emerald-500/15 text-emerald-300'
                    : item.run_mode === 'dry_run' ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-slate-700 text-slate-300'
                }`}>{item.run_mode}</span>
              </div>
              <p className="mt-2 text-xs text-slate-400">{item.notes}</p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm">Status eksekusi
                  <select value={item.run_mode} onChange={(e) => patchItem(item.source_name, { run_mode: e.target.value as OfficialSourceSetting['run_mode'] })} className={inputClass}>
                    <option value="disabled">Disabled</option>
                    <option value="dry_run">Dry-run / shadow</option>
                    {item.run_mode === 'active' ? <option value="active">Active</option> : null}
                  </select>
                </label>
                <label className="text-sm">Adapter version
                  <input value={item.adapter_version} onChange={(e) => patchItem(item.source_name, { adapter_version: e.target.value })} className={inputClass} />
                </label>
                <label className="text-sm">Mode endpoint
                  <select value={item.mode} onChange={(e) => patchItem(item.source_name, { mode: e.target.value as OfficialSourceSetting['mode'] })} className={inputClass}>
                    <option value="auto">Auto</option>
                    <option value="default_public">Default Public</option>
                    <option value="custom_api">Custom API</option>
                  </select>
                </label>
                <label className="text-sm">Interval polling (detik)
                  <input type="number" min={60} max={86400} value={item.poll_interval_seconds} onChange={(e) => patchItem(item.source_name, { poll_interval_seconds: Number(e.target.value) })} className={inputClass} />
                </label>
                <label className="text-sm md:col-span-2">Custom API URL
                  <input type="url" placeholder={item.default_api_url ?? 'https://... API resmi'} value={item.custom_api_url ?? ''} onChange={(e) => patchItem(item.source_name, { custom_api_url: e.target.value || null })} className={inputClass} />
                </label>
                <label className="text-sm md:col-span-2">API token {item.has_api_token ? '(tersimpan; kosongkan untuk mempertahankan)' : ''}
                  <input type="password" autoComplete="new-password" value={tokens[item.source_name] ?? ''} onChange={(e) => setTokens((current) => ({ ...current, [item.source_name]: e.target.value }))} className={inputClass} />
                </label>
                <label className="text-sm md:col-span-2">Field mapping JSON
                  <textarea rows={6} spellCheck={false} value={mappingDrafts[item.source_name] ?? '{}'} onChange={(e) => setMappingDrafts((current) => ({ ...current, [item.source_name]: e.target.value }))} className={`${inputClass} font-mono text-xs`} />
                  <span className="text-xs text-slate-500">Gunakan __records untuk path array, lalu canonical_field: nested.path.</span>
                </label>
                <label className="text-sm md:col-span-2">Alasan perubahan
                  <input value={changeReasons[item.source_name] ?? ''} onChange={(e) => setChangeReasons((current) => ({ ...current, [item.source_name]: e.target.value }))} className={inputClass} />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button onClick={() => testConnection(item.source_name)} disabled={busy === item.source_name} className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-200">Test API</button>
                <button onClick={() => preview(item)} disabled={busy === item.source_name} className="rounded-lg border border-violet-500/40 px-3 py-2 text-sm text-violet-200">Preview</button>
                <button onClick={() => save(item)} disabled={busy === item.source_name} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">Simpan versi</button>
                <button onClick={() => dryRun(item.source_name)} disabled={busy === item.source_name || item.run_mode !== 'dry_run'} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Jalankan dry-run</button>
                <button onClick={() => activate(item.source_name)} disabled={busy === item.source_name || !item.last_dry_run_valid} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40">Aktifkan</button>
                <button onClick={() => showHistory(item.source_name)} disabled={busy === item.source_name} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Histori & audit</button>
                {item.terms_url ? <a href={item.terms_url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-sky-300">Ketentuan sumber ↗</a> : null}
              </div>
              {messages[item.source_name] ? <p className="mt-3 text-xs text-slate-300">{messages[item.source_name]}</p> : null}

              {result ? (
                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs">
                  <p className={result.contract_valid ? 'text-emerald-300' : 'text-amber-300'}>
                    Adapter {result.adapter_version} · {result.valid_count}/{result.record_count} valid · payload_stored=false
                  </p>
                  {result.errors.length ? <ul className="mt-2 list-disc pl-4 text-rose-300">{result.errors.map((entry) => <li key={entry}>{entry}</li>)}</ul> : null}
                  <details className="mt-3"><summary className="cursor-pointer">Raw dan mapped sample</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-slate-400">{JSON.stringify({ raw: result.raw_sample, mapped: result.mapped_sample }, null, 2)}</pre>
                  </details>
                </div>
              ) : null}

              {sourceHistory ? (
                <div className="mt-4 grid gap-4 border-t border-slate-800 pt-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold">Versi konfigurasi</h3>
                    <input placeholder="Alasan rollback" value={rollbackReasons[item.source_name] ?? ''} onChange={(e) => setRollbackReasons((current) => ({ ...current, [item.source_name]: e.target.value }))} className={inputClass} />
                    <ul className="mt-2 space-y-2 text-xs">{sourceHistory.versions.map((version) => (
                      <li key={version.version} className="flex items-center justify-between rounded bg-slate-950 p-2">
                        <span>v{version.version} · {version.changed_by}<br />{version.change_reason ?? 'Tanpa catatan'}</span>
                        <button onClick={() => rollback(item.source_name, version.version)} disabled={version.version === item.config_version || busy === item.source_name} className="rounded border border-rose-500/40 px-2 py-1 text-rose-200 disabled:opacity-30">Rollback</button>
                      </li>
                    ))}</ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Audit administrator</h3>
                    <ul className="mt-2 max-h-72 space-y-2 overflow-auto text-xs">{sourceHistory.audit.map((entry, index) => (
                      <li key={`${entry.created_at}-${index}`} className="rounded bg-slate-950 p-2">
                        {entry.action} · {entry.success ? 'sukses' : 'gagal'} · {entry.actor_email}<br />
                        <span className="text-slate-500">{new Date(entry.created_at).toLocaleString('id-ID')}</span>
                      </li>
                    ))}</ul>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
