import { useCallback, useEffect, useState } from 'react'
import {
  acceptOrganizationInvitation,
  activateEntitlement,
  createOrganizationInvitation,
  getEntitlementStatus,
  type EntitlementStatus,
} from '../../lib/api/client'
import { useAuth } from '../../lib/auth/AuthProvider'
import LoginGate from '../ews/LoginGate'
import ContractsPage from './ContractsPage'
import PersonalAssetsPage from './PersonalAssetsPage'

type Tab = 'personal' | 'company'

export default function RiskRegistryPage() {
  const { session, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('personal')
  const [status, setStatus] = useState<EntitlementStatus | null>(null)
  const [token, setToken] = useState('')
  const [inviteToken, setInviteToken] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [createdInvite, setCreatedInvite] = useState('')
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      setStatus(await getEntitlementStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status organisasi.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { void loadStatus() }, [loadStatus])

  if (authLoading) return <div className="py-12 text-center text-sm text-slate-500">Memuat akun…</div>
  if (!session) return <LoginGate title="Daftar Risiko" subtitleIn="Masuk untuk mengelola aset dan risiko privat Anda." subtitleUp="Daftar untuk mulai memantau aset pribadi." />

  const companyEnabled = status?.company_enabled === true
  const activate = async () => {
    if (!token.trim()) return
    setActivating(true)
    setError(null)
    try {
      await activateEntitlement(token.trim())
      setToken('')
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktivasi token gagal.')
    } finally {
      setActivating(false)
    }
  }

  const acceptInvite = async () => {
    if (!inviteToken.trim()) return
    setActivating(true)
    setError(null)
    try {
      await acceptOrganizationInvitation(inviteToken.trim())
      setInviteToken('')
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undangan tidak valid.')
    } finally {
      setActivating(false)
    }
  }

  const createInvite = async () => {
    if (!inviteEmail.trim()) return
    setError(null)
    try {
      const invitation = await createOrganizationInvitation(inviteEmail.trim(), 'member')
      setCreatedInvite(invitation.invite_token)
      setInviteEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat undangan.')
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-slate-950/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-50">Daftar Risiko</h2>
            <p className="mt-1 text-sm text-slate-400">Pantau aset pribadi atau kelola portofolio perusahaan.</p>
          </div>
          {status && (
            <span className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs text-slate-300">
              {status.deployment_mode === 'community' ? 'Community · perusahaan terbuka' : companyEnabled ? `Organisasi · ${status.organization?.name}` : 'Hosted · personal'}
            </span>
          )}
        </div>
        <div className="mt-5 flex gap-2 border-b border-slate-800">
          <button type="button" onClick={() => setTab('personal')} className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === 'personal' ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-slate-500'}`}>Aset Saya</button>
          <button type="button" onClick={() => setTab('company')} className={`border-b-2 px-4 py-2 text-sm font-semibold ${tab === 'company' ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-slate-500'}`}>Portofolio Perusahaan</button>
        </div>
      </section>

      {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</p>}
      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />
      ) : tab === 'personal' ? (
        <PersonalAssetsPage />
      ) : companyEnabled ? (
        <div className="space-y-4">
          {status?.organization && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Masa berlaku</p><p className="mt-1 text-sm font-semibold text-slate-200">{new Date(status.organization.expires_at).toLocaleDateString('id-ID')}</p></div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Anggota</p><p className="mt-1 text-sm font-semibold text-slate-200">{status.organization.member_count} / {status.organization.max_users}</p></div>
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-500">Risiko perusahaan</p><p className="mt-1 text-sm font-semibold text-slate-200">{status.organization.company_risk_count} / {status.organization.max_company_risks}</p></div>
              </div>
              {(status.organization.role === 'owner' || status.organization.role === 'admin') && (
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                  <p className="text-sm font-semibold text-slate-100">Undang anggota</p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="email@perusahaan.id" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
                    <button type="button" onClick={createInvite} className="rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-4 py-2 text-sm font-semibold text-indigo-100">Buat undangan</button>
                  </div>
                  {createdInvite && <p className="mt-3 break-all rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">Kode undangan: {createdInvite}</p>}
                </div>
              )}
            </>
          )}
          <ContractsPage />
        </div>
      ) : (
        <section className="mx-auto max-w-2xl rounded-2xl border border-amber-400/20 bg-slate-900 p-6 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Fitur organisasi</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-50">Aktifkan Portofolio Perusahaan</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">Masukkan token organisasi yang diterbitkan oleh pengelola SadarBencana. Token tidak dikirim ke layanan pihak ketiga.</p>
          <textarea value={token} onChange={(event) => setToken(event.target.value)} rows={5} spellCheck={false} className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-400" placeholder="Tempel token entitlement di sini" />
          <button type="button" onClick={activate} disabled={activating || !token.trim()} className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-50">
            {activating ? 'Mengaktifkan…' : 'Aktifkan token'}
          </button>
          <div className="mt-6 border-t border-slate-800 pt-5">
            <p className="text-sm font-semibold text-slate-200">Menerima undangan organisasi?</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200" placeholder="Masukkan kode undangan" />
              <button type="button" onClick={acceptInvite} disabled={activating || !inviteToken.trim()} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50">Gabung</button>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500">Untuk meminta token organisasi, hubungi pengelola sadarbencana.id.</p>
        </section>
      )}
    </div>
  )
}
