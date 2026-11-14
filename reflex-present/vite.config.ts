import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const kitJs = fileURLToPath(new URL('../vexo-open-kit/js/src', import.meta.url))
const kitSpeech = fileURLToPath(new URL('../vexo-open-kit/dashboard/speech', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'vexo-kit': kitJs, 'vexo-speech': kitSpeech },
  },
  server: {
    // Only the kit's library folders, never the whole parent folder (it may hold a .env).
    fs: { allow: ['.', kitJs, kitSpeech] },
  },
})
