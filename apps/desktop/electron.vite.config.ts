import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Strict CSP is baked into the production HTML. In dev, main sets a looser header (Vite needs inline scripts/HMR).
export const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export default defineConfig({
  // Everything except Electron/Node builtins is bundled, so the packaged app ships no node_modules.
  main: { build: { rollupOptions: { external: ['electron'] } } },
  preload: { build: { rollupOptions: { external: ['electron'] } } },
  renderer: {
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV === 'development' ? 'development' : 'production') },
    plugins: [react(), { name: 'prod-csp', apply: 'build', transformIndexHtml: (html: string) => html.replace('</title>', `</title>\n<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`) }]
  }
})
