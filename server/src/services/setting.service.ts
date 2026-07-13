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
    timezone: 'America/Managua'
});

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
    }

    /** Shared cash/arqueo tolerance. Default C$1 preserves the historical arqueo contract. */
    static async getCashReconciliationTolerance(companyId: number): Promise<number> {
        const settings = await this.getAll(companyId);
        const configured = Number(settings.cash_reconciliation_tolerance);
        return Number.isFinite(configured) && configured >= 0 ? configured : 1;
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

    static async update(companyId: number, data: Record<string, string>) {
        const prefix = `${companyId}_`;

        // Validate all values before starting transaction
        for (const [name, value] of Object.entries(data)) {
            this.validateSettingValue(name, value);
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
