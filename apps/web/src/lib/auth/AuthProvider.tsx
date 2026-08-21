import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, captchaToken?: string) => Promise<{ error: string | null; needsConfirmation?: boolean }>
  resendConfirmation: (email: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    return { error: error?.message ?? null }
  }
  const signUp = async (email: string, password: string, captchaToken?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin, ...(captchaToken ? { captchaToken } : {}) },
    })
    // autoconfirm aktif (atau sesi langsung) -> session terisi; sebaliknya
    // user wajib konfirmasi email -> session null, needsConfirmation true.
    const needsConfirmation = !error && !data.session
    return { error: error?.message ?? null, needsConfirmation }
  }
  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    return { error: error?.message ?? null }
  }
  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, resendConfirmation, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
