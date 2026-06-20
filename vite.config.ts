import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/zkprover': {
        target: 'https://api.us1.shinami.com/sui/zkprover/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/zkprover/, ''),
      }
    }
  }
})
