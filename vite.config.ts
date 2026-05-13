import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

// Card Pack dev server. Port 5180 to avoid colliding with the existing
// glasses-app cluster (5173-5179 already taken across the workspace).
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
  },
})
