import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // esbuild minify is the default and optimal for speed; no need for terser
    // Inline small assets (< 8kb) as base64 to reduce HTTP requests
    assetsInlineLimit: 8192,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['@supabase/supabase-js'],
        },
        chunkFileNames(chunkInfo) {
          const lazyChunks = {
            brainstorm: 'brainstorm',
            'weekly-review': 'weekly-review',
            'command-palette': 'command-palette',
            focus: 'focus',
          };
          for (const [mod, name] of Object.entries(lazyChunks)) {
            if (chunkInfo.moduleIds?.some(id => id.endsWith(`/${mod}.js`))) {
              return `assets/${name}-[hash].js`;
            }
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    coverage: {
      provider: 'v8',
      exclude: ['**/app.js', '**/init.js', '**/proactive-briefing.js', '**/proactive-nudges.js', '**/proactive-planning.js', '**/node_modules/**', '**/__tests__/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
