import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// The Flask backend. BACKEND_URL points the proxy elsewhere, for a backend
// started on another port.
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:5001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/simulate': backend, '/problems': backend } }
})
