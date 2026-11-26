import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { getUploadsDir } from '../utils/storage';
import prisma from '../utils/prisma';
import { fileCleanupService } from '../services/file-cleanup.service';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

const EXCEL_MIME_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
]);

const INVOICE_TYPES = new Map([
    ['.pdf', 'application/pdf'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
]);

function uploadError(message: string): Error & { statusCode: number } {
    return Object.assign(new Error(message), { statusCode: 400 });
}

export function isExcelFileContent(buffer: Buffer, extension: string): boolean {
    const normalizedExtension = extension.toLowerCase();
    if (normalizedExtension === '.xlsx') {
        return buffer.length >= 4
            && buffer[0] === 0x50
            && buffer[1] === 0x4b
            && [0x03, 0x05, 0x07].includes(buffer[2])
            && [0x04, 0x06, 0x08].includes(buffer[3]);
    }
    if (normalizedExtension === '.xls') {
        return buffer.subarray(0, 8).equals(
            Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        );
    }
    return false;
}

export function validateExcelUpload(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    if (!req.file) return next();
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!isExcelFileContent(req.file.buffer, extension)) {
        return next(uploadError('El contenido no corresponde a un archivo Excel válido'));
    }
    return next();
}

export const excelImportUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_IMPORT_BYTES,
        files: 1,
        fields: 2,
        parts: 3,
    },
    fileFilter: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        if (!['.xlsx', '.xls'].includes(extension) || !EXCEL_MIME_TYPES.has(file.mimetype)) {
            return callback(uploadError('Solo se permiten archivos Excel .xlsx o .xls'));
        }
        return callback(null, true);
    },
});

export function invoiceExtension(file: Pick<Express.Multer.File, 'originalname' | 'mimetype'>): string | null {
    const extension = path.extname(file.originalname).toLowerCase();
    const expectedMime = INVOICE_TYPES.get(extension);
    if (!expectedMime || expectedMime !== file.mimetype) return null;
    return extension === '.jpeg' ? '.jpg' : extension;
}

function invoiceContentType(header: Buffer): string | null {
    if (header.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }
    if (
        header.subarray(0, 4).toString('ascii') === 'RIFF'
        && header.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

const invoiceStorage = multer.diskStorage({
    destination: (_req, _file, callback) => {
        const directory = getUploadsDir('invoices');
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
    },
    filename: (req, file, callback) => {
        const extension = invoiceExtension(file);
        if (!extension) return callback(uploadError('Tipo de factura adjunta no permitido'), '');
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const filename = `invoice-${uniqueSuffix}${extension}`;
        const companyId = req.user?.companyId;
        if (!companyId) return callback(Object.assign(new Error('No autenticado'), { statusCode: 401 }), '');
        fileCleanupService.reserveUpload(companyId, 'INVOICE', filename)
            .then(() => callback(null, filename))
            .catch((error: Error) => callback(error, ''));
    },
});

export const invoiceUpload = multer({
    storage: invoiceStorage,
    limits: {
        fileSize: MAX_INVOICE_BYTES,
        files: 1,
        fields: 20,
        fieldSize: 1024 * 1024,
        parts: 21,
    },
    fileFilter: (_req, file, callback) => {
        if (!invoiceExtension(file)) {
            return callback(uploadError('Solo se permiten facturas PDF, JPEG, PNG o WebP'));
        }
        return callback(null, true);
    },
});

async function discardInvoiceUpload(req: Request): Promise<void> {
    if (!req.file || !req.user?.companyId) return;
    const filename = req.file.filename;
    await fileCleanupService.requestDeletion(
        prisma,
        req.user.companyId,
        'INVOICE',
        filename,
        'UPLOAD_VALIDATION_FAILED',
    );
    await fileCleanupService.processByStorageKey(req.user.companyId, 'INVOICE', filename);
}

export async function validateInvoiceUpload(
    req: Request,
    _res: Response,
    next: NextFunction,
) {
    if (!req.file) return next();
    try {
        const descriptor = fs.openSync(req.file.path, 'r');
        const header = Buffer.alloc(12);
        try {
            fs.readSync(descriptor, header, 0, header.length, 0);
        } finally {
            fs.closeSync(descriptor);
        }
        if (invoiceContentType(header) !== req.file.mimetype) {
            await discardInvoiceUpload(req);
            req.file = undefined;
            return next(uploadError('El contenido de la factura adjunta no coincide con su tipo'));
        }
        return next();
    } catch (error) {
        await discardInvoiceUpload(req).catch((cleanupError) => {
            console.error('[PurchaseOrderInvoice] Failed to enqueue rejected upload', {
                errorType: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
            });
        });
        req.file = undefined;
        return next(error);
    }
}
