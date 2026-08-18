import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiTarget = process.env.VITE_PROXY_API_TARGET ?? 'http://localhost:8001'
// Padanan dev untuk Caddy production: supabase-js memanggil {SUPABASE_URL}/auth/v1/*,
// GoTrue menyajikan endpoint tanpa prefix tersebut — proxy men-stripping /auth/v1.
const authTarget = process.env.VITE_PROXY_AUTH_TARGET ?? 'http://127.0.0.1:9999'
const projectDir = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sadar-backend-supervisor',
      apply: 'serve',
      configureServer(server) {
        const supervisor = spawn(
          'bash',
          [`${projectDir}scripts/dev-backend-supervisor.sh`],
          { cwd: projectDir, env: process.env, stdio: 'ignore' },
        )
        server.httpServer?.once('close', () => supervisor.kill('SIGTERM'))
      },
    },
  ],
  server: {
    port: 3001,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/auth/v1': {
        target: authTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/auth\/v1/, ''),
      },
    },
  },
})
