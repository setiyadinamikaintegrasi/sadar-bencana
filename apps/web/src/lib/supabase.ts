import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const isConfigured = Boolean(url && anonKey)
if (!isConfigured) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — EWS auth disabled; other pages unaffected')
}

// Fall back to a syntactically valid placeholder so createClient never throws
// when EWS auth is unconfigured; auth calls will simply fail at call time.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)

export const isSupabaseConfigured = isConfigured
