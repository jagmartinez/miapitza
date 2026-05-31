import http from 'http';
import app from './app';
import prisma from './utils/prisma';
import { WebSocketService } from './services/websocket.service';
import { SettingService } from './services/setting.service';
import { NotificationService } from './services/notification.service';
import { SessionService } from './services/session.service';
import { stopAuthCleanup } from './services/auth.service';

const PORT = process.env.PORT || 3001;

// Validate required environment before accepting traffic. prisma.ts already
// validates DATABASE_URL; here we guarantee a usable JWT secret so the server
// never boots with auth that can be trivially forged.
function validateEnv(): void {
    const errors: string[] = [];

    const jwtSecret = process.env.JWT_SECRET;
    const WEAK_JWT_SECRETS = new Set(['change-me-in-production', 'changeme', 'secret']);
    if (!jwtSecret || jwtSecret.trim() === '') {
        errors.push('JWT_SECRET is required but not set.');
    } else if (WEAK_JWT_SECRETS.has(jwtSecret.trim())) {
        errors.push('JWT_SECRET is set to a known-weak default; use a long random secret.');
    }

    if (errors.length > 0) {
        console.error('FATAL: invalid environment configuration:');
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
    }
}

validateEnv();

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
WebSocketService.initialize(server);

// Initialize default settings
SettingService.initializeDefaults().catch(err => {
    console.error('Failed to initialize settings:', err);
});

// Purge expired/revoked sessions from the database on startup
SessionService.purgeExpired()
    .then(count => { if (count > 0) console.log(`Purged ${count} expired/revoked sessions`); })
    .catch(err => { console.error('Failed to purge expired sessions:', err); });

// Periodically purge expired sessions (every 60 minutes)
const sessionPurgeTimer = setInterval(() => {
    SessionService.purgeExpired().catch(err => {
        console.error('Session purge error:', err);
    });
}, 60 * 60 * 1000);
if (sessionPurgeTimer.unref) sessionPurgeTimer.unref();

// Start background notification service
NotificationService.start();

// Start server
server.listen(PORT, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${PORT}`);
    console.log(`🔌 [websocket]: WebSocket server is ready`);
});

// Graceful shutdown
const shutdown = async () => {
    console.log('Shutdown signal received: closing HTTP server');
    WebSocketService.shutdown();
    NotificationService.stop();
    stopAuthCleanup();
    clearInterval(sessionPurgeTimer);
    await prisma.$disconnect();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
