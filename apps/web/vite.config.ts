import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiTarget = process.env.VITE_PROXY_API_TARGET ?? 'http://localhost:8001'
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
    },
  },
})
