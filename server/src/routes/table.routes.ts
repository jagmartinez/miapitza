import { Router } from 'express';
import { TableController } from '../controllers/table.controller';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/', requirePermission('tables.map.view', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO', 'CAJERO'), TableController.getAll);
router.get('/plan/:branchId', requirePermission('tables.map.view', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO', 'CAJERO'), validate(s.tableFloorPlanParams), TableController.getFloorPlan);
router.put('/plan/:branchId', requirePermission('tables.map.edit', 'SUPERADMIN', 'ADMIN'), validate(s.updateTableFloorPlan), TableController.updateFloorPlan);
router.get('/branch/:branchId', requirePermission('tables.map.view', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO', 'CAJERO'), TableController.getByBranch);
router.put('/layout', requirePermission('tables.map.edit', 'SUPERADMIN', 'ADMIN'), validate(s.updateTableLayout), TableController.updateLayout);
router.post('/groups', requirePermission('tables.group.manage', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), validate(s.createTableGroup), TableController.createGroup);
router.patch('/groups/:id', requirePermission('tables.group.manage', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), validate(s.updateTableGroup), TableController.updateGroup);
router.post('/groups/:id/close', requirePermission('tables.group.manage', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), validate(s.closeTableGroup), TableController.closeGroup);
router.post('/consolidate', requirePermission('tables.consolidate', 'SUPERADMIN', 'ADMIN', 'CAJERO'), validate(s.consolidateTables), TableController.consolidate);
router.post('/transfer', requirePermission('tables.transfer', 'SUPERADMIN', 'ADMIN', 'MESERO'), validate(s.transferTableConsumption), TableController.transfer);
router.get('/:id', requirePermission('tables.map.view', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO', 'CAJERO'), validate(s.idParam), TableController.getById);
router.post('/', requirePermission('tables.create', 'SUPERADMIN', 'ADMIN'), validate(s.createTable), TableController.create);
router.put('/:id', requirePermission('tables.edit', 'SUPERADMIN', 'ADMIN', 'HOST'), validate(s.idParam), TableController.update);
router.patch('/:id/status', requirePermission('tables.status.manage', 'SUPERADMIN', 'ADMIN', 'HOST', 'MESERO'), validate(s.updateTableStatus), TableController.updateStatus);
router.delete('/:id', requirePermission('tables.delete', 'SUPERADMIN', 'ADMIN'), validate(s.idParam), TableController.delete);

export default router;
