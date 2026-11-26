import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
export const NUMBER_FORMATS = ['es-NI', 'en-US'] as const;
export const NOTIFICATION_EVENTS = ['approvals', 'lowStock', 'cashShift', 'reservations', 'payroll'] as const;
export const NOTIFICATION_CHANNELS = ['app', 'email'] as const;

export interface UserPreferences {
    density: (typeof DENSITIES)[number];
    rowsPerPage: (typeof ROWS_PER_PAGE_OPTIONS)[number];
    homePage: string | null;
    defaultBranchId: number | null;
    numberFormat: (typeof NUMBER_FORMATS)[number];
    notifications: Record<string, Record<string, boolean>>;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
    density: 'comfortable',
    rowsPerPage: 25,
    homePage: null,
    defaultBranchId: null,
    numberFormat: 'es-NI',
    notifications: {},
};

export class PreferencesValidationError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida un parche parcial; lanza si algún campo presente es inválido (nunca guarda a medias). */
export function parsePreferencesPatch(input: unknown): Partial<UserPreferences> {
    if (!isRecord(input)) throw new PreferencesValidationError('Preferencias inválidas');
    const out: Partial<UserPreferences> = {};
    if ('density' in input) {
        if (!(DENSITIES as readonly unknown[]).includes(input.density)) throw new PreferencesValidationError('Densidad inválida');
        out.density = input.density as UserPreferences['density'];
    }
    if ('rowsPerPage' in input) {
        if (!(ROWS_PER_PAGE_OPTIONS as readonly unknown[]).includes(input.rowsPerPage)) {
            throw new PreferencesValidationError('Filas por página inválidas');
        }
        out.rowsPerPage = input.rowsPerPage as UserPreferences['rowsPerPage'];
    }
    if ('homePage' in input) {
        const v = input.homePage;
        if (v !== null && (typeof v !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(v) || v.startsWith('//'))) {
            throw new PreferencesValidationError('Página de inicio inválida');
        }
        out.homePage = v as string | null;
    }
    if ('defaultBranchId' in input) {
        const v = input.defaultBranchId;
        if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v <= 0)) {
            throw new PreferencesValidationError('Sucursal inválida');
        }
        out.defaultBranchId = v as number | null;
    }
    if ('numberFormat' in input) {
        if (!(NUMBER_FORMATS as readonly unknown[]).includes(input.numberFormat)) throw new PreferencesValidationError('Formato inválido');
        out.numberFormat = input.numberFormat as UserPreferences['numberFormat'];
    }
    if ('notifications' in input) {
        if (!isRecord(input.notifications)) throw new PreferencesValidationError('Notificaciones inválidas');
        const matrix: Record<string, Record<string, boolean>> = {};
        for (const [event, channels] of Object.entries(input.notifications)) {
            if (!(NOTIFICATION_EVENTS as readonly string[]).includes(event) || !isRecord(channels)) {
                throw new PreferencesValidationError('Notificaciones inválidas');
            }
            matrix[event] = {};
            for (const [channel, on] of Object.entries(channels)) {
                if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel) || typeof on !== 'boolean') {
                    throw new PreferencesValidationError('Notificaciones inválidas');
                }
                matrix[event][channel] = on;
            }
        }
        out.notifications = matrix;
    }
    return out;
}

/** Combina lo guardado con los valores por defecto, ignorando claves desconocidas o corruptas. */
export function resolvePreferences(stored: unknown): UserPreferences {
    try {
        return { ...DEFAULT_PREFERENCES, ...parsePreferencesPatch(isRecord(stored) ? stored : {}) };
    } catch {
        return { ...DEFAULT_PREFERENCES };
    }
}

export class UserPreferencesService {
    static async get(userId: number): Promise<UserPreferences> {
        const row = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
        return resolvePreferences(row?.preferences);
    }

    static async update(userId: number, patchInput: unknown): Promise<UserPreferences> {
        const patch = parsePreferencesPatch(patchInput);
        const current = await UserPreferencesService.get(userId);
        const merged: UserPreferences = {
            ...current,
            ...patch,
            notifications: patch.notifications
                ? Object.fromEntries(
                      Object.entries({ ...current.notifications, ...patch.notifications }).map(([event, channels]) => [
                          event,
                          { ...current.notifications[event], ...patch.notifications?.[event] },
                      ]),
                  )
                : current.notifications,
        };
        await prisma.user.update({
            where: { id: userId },
            data: { preferences: merged as unknown as Prisma.InputJsonValue },
            select: { id: true },
        });
        return merged;
    }
}
