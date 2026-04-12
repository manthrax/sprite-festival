import { defineConfig } from 'vite';

export default defineConfig({
  // Set base to './' so that the build works on GitHub Pages subfolders
  base: './',
  server: {
    open: true,
    port: 5173,
    watch: {
      usePolling: true
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Target modern browsers for best performance with Three.js
    target: 'esnext'
  }
});
