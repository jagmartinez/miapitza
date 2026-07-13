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
    }) {
        return prisma.$transaction(async (tx) => {
            const company = await tx.company.create({ data });
            await SettingService.ensureDefaultsForCompany(company.id, tx);
            return company;
        });
    }

    static async update(id: number, data: {
        name?: string;
        ruc?: string;
        logo?: string;
        active?: boolean;
    }) {
        return await prisma.company.update({
            where: { id },
            data
        });
    }
}
