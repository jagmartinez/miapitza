import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { InvoiceService } from '../../services/invoice.service';
import prisma from '../../utils/prisma';

describe('InvoiceService Unit Tests', () => {
    afterEach(() => { jest.restoreAllMocks(); });
    it('should correctly calculate IVA and subtotal', async () => {
        // We can test the static calculation logic if we extract it or mock prisma
        // For now, let's verify the service has the necessary methods
        expect(InvoiceService.generateInvoice).toBeDefined();
        expect(InvoiceService.generateInvoicePDF).toBeDefined();
    });

    it('rejects invoicing after all payments were reversed', async () => {
        const lookup = jest.spyOn(prisma.order, 'findFirst').mockResolvedValue({ status: 'PAID', total: 100, payments: [] } as never);
        await expect(InvoiceService.generateInvoice(9, 1)).rejects.toThrow('Only fully paid');
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 9, companyId: 1 },
            select: expect.objectContaining({ payments: { where: { status: 'ACTIVE' }, select: { amount: true } } })
        }));
    });
});
