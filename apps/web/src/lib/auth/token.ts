// Penyimpanan token JWT lokal (pengganti sesi supabase-js).
// Modul terpisah agar client.ts dan AuthProvider.tsx bisa berbagi tanpa
// circular import.

export const AUTH_TOKEN_STORAGE_KEY = 'sadar_auth_token'

export function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
    else window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
  } catch {
    // localStorage tidak tersedia (privacy mode) — sesi hanya bertahan di memori.
  }
}
