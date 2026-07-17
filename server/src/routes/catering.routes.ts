import { Router } from 'express';
import { CateringController } from '../controllers/catering.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import * as s from '../middlewares/validate-schemas';

const router = Router();

router.use(authMiddleware);

router.get('/services', CateringController.getAllServices);
router.post('/services', requireRole('SUPERADMIN', 'ADMIN'), validate(s.createCateringService), CateringController.createService);
router.put('/services/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CateringController.updateService);
router.delete('/services/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CateringController.deleteService);

router.get('/availability', CateringController.checkAvailability);

router.get('/', CateringController.getAllEvents);
router.get('/:id', validate(s.idParam), CateringController.getEventById);
router.post('/', requireRole('SUPERADMIN', 'ADMIN'), validate(s.createCateringEvent), CateringController.createEvent);
router.put('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CateringController.updateEvent);
router.delete('/:id', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CateringController.deleteEvent);

router.post('/:id/payments', requireRole('SUPERADMIN', 'ADMIN'), validate(s.addCateringPayment), CateringController.addPayment);
router.post('/:id/payments/:paymentId/reverse', requireRole('SUPERADMIN', 'ADMIN'), validate(s.reverseCateringPayment), CateringController.reversePayment);

// Fiscal writes are POST and require a caller-provided X-Idempotency-Key.
// Reads never allocate sequences or mutate money/inventory.
router.post('/:id/fiscal-invoice', requireRole('SUPERADMIN', 'ADMIN'), validate(s.idParam), CateringController.issueFiscalInvoice);
router.get('/:id/fiscal-invoice', validate(s.idParam), CateringController.getFiscalInvoice);
router.post('/:id/fiscal-credit-note', requireRole('SUPERADMIN', 'ADMIN'), validate(s.issueCateringFiscalCreditNote), CateringController.issueFiscalCreditNote);
router.get('/:id/fiscal-credit-note', validate(s.idParam), CateringController.getFiscalCreditNote);

export default router;
