import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 連線對戰、登入、金流：把 Socket.IO、/auth、/api、/billing 轉給本機的遊戲伺服器（yarn server）
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/auth': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
      '/billing': 'http://localhost:3001',
    },
  },
})
