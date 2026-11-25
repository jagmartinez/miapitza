import prisma from '../utils/prisma';
import { SettingService } from './setting.service';
import { CompanyProvisioningService } from './company-provisioning.service';

export class CompanyService {
    static async getAll(companyId?: number) {
        return await prisma.company.findMany({
            where: companyId === undefined ? undefined : { id: companyId },
            include: {
                _count: {
                    select: {
                        branches: true,
                        users: true,
                    }
                }
            }
        });
    }

    static async getById(id: number) {
        if (!Number.isInteger(id) || id <= 0) throw new Error('Empresa inválida');
        const company = await prisma.company.findUnique({
            where: { id },
            include: {
                branches: true
            }
        });

        if (!company) {
            throw new Error('Company not found');
        }

        return company;
    }

    static async create(data: {
        name: string;
        ruc?: string;
        logo?: string;
        payrollTaxRegime: string;
        payrollIncomeTaxWithholding: boolean;
        payrollTaxRegimeReference: string;
        payrollIncomeTaxException?: string;
    }, actorUserId?: number) {
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre de la empresa es obligatorio');
        if (name.length > 200) throw new Error('El nombre de la empresa es demasiado largo');
        const ruc = data.ruc?.trim() || null;
        const logo = data.logo?.trim() || null;
        const payrollTaxRegime = this.normalizePayrollTaxRegime(data.payrollTaxRegime);
        if (typeof data.payrollIncomeTaxWithholding !== 'boolean') throw new Error('Debes indicar si la empresa retiene IR laboral');
        const payrollIncomeTaxWithholding = data.payrollIncomeTaxWithholding;
        const payrollTaxRegimeReference = data.payrollTaxRegimeReference?.trim();
        if (!payrollTaxRegimeReference || payrollTaxRegimeReference.length < 3) throw new Error('El respaldo fiscal de la empresa es obligatorio');
        const payrollIncomeTaxException = payrollIncomeTaxWithholding
            ? null
            : data.payrollIncomeTaxException?.trim();
        if (!payrollIncomeTaxWithholding && (!payrollIncomeTaxException || payrollIncomeTaxException.length < 3)) {
            throw new Error('Documenta por qué la empresa no retiene IR laboral');
        }
        return prisma.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: {
                    name,
                    ruc,
                    logo,
                    payrollTaxRegime,
                    payrollIncomeTaxWithholding,
                    payrollTaxRegimeReference,
                    payrollIncomeTaxException,
                    payrollTaxProfileReady: true,
                }
            });
            await SettingService.ensureDefaultsForCompany(company.id, tx);
            // Tenant roles (ADMIN…CAJERO) — never SUPERADMIN — so new companies
            // are usable without granting platform-wide privilege to the tenant.
            await CompanyProvisioningService.provisionTenantRoles(company.id, tx);
            if (actorUserId) {
                await tx.auditLog.create({
                    data: {
                        companyId: company.id,
                        userId: actorUserId,
                        entityType: 'Company',
                        entityId: company.id,
                        action: 'CREATE',
                        details: { name: company.name, ruc: company.ruc, payrollTaxRegime, payrollIncomeTaxWithholding }
                    }
                });
            }
            return company;
        });
    }

    static async update(id: number, data: {
        name?: string;
        ruc?: string | null;
        logo?: string | null;
        active?: boolean;
        payrollTaxRegime?: string;
        payrollIncomeTaxWithholding?: boolean;
        payrollTaxRegimeReference?: string | null;
        payrollIncomeTaxException?: string | null;
    }, actorUserId?: number) {
        if (!Number.isInteger(id) || id <= 0) throw new Error('Empresa inválida');
        const updateData: {
            name?: string; ruc?: string | null; logo?: string | null; active?: boolean;
            payrollTaxRegime?: string; payrollIncomeTaxWithholding?: boolean; payrollTaxRegimeReference?: string | null;
            payrollIncomeTaxException?: string | null;
            payrollTaxProfileReady?: boolean;
        } = {};
        if (data.name !== undefined) {
            const name = data.name.trim();
            if (!name) throw new Error('El nombre de la empresa es obligatorio');
            if (name.length > 200) throw new Error('El nombre de la empresa es demasiado largo');
            updateData.name = name;
        }
        if (data.ruc !== undefined) updateData.ruc = data.ruc?.trim() || null;
        if (data.logo !== undefined) updateData.logo = data.logo?.trim() || null;
        if (data.active !== undefined) {
            if (typeof data.active !== 'boolean') throw new Error('Estado de empresa inválido');
            updateData.active = data.active;
        }
        if (data.payrollTaxRegime !== undefined) updateData.payrollTaxRegime = this.normalizePayrollTaxRegime(data.payrollTaxRegime);
        if (data.payrollIncomeTaxWithholding !== undefined) {
            if (typeof data.payrollIncomeTaxWithholding !== 'boolean') throw new Error('La retención de IR laboral debe ser sí o no');
            updateData.payrollIncomeTaxWithholding = data.payrollIncomeTaxWithholding;
        }
        if (data.payrollTaxRegimeReference !== undefined) {
            const reference = data.payrollTaxRegimeReference?.trim() || null;
            if (reference && reference.length > 500) throw new Error('La referencia fiscal es demasiado larga');
            updateData.payrollTaxRegimeReference = reference;
        }
        if (data.payrollIncomeTaxException !== undefined) {
            const exception = data.payrollIncomeTaxException?.trim() || null;
            if (exception && exception.length > 500) throw new Error('El fundamento de no retención es demasiado largo');
            updateData.payrollIncomeTaxException = exception;
        }
        if (Object.keys(updateData).length === 0) throw new Error('No hay campos válidos para actualizar');

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${id} FOR UPDATE`;
            const existing = await tx.company.findUnique({
                where: { id },
                select: {
                    id: true, name: true, ruc: true, logo: true, active: true,
                    payrollTaxRegime: true, payrollIncomeTaxWithholding: true, payrollTaxRegimeReference: true,
                    payrollIncomeTaxException: true,
                    payrollTaxProfileReady: true,
                }
            });
            if (!existing) throw new Error('Company not found');
            const fiscalProfileTouched = data.payrollTaxRegime !== undefined
                || data.payrollIncomeTaxWithholding !== undefined
                || data.payrollTaxRegimeReference !== undefined
                || data.payrollIncomeTaxException !== undefined;
            if (fiscalProfileTouched && (
                data.payrollTaxRegime === undefined
                || data.payrollIncomeTaxWithholding === undefined
                || data.payrollTaxRegimeReference === undefined
            )) {
                throw new Error('Envía régimen, retención y respaldo juntos para actualizar el perfil fiscal');
            }
            if (fiscalProfileTouched && data.payrollIncomeTaxWithholding === false && data.payrollIncomeTaxException === undefined) {
                throw new Error('Incluye el fundamento para no retener IR laboral');
            }
            const effectiveProfile = {
                regime: updateData.payrollTaxRegime ?? existing.payrollTaxRegime,
                withholding: updateData.payrollIncomeTaxWithholding ?? existing.payrollIncomeTaxWithholding,
                reference: updateData.payrollTaxRegimeReference === undefined
                    ? existing.payrollTaxRegimeReference
                    : updateData.payrollTaxRegimeReference,
                exception: updateData.payrollIncomeTaxException === undefined
                    ? existing.payrollIncomeTaxException
                    : updateData.payrollIncomeTaxException,
            };
            if (fiscalProfileTouched) {
                if (!effectiveProfile.reference?.trim() || effectiveProfile.reference.trim().length < 3) {
                    throw new Error('La referencia o respaldo fiscal de la empresa es obligatorio');
                }
                if (!effectiveProfile.withholding && (!effectiveProfile.exception?.trim() || effectiveProfile.exception.trim().length < 3)) {
                    throw new Error('Documenta por qué la empresa no retiene IR laboral');
                }
                if (effectiveProfile.withholding) updateData.payrollIncomeTaxException = null;
                updateData.payrollTaxProfileReady = true;
            }
            const updated = await tx.company.update({ where: { id }, data: updateData });
            if (actorUserId) {
                await tx.auditLog.create({
                    data: {
                        companyId: id,
                        userId: actorUserId,
                        entityType: 'Company',
                        entityId: id,
                        action: 'UPDATE',
                        details: { fields: Object.keys(updateData), previous: existing }
                    }
                });
            }
            return updated;
        });
    }

    private static normalizePayrollTaxRegime(value?: string): string {
        const normalized = value?.trim().toUpperCase();
        if (!normalized) throw new Error('El régimen tributario de la empresa es obligatorio');
        if (!['GENERAL', 'SIMPLIFIED_FIXED_QUOTA', 'SPECIAL', 'EXEMPT', 'OTHER'].includes(normalized)) {
            throw new Error('Régimen tributario de empresa inválido');
        }
        return normalized;
    }
}
