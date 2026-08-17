import { afterEach, vi } from 'vitest'

// jsdom pada beberapa versi tidak menyediakan localStorage; token auth lokal
// (pengganti supabase-js) memakainya — stub minimal agar test konsisten.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})
