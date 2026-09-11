import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Registrasi worker MapLibre v6 memakai specifier '?worker&url' yang
    // tidak dapat diselesaikan di jsdom — arahkan ke stub URL string.
    alias: [
      {
        find: /maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?worker&url$/,
        replacement: fileURLToPath(new URL('./src/config/maplibreWorkerTestStub.ts', import.meta.url)),
      },
    ],
  },
})
