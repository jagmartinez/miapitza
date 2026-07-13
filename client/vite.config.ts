import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        // Bind on both IPv4 and IPv6 (Windows sometimes resolves localhost to 127.0.0.1
        // instead of ::1, which would otherwise refuse the connection).
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        // Put HMR on its own dedicated port so it can never collide with the /api
        // proxy upgrade path. 24678 is Vite's default.
        hmr: {
            protocol: 'ws',
            host: '127.0.0.1',
            port: 24678,
            clientPort: 24678,
        },
        // Cursor/VSCode on Windows uses "atomic save" (write-temp-then-rename),
        // which chokidar's native fs events sometimes miss. Polling guarantees
        // every save fires an HMR update.
        watch: {
            usePolling: true,
            interval: 300,
        },
        proxy: {
            // The application WebSocket connects directly to ws://localhost:3000
            // (see VITE_WS_URL), so we intentionally do NOT enable ws: true here.
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                secure: false
            },
            '/uploads': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                secure: false
            }
        }
    },
    preview: {
        host: true,
        port: parseInt(process.env.PORT ?? '4173', 10)
    },
    build: {
        chunkSizeWarningLimit: 900
    }
});
