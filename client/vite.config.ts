import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { LOCALE, t } from './src/ui/messages.js';

// The page title and language come from the message catalogue like every other
// UI string (specs/08-ux-journeys.md §6, D-073). The server's development mode
// calls transformIndexHtml too, so both builds get them.
function catalogueHtml(): Plugin {
  const escape = (text: string) =>
    text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return {
    name: 'emberglass-catalogue-html',
    transformIndexHtml: (html) =>
      html.replaceAll('%EG_LANG%', escape(LOCALE)).replaceAll('%EG_TITLE%', escape(t('app.name'))),
  };
}

// The build is static files served by the Node server; in development the server
// runs Vite in middleware mode on its own port (D-010).
export default defineConfig({
  plugins: [react(), catalogueHtml()],
  build: { outDir: 'dist', emptyOutDir: true },
});
