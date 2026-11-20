import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In dev, the Go API runs on :8001 and Vite proxies /api to it.
// In production, `npm run build` writes dist/ and the Go server serves it on one port.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8001' } },
})
