import { Router } from 'express';
import { ModifierController } from '../controllers/modifier.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/groups', ModifierController.getAllGroups);

router.post('/groups', requireRole('ADMIN', 'SUPERADMIN'), validate(s.createModifierGroup), ModifierController.createGroup);
router.put('/groups/:id', requireRole('ADMIN', 'SUPERADMIN'), validate(s.idParam), ModifierController.updateGroup);

router.post('/modifiers', requireRole('ADMIN', 'SUPERADMIN'), validate(s.createModifier), ModifierController.createModifier);
router.put('/modifiers/:id', requireRole('ADMIN', 'SUPERADMIN'), validate(s.idParam), ModifierController.updateModifier);

router.post('/assign', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.assignGroupToMenuItem);
router.post('/remove', requireRole('ADMIN', 'SUPERADMIN'), ModifierController.removeGroupFromMenuItem);

export default router;
