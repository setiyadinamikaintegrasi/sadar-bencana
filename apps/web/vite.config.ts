import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_PROXY_API_TARGET ?? 'http://localhost:8001'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
