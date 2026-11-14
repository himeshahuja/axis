import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { geminiVoicePlugin } from './server/geminiVoice.ts'

const kitJs = fileURLToPath(new URL('../vexo-open-kit/js/src', import.meta.url))
const kitSpeech = fileURLToPath(new URL('../vexo-open-kit/dashboard/speech', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Server side only: GEMINI_* has no VITE_ prefix, so Vite never puts it into the page.
  const env = loadEnv(mode, process.cwd(), 'GEMINI_')
  const gemini = () => ({ key: process.env.GEMINI_API_KEY || env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || env.GEMINI_MODEL || undefined })
  return {
    plugins: [react(), geminiVoicePlugin(gemini)],
    resolve: {
      alias: { 'vexo-kit': kitJs, 'vexo-speech': kitSpeech },
    },
    // Keep GEMINI_ (and everything else without VITE_) out of import.meta.env.
    envPrefix: 'VITE_',
    server: {
      // Only the kit's library folders, never the whole parent folder (it may hold a .env).
      // (Vite's default fs.deny already refuses .env files.)
      fs: { allow: ['.', kitJs, kitSpeech] },
    },
  }
})
