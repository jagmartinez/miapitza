import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { CateringStatus } from '@prisma/client';
import prisma from '../../utils/prisma';
import { CATERING_STATUS_TRANSITIONS, CateringService } from '../../services/catering.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('catering status machine', () => {
    const valid: Array<[CateringStatus, CateringStatus]> = [
        ['QUOTED', 'RESERVED'],
        ['QUOTED', 'CANCELLED'],
        ['RESERVED', 'CANCELLED'],
        ['PAID', 'FINISHED'],
    ];

    it.each(valid)('allows %s -> %s', (from, to) => {
        expect(CATERING_STATUS_TRANSITIONS[from]).toContain(to);
    });

    it('contains only real Prisma/UI statuses and no dead intermediate states', () => {
        const real = new Set<CateringStatus>(['QUOTED', 'RESERVED', 'PAID', 'FINISHED', 'CANCELLED']);
        for (const [from, targets] of Object.entries(CATERING_STATUS_TRANSITIONS)) {
            expect(real.has(from as CateringStatus)).toBe(true);
            for (const target of targets) expect(real.has(target)).toBe(true);
        }
        expect(Object.keys(CATERING_STATUS_TRANSITIONS)).not.toContain('CONFIRMED');
        expect(Object.keys(CATERING_STATUS_TRANSITIONS)).not.toContain('IN_PROGRESS');
    });

    it.each([
        ['QUOTED', 'PAID'], ['QUOTED', 'FINISHED'], ['RESERVED', 'FINISHED'],
        ['RESERVED', 'PAID'], ['PAID', 'CANCELLED'], ['FINISHED', 'CANCELLED'],
        ['CANCELLED', 'RESERVED'],
    ] as Array<[CateringStatus, CateringStatus]>)('rejects manual %s -> %s', (from, to) => {
        expect(CATERING_STATUS_TRANSITIONS[from]).not.toContain(to);
    });
});

describe('catering service boundary', () => {
    it('rejects malformed catalog values before touching persistence', async () => {
        await expect(CateringService.createService(1, {
            name: '  ', internalCost: 1, salePrice: 2
        } as never)).rejects.toThrow(/nombre/i);
        await expect(CateringService.createService(1, {
            name: 'Montaje', internalCost: -1, salePrice: 2
        } as never)).rejects.toThrow(/costo/i);
        await expect(CateringService.updateService(3, 1, {
            salePrice: -0.01
        })).rejects.toThrow(/precio/i);
    });

    it('keeps the branch immutable once the event has active payments', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue({
            status: 'RESERVED',
            date: new Date(Date.now() + 86_400_000),
            branchId: 2,
            customerId: null,
            services: [],
            menuItems: [],
            payments: [{ status: 'ACTIVE' }]
        } as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 3 } as never);

        const tx = {
            $queryRaw: jest.fn(async () => []),
            cateringEvent: {
                findFirst: jest.fn(async () => ({ status: 'RESERVED', payments: [{ id: 8 }] })),
                update: jest.fn()
            },
            cateringServiceItem: { deleteMany: jest.fn() },
            cateringMenuItem: { deleteMany: jest.fn() }
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
        );

        await expect(CateringService.updateEvent(9, 1, 7, { branchId: 3 }))
            .rejects.toThrow(/cambiar la sucursal.*pagos activos/i);
        expect(tx.cateringEvent.update).not.toHaveBeenCalled();
    });
});
