import http from 'http';
import app from './app';
import prisma from './utils/prisma';
import { WebSocketService } from './services/websocket.service';
import { SettingService } from './services/setting.service';
import { NotificationService } from './services/notification.service';
import { SessionService } from './services/session.service';
import { stopAuthCleanup } from './services/auth.service';
import { collectEnvironmentErrors } from './utils/env-validation';
import { BiometricService } from './services/hr-biometric.service';
import { fileCleanupService } from './services/file-cleanup.service';
import { initializeStorageIdentity } from './services/storage-identity.service';

// Keep the local fallback aligned with Docker, examples and the client defaults.
const PORT = process.env.PORT || 3000;

// Validate required environment before accepting traffic. prisma.ts already
// validates DATABASE_URL; here we guarantee the remaining security and
// infrastructure requirements.
function validateEnv(): void {
    const errors = collectEnvironmentErrors(process.env);

    if (errors.length > 0) {
        console.error('FATAL: invalid environment configuration:');
        for (const error of errors) console.error(`  - ${error}`);
        process.exit(1);
    }
}

validateEnv();

const server = http.createServer(app);
WebSocketService.initialize(server);

let sessionPurgeTimer: ReturnType<typeof setInterval> | undefined;
let fileCleanupTimer: ReturnType<typeof setInterval> | undefined;
let biometricMaintenanceTimer: ReturnType<typeof setInterval> | undefined;

// The compare-and-swap lease in FileCleanupService makes this safe on every
// replica, after storage identity has been proven.
let fileCleanupRunning = false;
const runFileCleanup = async (): Promise<void> => {
    if (fileCleanupRunning) return;
    fileCleanupRunning = true;
    try {
        const result = await fileCleanupService.runDue();
        if (result.examined > 0) {
            console.log('[FileCleanup] Reconciliation cycle completed', result);
        }
    } catch (error) {
        console.error('[FileCleanup] Reconciliation cycle unavailable', {
            errorType: error instanceof Error ? error.name : typeof error,
        });
    } finally {
        fileCleanupRunning = false;
    }
};

async function bootstrap(): Promise<void> {
    try {
        // Workers and HTTP traffic must not touch files before this gate. In
        // production it proves that all replicas sharing MySQL see the same
        // durable volume marker.
        const storage = await initializeStorageIdentity();
        console.log('[Storage] Readiness verified', {
            mode: storage.mode,
            identityVerified: storage.identityVerified,
            identityHash: storage.identityHash,
        });
    } catch (error) {
        console.error('FATAL: storage identity/readiness verification failed', {
            errorType: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : 'Unknown storage readiness error',
        });
        WebSocketService.shutdown();
        stopAuthCleanup();
        await prisma.$disconnect().catch(() => undefined);
        process.exit(1);
    }

    SettingService.initializeDefaults().catch(error => {
        console.error('Failed to initialize settings:', error);
    });

    SessionService.purgeExpired()
        .then(count => { if (count > 0) console.log(`Purged ${count} expired/revoked sessions`); })
        .catch(error => { console.error('Failed to purge expired sessions:', error); });
    sessionPurgeTimer = setInterval(() => {
        SessionService.purgeExpired().catch(error => {
            console.error('Session purge error:', error);
        });
    }, 60 * 60 * 1000);
    sessionPurgeTimer.unref?.();

    void runFileCleanup();
    fileCleanupTimer = setInterval(() => {
        void runFileCleanup();
    }, 60 * 1000);
    fileCleanupTimer.unref?.();

    // Apply biometric retention and retry the provider purge outbox hourly.
    BiometricService.runScheduledMaintenance().catch(error => {
        console.error('Initial biometric maintenance error:', error);
    });
    biometricMaintenanceTimer = setInterval(() => {
        BiometricService.runScheduledMaintenance().then(results => {
            for (const result of results) {
                if (!result.ok) console.error(`Biometric maintenance failed for company ${result.companyId}: ${result.error}`);
            }
        }).catch(error => {
            console.error('Biometric maintenance error:', error);
        });
    }, 60 * 60 * 1000);
    biometricMaintenanceTimer.unref?.();

    NotificationService.start();

    server.listen(PORT, () => {
        console.log(`⚡️[server]: Server is running at http://localhost:${PORT}`);
        console.log('🔌 [websocket]: WebSocket server is ready');
    });
}

void bootstrap();

// Graceful shutdown
const shutdown = async () => {
    console.log('Shutdown signal received: closing HTTP server');
    WebSocketService.shutdown();
    NotificationService.stop();
    stopAuthCleanup();
    if (sessionPurgeTimer) clearInterval(sessionPurgeTimer);
    if (fileCleanupTimer) clearInterval(fileCleanupTimer);
    if (biometricMaintenanceTimer) clearInterval(biometricMaintenanceTimer);
    await prisma.$disconnect();
    if (!server.listening) {
        process.exit(0);
    }
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
