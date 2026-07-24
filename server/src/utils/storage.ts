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

export function getRequiredStorageDirectories(root: string = getStorageRoot()): string[] {
    return [
        path.join(root, 'uploads'),
        path.join(root, 'uploads', 'invoices'),
        path.join(root, 'uploads', 'hr-documents'),
        path.join(root, 'backups'),
        path.join(root, '.readiness'),
    ];
}

/** Fail startup before accepting traffic when the mounted durable volume is unusable. */
export function ensureStorageReady(root: string = getStorageRoot()): void {
    for (const directory of getRequiredStorageDirectories(root)) {
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    }
}
