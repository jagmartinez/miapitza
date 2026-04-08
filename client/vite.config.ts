import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const vendorChunkByPackage = (id: string) => {
    if (!id.includes('node_modules')) {
        return undefined;
    }

    if (id.includes('@react-pdf') || id.includes('react-pdf')) {
        return 'react-pdf-vendor';
    }

    if (id.includes('pdfkit') || id.includes('fontkit')) {
        return 'pdfkit-vendor';
    }

    if (id.includes('yoga-layout')) {
        return 'pdf-layout-vendor';
    }

    if (id.includes('recharts') || id.includes('d3-')) {
        return 'charts-vendor';
    }

    if (id.includes('react-select')) {
        return 'select-vendor';
    }

    if (id.includes('react-router')) {
        return 'router-vendor';
    }

    if (id.includes('lucide-react')) {
        return 'icons-vendor';
    }

    if (id.includes('react') || id.includes('scheduler')) {
        return 'react-vendor';
    }

    return 'vendor';
};

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
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
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks: vendorChunkByPackage
            }
        }
    }
});
