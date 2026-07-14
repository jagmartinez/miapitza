import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { InvoiceService } from '../../services/invoice.service';
import prisma from '../../utils/prisma';
import { SettingService } from '../../services/setting.service';

describe('InvoiceService Unit Tests', () => {
    afterEach(() => { jest.restoreAllMocks(); });
    it('uses persisted fiscal totals and the configured company currency', async () => {
        jest.spyOn(prisma.order, 'findFirst')
            .mockResolvedValueOnce({ status: 'OPEN', total: 116, items: [{ id: 1 }] } as never)
            .mockResolvedValueOnce({
                id: 7,
                invoiceNumber: 'FAC-2-000007',
                branchId: 2,
                customerName: 'Cliente',
                discount: 0,
                tax: 15,
                tipAmount: 1,
                total: 116,
                createdAt: new Date('2026-07-13T12:00:00.000Z'),
                branch: {
                    name: 'Centro', address: null, phone: null,
                    company: { name: 'Empresa', ruc: 'J001' }
                },
                items: [{
                    quantity: 1, price: 100, subtotal: 100,
                    menuItem: { name: 'Plato' }
                }],
                user: { id: 1 }
            } as never);
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({ tax_rate: '15', tipRate: '10' });
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('Q');

        const invoice = await InvoiceService.generateInvoice(7, 1);

        expect(invoice).toEqual(expect.objectContaining({
            subtotal: 100,
            tax: 15,
            tipAmount: 1,
            total: 116,
            currencySymbol: 'Q',
            taxRatePercent: 15
        }));
    });

    it('allows issuing the invoice before collection', async () => {
        jest.spyOn(prisma.order, 'findFirst')
            .mockResolvedValueOnce({ status: 'OPEN', total: 100, items: [{ id: 1 }] } as never)
            .mockResolvedValueOnce({
                id: 9,
                invoiceNumber: 'FAC-2-000009',
                branchId: 2,
                customerName: null,
                discount: 0,
                tax: 0,
                tipAmount: 0,
                total: 100,
                createdAt: new Date('2026-07-13T12:00:00.000Z'),
                branch: { name: 'Centro', address: null, phone: null, company: { name: 'Empresa', ruc: null } },
                items: [{ quantity: 1, price: 100, subtotal: 100, menuItem: { name: 'Plato' } }],
                user: { id: 1 }
            } as never);
        jest.spyOn(SettingService, 'getAll').mockResolvedValue({});
        jest.spyOn(SettingService, 'getCurrencySymbol').mockResolvedValue('C$');

        await expect(InvoiceService.generateInvoice(9, 1)).resolves.toEqual(expect.objectContaining({
            invoiceNumber: 'FAC-2-000009',
            total: 100,
        }));
    });

    it('rejects an empty order before consuming an invoice number', async () => {
        const lookup = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ status: 'OPEN', total: 100, items: [] } as never);
        await expect(InvoiceService.generateInvoice(9, 1)).rejects.toThrow(/productos/i);
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 9, companyId: 1 },
            select: expect.objectContaining({ items: { select: { id: true } } })
        }));
    });
});
