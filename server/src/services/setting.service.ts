import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone } from '../utils/timezone';

type SettingClient = Pick<Prisma.TransactionClient, 'setting'>;

export const DEFAULT_COMPANY_SETTINGS: Readonly<Record<string, string>> = Object.freeze({
    restaurant_name: 'Mi Restaurante',
    currency: 'NIO',
    currency_symbol: 'C$',
    currency_name: 'Córdoba Nicaragüense',
    tax_rate: '15',
    timezone: 'America/Managua',
    kds_warning_minutes: '3',
    kds_urgent_minutes: '10'
});

export function validateConfiguredFiscalTaxId(
    taxId: string,
    settings: Record<string, string>,
    label: string
): void {
    const length = Number(settings.fiscal_tax_id_length);
    const charset = settings.fiscal_tax_id_charset?.trim().toUpperCase();
    if (!Number.isInteger(length) || length < 1 || length > 50 || !['DIGITS', 'ALPHANUMERIC'].includes(charset || '')) {
        throw new Error('Configure longitud y tipo de identificación fiscal antes de usar RUC/NIT');
    }
    const normalized = taxId.trim();
    const validCharacters = charset === 'DIGITS'
        ? /^\d+$/.test(normalized)
        : /^[A-Za-z0-9-]+$/.test(normalized);
    if (normalized.length !== length || !validCharacters) {
        throw new Error(`${label} no cumple la configuración tributaria de la empresa`);
    }
}

export class SettingService {
    private static readonly TIMEZONE_CACHE_TTL_MS = 60_000;
    private static readonly timezoneCache = new Map<number, { value: string; expiresAt: number }>();

    static async getAll(companyId: number) {
        // Use prefix to simulate multi-tenancy on a global unique name field
        const prefix = `${companyId}_`;
        const settings = await prisma.setting.findMany({
            where: {
                companyId,
                name: {
                    startsWith: prefix
                }
            }
        });

        // Convert array to object and strip prefix
        const result = settings.reduce((acc, curr) => {
            const cleanName = curr.name.substring(prefix.length);
            acc[cleanName] = curr.value;
            return acc;
        }, {} as Record<string, string>);

        // Single source of truth for the tax id is Company.ruc; surface it under
        // both `ruc` and the legacy `nif` key so the UI always shows the unified value.
        const company = await prisma.company.findUnique({
            where: { id: companyId },
            select: { ruc: true }
        });
        if (company?.ruc) {
            result.ruc = company.ruc;
            result.nif = company.ruc;
        }

        return result;
    }

    private static validateSettingValue(name: string, value: string) {
        if (name === 'tax_rate' || name === 'taxRate') {
            const rate = parseFloat(value);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new Error('La tasa de impuesto debe ser un número entre 0 y 100');
            }
        }
        if (name === 'tipRate') {
            const rate = parseFloat(value);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new Error('La tasa de propina debe ser un número entre 0 y 100');
            }
        }
        if (name === 'session_timeout_minutes' || name === 'session_timeout' || name === 'timeout') {
            const timeout = parseInt(value, 10);
            if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1440) {
                throw new Error('El tiempo de espera debe ser un número positivo');
            }
        }
        if (name === 'cash_reconciliation_tolerance') {
            const tolerance = Number(value);
            if (!Number.isFinite(tolerance) || tolerance < 0) {
                throw new Error('La tolerancia de conciliación de caja debe ser un número mayor o igual a cero');
            }
        }
        if (name === 'password_expiry_days') {
            const days = Number(value);
            if (!Number.isInteger(days) || days < 0 || days > 3650) {
                throw new Error('La expiracion de contrasena debe estar entre 0 y 3650 dias');
            }
        }
        if (name === 'timezone' && !isValidTimeZone(value.trim())) {
            throw new Error('La zona horaria configurada no es válida');
        }
        if (name === 'kds_warning_minutes' || name === 'kds_urgent_minutes') {
            const minutes = Number(value);
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
                throw new Error('Los umbrales KDS deben ser minutos enteros entre 1 y 240');
            }
        }
        if (name === 'fiscal_jurisdiction') {
            const jurisdiction = value.trim();
            if (!/^[A-Za-z0-9_-]{2,32}$/.test(jurisdiction)) {
                throw new Error('La jurisdicción fiscal debe tener entre 2 y 32 caracteres alfanuméricos');
            }
        }
        if (name === 'credit_note_series' && !/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(value.trim())) {
            throw new Error('La serie de nota de crédito admite A-Z, 0-9 y guion; máximo 20 caracteres');
        }
        if (name === 'fiscal_tax_id_length') {
            const length = Number(value);
            if (!Number.isInteger(length) || length < 1 || length > 50) {
                throw new Error('La longitud de identificación fiscal debe ser un entero entre 1 y 50');
            }
        }
        if (name === 'fiscal_tax_id_charset' && !['DIGITS', 'ALPHANUMERIC'].includes(value.trim().toUpperCase())) {
            throw new Error('El tipo de identificación fiscal debe ser DIGITS o ALPHANUMERIC');
        }
    }

    /** Shared cash/arqueo tolerance. Default one currency unit preserves the historical contract. */
    static async getCashReconciliationTolerance(companyId: number): Promise<number> {
        const settings = await this.getAll(companyId);
        const configured = Number(settings.cash_reconciliation_tolerance);
        return Number.isFinite(configured) && configured >= 0 ? configured : 1;
    }

    static async getCurrencySymbol(companyId: number): Promise<string> {
        const settings = await this.getAll(companyId);
        return settings.currency_symbol?.trim() || DEFAULT_COMPANY_SETTINGS.currency_symbol;
    }

    static async getTimezone(companyId: number): Promise<string> {
        const cached = this.timezoneCache.get(companyId);
        if (cached && cached.expiresAt > Date.now()) return cached.value;

        const name = `${companyId}_timezone`;
        const setting = await prisma.setting.findUnique({
            where: { companyId_name: { companyId, name } },
            select: { value: true }
        });
        const configured = setting?.value?.trim();
        const value = configured && isValidTimeZone(configured)
            ? configured
            : DEFAULT_COMPANY_SETTINGS.timezone;
        this.timezoneCache.set(companyId, {
            value,
            expiresAt: Date.now() + this.TIMEZONE_CACHE_TTL_MS
        });
        return value;
    }

    static async getKdsTimingConfig(companyId: number): Promise<{ warningMinutes: number; urgentMinutes: number }> {
        const settings = await this.getAll(companyId);
        const warningMinutes = Number(settings.kds_warning_minutes ?? DEFAULT_COMPANY_SETTINGS.kds_warning_minutes);
        const urgentMinutes = Number(settings.kds_urgent_minutes ?? DEFAULT_COMPANY_SETTINGS.kds_urgent_minutes);
        if (!Number.isInteger(warningMinutes) || !Number.isInteger(urgentMinutes) || warningMinutes >= urgentMinutes) {
            return {
                warningMinutes: Number(DEFAULT_COMPANY_SETTINGS.kds_warning_minutes),
                urgentMinutes: Number(DEFAULT_COMPANY_SETTINGS.kds_urgent_minutes)
            };
        }
        return { warningMinutes, urgentMinutes };
    }

    static async update(companyId: number, data: Record<string, string>) {
        const prefix = `${companyId}_`;

        // Validate all values before starting transaction
        for (const [name, value] of Object.entries(data)) {
            this.validateSettingValue(name, value);
        }

        if (data.kds_warning_minutes !== undefined || data.kds_urgent_minutes !== undefined) {
            const current = await this.getKdsTimingConfig(companyId);
            const warningMinutes = Number(data.kds_warning_minutes ?? current.warningMinutes);
            const urgentMinutes = Number(data.kds_urgent_minutes ?? current.urgentMinutes);
            if (warningMinutes >= urgentMinutes) {
                throw new Error('El umbral de advertencia KDS debe ser menor que el umbral urgente');
            }
        }

        await prisma.$transaction(async (tx) => {
            for (const [name, value] of Object.entries(data)) {
                const prefixedName = `${prefix}${name}`;
                const existing = await tx.setting.findFirst({
                    where: { companyId, name: prefixedName }
                });

                if (existing) {
                    await tx.setting.update({
                        where: { id: existing.id },
                        data: { value }
                    });
                } else {
                    await tx.setting.create({
                        data: { name: prefixedName, value, companyId }
                    });
                }
            }

            // Keep the tax id unified: editing it here (nif/ruc) updates Company.ruc,
            // which is the source the invoices, tickets and reports read from.
            const taxId = data.ruc ?? data.nif;
            if (taxId !== undefined) {
                await tx.company.update({
                    where: { id: companyId },
                    data: { ruc: taxId || null }
                });
            }
        });

        if (data.timezone !== undefined) this.timezoneCache.delete(companyId);

        return this.getAll(companyId);
    }

    /** Create only missing defaults, without overwriting tenant configuration. */
    static async ensureDefaultsForCompany(companyId: number, client: SettingClient = prisma) {
        const prefix = `${companyId}_`;
        return client.setting.createMany({
            data: Object.entries(DEFAULT_COMPANY_SETTINGS).map(([name, value]) => ({
                companyId,
                name: `${prefix}${name}`,
                value
            })),
            skipDuplicates: true
        });
    }

    /**
     * Initialize default settings if they don't exist
     */
    static async initializeDefaults() {
        const companies = await prisma.company.findMany({ select: { id: true } });
        for (const company of companies) {
            await this.ensureDefaultsForCompany(company.id);
        }
    }
}
