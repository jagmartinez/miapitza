import prisma from '../utils/prisma';

export class SettingService {
    static async getAll(companyId: number) {
        // Use prefix to simulate multi-tenancy on a global unique name field
        const prefix = `${companyId}_`;
        const settings = await prisma.setting.findMany({
            where: {
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
    }

    /** Shared cash/arqueo tolerance. Default C$1 preserves the historical arqueo contract. */
    static async getCashReconciliationTolerance(companyId: number): Promise<number> {
        const settings = await this.getAll(companyId);
        const configured = Number(settings.cash_reconciliation_tolerance);
        return Number.isFinite(configured) && configured >= 0 ? configured : 1;
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

        return this.getAll(companyId);
    }

    /**
     * Initialize default settings if they don't exist
     */
    static async initializeDefaults() {
        const defaults: Record<string, string> = {
            'restaurant_name': 'Mi Restaurante',
            'currency': 'NIO',
            'currency_symbol': 'C$',
            'currency_name': 'Córdoba Nicaragüense',
            'tax_rate': '15',
            'timezone': 'America/Managua'
        };

        const existingCount = await prisma.setting.count();
        if (existingCount === 0) {
            // Only initialize if at least one company exists
            const firstCompany = await prisma.company.findFirst({ select: { id: true } });
            if (firstCompany) {
                await this.update(firstCompany.id, defaults);
            }
        }
    }
}
