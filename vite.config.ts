import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 連線對戰：把 Socket.IO 轉給本機的遊戲伺服器（yarn server）
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
