import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getErrorMessage } from '../utils/error';
import prisma from '../utils/prisma';
import { getUploadsDir } from '../utils/storage';

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
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: fileFilter
});

export class UploadController {
    static async uploadLogo(req: Request, res: Response, next: NextFunction) {
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
            if (!isJpeg && !isPng && !isWebp) {
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ success: false, message: 'El contenido del archivo no es una imagen vÃ¡lida' });
            }

            const fileUrl = `/uploads/${req.file.filename}`;
            await prisma.company.update({
                where: { id: req.user!.companyId },
                data: { logo: fileUrl }
            });

            res.json({
                success: true,
                data: {
                    url: fileUrl,
                    filename: req.file.filename,
                    size: req.file.size
                }
            });
        } catch (error: unknown) {
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

            const filePath = path.join(getUploadsDir(), sanitized);
            const expectedUrl = `/uploads/${sanitized}`;
            const company = await prisma.company.findFirst({
                where: { id: req.user!.companyId, logo: expectedUrl },
                select: { id: true }
            });
            if (!company) {
                return res.status(403).json({ success: false, message: 'El archivo no pertenece a esta empresa' });
            }

            if (fs.existsSync(filePath)) {
                await prisma.company.update({ where: { id: company.id }, data: { logo: null } });
                fs.unlinkSync(filePath);
                res.json({
                    success: true,
                    message: 'Archivo eliminado exitosamente'
                });
            } else {
                res.status(404).json({
                    success: false,
                    message: 'Archivo no encontrado'
                });
            }
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
