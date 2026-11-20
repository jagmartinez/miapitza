import { Router, Request, Response, NextFunction } from 'express';
import type { OperationalDevice } from '@prisma/client';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { assertBranchAccess } from '../utils/branch-scope';
import { OperationalDeviceService } from '../services/operational-device.service';

const router = Router();

router.use(authMiddleware);
router.use(requirePermission('devices.manage'));

/** The token hash is a credential equivalent: it never leaves the server. */
function publicDevice(device: OperationalDevice) {
    const { tokenHash: _tokenHash, ...rest } = device;
    return rest;
}

function actorOf(req: Request) {
    return { userId: req.user!.userId, companyId: req.user!.companyId };
}

router.post(
    '/',
    validate({
        body: {
            branchId: { type: 'number', required: true, min: 1, integer: true },
            type: { type: 'string', required: true, enum: ['SERVICE_TABLET', 'KITCHEN_TABLET'] },
            name: { type: 'string', required: true, min: 1, max: 100 },
            kitchenUserId: { type: 'number', min: 1, integer: true },
        },
    }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            assertBranchAccess(req.user!, req.body.branchId);
            const { device, deviceToken } = await OperationalDeviceService.register(actorOf(req), {
                branchId: req.body.branchId,
                type: req.body.type,
                name: req.body.name,
                kitchenUserId: req.body.kitchenUserId,
            });
            res.set('Cache-Control', 'no-store');
            res.status(201).json({ success: true, data: { device: publicDevice(device), deviceToken } });
        } catch (error) {
            next(error);
        }
    },
);

router.get(
    '/',
    validate({ query: { branchId: { type: 'number', min: 1, integer: true } } }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
            if (branchId) assertBranchAccess(req.user!, branchId);
            const devices = await OperationalDeviceService.list(actorOf(req), branchId);
            res.json({ success: true, data: devices.map(publicDevice) });
        } catch (error) {
            next(error);
        }
    },
);

router.post(
    '/:id/revoke',
    validate({ params: { id: { type: 'number', required: true, min: 1, integer: true } } }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            await OperationalDeviceService.revoke(actorOf(req), Number(req.params.id));
            res.json({ success: true, data: { revoked: true } });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
