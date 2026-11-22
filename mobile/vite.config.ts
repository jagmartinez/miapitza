/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { '@web': path.resolve(import.meta.dirname, '../client/src') },
        // Modules shared from client/ must use mobile's single copy of these.
        dedupe: ['react', 'react-dom', 'axios'],
    },
    build: { target: 'es2020', chunkSizeWarningLimit: 250 },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        // Same reason as asyncUtilTimeout in setup.ts: a test that loads a lazy chunk and waits on real timers (the kitchen relogin gap is 2 s).
        testTimeout: 20_000,
    },
});
