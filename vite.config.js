import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars from .env files (Vite automatically loads .env, but loadEnv ensures proper loading)
  const env = loadEnv(mode, process.cwd(), '')
  
  // Validate VITE_API_BASE is set only in development mode (required for dev proxy)
  // No default to prevent silent fallback to wrong server (e.g., localhost when running in cloud)
  // During build (production), we don't need this as the frontend will be served by the backend
  if (mode === 'development' && !env.VITE_API_BASE) {
    throw new Error(
      'VITE_API_BASE environment variable is required for development.\n' +
      'Set it in your .env file (e.g., VITE_API_BASE=http://localhost:5000 for local dev, ' +
      'or VITE_API_BASE=http://your-cloud-server:5000 for cloud dev)'
    )
  }

  return {
    plugins: [react()],
    server: {
      ...(env.VITE_API_BASE ? {
        host: true,
        proxy: {
          '/api': {
            target: env.VITE_API_BASE,
            changeOrigin: true,
            cookieDomainRewrite: '',  // Remove domain restriction for cookies
            secure: false,  // Allow self-signed certificates in dev
          },
          '/images': {
            target: env.VITE_API_BASE,
            changeOrigin: true,
            cookieDomainRewrite: '',  // Remove domain restriction for cookies
            secure: false,  // Allow self-signed certificates in dev
          }
        }
      } : {
        host: true
      }),
      watch: {
        ignored: [
          '**/venv/**',
          '**/node_modules/**',
          '**/__pycache__/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/migrations/**',
          '**/data/**'
        ]
      }
    }
  }
}) 