import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

// Mobile MVP app. Reuses the root node_modules and shares code from ../../src.
export default defineConfig({
  root: __dirname,
  // .env.appwrite lives at the repo root (shared with the web build, single
  // source of truth) — without this, Vite would look for it under
  // apps/mobile/ instead and silently fall back to no Appwrite config.
  envDir: repoRoot,
  plugins: [react()],
  resolve: {
    // Use the single React copy from the repo root (avoid duplicate-React errors).
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  server: {
    port: 5174,
    host: true, // allow a phone on the same Wi-Fi to connect later
    fs: {
      // Permit importing shared modules from ../../src and the root node_modules.
      allow: [repoRoot],
    },
    proxy: {
      // Same Dev/Test backend as the main app (dev.db on :3002).
      '/api': { target: 'http://localhost:3002', changeOrigin: true },
      '/health': { target: 'http://localhost:3002', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(repoRoot, 'dist/mobile'),
    emptyOutDir: true,
  },
});
