import { Router } from 'express';
import { ModifierController } from '../controllers/modifier.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// Protected routes (Only ADMIN or SUPERADMIN)
router.use(authMiddleware);

router.get('/groups', ModifierController.getAllGroups);

router.post('/groups', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.createGroup);
router.put('/groups/:id', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.updateGroup);

router.post('/modifiers', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.createModifier);
router.put('/modifiers/:id', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.updateModifier);

router.post('/assign', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.assignGroupToMenuItem);
router.post('/remove', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.removeGroupFromMenuItem);

export default router;
