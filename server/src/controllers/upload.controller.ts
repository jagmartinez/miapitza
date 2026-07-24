import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getErrorMessage } from '../utils/error';
import prisma from '../utils/prisma';
import { getUploadsDir } from '../utils/storage';
import { fileCleanupService } from '../services/file-cleanup.service';

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = getUploadsDir();
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = 'logo-' + uniqueSuffix + path.extname(file.originalname).toLowerCase();
        const companyId = req.user?.companyId;
        if (!companyId) return cb(Object.assign(new Error('No autenticado'), { statusCode: 401 }), '');
        fileCleanupService.reserveUpload(companyId, 'LOGO', filename)
            .then(() => cb(null, filename))
            .catch((error: Error) => cb(error, ''));
    }
});

const ALLOWED_EXTENSIONS = ['.jpeg', '.jpg', '.png', '.webp'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function sanitizeLogoFilename(filename: string): string | null {
    const sanitized = path.basename(filename);
    const extension = path.extname(sanitized).toLowerCase();
    if (sanitized !== filename) {
        return null;
    }
    if (!/^logo-\d+-\d+\.(jpeg|jpg|png|webp)$/i.test(sanitized)) {
        return null;
    }
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return null;
    }
    return sanitized;
}

function logoStorageKey(fileUrl: string | null | undefined): string | null {
    if (!fileUrl?.startsWith('/uploads/')) return null;
    const filename = sanitizeLogoFilename(path.basename(fileUrl));
    return filename;
}

async function dispatchLogoCleanup(companyId: number, storageKey: string, context: string): Promise<boolean> {
    try {
        return await fileCleanupService.processByStorageKey(companyId, 'LOGO', storageKey);
    } catch (error) {
        console.error('[CompanyLogo] Immediate cleanup dispatch failed; outbox retained', {
            companyId,
            context,
            errorType: error instanceof Error ? error.name : typeof error,
        });
        return false;
    }
}

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const extname = ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase());
    const mimetype = ALLOWED_MIME_TYPES.includes(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Solo se permiten archivos de imagen'));
    }
};

export const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, parts: 2 },
    fileFilter: fileFilter
});

export class UploadController {
    static async uploadLogo(req: Request, res: Response, next: NextFunction) {
        let logoPersisted = false;
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No se subió ningún archivo'
                });
            }

            const header = Buffer.alloc(12);
            const descriptor = fs.openSync(req.file.path, 'r');
            try {
                fs.readSync(descriptor, header, 0, header.length, 0);
            } finally {
                fs.closeSync(descriptor);
            }
            const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
            const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
            const isWebp = header.subarray(0, 4).toString('ascii') === 'RIFF'
                && header.subarray(8, 12).toString('ascii') === 'WEBP';
            const detectedMime = isJpeg
                ? 'image/jpeg'
                : isPng
                    ? 'image/png'
                    : isWebp
                        ? 'image/webp'
                        : null;
            if (!detectedMime || detectedMime !== req.file.mimetype) {
                await fileCleanupService.requestDeletion(
                    prisma,
                    req.user!.companyId,
                    'LOGO',
                    req.file.filename,
                    'UPLOAD_VALIDATION_FAILED',
                );
                await dispatchLogoCleanup(
                    req.user!.companyId,
                    req.file.filename,
                    'upload-validation-failed',
                );
                return res.status(400).json({ success: false, message: 'El contenido del archivo no es una imagen válida' });
            }

            const fileUrl = `/uploads/${req.file.filename}`;
            let previousLogoKey: string | null = null;
            await prisma.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${req.user!.companyId} FOR UPDATE`;
                const current = await tx.company.findUnique({
                    where: { id: req.user!.companyId },
                    select: { logo: true },
                });
                if (!current) throw new Error('Empresa no encontrada');
                await tx.company.update({
                    where: { id: req.user!.companyId },
                    data: { logo: fileUrl },
                });
                await fileCleanupService.cancelReservation(
                    tx,
                    req.user!.companyId,
                    'LOGO',
                    req.file!.filename,
                );
                previousLogoKey = logoStorageKey(current.logo);
                if (previousLogoKey && previousLogoKey !== req.file!.filename) {
                    await fileCleanupService.requestDeletion(
                        tx,
                        req.user!.companyId,
                        'LOGO',
                        previousLogoKey,
                        'COMPANY_LOGO_REPLACED',
                    );
                }
            });
            logoPersisted = true;
            if (previousLogoKey) {
                await dispatchLogoCleanup(
                    req.user!.companyId,
                    previousLogoKey,
                    'upload-replaced',
                );
            }

            res.json({
                success: true,
                data: {
                    url: fileUrl,
                    filename: req.file.filename,
                    size: req.file.size
                }
            });
        } catch (error: unknown) {
            if (req.file && !logoPersisted) {
                await fileCleanupService.requestDeletion(
                    prisma,
                    req.user!.companyId,
                    'LOGO',
                    req.file.filename,
                    'UPLOAD_PERSISTENCE_FAILED',
                ).then(() => dispatchLogoCleanup(
                    req.user!.companyId,
                    req.file!.filename,
                    'upload-persistence-failed',
                )).catch((cleanupError) => {
                    console.error('[CompanyLogo] Failed to dispatch durable cleanup', {
                        companyId: req.user!.companyId,
                        errorType: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
                    });
                });
            }
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async deleteLogo(req: Request, res: Response, next: NextFunction) {
        try {
            const { filename } = req.params;
            const sanitized = sanitizeLogoFilename(filename);
            if (!sanitized) {
                return res.status(400).json({
                    success: false,
                    message: 'Nombre de archivo inválido'
                });
            }

            const expectedUrl = `/uploads/${sanitized}`;
            await prisma.$transaction(async (tx) => {
                await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${req.user!.companyId} FOR UPDATE`;
                const company = await tx.company.findFirst({
                    where: { id: req.user!.companyId, logo: expectedUrl },
                    select: { id: true },
                });
                if (!company) {
                    throw Object.assign(
                        new Error('El archivo no pertenece a esta empresa'),
                        { statusCode: 403 },
                    );
                }
                await tx.company.update({ where: { id: company.id }, data: { logo: null } });
                await fileCleanupService.requestDeletion(
                    tx,
                    req.user!.companyId,
                    'LOGO',
                    sanitized,
                    'COMPANY_LOGO_DELETED',
                );
            });
            await dispatchLogoCleanup(req.user!.companyId, sanitized, 'delete');
            res.json({
                success: true,
                message: 'Archivo eliminado exitosamente',
            });
        } catch (error: unknown) {
            next({
                statusCode: error && typeof error === 'object' && 'statusCode' in error
                    ? Number(error.statusCode)
                    : 500,
                message: getErrorMessage(error),
            });
        }
    }
}
