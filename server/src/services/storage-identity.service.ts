import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

import prisma from '../utils/prisma';
import { getRequiredStorageDirectories, getStorageRoot } from '../utils/storage';

const MARKER_FILE = '.restaurant-storage-identity-v1.json';
const MARKER_VERSION = 1;
const SHARED_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
export const STORAGE_IDENTITY_SINGLETON_KEY = 'PRIMARY';

interface StorageMarker {
    version: number;
    identityKey: string;
    nonce: string;
}

interface StorageIdentityRow {
    singletonKey: string;
    fingerprint: string;
}

export interface StorageReadiness {
    mode: 'local-development' | 'verified-shared';
    identityVerified: boolean;
    identityHash?: string;
}

export class StorageIdentityMismatchError extends Error {
    constructor(message = 'El volumen no coincide con la identidad de almacenamiento registrada') {
        super(message);
        this.name = 'StorageIdentityMismatchError';
    }
}

function configuredSharedId(env: NodeJS.ProcessEnv): string | null {
    const value = env.STORAGE_SHARED_ID?.trim();
    if (!value) return null;
    if (!SHARED_ID_PATTERN.test(value)) {
        throw new Error('STORAGE_SHARED_ID debe tener entre 8 y 128 caracteres alfanuméricos, punto, guion o guion bajo');
    }
    if (!env.STORAGE_DIR?.trim()) {
        throw new Error('STORAGE_DIR es obligatorio cuando STORAGE_SHARED_ID está configurado');
    }
    return value;
}

function markerFingerprint(marker: StorageMarker): string {
    return createHash('sha256')
        .update(`${marker.version}\n${marker.identityKey}\n${marker.nonce}`, 'utf8')
        .digest('hex');
}

function parseMarker(raw: string, expectedIdentityKey: string): StorageMarker {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new StorageIdentityMismatchError('El marcador del volumen no contiene JSON válido');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new StorageIdentityMismatchError('El marcador del volumen tiene un formato inválido');
    }
    const marker = value as Partial<StorageMarker>;
    if (
        marker.version !== MARKER_VERSION
        || marker.identityKey !== expectedIdentityKey
        || typeof marker.nonce !== 'string'
        || !/^[0-9a-f]{64}$/i.test(marker.nonce)
    ) {
        throw new StorageIdentityMismatchError('El marcador del volumen no coincide con STORAGE_SHARED_ID');
    }
    return marker as StorageMarker;
}

async function readMarkerWithShortRetry(markerPath: string, identityKey: string): Promise<StorageMarker> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            return parseMarker(await fs.readFile(markerPath, 'utf8'), identityKey);
        } catch (error) {
            lastError = error;
            if (attempt < 7) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
    }
    throw lastError;
}

async function loadOrCreateMarker(root: string, identityKey: string): Promise<StorageMarker> {
    const markerPath = path.join(root, MARKER_FILE);
    const marker: StorageMarker = {
        version: MARKER_VERSION,
        identityKey,
        nonce: randomBytes(32).toString('hex'),
    };
    try {
        await fs.writeFile(markerPath, `${JSON.stringify(marker)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        return marker;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        return readMarkerWithShortRetry(markerPath, identityKey);
    }
}

async function verifyReadWriteRoundTrip(root: string): Promise<void> {
    const probePath = path.join(root, '.readiness', `probe-${process.pid}-${randomUUID()}`);
    const payload = randomBytes(32);
    let operationError: unknown;
    try {
        const handle = await fs.open(probePath, 'wx', 0o600);
        try {
            await handle.writeFile(payload);
            await handle.sync();
        } finally {
            await handle.close();
        }
        const stored = await fs.readFile(probePath);
        if (!stored.equals(payload)) throw new Error('La verificación de lectura devolvió datos distintos');
    } catch (error) {
        operationError = error;
    }

    let cleanupError: unknown;
    try {
        await fs.rm(probePath, { force: true });
    } catch (error) {
        cleanupError = error;
    }

    if (operationError && cleanupError) {
        const combined = new Error('Fallaron la verificación de almacenamiento y la eliminación de su archivo temporal');
        Object.assign(combined, { errors: [operationError, cleanupError] });
        throw combined;
    }
    if (operationError) throw operationError;
    if (cleanupError) throw cleanupError;
}

async function ensureStorageDirectories(root: string): Promise<void> {
    for (const directory of getRequiredStorageDirectories(root)) {
        await fs.mkdir(directory, { recursive: true });
        await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK);
    }
}

function isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

async function registerOrVerifyDatabaseIdentity(
    db: PrismaClient,
    fingerprint: string,
): Promise<StorageIdentityRow> {
    let registered = await db.storageIdentity.findUnique({
        where: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY },
        select: { singletonKey: true, fingerprint: true },
    });
    if (!registered) {
        try {
            registered = await db.storageIdentity.create({
                data: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY, fingerprint },
                select: { singletonKey: true, fingerprint: true },
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
            registered = await db.storageIdentity.findUnique({
                where: { singletonKey: STORAGE_IDENTITY_SINGLETON_KEY },
                select: { singletonKey: true, fingerprint: true },
            });
        }
    }
    if (!registered || registered.fingerprint !== fingerprint) {
        throw new StorageIdentityMismatchError();
    }
    return registered;
}

/**
 * Verifies real read/write durability. In shared mode it also binds one
 * configured deployment identity to one volume marker through MySQL, so two
 * replicas using isolated disks cannot both become ready.
 */
export async function checkStorageReadiness(
    db: PrismaClient = prisma,
    env: NodeJS.ProcessEnv = process.env,
): Promise<StorageReadiness> {
    const root = path.resolve(env.STORAGE_DIR?.trim() || getStorageRoot());
    await ensureStorageDirectories(root);
    await verifyReadWriteRoundTrip(root);

    const identityKey = configuredSharedId(env);
    if (!identityKey) {
        if (env.NODE_ENV === 'production') {
            throw new Error('STORAGE_SHARED_ID es obligatorio en producción');
        }
        return { mode: 'local-development', identityVerified: false };
    }

    const marker = await loadOrCreateMarker(root, identityKey);
    const fingerprint = markerFingerprint(marker);
    await registerOrVerifyDatabaseIdentity(db, fingerprint);
    return {
        mode: 'verified-shared',
        identityVerified: true,
        identityHash: fingerprint.slice(0, 12),
    };
}

export const initializeStorageIdentity = checkStorageReadiness;
