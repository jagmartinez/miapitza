import { appEvents } from '../core/events';

export type StorageScope = 'cache' | 'queue' | 'drafts';

/** One typed error for every local-database failure (quota, blocked, corrupted, closed). */
export class StorageError extends Error {
    readonly scope: StorageScope;
    readonly op: string;
    readonly cause: unknown;
    constructor(scope: StorageScope, op: string, cause: unknown) {
        super(`Fallo de almacenamiento local (${scope}/${op})`);
        this.name = 'StorageError';
        this.scope = scope;
        this.op = op;
        this.cause = cause;
    }
}

/** Never silent: the UI subscribes to appEvents 'storage-error' (payload: { scope, op, error }). */
export function reportStorage(error: StorageError): void {
    appEvents.emit('storage-error', { scope: error.scope, op: error.op, error });
}

export function toStorageError(scope: StorageScope, op: string, cause: unknown): StorageError {
    return cause instanceof StorageError ? cause : new StorageError(scope, op, cause);
}

/** Runs a database operation; any failure is reported and rethrown as StorageError. */
export async function guarded<T>(scope: StorageScope, op: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (cause) {
        const err = toStorageError(scope, op, cause);
        reportStorage(err);
        throw err;
    }
}
