import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import brand from './brand.json' with { type: 'json' }

// In Docker, Vite runs in its own container and must proxy /api to the backend
// service (http://backend:8000). On the host it's http://localhost:8000.
const apiTarget = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

// index.html is served before any JavaScript runs, so the product's name is written into it at
// build time, from the same place the app reads it (src/constants.js).
const appName = process.env.VITE_APP_NAME || brand.name
const brandInHtml = { name: 'brand-in-html', transformIndexHtml: html => html.replaceAll('%APP_NAME%', appName) }

export default defineConfig({
  plugins: [react(), brandInHtml],
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
