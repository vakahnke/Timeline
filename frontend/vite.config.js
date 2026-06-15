import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In Docker, Vite runs in its own container and must proxy /api to the backend
// service (http://backend:8000). On the host it's http://localhost:8000.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
