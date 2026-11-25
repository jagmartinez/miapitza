import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone } from '../utils/timezone';
import { SETTINGS_REGISTRY, type SettingDef } from '../constants/settings-registry';
import { SettingService } from './setting.service';

export interface ResolvedSetting {
    key: string;
    value: string;
    source: 'company' | 'branch' | 'default';
    companyValue: string;
}

export class SettingValidationError extends Error {
    statusCode = 400;
    constructor(public errors: Record<string, string>) {
        super('Hay valores inválidos en la configuración');
        this.name = 'SettingValidationError';
    }
}

export class SettingConflictError extends Error {
    statusCode = 409;
    constructor(message = 'La configuración cambió mientras la editaba. Recargue e intente de nuevo.') {
        super(message);
        this.name = 'SettingConflictError';
    }
}

type Reader = Pick<Prisma.TransactionClient, 'setting' | 'branchSettingOverride' | 'company'>;

const DEF_BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTINGS_REGISTRY.map((d) => [d.key, d]));
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const PLAIN_INTEGER = /^-?\d+$/;

/** Returns the normalized text to persist, or throws a message for the key. */
function normalizeValue(def: SettingDef, raw: unknown): string {
    if (raw === null || raw === undefined) throw new Error('El valor es obligatorio');
    switch (def.type) {
        case 'number':
        case 'integer': {
            const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
            if (!text) throw new Error('El valor es obligatorio');
            const pattern = def.type === 'integer' ? PLAIN_INTEGER : PLAIN_NUMBER;
            if (!pattern.test(text)) {
                throw new Error(def.type === 'integer'
                    ? 'Debe ser un número entero sin separadores'
                    : 'Debe ser un número con punto decimal y sin separador de miles');
            }
            const n = Number(text);
            if (!Number.isFinite(n)) throw new Error('Número inválido');
            if (def.min !== undefined && n < def.min) throw new Error(`Debe ser mayor o igual a ${def.min}`);
            if (def.max !== undefined && n > def.max) throw new Error(`Debe ser menor o igual a ${def.max}`);
            return def.type === 'integer' ? String(Math.trunc(n)) : n.toFixed(2);
        }
        case 'boolean': {
            if (raw === true || raw === 'true') return 'true';
            if (raw === false || raw === 'false') return 'false';
            throw new Error('Debe ser verdadero o falso');
        }
        case 'enum': {
            const text = String(raw);
            if (!def.options?.some((o) => o.value === text)) throw new Error('Opción no permitida');
            return text;
        }
        default: {
            if (typeof raw !== 'string') throw new Error('Debe ser texto');
            const text = raw.trim();
            if (def.min !== undefined && text.length < def.min) throw new Error('El valor es obligatorio');
            if (def.max !== undefined && text.length > def.max) throw new Error(`Máximo ${def.max} caracteres`);
            if (def.key === 'timezone' && !isValidTimeZone(text)) throw new Error('La zona horaria no es válida');
            return text;
        }
    }
}

/** Lenient normalization for stored values (so '550' and '550.00' compare equal). */
function comparable(def: SettingDef, stored: string): string {
    try { return normalizeValue(def, stored); } catch { return stored; }
}

async function loadRows(reader: Reader, companyId: number, branchId: number | null) {
    const prefix = `${companyId}_`;
    const [settingRows, overrideRows, companyRow] = await Promise.all([
        reader.setting.findMany({ where: { companyId, name: { startsWith: prefix } } }),
        branchId
            ? reader.branchSettingOverride.findMany({ where: { companyId, branchId } })
            : Promise.resolve([] as { id: number; name: string; value: string; updatedAt: Date }[]),
        reader.company.findUnique({ where: { id: companyId }, select: { ruc: true } })
    ]);
    const company = new Map<string, string>();
    for (const r of settingRows) company.set(r.name.substring(prefix.length), r.value);
    // Single source of truth for the tax id is Company.ruc (same rule as SettingService.getAll).
    if (companyRow?.ruc) company.set('ruc', companyRow.ruc);
    const overrides = new Map<string, string>();
    for (const r of overrideRows) overrides.set(r.name, r.value);

    const hash = createHash('sha1');
    for (const r of [...settingRows].sort((a, b) => a.name.localeCompare(b.name))) {
        hash.update(`s|${r.name}|${r.updatedAt.toISOString()}\n`);
    }
    for (const r of [...overrideRows].sort((a, b) => a.name.localeCompare(b.name))) {
        hash.update(`o|${r.name}|${r.updatedAt.toISOString()}\n`);
    }
    hash.update(`c|ruc|${companyRow?.ruc ?? ''}
`);
    return { company, overrides, version: hash.digest('hex') };
}

function buildResolved(company: Map<string, string>, overrides: Map<string, string>, branchId: number | null) {
    const out: Record<string, ResolvedSetting> = {};
    for (const def of SETTINGS_REGISTRY) {
        const companyRaw = company.get(def.key);
        const companyValue = companyRaw ?? def.default;
        const override = branchId && def.branchable ? overrides.get(def.key) : undefined;
        if (override !== undefined) {
            out[def.key] = { key: def.key, value: override, source: 'branch', companyValue };
        } else {
            out[def.key] = { key: def.key, value: companyValue, source: companyRaw !== undefined ? 'company' : 'default', companyValue };
        }
    }
    return out;
}

export class SettingsScopeService {
    static async resolveWithVersion(companyId: number, branchId: number | null) {
        const rows = await loadRows(prisma, companyId, branchId);
        return { values: buildResolved(rows.company, rows.overrides, branchId), version: rows.version };
    }

    static async resolve(companyId: number, branchId: number | null): Promise<Record<string, ResolvedSetting>> {
        return (await this.resolveWithVersion(companyId, branchId)).values;
    }

    static async getNumber(companyId: number, branchId: number | null, key: string): Promise<number> {
        const def = DEF_BY_KEY.get(key);
        if (!def) throw new Error(`Parámetro desconocido: ${key}`);
        const resolved = (await this.resolve(companyId, branchId))[key];
        const n = Number(resolved.value);
        return Number.isFinite(n) ? n : Number(def.default);
    }

    static async update(
        companyId: number,
        branchId: number | null,
        userId: number,
        changes: Record<string, string | number | boolean>,
        expectedVersion?: string
    ): Promise<{ resolved: Record<string, ResolvedSetting>; version: string }> {
        const errors: Record<string, string> = {};
        const normalized = new Map<string, { def: SettingDef; value: string }>();
        for (const [key, raw] of Object.entries(changes ?? {})) {
            const def = DEF_BY_KEY.get(key);
            if (!def) { errors[key] = 'Parámetro desconocido'; continue; }
            if (def.readOnly) { errors[key] = 'Este parámetro es de solo lectura'; continue; }
            if (branchId && !def.branchable) { errors[key] = 'Este parámetro no se puede personalizar por sucursal'; continue; }
            try {
                normalized.set(key, { def, value: normalizeValue(def, raw) });
            } catch (e) {
                errors[key] = e instanceof Error ? e.message : 'Valor inválido';
            }
        }
        if (Object.keys(errors).length > 0) throw new SettingValidationError(errors);

        await prisma.$transaction(async (tx) => {
            // Serialize concurrent saves of the same company so the version check is reliable.
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${companyId} FOR UPDATE`;
            const rows = await loadRows(tx, companyId, branchId);
            if (expectedVersion !== undefined && expectedVersion !== rows.version) throw new SettingConflictError();

            if (branchId === null && (normalized.has('kds_warning_minutes') || normalized.has('kds_urgent_minutes'))) {
                const effective = (key: string) => {
                    const def = DEF_BY_KEY.get(key)!;
                    return Number(normalized.get(key)?.value ?? rows.company.get(key) ?? def.default);
                };
                if (effective('kds_warning_minutes') >= effective('kds_urgent_minutes')) {
                    throw new SettingValidationError({
                        kds_warning_minutes: 'El aviso debe ser menor que el tiempo urgente'
                    });
                }
            }

            for (const [key, { def, value }] of normalized) {
                const currentCompany = rows.company.get(key) ?? def.default;
                if (branchId === null) {
                    // Unchanged: nothing to persist or audit. With no stored row we always persist,
                    // so an explicit choice is never a silent no-op.
                    if (rows.company.has(key) && comparable(def, currentCompany) === value) continue;
                    await tx.setting.upsert({
                        where: { companyId_name: { companyId, name: `${companyId}_${key}` } },
                        update: { value },
                        create: { companyId, name: `${companyId}_${key}`, value }
                    });
                    if (key === 'ruc') {
                        await tx.company.update({ where: { id: companyId }, data: { ruc: value || null } });
                    }
                    await tx.settingAudit.create({
                        data: { companyId, branchId: null, name: key, oldValue: currentCompany, newValue: value, userId }
                    });
                    continue;
                }

                const existing = rows.overrides.get(key);
                const sameAsCompany = comparable(def, currentCompany) === value;
                if (sameAsCompany) {
                    if (existing === undefined) continue;
                    await tx.branchSettingOverride.deleteMany({ where: { branchId, name: key } });
                    await tx.settingAudit.create({
                        data: { companyId, branchId, name: key, oldValue: existing, newValue: value, userId }
                    });
                    continue;
                }
                if (existing !== undefined && comparable(def, existing) === value) continue;
                await tx.branchSettingOverride.upsert({
                    where: { branchId_name: { branchId, name: key } },
                    update: { value, updatedById: userId },
                    create: { companyId, branchId, name: key, value, updatedById: userId }
                });
                await tx.settingAudit.create({
                    data: { companyId, branchId, name: key, oldValue: existing ?? currentCompany, newValue: value, userId }
                });
            }
        });

        if (branchId === null && normalized.has('timezone')) SettingService.clearTimezoneCache(companyId);

        const { values, version } = await this.resolveWithVersion(companyId, branchId);
        return { resolved: values, version };
    }

    static async history(companyId: number, opts: { section?: string; key?: string; limit?: number; branchIds?: number[] } = {}) {
        const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 200);
        let names: string[] | undefined;
        if (opts.key) names = [opts.key];
        else if (opts.section) names = SETTINGS_REGISTRY.filter((d) => d.section === opts.section).map((d) => d.key);

        const rows = await prisma.settingAudit.findMany({
            where: {
                companyId,
                ...(names ? { name: { in: names } } : {}),
                ...(opts.branchIds ? { OR: [{ branchId: null }, { branchId: { in: opts.branchIds } }] } : {})
            },
            orderBy: { createdAt: 'desc' },
            take: limit
        });
        const userIds = [...new Set(rows.map((r) => r.userId))];
        const users = userIds.length
            ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
            : [];
        const nameById = new Map(users.map((u) => [u.id, u.name]));
        return rows.map((r) => ({
            name: r.name,
            branchId: r.branchId,
            oldValue: r.oldValue,
            newValue: r.newValue,
            userName: nameById.get(r.userId) ?? 'Usuario eliminado',
            createdAt: r.createdAt
        }));
    }
}
