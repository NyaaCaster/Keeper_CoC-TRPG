import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import yaml from '@modyfi/vite-plugin-yaml';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // Empty prefix: loadEnv picks up every env var (root .env locally, Docker
  // ENV from build-args in container builds). Only keys explicitly listed in
  // define below are inlined into the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), yaml()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      // NyaaAcount platform public https entry for browser links (register /
      // account). Value from NYAAACOUNT_BASE_URL in .env. Public URL only —
      // the _LAN key stays server-side and never enters the bundle.
      __NYAACOUNT_BASE_URL__: JSON.stringify(env.NYAAACOUNT_BASE_URL || ''),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
