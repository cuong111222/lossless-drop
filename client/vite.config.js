import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/peerjs': {
        target: 'http://localhost:3001',
        ws: true
      },
      '/register': 'http://localhost:3001',
      '/peers': 'http://localhost:3001',
      '/room': 'http://localhost:3001'
    }
  }
})
