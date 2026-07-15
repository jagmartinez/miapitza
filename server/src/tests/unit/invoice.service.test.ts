import type { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { deserializeInvoiceSnapshot, InvoiceService } from '../../services/invoice.service';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';

const snapshot = {
    orderId: 7,
    customerName: 'Cliente',
    customerRuc: 'N/A',
    items: [{ name: 'Plato original', quantity: 1, price: 100, subtotal: 100 }],
    grossSubtotal: 100,
    discount: 0,
    subtotal: 100,
    tax: 15,
    tipAmount: 1,
    tipRatePercent: 1,
    total: 116,
    branchName: 'Centro',
    companyName: 'Empresa original',
    companyRuc: 'J001',
    date: '2026-07-13T12:00:00.000Z',
    invoiceNumber: 'FAC-2-000007',
    taxRatePercent: 15,
    currencySymbol: 'C$',
} as Prisma.JsonObject;

describe('InvoiceService immutable issuance', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('reads an issued invoice exclusively from its persisted snapshot', async () => {
        const lookup = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({
            id: 7,
            invoiceNumber: 'FAC-2-000007',
            invoiceSnapshot: snapshot,
        } as never);
        const settings = jest.spyOn(SettingService, 'getAll');

        const invoice = await InvoiceService.getInvoice(7, 1);

        expect(invoice.items[0].name).toBe('Plato original');
        expect(invoice.companyName).toBe('Empresa original');
        expect(invoice.date.toISOString()).toBe('2026-07-13T12:00:00.000Z');
        expect(settings).not.toHaveBeenCalled();
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
            select: { id: true, invoiceNumber: true, invoiceSnapshot: true },
        }));
    });

    it('persists number, timestamp and rendering snapshot atomically on first issuance', async () => {
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ tax_rate: '15', currency_symbol: 'Q' });
        const issuedAt = new Date('2026-07-14T18:00:00.000Z');
        jest.useFakeTimers().setSystemTime(issuedAt);
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 9 }] as never),
            order: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 9,
                    companyId: 1,
                    branchId: 2,
                    status: 'READY',
                    total: 115,
                    discount: 0,
                    tax: 15,
                    tipAmount: 0,
                    invoiceNumber: null,
                    invoicedAt: null,
                    invoiceSnapshot: null,
                    customerName: null,
                    branch: {
                        name: 'Centro', address: null, phone: null,
                        company: { name: 'Empresa', ruc: 'J001' },
                    },
                    items: [{ quantity: 1, price: 100, subtotal: 100, menuItem: { name: 'Plato' } }],
                } as never),
                update: jest.fn().mockResolvedValue({ id: 9 } as never),
            },
            invoiceSequence: {
                upsert: jest.fn().mockResolvedValue({ lastNumber: 6 } as never),
                update: jest.fn().mockResolvedValue({ lastNumber: 7 } as never),
            },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(((callback: unknown) =>
            (callback as (client: typeof tx) => Promise<unknown>)(tx)) as never);

        const invoice = await InvoiceService.generateInvoice(9, 1);

        expect(invoice).toEqual(expect.objectContaining({
            invoiceNumber: 'FAC-2-000007',
            total: 115,
            currencySymbol: 'Q',
            date: issuedAt,
        }));
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                invoiceNumber: 'FAC-2-000007',
                invoicedAt: issuedAt,
                invoiceSnapshot: expect.objectContaining({
                    companyName: 'Empresa',
                    currencySymbol: 'Q',
                }),
            }),
        }));
    });

    it('returns the first snapshot on an idempotent issuance retry', async () => {
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ currency_symbol: '$' });
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }] as never),
            order: { findUnique: jest.fn().mockResolvedValue({
                id: 7, companyId: 1, branchId: 2, status: 'READY', total: 116,
                items: [{ id: 1 }], invoiceNumber: 'FAC-2-000007', invoiceSnapshot: snapshot,
            } as never), update: jest.fn() },
            invoiceSequence: { upsert: jest.fn(), update: jest.fn() },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(((callback: unknown) =>
            (callback as (client: typeof tx) => Promise<unknown>)(tx)) as never);

        const invoice = await InvoiceService.generateInvoice(7, 1);

        expect(invoice.items[0].name).toBe('Plato original');
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.invoiceSequence.update).not.toHaveBeenCalled();
    });

    it('fails closed for a malformed fiscal snapshot', () => {
        expect(() => deserializeInvoiceSnapshot({ ...snapshot, items: [] })).toThrow(/snapshot.*items/i);
        expect(() => deserializeInvoiceSnapshot({ ...snapshot, total: 999 })).toThrow(/totals do not reconcile/i);
    });
});
