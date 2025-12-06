import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE || 'http://localhost:5000',
        changeOrigin: true,
        cookieDomainRewrite: '',  // Remove domain restriction for cookies
        secure: false,  // Allow self-signed certificates in dev
      },
      '/images': {
        target: process.env.VITE_API_BASE || 'http://localhost:5000',
        changeOrigin: true,
        cookieDomainRewrite: '',  // Remove domain restriction for cookies
        secure: false,  // Allow self-signed certificates in dev
      }
    }
  }
}) 