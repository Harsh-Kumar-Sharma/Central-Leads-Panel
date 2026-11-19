import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
  build: { sourcemap: false },
});
