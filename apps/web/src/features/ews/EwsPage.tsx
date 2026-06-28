import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from './LoginGate'
import WatchZoneMapPicker from './WatchZoneMapPicker'
import {
  createMyWatchZone,
  deleteMyWatchZone,
  fetchMyNotifications,
  fetchMyPrefs,
  fetchMyProfile,
  fetchMyWatchZones,
  updateMyPref,
  updateMyProfile,
  type EWSChannel,
  type EWSNotificationLogEntry,
  type EWSNotificationPref,
  type EWSSeverity,
  type EWSWatchZone,
} from '../../lib/api/ews'

type Tab = 'zones' | 'prefs' | 'notifs'
const TABS: { key: Tab; label: string }[] = [
  { key: 'zones', label: 'Watch Zones' },
  { key: 'prefs', label: 'Preferences' },
  { key: 'notifs', label: 'Notifikasi Saya' },
]
const CHANNELS: EWSChannel[] = ['telegram', 'whatsapp', 'email']
const SEVERITIES: EWSSeverity[] = ['Moderate', 'High', 'Critical']
const PERILS = ['earthquake', 'flood', 'volcano', 'wildfire', 'windstorm']
const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400'
const statusClasses: Record<string, string> = {
  sent: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/30',
  failed: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-400/30',
  skipped: 'bg-slate-500/15 text-slate-400 ring-1 ring-inset ring-slate-500/30',
  pending: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-400/30',
}

function Spinner() {
  return <div className="flex justify-center py-12"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400" /></div>
}

function ZonesTab() {
  const [zones, setZones] = useState<EWSWatchZone[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try { setZones(await fetchMyWatchZones()) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShowForm(true)} className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-sm font-semibold text-indigo-100 ring-1 ring-inset ring-indigo-400/40 hover:bg-indigo-500/30">+ Zona</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {zones.map((z) => (
          <div key={z.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-100">{z.label}</p>
                <p className="mt-1 font-mono text-xs text-slate-400">{z.latitude.toFixed(3)}, {z.longitude.toFixed(3)} · {z.radius_km} km</p>
              </div>
              <button type="button" onClick={async () => { if (window.confirm(`Hapus zona "${z.label}"?`)) { await deleteMyWatchZone(z.id); load() } }} className="text-xs text-rose-300 hover:text-rose-200">Hapus</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {z.peril_types.length === 0 ? <span className="text-[11px] text-slate-500">semua peril</span> : z.peril_types.map((p) => <span key={p} className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{p}</span>)}
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-amber-300">≥ M{z.min_magnitude}</span>
            </div>
          </div>
        ))}
        {zones.length === 0 && <p className="col-span-full py-8 text-center text-slate-500">Belum ada watch zone.</p>}
      </div>
      {showForm && <ZoneForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); load() }} />}
    </div>
  )
}

function ZoneForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [radius, setRadius] = useState(100)
  const [perils, setPerils] = useState<string[]>([])
  const [minMag, setMinMag] = useState(5.0)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    if (!label.trim() || lat === null || lon === null) { setErr('Label & titik peta wajib diisi.'); return }
    setSaving(true); setErr(null)
    try {
      await createMyWatchZone({ label: label.trim(), latitude: lat, longitude: lon, radius_km: radius, peril_types: perils, min_magnitude: minMag })
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menyimpan.') } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="mt-10 w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-semibold text-slate-100">Watch Zone Baru</h3><button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">✕</button></div>
        <div className="space-y-3">
          <input className={input} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <WatchZoneMapPicker latitude={lat} longitude={lon} radiusKm={radius} onChange={(la, lo, r) => { setLat(la); setLon(lo); setRadius(r) }} />
          <div className="flex flex-wrap gap-2">
            {PERILS.map((p) => { const on = perils.includes(p); return <button key={p} type="button" onClick={() => setPerils((cur) => on ? cur.filter((x) => x !== p) : [...cur, p])} className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-inset ring-indigo-400/40' : 'bg-slate-800 text-slate-200'}`}>{p}</button> })}
          </div>
          <label className="block text-xs text-slate-400">Min magnitude: M{minMag.toFixed(1)}
            <input type="range" min={0} max={9} step={0.5} value={minMag} onChange={(e) => setMinMag(Number(e.target.value))} className="mt-1 w-full accent-indigo-500" />
          </label>
          {err && <p className="text-sm text-rose-300">{err}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200">Batal</button><button type="button" onClick={save} disabled={saving} className="rounded-lg bg-indigo-500/20 px-4 py-1.5 text-sm font-semibold text-indigo-100 ring-1 ring-inset ring-indigo-400/40 disabled:opacity-50">{saving ? 'Menyimpan…' : 'Simpan'}</button></div>
        </div>
      </div>
    </div>
  )
}

function PrefsTab() {
  const [prefs, setPrefs] = useState<EWSNotificationPref[]>([])
  const [profile, setProfile] = useState<{ telegram_chat_id?: number | null; phone_whatsapp?: string | null }>({})
  const [loading, setLoading] = useState(true)
  const [busyCh, setBusyCh] = useState<EWSChannel | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, prof] = await Promise.all([fetchMyPrefs(), fetchMyProfile()])
      setPrefs(p); setProfile({ telegram_chat_id: prof.telegram_chat_id, phone_whatsapp: prof.phone_whatsapp })
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const prefFor = (ch: EWSChannel): EWSNotificationPref => prefs.find((p) => p.channel === ch) ?? { channel: ch, min_severity: 'High', alert_types: [], quiet_hours_start: null, quiet_hours_end: null, is_enabled: false }
  const save = async (ch: EWSChannel, patch: Partial<EWSNotificationPref>) => {
    setBusyCh(ch)
    try { const saved = await updateMyPref({ ...prefFor(ch), ...patch, channel: ch }); setPrefs((cur) => [...cur.filter((p) => p.channel !== ch), saved]) } finally { setBusyCh(null) }
  }
  if (loading) return <Spinner />
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <p className="mb-2 text-sm font-semibold text-slate-100">Kontak saya</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-slate-400">Telegram chat id
            <input className={input} value={profile.telegram_chat_id ?? ''} onChange={(e) => setProfile({ ...profile, telegram_chat_id: e.target.value ? Number(e.target.value) : null })} onBlur={() => updateMyProfile({ telegram_chat_id: profile.telegram_chat_id ?? null })} />
          </label>
          <label className="block text-xs text-slate-400">WhatsApp (62…)
            <input className={input} value={profile.phone_whatsapp ?? ''} onChange={(e) => setProfile({ ...profile, phone_whatsapp: e.target.value || null })} onBlur={() => updateMyProfile({ phone_whatsapp: profile.phone_whatsapp ?? null })} />
          </label>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {CHANNELS.map((ch) => { const p = prefFor(ch); return (
          <div key={ch} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between"><p className="font-semibold capitalize text-slate-100">{ch}</p>
              <input type="checkbox" checked={p.is_enabled} disabled={busyCh === ch} onChange={(e) => save(ch, { is_enabled: e.target.checked })} className="accent-indigo-500" />
            </div>
            <label className="mt-3 block text-xs text-slate-400">Min severity
              <select className={input} value={p.min_severity} disabled={busyCh === ch} onChange={(e) => save(ch, { min_severity: e.target.value as EWSSeverity })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        ) })}
      </div>
    </div>
  )
}

function NotifsTab() {
  const [entries, setEntries] = useState<EWSNotificationLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => { setLoading(true); try { setEntries(await fetchMyNotifications()) } finally { setLoading(false) } })() }, [])
  if (loading) return <Spinner />
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-full divide-y divide-slate-800 text-sm">
        <thead className="bg-slate-900/60 text-left text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Channel</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Sent at</th><th className="px-4 py-2">Error</th></tr></thead>
        <tbody className="divide-y divide-slate-800/70">
          {entries.map((e) => (
            <tr key={e.id} className="text-slate-300">
              <td className="px-4 py-2 capitalize">{e.channel}</td>
              <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusClasses[e.status] ?? ''}`}>{e.status}</span></td>
              <td className="px-4 py-2 text-xs text-slate-400">{e.sent_at ? new Date(e.sent_at).toLocaleString('id-ID') : '—'}</td>
              <td className="px-4 py-2 text-xs text-rose-300">{e.error_message ?? ''}</td>
            </tr>
          ))}
          {entries.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada notifikasi.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

export default function EwsPage() {
  const { session, loading, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('zones')
  if (loading) return <Spinner />
  if (!session) return (
    <LoginGate
      title="Early Warning System"
      subtitleIn="Masuk untuk mengelola watch zone & preferensi notifikasi Anda."
      subtitleUp="Daftar untuk mulai menerima peringatan bencana."
    />
  )
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Early Warning System</h1>
          <p className="mt-1 text-sm text-slate-400">{session.user.email} · kelola watch zone & preferensi notifikasi Anda.</p>
        </div>
        <button type="button" onClick={() => signOut()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-600">Logout</button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-800">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-slate-400 hover:text-slate-100'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'zones' && <ZonesTab />}
      {tab === 'prefs' && <PrefsTab />}
      {tab === 'notifs' && <NotifsTab />}
    </div>
  )
}
