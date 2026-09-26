import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Browser-only renderer preview (no Electron). Used for fast UI iteration and
 * visual QA: `npm run dev:web`. The privileged `window.dh` bridge is replaced by
 * an in-memory dev mock (src/renderer/lib/devBridge.ts) that is only loaded in
 * DEV when the real preload bridge is absent — it never ships in production.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: true, host: '0.0.0.0', allowedHosts: true },
  clearScreen: false,
})
