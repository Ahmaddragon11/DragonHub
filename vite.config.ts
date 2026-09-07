import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import renderer from 'vite-plugin-electron-renderer'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: [
                'electron', 'sharp', 'fluent-ffmpeg', '@ffmpeg-installer/ffmpeg',
                '@ffprobe-installer/ffprobe', '7zip-bin', 'node-7z',
                'electron-store', 'yt-dlp-wrap',
              ],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload/index.ts',
        vite: { build: { outDir: 'dist-electron/preload', rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } } },
      },
    }),
    renderer(),
  ],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
  clearScreen: false,
})
