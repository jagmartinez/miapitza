import path from 'path';
import fs from 'fs';

/**
 * Filesystem root for durable runtime data.
 *
 * Native/local execution remains backward compatible by defaulting to the
 * process working directory. Containers set STORAGE_DIR=/app/storage so a
 * single persistent volume can preserve uploads and backups across releases.
 */
export function getStorageRoot(): string {
    const configured = process.env.STORAGE_DIR?.trim();
    return path.resolve(configured || process.cwd());
}

export function getUploadsDir(...segments: string[]): string {
    return path.join(getStorageRoot(), 'uploads', ...segments);
}

export function getBackupsDir(...segments: string[]): string {
    return path.join(getStorageRoot(), 'backups', ...segments);
}

/** Fail startup before accepting traffic when the mounted durable volume is unusable. */
export function ensureStorageReady(): void {
    const directories = [getUploadsDir(), getUploadsDir('invoices'), getBackupsDir()];
    for (const directory of directories) {
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    }
}
