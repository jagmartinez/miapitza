import http from 'http';
import app from './app';
import prisma from './utils/prisma';
import { WebSocketService } from './services/websocket.service';
import { SettingService } from './services/setting.service';
import { NotificationService } from './services/notification.service';
import { SessionService } from './services/session.service';
import { stopAuthCleanup } from './services/auth.service';

const PORT = process.env.PORT || 3001;

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
