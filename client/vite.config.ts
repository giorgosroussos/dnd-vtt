import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The build is static files served by the Node server; in development the server
// runs Vite in middleware mode on its own port (D-010).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
