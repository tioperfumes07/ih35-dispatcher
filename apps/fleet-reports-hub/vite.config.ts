import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Root-relative public path. Use `/fleet-reports/` when copying dist into IH35 `public/fleet-reports/`. */
function viteBase(): string {
  const b = (process.env.VITE_BASE || '/').trim() || '/'
  if (b === '/') return '/'
  return b.endsWith('/') ? b : `${b}/`
}

// https://vite.dev/config/
export default defineConfig({
  base: viteBase(),
  plugins: [react()],
  server: {
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
})
