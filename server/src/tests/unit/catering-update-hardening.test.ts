import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '../../utils/prisma';
import { CateringService, cateringLinesUnchanged } from '../../services/catering.service';
import { SettingService } from '../../services/setting.service';

afterEach(() => {
    jest.restoreAllMocks();
});

const future = () => new Date(Date.now() + 7 * 86_400_000);

function snapshotEvent(overrides: Record<string, unknown> = {}) {
    return {
        status: 'RESERVED',
        date: future(),
        branchId: 2,
        customerId: null,
        services: [{ cateringServiceId: 5, quantity: new Decimal(2), unitPrice: new Decimal('50.00'), notes: null, subtotal: new Decimal(100) }],
        menuItems: [{ menuItemId: 9, quantity: 10, unitPrice: new Decimal('12.50'), subtotal: new Decimal(125) }],
        payments: [{ status: 'ACTIVE' }],
        fiscalSubtotal: new Decimal(195.65),
        fiscalTax: new Decimal(29.35),
        fiscalTaxRatePercent: new Decimal(15),
        pricingSnapshotCapturedAt: new Date(),
        ...overrides
    };
}

function mockTx(locked: Record<string, unknown>) {
    const tx = {
        $queryRaw: jest.fn(async () => []),
        customer: { create: jest.fn(), updateMany: jest.fn() },
        cateringEvent: {
            findFirst: jest.fn(async () => locked),
            update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
                totalAmount: (args.data.totalAmount as Decimal | undefined) ?? new Decimal(225),
                payments: [{ status: 'ACTIVE', amount: new Decimal(100) }]
            }))
        },
        cateringServiceItem: { deleteMany: jest.fn() },
        cateringMenuItem: { deleteMany: jest.fn() },
        auditLog: { create: jest.fn() }
    };
    jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (db: typeof tx) => unknown) => callback(tx)) as never
    );
    return tx;
}

describe('cateringLinesUnchanged', () => {
    const existing = [
        { id: 5, quantity: new Decimal(2), unitPrice: new Decimal('50.00') },
        { id: 6, quantity: new Decimal(1), unitPrice: new Decimal('10') }
    ];

    it('treats an identical resend (any order, numeric formatting) as unchanged', () => {
        expect(cateringLinesUnchanged([
            { id: '6', quantity: '1', unitPrice: 10 },
            { id: 5, quantity: 2, unitPrice: '50.0' }
        ], existing)).toBe(true);
    });

    it('detects quantity, price, line-count and malformed changes', () => {
        expect(cateringLinesUnchanged([{ id: 5, quantity: 3, unitPrice: 50 }, { id: 6, quantity: 1, unitPrice: 10 }], existing)).toBe(false);
        expect(cateringLinesUnchanged([{ id: 5, quantity: 2, unitPrice: 49.99 }, { id: 6, quantity: 1, unitPrice: 10 }], existing)).toBe(false);
        expect(cateringLinesUnchanged([{ id: 5, quantity: 2, unitPrice: 50 }], existing)).toBe(false);
        expect(cateringLinesUnchanged([{ id: 5, quantity: 'x', unitPrice: 50 }, { id: 6, quantity: 1, unitPrice: 10 }], existing)).toBe(false);
    });
});

describe('CateringService.updateEvent hardening', () => {
    it('allows a date change after a deposit when the UI resends the unchanged lines', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue(snapshotEvent() as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        const menuLookup = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
        const settings = jest.spyOn(SettingService, 'getAll').mockResolvedValue({} as never);
        const tx = mockTx({ status: 'RESERVED', payments: [{ id: 1 }], services: [], menuItems: [] });

        const newDate = new Date(Date.now() + 14 * 86_400_000).toISOString();
        await CateringService.updateEvent(4, 1, 7, {
            branchId: '2',
            date: newDate,
            status: 'RESERVED',
            services: [{ cateringServiceId: 5, quantity: 2, unitPrice: 50 }],
            menuItems: [{ menuItemId: 9, quantity: 10, unitPrice: 12.5 }]
        });

        expect(tx.cateringServiceItem.deleteMany).not.toHaveBeenCalled();
        expect(tx.cateringMenuItem.deleteMany).not.toHaveBeenCalled();
        expect(settings).not.toHaveBeenCalled();
        expect(menuLookup).not.toHaveBeenCalled();
        const firstUpdate = tx.cateringEvent.update.mock.calls[0][0] as { data: Record<string, unknown> };
        expect(firstUpdate.data).not.toHaveProperty('totalAmount');
        expect(firstUpdate.data.date).toEqual(new Date(newDate));
        const balanceUpdate = tx.cateringEvent.update.mock.calls[1][0] as { data: { balance: Decimal } };
        expect(balanceUpdate.data.balance.toString()).toBe('125');
    });

    it('still rejects a real line change once deposits exist', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue(snapshotEvent() as never);
        await expect(CateringService.updateEvent(4, 1, 7, {
            menuItems: [{ menuItemId: 9, quantity: 11, unitPrice: 12.5 }]
        })).rejects.toThrow(/pagos activos/i);
    });

    it('can finish a paid event whose dish was deactivated after quoting', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue(snapshotEvent({ status: 'PAID' }) as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        const menuLookup = jest.spyOn(prisma.menuItem, 'findMany').mockResolvedValue([] as never);
        const deduct = jest.spyOn(CateringService as unknown as { deductInventoryTx: (...args: unknown[]) => Promise<void> }, 'deductInventoryTx')
            .mockResolvedValue(undefined);
        mockTx({ status: 'PAID', payments: [{ id: 1 }], services: [], menuItems: [] });

        await CateringService.updateEvent(4, 1, 7, { status: 'FINISHED', warehouseId: 3 });

        expect(menuLookup).not.toHaveBeenCalled();
        expect(deduct).toHaveBeenCalledWith(expect.anything(), 4, 1, 7, 3);
    });

    it('computes the new total from the lines read under the event lock', async () => {
        jest.spyOn(prisma.cateringEvent, 'findFirst').mockResolvedValue(snapshotEvent({ status: 'QUOTED', payments: [] }) as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({ id: 2 } as never);
        jest.spyOn(prisma.cateringService, 'findMany').mockResolvedValue([{ id: 5 }] as never);
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ tax_rate: '15' } as never);
        // A concurrent edit changed the menu lines to 300 after our snapshot (125).
        const tx = mockTx({ status: 'QUOTED', payments: [], services: [], menuItems: [{ subtotal: new Decimal(300) }] });

        await CateringService.updateEvent(4, 1, 7, {
            services: [{ cateringServiceId: 5, quantity: 1, unitPrice: 40 }]
        });

        const firstUpdate = tx.cateringEvent.update.mock.calls[0][0] as { data: Record<string, Decimal> };
        expect(firstUpdate.data.totalAmount.toString()).toBe('340');
        expect(firstUpdate.data.fiscalSubtotal.add(firstUpdate.data.fiscalTax).toString()).toBe('340');
        expect(tx.cateringMenuItem.deleteMany).not.toHaveBeenCalled();
    });
});
