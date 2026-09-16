import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/** Ships drizzle-kit migrations next to the main bundle, where openDatabase reads them. */
function copyMigrations(): Plugin {
  return {
    name: 'arlo-copy-migrations',
    writeBundle(options) {
      cpSync(
        resolve(import.meta.dirname, 'src/main/db/migrations'),
        resolve(options.dir as string, 'migrations'),
        { recursive: true },
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copyMigrations()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          'agent-host/index': resolve(import.meta.dirname, 'src/agent-host/index.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron'],
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
  },
});
