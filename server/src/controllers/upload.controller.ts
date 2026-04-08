import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getErrorMessage } from '../utils/error';

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads');
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

            const fileUrl = `/uploads/${req.file.filename}`;

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

            const filePath = path.join(__dirname, '../../uploads', sanitized);

            if (fs.existsSync(filePath)) {
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
