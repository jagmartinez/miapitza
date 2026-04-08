import { Router } from 'express';
import { CateringController } from '../controllers/catering.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Services Catalog
router.get('/services', CateringController.getAllServices);
router.post('/services', requireRole('SUPERADMIN', 'ADMIN'), CateringController.createService);
router.put('/services/:id', requireRole('SUPERADMIN', 'ADMIN'), CateringController.updateService);
router.delete('/services/:id', requireRole('SUPERADMIN', 'ADMIN'), CateringController.deleteService);

// Availability Checks
router.get('/availability', CateringController.checkAvailability);

// Events
router.get('/', CateringController.getAllEvents);
router.get('/:id', CateringController.getEventById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), CateringController.createEvent);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), CateringController.updateEvent);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), CateringController.deleteEvent);

// Payments
router.post('/:id/payments', requireRole('SUPERADMIN', 'ADMIN'), CateringController.addPayment);

export default router;
