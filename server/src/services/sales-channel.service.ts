import prisma from '../utils/prisma';

type SalesChannelEnum = 'RESTAURANT' | 'DELIVERY' | 'PEDIDOSYA';

export class SalesChannelService {
    static async getAll(companyId: number) {
        return await prisma.salesChannelConfig.findMany({
            where: { companyId },
            orderBy: { channel: 'asc' }
        });
    }

    static async getByChannel(companyId: number, channel: SalesChannelEnum) {
        return await prisma.salesChannelConfig.findUnique({
            where: { companyId_channel: { companyId, channel } }
        });
    }

    static async upsert(companyId: number, data: {
        channel: SalesChannelEnum;
        name: string;
        priceMarkupPct?: number;
        commissionPct?: number;
        active?: boolean;
    }) {
        if (!['RESTAURANT', 'DELIVERY', 'PEDIDOSYA'].includes(data.channel)) {
            throw new Error('Canal de venta inválido');
        }
        const name = data.name?.trim();
        if (!name) throw new Error('El nombre del canal es requerido');
        const priceMarkupPct = Number(data.priceMarkupPct ?? 0);
        const commissionPct = Number(data.commissionPct ?? 0);
        if (!Number.isFinite(priceMarkupPct) || priceMarkupPct < 0 || priceMarkupPct > 1000) {
            throw new Error('El recargo del canal debe estar entre 0% y 1000%');
        }
        if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
            throw new Error('La comisión del canal debe estar entre 0% y 100%');
        }
        return await prisma.salesChannelConfig.upsert({
            where: { companyId_channel: { companyId, channel: data.channel } },
            update: {
                name,
                priceMarkupPct,
                commissionPct,
                active: data.active ?? true
            },
            create: {
                companyId,
                channel: data.channel,
                name,
                priceMarkupPct,
                commissionPct,
                active: data.active ?? true
            }
        });
    }

    static async ensureDefaults(companyId: number) {
        const defaults: Array<{ channel: SalesChannelEnum; name: string; priceMarkupPct: number; commissionPct: number }> = [
            { channel: 'RESTAURANT', name: 'Restaurante', priceMarkupPct: 0, commissionPct: 0 },
            { channel: 'DELIVERY', name: 'Delivery Propio', priceMarkupPct: 0, commissionPct: 0 },
            { channel: 'PEDIDOSYA', name: 'PedidosYa', priceMarkupPct: 18, commissionPct: 24 },
        ];

        for (const d of defaults) {
            const existing = await prisma.salesChannelConfig.findUnique({
                where: { companyId_channel: { companyId, channel: d.channel } }
            });
            if (!existing) {
                await prisma.salesChannelConfig.create({
                    data: { companyId, ...d }
                });
            }
        }
    }

    static calculatePedidosYaPricing(regularPrice: number, markupPct: number, commissionPct: number) {
        if (!Number.isFinite(regularPrice) || regularPrice < 0) throw new Error('Precio regular inválido');
        if (!Number.isFinite(markupPct) || markupPct < 0 || markupPct > 1000) throw new Error('Recargo inválido');
        if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) throw new Error('Comisión inválida');
        const pedidosYaPrice = regularPrice * (1 + markupPct / 100);
        const grossSale = pedidosYaPrice;
        const commission = grossSale * (commissionPct / 100);
        const netIncome = grossSale - commission;

        return {
            regularPrice: Math.round(regularPrice * 100) / 100,
            pedidosYaPrice: Math.round(pedidosYaPrice * 100) / 100,
            grossSale: Math.round(grossSale * 100) / 100,
            commission: Math.round(commission * 100) / 100,
            netIncome: Math.round(netIncome * 100) / 100,
            markupPct,
            commissionPct
        };
    }
}
