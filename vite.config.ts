import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 連線對戰與登入：把 Socket.IO 和 /auth 轉給本機的遊戲伺服器（yarn server）
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/auth': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
    },
  },
})
