import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { InvoiceService } from '../../services/invoice.service';
import { integrationUsernameFor, resolveIntegrationUser } from '../../services/delivery.service';
import { CashArqueoService, ShiftCloseForbiddenError } from '../../services/cash-arqueo.service';
import { ExportRangeError, MAX_EXPORT_RANGE_DAYS, resolveExportRange } from '../../controllers/export.controller';
import { formatTicketDate } from '../../services/ticket-printing.service';

afterEach(() => {
    jest.restoreAllMocks();
});

describe('invoice list', () => {
    it('searches number/customer/NIT server-side and returns page and global totals', async () => {
        const findMany = jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
            { id: 1, total: 100, fiscalCreditNotes: [] },
            { id: 2, total: 50.5, fiscalCreditNotes: [{ number: 'NC-1' }] },
        ] as never);
        jest.spyOn(prisma.order, 'count').mockResolvedValue(42 as never);
        const aggregate = jest.spyOn(prisma.order, 'aggregate')
            .mockResolvedValueOnce({ _sum: { total: 2000 } } as never)
            .mockResolvedValueOnce({ _sum: { total: 300 } } as never);

        const result = await InvoiceService.listInvoices(4, { search: ' J001 ', page: 2, limit: 20, branchId: 3 });

        const where = (findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toEqual(expect.objectContaining({
            companyId: 4,
            branchId: 3,
            invoiceNumber: { not: null },
            OR: [
                { invoiceNumber: { contains: 'J001' } },
                { customerName: { contains: 'J001' } },
                { customerTaxId: { contains: 'J001' } },
            ],
        }));
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
        expect(aggregate).toHaveBeenCalledTimes(2);
        expect(result.pagination).toEqual({ page: 2, limit: 20, total: 42, totalPages: 3 });
        expect(result.totals).toEqual({ pageTotal: 150.5, aggregateTotal: 2000, aggregateNetTotal: 1700 });
        expect(result.data[1].fiscalCreditNote).toEqual({ number: 'NC-1' });
    });
});

describe('delivery integration user', () => {
    it('looks up the per-company integration user inside the tenant', async () => {
        const findFirst = jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 77 } as never);
        await expect(resolveIntegrationUser(5, 'UBER_EATS')).resolves.toEqual({ id: 77 });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 5, username: { in: [integrationUsernameFor(5), 'system'] }, status: 'ACTIVE' }
        }));
        expect(integrationUsernameFor(5)).toBe('system-5');
    });

    it('falls back to the oldest active company user with a warning', async () => {
        jest.spyOn(prisma.user, 'findFirst')
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce({ id: 3 } as never);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(resolveIntegrationUser(5)).resolves.toEqual({ id: 3 });
        expect(warn).toHaveBeenCalled();
    });

    it('fails when the company has no active user', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null as never);
        await expect(resolveIntegrationUser(5)).rejects.toThrow('No active user');
    });
});

describe('cash shift close authorization', () => {
    it('forbids a cashier from closing another cashier shift', async () => {
        jest.spyOn(prisma.cashShift, 'findFirst').mockResolvedValue({ userId: 99 } as never);
        const tx = jest.spyOn(prisma, '$transaction');
        await expect(CashArqueoService.closeShiftWithArqueo(1, 1, 100, ['CAJERO'], 7))
            .rejects.toBeInstanceOf(ShiftCloseForbiddenError);
        expect(tx).not.toHaveBeenCalled();
    });

    it('lets ADMIN close any shift without the owner lookup', async () => {
        const lookup = jest.spyOn(prisma.cashShift, 'findFirst');
        const preview = jest.spyOn(CashArqueoService, 'previewClose').mockRejectedValue(new Error('stop') as never);
        await expect(CashArqueoService.closeShiftWithArqueo(1, 1, 100, ['ADMIN'], 7)).rejects.toThrow('stop');
        expect(lookup).not.toHaveBeenCalled();
        expect(preview).toHaveBeenCalled();
    });
});

describe('export date range', () => {
    const now = new Date('2026-11-18T12:00:00.000Z');

    it('defaults to the last 366 days ending now', () => {
        const { startDate, endDate } = resolveExportRange(undefined, undefined, 'UTC', now);
        expect(endDate).toEqual(now);
        expect(now.getTime() - startDate.getTime()).toBe(MAX_EXPORT_RANGE_DAYS * 86_400_000);
    });

    it('accepts a full calendar year', () => {
        expect(() => resolveExportRange('2024-01-01', '2024-12-31', 'UTC', now)).not.toThrow();
    });

    it('rejects ranges longer than 366 days, inverted ranges and invalid dates with 400', () => {
        expect(() => resolveExportRange('2024-01-01', '2025-06-30', 'UTC', now)).toThrow(ExportRangeError);
        expect(() => resolveExportRange('2025-02-01', '2025-01-01', 'UTC', now)).toThrow(/posterior/);
        expect(() => resolveExportRange('2025-02-30', undefined, 'UTC', now)).toThrow(ExportRangeError);
    });
});

describe('ticket dates', () => {
    it('renders in the company timezone, not the server one', () => {
        expect(formatTicketDate(new Date('2026-07-14T12:00:00.000Z'), 'America/Managua')).toContain('06:00:00');
        expect(formatTicketDate(new Date('2026-07-14T12:00:00.000Z'), 'Europe/Madrid')).toContain('14:00:00');
    });
});
