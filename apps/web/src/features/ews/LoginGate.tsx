import { useState } from 'react'
import { useAuth } from '../../lib/auth/AuthProvider'

type LoginGateProps = {
  title?: string
  subtitleIn?: string
  subtitleUp?: string
}

export default function LoginGate({
  title = 'Risiko & Early Warning System',
  subtitleIn = 'Masuk untuk mengelola Daftar Risiko & preferensi Early Warning System Anda.',
  subtitleUp = 'Daftar untuk mengelola risiko dan menerima peringatan bencana.',
}: LoginGateProps = {}) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setMsg(null)
    const fn = mode === 'in' ? signIn : signUp
    const { error } = await fn(email.trim(), password)
    setBusy(false)
    if (error) setMsg(error)
    else if (mode === 'up') setMsg('Pendaftaran berhasil. Cek email untuk konfirmasi bila diaktifkan, lalu masuk.')
  }

  const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400'

  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-slate-950/40">
      <div>
        <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {mode === 'in' ? subtitleIn : subtitleUp}
        </p>
      </div>
      <div className="space-y-2">
        <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {msg && <p className="text-sm text-amber-300">{msg}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !email || !password}
        className="w-full rounded-lg bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 ring-1 ring-inset ring-indigo-400/40 hover:bg-indigo-500/30 disabled:opacity-50"
      >
        {busy ? 'Memproses…' : mode === 'in' ? 'Masuk' : 'Daftar'}
      </button>
      <button
        type="button"
        onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }}
        className="w-full text-center text-xs text-slate-400 hover:text-slate-200"
      >
        {mode === 'in' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
      </button>
    </div>
  )
}
