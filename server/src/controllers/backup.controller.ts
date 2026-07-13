import { Request, Response, NextFunction } from 'express';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getErrorMessage } from '../utils/error';
import { getBackupsDir } from '../utils/storage';

export class BackupController {

    private static getRequiredEnv(name: string): string {
        const value = process.env[name];
        if (value && value.trim()) {
            return value.trim();
        }
        throw new Error(`Missing required environment variable: ${name}`);
    }

    private static getDatabaseConfig() {
        const databaseUrl = process.env.DATABASE_URL;
        if (databaseUrl) {
            const parsed = new URL(databaseUrl);
            if (parsed.protocol !== 'mysql:') {
                throw new Error('DATABASE_URL must use the mysql protocol for backups');
            }
            const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
            if (!parsed.hostname || !parsed.username || !database) {
                throw new Error('DATABASE_URL is incomplete for backups');
            }
            return {
                host: parsed.hostname,
                port: parsed.port || '3306',
                user: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password),
                database,
            };
        }

        return {
            host: BackupController.getRequiredEnv('DATABASE_HOST'),
            port: process.env.DATABASE_PORT || '3306',
            user: BackupController.getRequiredEnv('DATABASE_USER'),
            password: process.env.DATABASE_PASSWORD || '',
            database: BackupController.getRequiredEnv('DATABASE_NAME'),
        };
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
            const backupDir = getBackupsDir();
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `backup-${timestamp}.sql`;
            const filepath = path.join(backupDir, filename);

            const db = BackupController.getDatabaseConfig();
            const mysqldumpPath = process.env.MYSQLDUMP_PATH ||
                (process.platform === 'win32' ? 'C:\\xampp\\mysql\\bin\\mysqldump.exe' : 'mysqldump');

            // MySQL dump command using execFile (safe from command injection)
            const args = [
                '-u', db.user,
                '-h', db.host,
                '-P', db.port,
                '--single-transaction',
                '--routines',
                '--triggers',
                '--result-file', filepath,
                db.database
            ];

            execFile(
                mysqldumpPath,
                args,
                { env: { ...process.env, ...(db.password ? { MYSQL_PWD: db.password } : {}) } },
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
            const backupDir = getBackupsDir();
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

            const filepath = path.join(getBackupsDir(), sanitized);

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

            const filepath = path.join(getBackupsDir(), sanitized);

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
