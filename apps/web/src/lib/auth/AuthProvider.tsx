import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { request } from '../api/client'
import { readStoredToken, storeToken } from './token'

export type LocalSessionUser = {
  id: string
  email: string
  role: string
}

export type LocalSession = {
  access_token: string
  expires_in: number
  expires_at: string
  user: LocalSessionUser
}

export { AUTH_TOKEN_STORAGE_KEY } from './token'

interface AuthContextValue {
  session: LocalSession | null
  loading: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function authRequest(
  path: '/auth/login' | '/auth/register',
  email: string,
  password: string,
  captchaToken?: string,
): Promise<{ session: LocalSession | null; error: string | null }> {
  try {
    const res = await request<{ data: LocalSession }>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      }),
    })
    return { session: res.data, error: null }
  } catch (err) {
    const status = (err as { status?: number }).status
    const message = (err as Error).message ?? 'Gagal terhubung ke server'
    if (status === 401) return { session: null, error: 'Email atau kata sandi salah.' }
    if (status === 409) return { session: null, error: 'Email sudah terdaftar.' }
    if (status === 400) return { session: null, error: message }
    return { session: null, error: message }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const token = readStoredToken()
    if (!token) {
      setLoading(false)
      return
    }
    // Validasi token tersimpan terhadap /auth/me; kalau kedaluwarsa, buang.
    fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          storeToken(null)
          return
        }
        return res.json().then((body) => {
          if (cancelled) return
          const user = body.data
          setSession({ access_token: token, expires_in: 0, expires_at: '', user })
        })
      })
      .catch(() => {
        if (!cancelled) storeToken(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    const { session: next, error } = await authRequest('/auth/login', email, password, captchaToken)
    if (next) {
      storeToken(next.access_token)
      setSession(next)
    }
    return { error }
  }

  const signUp = async (email: string, password: string, captchaToken?: string) => {
    const { session: next, error } = await authRequest('/auth/register', email, password, captchaToken)
    if (next) {
      storeToken(next.access_token)
      setSession(next)
    }
    return { error }
  }

  const signOut = async () => {
    storeToken(null)
    setSession(null)
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
