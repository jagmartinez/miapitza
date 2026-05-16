import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        // Explicit HMR endpoint avoids flaky WebSocket upgrades on some Windows setups / extensions.
        hmr: {
            protocol: 'ws',
            host: 'localhost',
            port: 3000,
            clientPort: 3000,
        },
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                secure: false,
                ws: true
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
