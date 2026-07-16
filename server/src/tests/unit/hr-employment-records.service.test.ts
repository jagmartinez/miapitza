import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import {
    createHrDocumentStorage,
    HrCompensationService,
    HrDocumentStorageUnavailableError,
    HrEmployeeDocumentService,
    HrEmploymentContractService,
    type HrDocumentStorage,
} from '../../services/hr-employment-records.service';

function employee(overrides: Record<string, unknown> = {}) {
    return {
        id: 7, userId: 11, hireDate: new Date('2025-01-01T00:00:00.000Z'), terminationDate: null,
        status: 'ACTIVE', ...overrides,
    };
}

function memoryStorage(initial?: Buffer): HrDocumentStorage & { stored?: Buffer; deleted: string[] } {
    return {
        provider: 'memory-test', stored: initial, deleted: [],
        healthCheck: async () => ({ provider: 'memory-test', status: 'AVAILABLE', checkedAt: new Date().toISOString() }),
        async put(_key, content) { this.stored = Buffer.from(content); },
        async get() { if (!this.stored) throw new Error('missing'); return Buffer.from(this.stored); },
        async delete(key) { this.deleted.push(key); this.stored = undefined; },
    };
}

describe('HR employment records and document custody', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('fails closed unless a document storage provider is explicitly configured', async () => {
        const storage = createHrDocumentStorage({ NODE_ENV: 'production' });
        await expect(storage.put('1/2/a.pdf', Buffer.from('%PDF-1.7'))).rejects.toBeInstanceOf(HrDocumentStorageUnavailableError);
    });

    it('rejects MIME spoofing before persisting a document', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(employee() as never);
        const storage = memoryStorage();
        await expect(HrEmployeeDocumentService.upload({
            companyId: 4, employeeId: 7, actorUserId: 3, documentType: 'CONTRATO',
            fileName: 'contrato.pdf', mimeType: 'application/pdf', content: Buffer.from('not-a-pdf'),
        }, storage)).rejects.toThrow('no coincide');
        expect(storage.stored).toBeUndefined();
    });

    it('stores only an opaque key and SHA-256 after signature validation', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(employee() as never);
        const content = Buffer.from('%PDF-1.7\nminimal');
        const storage = memoryStorage();
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
            id: 31, ...args.data, createdAt: new Date(), updatedAt: new Date(), uploadedBy: { id: 3, name: 'Owner', username: 'owner' },
        }));
        const tx = { employeeDocument: { create }, auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) } };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        const result = await HrEmployeeDocumentService.upload({
            companyId: 4, employeeId: 7, actorUserId: 3, documentType: 'contrato',
            fileName: '../Contrato final.pdf', mimeType: 'application/pdf', content,
        }, storage);

        expect(result).toEqual(expect.objectContaining({ id: 31, contentHash: createHash('sha256').update(content).digest('hex') }));
        expect(storage.stored).toEqual(content);
        const data = create.mock.calls[0][0].data;
        expect(data.storageKey).toMatch(/^4\/7\/[0-9a-f-]+\.pdf$/);
        expect(data.fileName).toBe('Contrato final.pdf');
        expect(data).not.toHaveProperty('content');
    });

    it('fails closed when a downloaded file no longer matches its stored hash', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(employee() as never);
        jest.spyOn(prisma.employeeDocument, 'findFirst').mockResolvedValue({
            id: 31, companyId: 4, employeeId: 7, storageKey: '4/7/file.pdf', status: 'ACTIVE',
            expiresAt: null, sizeBytes: 9, contentHash: '0'.repeat(64), mimeType: 'application/pdf', fileName: 'file.pdf',
        } as never);
        await expect(HrEmployeeDocumentService.download(4, 7, 31, 3, undefined, memoryStorage(Buffer.from('%PDF-bad'))))
            .rejects.toBeInstanceOf(HrDocumentStorageUnavailableError);
    });

    it('retries physical purge for an already expired document after a prior storage failure', async () => {
        jest.spyOn(prisma.employeeDocument, 'findMany').mockResolvedValue([{
            id: 31, companyId: 4, employeeId: 7, uploadedById: 3, documentType: 'CONTRATO', fileName: 'file.pdf',
            storageKey: '4/7/file.pdf', contentHash: 'a'.repeat(64), mimeType: 'application/pdf', sizeBytes: 10,
            expiresAt: new Date('2026-01-01T00:00:00.000Z'), status: 'EXPIRED', createdAt: new Date(), updatedAt: new Date(),
        }] as never);
        const update = jest.spyOn(prisma.employeeDocument, 'updateMany');
        jest.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 1 } as never);
        const storage = memoryStorage(Buffer.from('%PDF-old'));

        const result = await HrEmployeeDocumentService.runRetentionMaintenance(4, 3, storage, new Date('2026-07-14T00:00:00.000Z'));

        expect(result).toEqual(expect.objectContaining({ examined: 1, newlyExpired: 0, purged: 1, failures: [] }));
        expect(storage.deleted).toEqual(['4/7/file.pdf']);
        expect(update).not.toHaveBeenCalled();
    });

    it('serializes and closes the previous compensation before appending the next version', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(employee() as never);
        const findFirst = jest.fn()
            .mockResolvedValueOnce(null as never)
            .mockResolvedValueOnce({ id: 15, effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: null } as never);
        const updateMany = jest.fn().mockResolvedValue({ count: 1 } as never);
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: 16, ...args.data, createdAt: new Date(), changedBy: { id: 3, name: 'Owner', username: 'owner' } }));
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 7, status: 'ACTIVE' }] as never),
            employmentContract: { findFirst: jest.fn() },
            compensationHistory: { findFirst, updateMany, create },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        await HrCompensationService.append(4, 7, 3, {
            compensationType: 'SALARY', payFrequency: 'FORTNIGHTLY', amount: '25000.00', currency: 'NIO',
            effectiveFrom: '2026-01-01', reason: 'Ajuste anual aprobado',
        });

        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { effectiveTo: new Date('2025-12-31T00:00:00.000Z') } }));
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: new Prisma.Decimal('25000.00'), payFrequency: 'FORTNIGHTLY', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }) }));
    });

    it('blocks activation when an active contract overlaps the draft period', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue(employee() as never);
        const contractFind = jest.fn()
            .mockResolvedValueOnce({ id: 21, companyId: 4, employeeId: 7, status: 'DRAFT', startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: null } as never)
            .mockResolvedValueOnce({ id: 20 } as never);
        const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: 7, status: 'ACTIVE' }] as never), employmentContract: { findFirst: contractFind } };
        jest.spyOn(prisma, '$transaction').mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);

        await expect(HrEmploymentContractService.transition(4, 7, 21, 3, 'ACTIVATE', {
            signedAt: '2026-01-01T12:00:00.000Z', reason: 'Contrato firmado',
        })).rejects.toMatchObject({ statusCode: 409 });
    });
});
