import { Router } from 'express';
import { UploadController, upload } from '../controllers/upload.controller';
import { authMiddleware, requireRole } from '../middlewares/auth';

const router = Router();

router.use(authMiddleware);
router.use(requireRole('SUPERADMIN', 'ADMIN'));

router.post('/logo', upload.single('logo'), UploadController.uploadLogo);
router.delete('/logo/:filename', UploadController.deleteLogo);

export default router;
