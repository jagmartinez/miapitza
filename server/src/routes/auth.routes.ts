import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();

// Register requires authentication + admin role (no public self-registration)
router.post('/register',
    authMiddleware,
    requireRole('ADMIN', 'SUPERADMIN'),
    validate({
        body: {
            name: { type: 'string', required: true, min: 1, max: 100 },
            email: { type: 'email', required: true },
            username: { type: 'string', required: true, min: 3, max: 50 },
            password: { type: 'string', required: true, min: 8, max: 128 },
            roleId: { type: 'number', required: true, min: 1 },
        },
    }),
    AuthController.register
);

router.post('/login',
    validate({
        body: {
            username: { type: 'string', required: true, max: 100 },
            password: { type: 'string', required: true, max: 128 },
            twoFactorCode: { type: 'string' },
        },
    }),
    AuthController.login
);

// Verify current session (used by client on app load)
router.get('/me', authMiddleware, AuthController.me);

// Change password (any authenticated user)
router.post('/change-password',
    authMiddleware,
    validate({
        body: {
            oldPassword: { type: 'string', required: true },
            newPassword: { type: 'string', required: true, min: 8, max: 128 },
        },
    }),
    AuthController.changePassword
);

// Sessions management
router.get('/sessions', authMiddleware, AuthController.getSessions);
router.delete('/sessions/:id',
    authMiddleware,
    validate({ params: { id: { type: 'string', required: true } } }),
    AuthController.revokeSession
);
router.delete('/sessions', authMiddleware, AuthController.revokeAllSessions);

// 2FA management
router.post('/2fa/setup', authMiddleware, AuthController.setup2FA);
router.post('/2fa/verify',
    authMiddleware,
    validate({ body: { code: { type: 'string', required: true, min: 6, max: 6 } } }),
    AuthController.verify2FA
);
router.post('/2fa/disable',
    authMiddleware,
    validate({ body: { code: { type: 'string', required: true, min: 6, max: 6 } } }),
    AuthController.disable2FA
);
router.post('/2fa/recovery-codes',
    authMiddleware,
    validate({ body: { code: { type: 'string', required: true, min: 6, max: 6 } } }),
    AuthController.regenerateRecoveryCodes
);

export default router;
