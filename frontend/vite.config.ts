import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, the Go API (backend/) runs on :8001 and Vite proxies /api to it.
// In production, `npm run build` writes dist/ and the Go server serves it on one port.
const config = defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:8001' } },
  resolve: { 
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom', 'react/compiler-runtime'],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    viteReact(),
  ],
})

export default config
