import { Router, Request, Response, NextFunction } from 'express';
import type { OperationalDevice } from '@prisma/client';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { assertBranchAccess, resolveBranchScope } from '../utils/branch-scope';
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
            // validate() does not write coerced values back: coerce explicitly.
            const branchId = Number(req.body.branchId);
            const kitchenUserId = req.body.kitchenUserId === undefined || req.body.kitchenUserId === ''
                ? undefined : Number(req.body.kitchenUserId);
            assertBranchAccess(req.user!, branchId);
            const { device, deviceToken } = await OperationalDeviceService.register(actorOf(req), {
                branchId,
                type: req.body.type,
                name: req.body.name,
                kitchenUserId,
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
            const requested = req.query.branchId ? Number(req.query.branchId) : undefined;
            // Company-wide admins may filter or see all; branch-pinned users are forced to their branch.
            if (requested) assertBranchAccess(req.user!, requested);
            const branchId = resolveBranchScope(req.user!, requested);
            const devices = await OperationalDeviceService.list(actorOf(req), branchId);
            res.json({ success: true, data: devices.map(publicDevice) });
        } catch (error) {
            next(error);
        }
    },
);

router.get('/setup-options', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const data = await OperationalDeviceService.setupOptions(actorOf(req), resolveBranchScope(req.user!));
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
});

router.post(
    '/:id/revoke',
    validate({ params: { id: { type: 'number', required: true, min: 1, integer: true } } }),
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            await OperationalDeviceService.revoke(actorOf(req), Number(req.params.id), {
                branchScope: resolveBranchScope(req.user!),
            });
            res.json({ success: true, data: { revoked: true } });
        } catch (error) {
            next(error);
        }
    },
);

export default router;
