// apps/web/src/features/settings/AdminUsersPage.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from '../ews/LoginGate'
import {
  deleteAdminUser,
  fetchAdminUsers,
  resendAdminUserLink,
  setAdminUserBanned,
  type AdminUser,
} from '../../lib/api/adminUsers'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
}

function formatRelative(value: string | null): string {
  if (!value) return 'Belum pernah'
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return '—'
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'Baru saja'
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}

export default function AdminUsersPage() {
  const { session, loading } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [query, setQuery] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null)
  const [generatedLink, setGeneratedLink] = useState<{ email: string; url: string } | null>(null)
  const linkRef = useRef<HTMLSpanElement | null>(null)

  const load = useCallback(async (search?: string) => {
    setInitialLoading(true)
    setError(null)
    try {
      const response = await fetchAdminUsers(search)
      setUsers(response.data)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memuat daftar pengguna.'
      if ((err as Error & { status?: number }).status === 403) {
        setError('Akses admin diperlukan. Email Anda belum terdaftar di ADMIN_EMAILS server.')
      } else {
        setError(message)
      }
    } finally {
      setInitialLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) void load()
  }, [session, load])

  useEffect(() => {
    if (!query.trim()) {
      if (!initialLoading) void load()
      return
    }
    const timer = window.setTimeout(() => void load(query), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  if (loading) return <p className="py-12 text-center text-sm text-slate-400">Memeriksa sesi…</p>
  if (!session) {
    return (
      <LoginGate
        title="Admin Pengguna"
        subtitleIn="Masuk dengan akun admin untuk mengelola pengguna terdaftar."
        subtitleUp="Pendaftaran akun baru terbuka — akses admin diberikan lewat whitelist server."
      />
    )
  }

  const handleBanToggle = async (user: AdminUser) => {
    setBusy(`ban-${user.id}`)
    setNotice(null)
    try {
      const banned = user.banned_until == null
      const updated = await setAdminUserBanned(user.id, banned)
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, banned_until: updated.banned_until } : item)))
      setNotice(banned ? `Pengguna ${user.email} diblokir.` : `Blokir ${user.email} dihapus.`)
    } catch {
      setError('Gagal mengubah status blokir. Coba lagi.')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setBusy(`delete-${confirmDelete.id}`)
    setError(null)
    try {
      await deleteAdminUser(confirmDelete.id)
      setUsers((current) => current.filter((item) => item.id !== confirmDelete.id))
      setNotice(`Pengguna ${confirmDelete.email} dihapus permanen.`)
      setConfirmDelete(null)
    } catch {
      setError('Gagal menghapus pengguna. Coba lagi.')
    } finally {
      setBusy(null)
    }
  }

  const handleResend = async (user: AdminUser) => {
    setBusy(`resend-${user.id}`)
    setError(null)
    setNotice(null)
    try {
      const result = await resendAdminUserLink(user.id)
      setGeneratedLink({ email: result.email, url: result.action_link })
      setNotice(`Tautan masuk untuk ${user.email} dibuat — salin & kirim manual (SMTP belum aktif).`)
    } catch {
      setError('Gagal membuat tautan. Coba lagi.')
    } finally {
      setBusy(null)
    }
  }

  const copyLink = async () => {
    if (!generatedLink) return
    try {
      await navigator.clipboard.writeText(generatedLink.url)
      setNotice('Tautan disalin ke clipboard.')
    } catch {
      linkRef.current?.focus()
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-50">Admin Pengguna</h2>
          <p className="mt-1 text-xs text-slate-500">
            Kelola pengguna terdaftar: status konfirmasi, blokir, hapus, dan tautan masuk manual.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-400">
          {users.length} pengguna
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200" role="alert">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200" role="status">
          {notice}
          {generatedLink && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <span
                ref={linkRef}
                tabIndex={-1}
                className="min-w-0 flex-1 truncate rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300"
                title={generatedLink.url}
              >
                {generatedLink.url}
              </span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="shrink-0 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                Salin tautan
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/40">
        <div className="mb-3 relative">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari email pengguna…"
            aria-label="Cari email pengguna"
            className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 shadow-inner shadow-slate-950/40 outline-none transition placeholder:text-slate-500 focus:border-indigo-400 focus:ring-1 focus:ring-inset focus:ring-indigo-400"
          />
        </div>

        {initialLoading ? (
          <div className="py-10 text-center text-sm text-slate-400">Memuat daftar pengguna…</div>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
            {query.trim() ? `Tidak ada pengguna yang cocok dengan "${query}".` : 'Belum ada pengguna terdaftar.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-3 pr-4 font-medium">Email</th>
                  <th className="pb-3 pr-4 font-medium">Konfirmasi</th>
                  <th className="pb-3 pr-4 font-medium">Login terakhir</th>
                  <th className="pb-3 pr-4 font-medium">Terdaftar</th>
                  <th className="pb-3 pr-4 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {users.map((user) => {
                  const banned = user.banned_until != null
                  return (
                    <tr key={user.id} className="text-slate-200">
                      <td className="py-3 pr-4 font-medium">{user.email}</td>
                      <td className="py-3 pr-4">
                        {user.email_confirmed_at ? (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                            Terkonfirmasi
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                            Belum
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-400">{formatRelative(user.last_sign_in_at)}</td>
                      <td className="py-3 pr-4 text-xs text-slate-400">{formatDate(user.created_at)}</td>
                      <td className="py-3 pr-4">
                        {banned ? (
                          <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
                            Diblokir
                          </span>
                        ) : (
                          <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                            Aktif
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleResend(user)}
                            disabled={busy !== null}
                            aria-label={`Buat tautan masuk untuk ${user.email}`}
                            className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:border-indigo-400 hover:text-indigo-200 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
                          >
                            {busy === `resend-${user.id}` ? '…' : 'Tautan'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleBanToggle(user)}
                            disabled={busy !== null}
                            aria-label={banned ? `Hapus blokir ${user.email}` : `Blokir ${user.email}`}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 ${
                              banned
                                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                                : 'border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                            }`}
                          >
                            {busy === `ban-${user.id}` ? '…' : banned ? 'Buka' : 'Blokir'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(user)}
                            disabled={busy !== null}
                            aria-label={`Hapus ${user.email} permanen`}
                            className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi hapus pengguna"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-50">Hapus pengguna?</h3>
            <p className="mt-2 text-sm text-slate-400">
              <span className="font-semibold text-rose-300">{confirmDelete.email}</span> akan dihapus permanen
              beserta sesinya. Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy === `delete-${confirmDelete.id}`}
                className="rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/25 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70"
              >
                {busy === `delete-${confirmDelete.id}` ? 'Menghapus…' : 'Hapus permanen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
