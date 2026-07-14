import prisma from '../utils/prisma';
import { SettingService } from './setting.service';

export class CompanyService {
    static async getAll() {
        return await prisma.company.findMany({
            include: {
                _count: {
                    select: {
                        branches: true
                    }
                }
            }
        });
    }

    static async getById(id: number) {
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
    }, actorUserId?: number) {
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre de la empresa es obligatorio');
        if (name.length > 200) throw new Error('El nombre de la empresa es demasiado largo');
        const ruc = data.ruc?.trim() || null;
        const logo = data.logo?.trim() || null;
        return prisma.$transaction(async (tx) => {
            const company = await tx.company.create({ data: { name, ruc, logo } });
            await SettingService.ensureDefaultsForCompany(company.id, tx);
            if (actorUserId) {
                await tx.auditLog.create({
                    data: {
                        companyId: company.id,
                        userId: actorUserId,
                        entityType: 'Company',
                        entityId: company.id,
                        action: 'CREATE',
                        details: { name: company.name, ruc: company.ruc }
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
    }, actorUserId?: number) {
        if (!Number.isInteger(id) || id <= 0) throw new Error('Empresa inválida');
        const updateData: { name?: string; ruc?: string | null; logo?: string | null; active?: boolean } = {};
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
        if (Object.keys(updateData).length === 0) throw new Error('No hay campos válidos para actualizar');

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Company\` WHERE id = ${id} FOR UPDATE`;
            const existing = await tx.company.findUnique({
                where: { id },
                select: { id: true, name: true, ruc: true, logo: true, active: true }
            });
            if (!existing) throw new Error('Company not found');
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
}
