import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig } from 'vite'

// The Flask backend. BACKEND_URL points the proxy elsewhere, for a backend
// started on another port.
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:5001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // changeOrigin stays false: the backend must see the browser's own host,
    // so sign-in redirects back here and same-origin checks pass.
    proxy: Object.fromEntries(['/simulate', '/problems', '/auth', '/api']
      .map((path) => [path, { target: backend, changeOrigin: false }])),
  },
})
