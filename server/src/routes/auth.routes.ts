import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// Register requires authentication + admin role (no public self-registration)
router.post('/register', authMiddleware, requireRole('ADMIN', 'SUPERADMIN'), AuthController.register);
router.post('/login', AuthController.login);

// Verify current session (used by client on app load)
router.get('/me', authMiddleware, AuthController.me);

// Change password (any authenticated user)
router.post('/change-password', authMiddleware, AuthController.changePassword);

// Sessions management
router.get('/sessions', authMiddleware, AuthController.getSessions);
router.delete('/sessions/:id', authMiddleware, AuthController.revokeSession);
router.delete('/sessions', authMiddleware, AuthController.revokeAllSessions);

// 2FA management
router.post('/2fa/setup', authMiddleware, AuthController.setup2FA);
router.post('/2fa/verify', authMiddleware, AuthController.verify2FA);
router.post('/2fa/disable', authMiddleware, AuthController.disable2FA);

export default router;
