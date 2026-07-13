import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { ensureStorageReady, getBackupsDir, getStorageRoot, getUploadsDir } from '../../utils/storage';

const originalStorageDir = process.env.STORAGE_DIR;

afterEach(() => {
    if (originalStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = originalStorageDir;
});

describe('durable storage paths', () => {
    it('defaults to process.cwd() for backwards-compatible local paths', () => {
        delete process.env.STORAGE_DIR;
        expect(getStorageRoot()).toBe(path.resolve(process.cwd()));
        expect(getUploadsDir('invoices')).toBe(path.join(process.cwd(), 'uploads', 'invoices'));
        expect(getBackupsDir()).toBe(path.join(process.cwd(), 'backups'));
    });

    it('creates the shared volume directory structure when STORAGE_DIR is configured', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurant-storage-'));
        process.env.STORAGE_DIR = root;
        try {
            ensureStorageReady();
            expect(fs.statSync(path.join(root, 'uploads')).isDirectory()).toBe(true);
            expect(fs.statSync(path.join(root, 'uploads', 'invoices')).isDirectory()).toBe(true);
            expect(fs.statSync(path.join(root, 'backups')).isDirectory()).toBe(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
