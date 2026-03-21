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
        manualChunks(id) {
          // Vendor: Supabase client
          if (id.includes('node_modules/@supabase')) return 'vendor';
          // AI: AI caller + context builder (large, changes independently from app logic)
          if (id.includes('/ai-context.js') || (id.includes('/ai.js') && !id.includes('ui-'))) return 'ai';
          // Proactive: all proactive sub-modules (~2800 lines, only needed post-init)
          if (id.includes('/proactive')) return 'proactive';
          // Chat: standalone module, only active when chat panel is opened
          if (id.includes('/chat.js') && !id.includes('__tests__')) return 'chat';
        },
        chunkFileNames(chunkInfo) {
          // Named manual chunks and lazy chunks get clean predictable names
          const namedChunks = ['vendor', 'ai', 'proactive', 'chat'];
          if (namedChunks.includes(chunkInfo.name)) {
            return `assets/${chunkInfo.name}-[hash].js`;
          }
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
        lines: 70,
        functions: 55,
        branches: 70,
        statements: 70,
      },
    },
  },
});
