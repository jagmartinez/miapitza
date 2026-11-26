import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import { PurchaseOrderController } from '../../controllers/purchase-order.controller';
import { PurchaseOrderService } from '../../services/purchase-order.service';
import {
    invoiceExtension,
    isExcelFileContent,
    validateInvoiceUpload,
} from '../../middlewares/upload-security';
import { fileCleanupService } from '../../services/file-cleanup.service';

const originalStorageDir = process.env.STORAGE_DIR;
let temporaryStorage: string | undefined;

function createStorage(): string {
    temporaryStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-upload-security-'));
    process.env.STORAGE_DIR = temporaryStorage;
    const directory = path.join(temporaryStorage, 'uploads', 'invoices');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

function response(): Response {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        download: jest.fn(),
    } as unknown as Response;
}

const adminUser = {
    userId: 7,
    companyId: 3,
    branchId: 4,
    role: 'ADMIN',
    roles: ['ADMIN'],
    timezone: 'America/Managua',
    permissions: [],
};

afterEach(() => {
    jest.restoreAllMocks();
    process.env.STORAGE_DIR = originalStorageDir;
    if (temporaryStorage) fs.rmSync(temporaryStorage, { recursive: true, force: true });
    temporaryStorage = undefined;
});

describe('upload type verification', () => {
    it('requires a matching invoice extension and exact MIME type', () => {
        expect(invoiceExtension({ originalname: 'invoice.pdf', mimetype: 'application/pdf' })).toBe('.pdf');
        expect(invoiceExtension({ originalname: 'invoice.svg', mimetype: 'image/svg+xml' })).toBeNull();
        expect(invoiceExtension({ originalname: 'invoice.png', mimetype: 'image/jpeg' })).toBeNull();
    });

    it('recognizes XLSX ZIP and legacy XLS OLE signatures', () => {
        expect(isExcelFileContent(Buffer.from([0x50, 0x4b, 0x03, 0x04]), '.xlsx')).toBe(true);
        expect(isExcelFileContent(
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
            '.xls',
        )).toBe(true);
        expect(isExcelFileContent(Buffer.from('<html>not excel</html>'), '.xlsx')).toBe(false);
    });

    it('durably dispatches deletion when magic bytes contradict the declared type', async () => {
        const directory = createStorage();
        const filePath = path.join(directory, 'invoice-1-1.pdf');
        fs.writeFileSync(filePath, '<script>alert(1)</script>');
        const next = jest.fn() as unknown as NextFunction;
        const req = {
            user: adminUser,
            file: {
                path: filePath,
                filename: 'invoice-1-1.pdf',
                mimetype: 'application/pdf',
            },
        } as unknown as Request;
        jest.spyOn(fileCleanupService, 'requestDeletion').mockResolvedValue();
        jest.spyOn(fileCleanupService, 'processByStorageKey').mockImplementation(async () => {
            fs.unlinkSync(filePath);
            return true;
        });

        await validateInvoiceUpload(req, response(), next);

        expect(fs.existsSync(filePath)).toBe(false);
        expect(fileCleanupService.requestDeletion).toHaveBeenCalledWith(
            expect.anything(),
            3,
            'INVOICE',
            'invoice-1-1.pdf',
            'UPLOAD_VALIDATION_FAILED',
        );
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
});

describe('purchase invoice lifecycle', () => {
    it('removes a newly uploaded invoice when order creation fails', async () => {
        const directory = createStorage();
        const filename = 'invoice-100-200.pdf';
        const filePath = path.join(directory, filename);
        fs.writeFileSync(filePath, '%PDF-1.7');
        jest.spyOn(PurchaseOrderService, 'create').mockRejectedValue(new Error('database failed'));
        const next = jest.fn() as unknown as NextFunction;

        await PurchaseOrderController.create({
            user: adminUser,
            body: { branchId: 4, supplierId: 2 },
            file: { filename, path: filePath },
        } as unknown as Request, response(), next);

        expect(fs.existsSync(filePath)).toBe(false);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('delegates replacement cleanup to the transactional purchase-order service', async () => {
        const directory = createStorage();
        const oldFilename = 'invoice-100-201.pdf';
        const newFilename = 'invoice-100-202.pdf';
        fs.writeFileSync(path.join(directory, oldFilename), '%PDF-1.7 old');
        fs.writeFileSync(path.join(directory, newFilename), '%PDF-1.7 new');
        jest.spyOn(PurchaseOrderService, 'getById').mockResolvedValue({
            id: 9,
            branchId: 4,
            invoicePdf: `/uploads/invoices/${oldFilename}`,
        } as never);
        jest.spyOn(PurchaseOrderService, 'update').mockResolvedValue({ id: 9 } as never);
        const next = jest.fn() as unknown as NextFunction;

        await PurchaseOrderController.update({
            params: { id: '9' },
            user: adminUser,
            body: {},
            file: { filename: newFilename, path: path.join(directory, newFilename) },
        } as unknown as Request, response(), next);

        expect(fs.existsSync(path.join(directory, oldFilename))).toBe(true);
        expect(fs.existsSync(path.join(directory, newFilename))).toBe(true);
        expect(PurchaseOrderService.update).toHaveBeenCalledWith(
            9,
            3,
            { invoicePdf: `/uploads/invoices/${newFilename}` },
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('does not accept a client-supplied invoice path without an uploaded file', async () => {
        jest.spyOn(PurchaseOrderService, 'getById').mockResolvedValue({
            id: 9,
            branchId: 4,
            invoicePdf: null,
        } as never);
        const update = jest.spyOn(PurchaseOrderService, 'update').mockResolvedValue({ id: 9 } as never);
        const next = jest.fn() as unknown as NextFunction;

        await PurchaseOrderController.update({
            params: { id: '9' },
            user: adminUser,
            body: { invoicePdf: '/uploads/invoices/invoice-1-1.pdf' },
        } as unknown as Request, response(), next);

        expect(update).toHaveBeenCalledWith(9, 3, {});
        expect(next).not.toHaveBeenCalled();
    });
});
