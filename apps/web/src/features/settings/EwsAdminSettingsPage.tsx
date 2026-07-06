import { useCallback, useEffect, useState } from 'react'
import {
  fetchAdminChannelStatus,
  fetchAdminChannelAudit,
  fetchNotificationLog,
  fetchSubscribers,
  retryDelivery,
  testSubscriberChannel,
  updateSubscriber,
  updateAdminChannel,
  type EWSChannel,
  type EWSChannelStatus,
  type EWSChannelAuditEntry,
  type EWSNotificationLogEntry,
  type EWSSubscriber,
} from '../../lib/api/ews'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from '../ews/LoginGate'

function Spinner() {
  return <div className="py-12 text-center text-sm text-slate-400">Memuat pengaturan EWS…</div>
}

export default function EwsAdminSettingsPage() {
  const { session, loading } = useAuth()
  const [channels, setChannels] = useState<EWSChannelStatus[]>([])
  const [subscribers, setSubscribers] = useState<EWSSubscriber[]>([])
  const [deliveries, setDeliveries] = useState<EWSNotificationLogEntry[]>([])
  const [audit, setAudit] = useState<EWSChannelAuditEntry[]>([])
  const [selectedSubscriber, setSelectedSubscriber] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)

  const load = useCallback(async () => {
    setInitialLoading(true)
    try {
      const [loadedChannels, loadedSubscribers, loadedDeliveries, loadedAudit] = await Promise.all([
        fetchAdminChannelStatus(),
        fetchSubscribers(),
        fetchNotificationLog({ limit: 100 }),
        fetchAdminChannelAudit(),
      ])
      setChannels(loadedChannels)
      setSubscribers(loadedSubscribers)
      setDeliveries(loadedDeliveries)
      setAudit(loadedAudit)
      setSelectedSubscriber((current) => current || loadedSubscribers[0]?.id || '')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat pengaturan EWS.')
    } finally { setInitialLoading(false) }
  }, [])

  useEffect(() => {
    if (session) void load()
  }, [session, load])

  if (loading) return <Spinner />
  if (!session) return (
    <LoginGate
      title="Admin EWS"
      subtitleIn="Masuk dengan akun admin EWS."
      subtitleUp="Akses halaman ini hanya untuk administrator."
    />
  )

  const run = async (key: string, action: () => Promise<void>, success: string) => {
    setBusy(key); setError(null); setMessage(null)
    try {
      await action()
      setMessage(success)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operasi gagal.')
    } finally { setBusy(null) }
  }

  if (initialLoading) return <Spinner />
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-50">Admin · EWS Channels</h1>
        <p className="mt-1 text-sm text-slate-400">Status provider, test delivery, queue, dan dead-letter. Secret tetap dikelola di server.</p>
      </div>
      {message && <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</p>}
      {error && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {channels.map((channel) => (
          <section key={channel.channel} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold capitalize text-slate-100">{channel.channel}</h2>
                <p className="text-xs text-slate-400">{channel.provider}{channel.sender ? ` · ${channel.sender}` : ''}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                Aktif
                <input type="checkbox" checked={channel.is_enabled} disabled={busy !== null} onChange={(e) => {
                  void run(`toggle-${channel.channel}`, () => updateAdminChannel(channel.channel, e.target.checked), `Kanal ${channel.channel} diperbarui.`)
                }} className="accent-indigo-500" />
              </label>
            </div>
            <p className={`mt-3 text-sm ${channel.configured ? 'text-emerald-300' : 'text-amber-300'}`}>{channel.configured ? 'Configured' : 'Credential belum tersedia'}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-950 p-2"><p className="text-slate-500">Pending</p><p className="text-slate-100">{channel.pending}</p></div>
              <div className="rounded-lg bg-slate-950 p-2"><p className="text-slate-500">Failed</p><p className="text-amber-300">{channel.failed}</p></div>
              <div className="rounded-lg bg-slate-950 p-2"><p className="text-slate-500">Dead</p><p className="text-rose-300">{channel.dead_letter}</p></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Last success: {channel.last_success_at ? new Date(channel.last_success_at).toLocaleString('id-ID') : '—'}</p>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="font-semibold text-slate-100">Test subscriber</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={selectedSubscriber} onChange={(e) => setSelectedSubscriber(e.target.value)} className="min-w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            {subscribers.map((subscriber) => <option key={subscriber.id} value={subscriber.id}>{subscriber.name} · {subscriber.email}</option>)}
          </select>
          {(['telegram', 'email'] as EWSChannel[]).map((channel) => (
            <button key={channel} type="button" disabled={!selectedSubscriber || busy !== null} onClick={() => {
              void run(`test-${channel}`, () => testSubscriberChannel(selectedSubscriber, channel), `Test ${channel} berhasil dikirim.`)
            }} className="rounded-lg border border-indigo-400/40 px-3 py-2 text-sm text-indigo-200 disabled:opacity-40">Test {channel}</button>
          ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900/70 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Subscriber</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Timezone</th><th className="px-3 py-2">Telegram</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {subscribers.map((subscriber) => <tr key={subscriber.id}>
              <td className="px-3 py-2 text-slate-300">{subscriber.name}<p className="text-xs text-slate-500">{subscriber.email}</p></td>
              <td className="px-3 py-2 text-slate-300">{subscriber.role}</td>
              <td className="px-3 py-2 text-slate-300">{subscriber.timezone}</td>
              <td className="px-3 py-2 text-slate-300">{subscriber.telegram_chat_id ? 'configured' : '—'}</td>
              <td className="px-3 py-2"><button type="button" disabled={busy !== null} onClick={() => {
                void run(`subscriber-${subscriber.id}`, () => updateSubscriber(subscriber.id, { is_active: !subscriber.is_active }).then(() => undefined), `Subscriber ${subscriber.is_active ? 'dinonaktifkan' : 'diaktifkan'}.`)
              }} className={subscriber.is_active ? 'text-emerald-300' : 'text-slate-500'}>{subscriber.is_active ? 'Aktif' : 'Nonaktif'}</button></td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900/70 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">Subscriber</th><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Error</th><th className="px-3 py-2">Waktu</th><th className="px-3 py-2">Aksi</th></tr></thead>
          <tbody className="divide-y divide-slate-800/70">
            {deliveries.map((delivery) => <tr key={delivery.id}>
              <td className="px-3 py-2 text-slate-300">{delivery.subscriber_name || delivery.subscriber_id}</td>
              <td className="px-3 py-2 capitalize text-slate-300">{delivery.channel}</td>
              <td className="px-3 py-2 text-slate-300">{delivery.status}</td>
              <td className="max-w-64 truncate px-3 py-2 text-xs text-rose-300">{delivery.error_message || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-400">{new Date(delivery.created_at).toLocaleString('id-ID')}</td>
              <td className="px-3 py-2">{(['failed', 'dead_letter'] as string[]).includes(delivery.status) && <button type="button" disabled={busy !== null} onClick={() => {
                void run(`retry-${delivery.id}`, () => retryDelivery(delivery.id), 'Delivery dimasukkan kembali ke queue.')
              }} className="text-xs text-indigo-300">Retry</button>}</td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="font-semibold text-slate-100">Audit perubahan kanal</h2>
        <div className="mt-3 space-y-2">
          {audit.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-950 p-2 text-xs text-slate-300">
            <span className="capitalize">{entry.channel}: {entry.previous_enabled ? 'aktif' : 'nonaktif'} → {entry.new_enabled ? 'aktif' : 'nonaktif'}</span>
            <span className="text-slate-500">{entry.changed_by} · {new Date(entry.changed_at).toLocaleString('id-ID')}</span>
          </div>)}
          {audit.length === 0 && <p className="text-xs text-slate-500">Belum ada perubahan pengaturan.</p>}
        </div>
      </section>
    </div>
  )
}
