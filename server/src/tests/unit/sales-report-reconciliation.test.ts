import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { ReportService } from '../../services/report.service';

describe('ReportService.getSalesReport reconciliation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(prisma.fiscalCreditNote, 'findMany').mockResolvedValue([] as never);
    });

    it('reconciles order metrics and counts only orders matching item filters', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            {
                id: 1, createdAt: new Date('2025-12-31T23:55:00Z'), closedAt: new Date('2026-01-01T00:05:00Z'), invoiceNumber: 'F-1',
                discount: 10, tax: 13.5, tipAmount: 5, total: 98.5,
                payments: [{ amount: 98.5, paymentMethod: { name: 'Efectivo' } }],
                user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
                items: [
                    { quantity: 1, price: 60, subtotal: 60, menuItem: { name: 'A', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } } },
                    { quantity: 1, price: 30, subtotal: 30, menuItem: { name: 'B', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } } },
                ],
            },
            {
                id: 2, createdAt: new Date('2026-01-01T00:10:00Z'), closedAt: new Date('2026-01-01T00:20:00Z'), invoiceNumber: 'F-2',
                discount: 0, tax: 15, tipAmount: 0, total: 115,
                payments: [{ amount: 115, paymentMethod: { name: 'Tarjeta' } }],
                user: { name: 'Luis' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
                items: [{ quantity: 1, price: 100, subtotal: 100, menuItem: { name: 'C', categoryId: 8, brandId: 1, category: { name: 'Otra' }, brand: { name: 'Marca' } } }],
            },
        ] as never);

        const dateFrom = new Date('2026-01-01T00:00:00Z');
        const result = await ReportService.getSalesReport(3, { categoryIds: [7], dateFrom });

        expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                closedAt: expect.objectContaining({ not: null, gte: dateFrom }),
                OR: expect.arrayContaining([
                    { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
                    { status: 'CANCELLED', invoiceFiscalStatus: 'CREDITED' }
                ]),
            }),
            orderBy: { closedAt: 'desc' }
        }));

        expect(result.summary).toMatchObject({
            totalOrders: 1,
            totalSales: 90,
            netItemSales: 90,
            orderDiscount: 10,
            tax: 13.5,
            tip: 5,
            grossOrderTotal: 98.5,
            collected: 98.5,
            averageTicket: 98.5,
        });
        expect(result.summary.netItemSales - result.summary.orderDiscount + result.summary.tax + result.summary.tip)
            .toBe(result.summary.grossOrderTotal);
        expect(result.items.map((item) => item.discount)).toEqual([10, 0]);
        expect(result.items[0].date).toEqual(new Date('2026-01-01T00:05:00Z'));
    });

    it('nets partial fiscal credits across quantities, tax, collected amount and ticket value', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 3,
            createdAt: new Date('2026-01-01T10:00:00Z'),
            closedAt: new Date('2026-01-01T10:10:00Z'),
            invoiceNumber: 'F-3',
            discount: 0,
            tax: 30,
            tipAmount: 0,
            total: 230,
            payments: [{
                amount: 230,
                status: 'ACTIVE',
                paymentMethod: { name: 'Efectivo' },
                fiscalCreditNoteRefunds: [{ amount: 115 }]
            }],
            user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
            items: [{
                id: 31,
                quantity: 2,
                price: 100,
                subtotal: 200,
                menuItem: { name: 'A', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
            }]
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            id: 1,
            number: 'NC-1',
            originalInvoiceNumber: 'F-3',
            issuedAt: new Date('2026-01-01T11:00:00Z'),
            refunds: [{ payment: { paymentMethod: { name: 'Efectivo' } } }],
            order: { user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' } },
            lines: [{
                orderItemId: 31, quantity: 1, grossSubtotal: 100, discount: 0,
                tax: 15, tipAmount: 0, total: 115,
                orderItem: {
                    price: 100,
                    menuItem: { name: 'A', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
                }
            }]
        }] as never);

        const result = await ReportService.getSalesReport(3);

        expect(result.items).toEqual([
            expect.objectContaining({ quantity: 2, totalSale: 200 }),
            expect.objectContaining({ quantity: -1, totalSale: -100 })
        ]);
        expect(result.summary).toMatchObject({
            totalOrders: 1,
            totalSales: 100,
            netItemSales: 100,
            tax: 15,
            tip: 0,
            grossOrderTotal: 115,
            collected: 115,
            averageTicket: 115
        });
    });

    it('allocates order-level money in cents when category filters select only part of an order', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 5,
            closedAt: new Date('2026-01-01T10:10:00Z'),
            invoiceNumber: 'F-5',
            discount: 10,
            tax: 13.5,
            tipAmount: 5,
            total: 98.5,
            payments: [{ amount: 98.5, paymentMethod: { name: 'Efectivo' } }],
            user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
            items: [
                {
                    id: 51, quantity: 1, price: 60, subtotal: 60,
                    menuItem: { name: 'A', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
                },
                {
                    id: 52, quantity: 1, price: 30, subtotal: 30,
                    menuItem: { name: 'B', categoryId: 8, brandId: 1, category: { name: 'Otra' }, brand: { name: 'Marca' } }
                }
            ]
        }] as never);

        const result = await ReportService.getSalesReport(3, { categoryId: 7 });

        expect(result.summary).toMatchObject({
            totalOrders: 1,
            netItemSales: 60,
            orderDiscount: 6.67,
            tax: 9,
            tip: 3.33,
            grossOrderTotal: 65.66,
            collected: 65.66,
            averageTicket: 65.66
        });
        expect(
            result.summary.netItemSales
            - result.summary.orderDiscount
            + result.summary.tax
            + result.summary.tip
        ).toBe(result.summary.grossOrderTotal);
        expect(result.items).toEqual([
            expect.objectContaining({ productName: 'A', discount: 6.67, totalSale: 60 })
        ]);
    });

    it('books a current-period credit as a negative without rewriting an older sale period', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            id: 2,
            number: 'NC-2',
            originalInvoiceNumber: 'F-OLD',
            issuedAt: new Date('2026-02-10T12:00:00Z'),
            refunds: [{ payment: { paymentMethod: { name: 'Tarjeta' } } }],
            order: { user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' } },
            lines: [{
                orderItemId: 90, quantity: 1, grossSubtotal: 100, discount: 0,
                tax: 15, tipAmount: 0, total: 115,
                orderItem: {
                    price: 100,
                    menuItem: { name: 'Venta antigua', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
                }
            }]
        }] as never);

        const from = new Date('2026-02-01T00:00:00Z');
        const to = new Date('2026-02-28T23:59:59Z');
        const result = await ReportService.getSalesReport(3, { dateFrom: from, dateTo: to });

        expect(prisma.fiscalCreditNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ issuedAt: { gte: from, lte: to } })
        }));
        expect(result.summary).toMatchObject({
            totalOrders: 0,
            creditNoteCount: 1,
            totalSales: -100,
            tax: -15,
            grossOrderTotal: -115,
            collected: -115
        });
        expect(result.items[0]).toEqual(expect.objectContaining({ quantity: -1, totalSale: -100 }));
    });

    it('keeps the gross closed event so a full same-period credit reconciles to zero', async () => {
        jest.spyOn(prisma.order, 'findMany').mockResolvedValue([{
            id: 4,
            closedAt: new Date('2026-03-10T10:00:00Z'),
            invoiceNumber: 'F-4',
            discount: 0,
            tax: 15,
            tipAmount: 0,
            total: 115,
            payments: [{ amount: 115, status: 'REVERSED', paymentMethod: { name: 'Efectivo' } }],
            user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' },
            items: [{
                id: 41, quantity: 1, price: 100, subtotal: 100,
                menuItem: { name: 'Pizza', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
            }]
        }] as never);
        jest.mocked(prisma.fiscalCreditNote.findMany).mockResolvedValue([{
            id: 4,
            number: 'NC-4',
            originalInvoiceNumber: 'F-4',
            issuedAt: new Date('2026-03-10T12:00:00Z'),
            refunds: [{ payment: { paymentMethod: { name: 'Efectivo' } } }],
            order: { user: { name: 'Ana' }, branch: { name: 'Centro' }, company: { name: 'Demo' } },
            lines: [{
                orderItemId: 41, quantity: 1, grossSubtotal: 100, discount: 0, tax: 15, tipAmount: 0, total: 115,
                orderItem: {
                    price: 100,
                    menuItem: { name: 'Pizza', categoryId: 7, brandId: 1, category: { name: 'Cat' }, brand: { name: 'Marca' } }
                }
            }]
        }] as never);

        const result = await ReportService.getSalesReport(3, {
            dateFrom: new Date('2026-03-01T00:00:00Z'),
            dateTo: new Date('2026-03-31T23:59:59Z')
        });

        expect(result.summary).toMatchObject({
            totalOrders: 1,
            creditNoteCount: 1,
            totalSales: 0,
            tax: 0,
            grossOrderTotal: 0,
            collected: 0
        });
    });
});
