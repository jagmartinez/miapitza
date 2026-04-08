import { Request, Response, NextFunction } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getErrorMessage } from '../utils/error';

export class BackupController {

    private static getRequiredEnv(name: string): string {
        const value = process.env[name];
        if (value && value.trim()) {
            return value.trim();
        }
        throw new Error(`Missing required environment variable: ${name}`);
    }

    /**
     * Validates that a filename is safe (no path traversal).
     * Returns the sanitized basename or null if invalid.
     */
    private static sanitizeFilename(filename: string): string | null {
        const sanitized = path.basename(filename);
        // Only allow .sql files with safe characters
        if (sanitized !== filename || !/^backup-[\w-]+\.sql$/.test(sanitized)) {
            return null;
        }
        return sanitized;
    }

    static async createBackup(req: Request, res: Response, next: NextFunction) {
        try {
            const backupDir = path.join(__dirname, '../../backups');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `backup-${timestamp}.sql`;
            const filepath = path.join(backupDir, filename);

            const isProduction = process.env.NODE_ENV === 'production';
            const dbName = isProduction
                ? BackupController.getRequiredEnv('DATABASE_NAME')
                : (process.env.DATABASE_NAME || 'restaurante');
            const dbUser = isProduction
                ? BackupController.getRequiredEnv('DATABASE_USER')
                : (process.env.DATABASE_USER || 'root');
            const dbPassword = process.env.DATABASE_PASSWORD || '';
            const dbHost = isProduction
                ? BackupController.getRequiredEnv('DATABASE_HOST')
                : (process.env.DATABASE_HOST || '127.0.0.1');
            const mysqldumpPath = isProduction
                ? BackupController.getRequiredEnv('MYSQLDUMP_PATH')
                : (process.env.MYSQLDUMP_PATH || 'C:\\xampp\\mysql\\bin\\mysqldump.exe');

            // MySQL dump command using execFile (safe from command injection)
            const args = [
                '-u', dbUser,
                '-h', dbHost,
                '--result-file', filepath,
                dbName
            ];

            execFile(
                mysqldumpPath,
                args,
                { env: { ...process.env, ...(dbPassword ? { MYSQL_PWD: dbPassword } : {}) } },
                (error) => {
                if (error) {
                    console.error('Backup error:', error.message);
                    return res.status(500).json({
                        success: false,
                        message: 'Error al crear respaldo'
                    });
                }

                res.json({
                    success: true,
                    data: {
                        filename: filename,
                        size: fs.statSync(filepath).size,
                        createdAt: new Date()
                    }
                });
                }
            );
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async listBackups(req: Request, res: Response, next: NextFunction) {
        try {
            const backupDir = path.join(__dirname, '../../backups');
            if (!fs.existsSync(backupDir)) {
                return res.json({
                    success: true,
                    data: []
                });
            }

            const files = fs.readdirSync(backupDir)
                .filter(file => file.endsWith('.sql'))
                .map(file => {
                    const filepath = path.join(backupDir, file);
                    const stats = fs.statSync(filepath);
                    return {
                        filename: file,
                        size: stats.size,
                        createdAt: stats.mtime
                    };
                })
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

            res.json({
                success: true,
                data: files
            });
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async downloadBackup(req: Request, res: Response, next: NextFunction) {
        try {
            const { filename } = req.params;
            const sanitized = BackupController.sanitizeFilename(filename);
            if (!sanitized) {
                return res.status(400).json({ success: false, message: 'Nombre de archivo inválido' });
            }

            const filepath = path.join(__dirname, '../../backups', sanitized);

            if (!fs.existsSync(filepath)) {
                return res.status(404).json({
                    success: false,
                    message: 'Archivo de respaldo no encontrado'
                });
            }

            res.download(filepath, sanitized);
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }

    static async deleteBackup(req: Request, res: Response, next: NextFunction) {
        try {
            const { filename } = req.params;
            const sanitized = BackupController.sanitizeFilename(filename);
            if (!sanitized) {
                return res.status(400).json({ success: false, message: 'Nombre de archivo inválido' });
            }

            const filepath = path.join(__dirname, '../../backups', sanitized);

            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
                res.json({
                    success: true,
                    message: 'Respaldo eliminado exitosamente'
                });
            } else {
                res.status(404).json({
                    success: false,
                    message: 'Archivo de respaldo no encontrado'
                });
            }
        } catch (error: unknown) {
            next({ statusCode: 500, message: getErrorMessage(error) });
        }
    }
}
