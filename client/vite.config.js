import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_')
  return {
    plugins: [react()],
    // 'real' talks to the backend, anything else uses the in-memory mock (see client/README.md).
    define: {
      __API_MODE__: JSON.stringify(env.VITE_API_MODE === 'real' ? 'real' : 'mock'),
    },
    server: {
      // The Express + Socket.io backend listens on 127.0.0.1:5000.
      proxy: {
        '/api': 'http://127.0.0.1:5000',
        '/socket.io': { target: 'http://127.0.0.1:5000', ws: true },
      },
    },
  }
})
