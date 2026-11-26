import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { FileCleanupService } from '../../services/file-cleanup.service';

describe('filesystem cleanup outbox integration', () => {
    const originalStorageDir = process.env.STORAGE_DIR;
    let storageRoot: string;
    let companyId: number;

    beforeAll(async () => {
        storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-cleanup-it-'));
        process.env.STORAGE_DIR = storageRoot;
        const company = await prisma.company.create({
            data: { name: `FILE_CLEANUP_IT_${Date.now()}` },
        });
        companyId = company.id;
    });

    afterAll(async () => {
        await prisma.fileCleanupTask.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
        process.env.STORAGE_DIR = originalStorageDir;
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    it('reconciles an orphan left after file write and process interruption', async () => {
        let now = new Date('2026-07-23T12:00:00.000Z');
        const service = new FileCleanupService(prisma, { now: () => now });
        const filename = 'logo-1712345678-123456701.png';
        const uploadDir = path.join(storageRoot, 'uploads');
        const filePath = path.join(uploadDir, filename);
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from('orphan'));

        await service.reserveUpload(companyId, 'LOGO', filename);
        now = new Date(now.getTime() + 2 * 60 * 60 * 1000);

        await expect(service.runDue()).resolves.toEqual({ examined: 1, completed: 1 });
        expect(fs.existsSync(filePath)).toBe(false);
        await expect(prisma.fileCleanupTask.findUniqueOrThrow({
            where: { companyId_area_storageKey: { companyId, area: 'LOGO', storageKey: filename } },
            select: { status: true },
        })).resolves.toEqual({ status: 'COMPLETED' });
    });

    it('rolls back the domain reference and cleanup intent together, then commits both', async () => {
        const service = new FileCleanupService();
        const filename = 'logo-1712345678-123456702.png';
        const filePath = path.join(storageRoot, 'uploads', filename);
        fs.writeFileSync(filePath, Buffer.from('active-logo'));
        const expectedUrl = `/uploads/${filename}`;
        await prisma.company.update({ where: { id: companyId }, data: { logo: expectedUrl } });

        await expect(prisma.$transaction(async (tx) => {
            await tx.company.update({ where: { id: companyId }, data: { logo: null } });
            await service.requestDeletion(tx, companyId, 'LOGO', filename, 'ROLLBACK_PROBE');
            throw new Error('force rollback');
        })).rejects.toThrow('force rollback');

        await expect(prisma.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { logo: true },
        })).resolves.toEqual({ logo: expectedUrl });
        await expect(prisma.fileCleanupTask.findUnique({
            where: { companyId_area_storageKey: { companyId, area: 'LOGO', storageKey: filename } },
        })).resolves.toBeNull();
        expect(fs.existsSync(filePath)).toBe(true);

        await prisma.$transaction(async (tx) => {
            await tx.company.update({ where: { id: companyId }, data: { logo: null } });
            await service.requestDeletion(tx, companyId, 'LOGO', filename, 'COMMIT_PROBE');
        });
        await expect(service.processByStorageKey(companyId, 'LOGO', filename)).resolves.toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
        await expect(prisma.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { logo: true },
        })).resolves.toEqual({ logo: null });
    });
});
