import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';
import { effectiveUnitCost } from '../utils/product-cost';
import { SettingService } from './setting.service';
import {
    getZonedDayBounds,
    getZonedDaysBounds,
    getZonedDayStartOffset,
    getZonedParts,
    zonedDateKey,
    zonedDateTimeToUtc,
    zonedHour,
    zonedWeekday
} from '../utils/timezone';

const CHART_COLORS = ['#60a5fa', '#34d399', '#818cf8', '#fbbf24', '#f87171', '#a78bfa'];
// Financial settlement is independent from kitchen/delivery status. closedAt is
// cleared when settlement is reversed.
const SETTLED_ORDER_WHERE: Prisma.OrderWhereInput = {
    financialStatus: 'PAID',
    status: { not: 'CANCELLED' },
    closedAt: { not: null }
};
/** Merge settlement predicates with a closedAt window without clobbering either side. */
function settledWhere(closedAt?: Prisma.DateTimeNullableFilter): Prisma.OrderWhereInput {
    return {
        financialStatus: 'PAID',
        status: { not: 'CANCELLED' },
        closedAt: closedAt ? { not: null, ...closedAt } : { not: null }
    };
}
/** Gross fiscal sale events. A final credit changes the order to
 * CANCELLED/UNPAID, but the original closed sale remains part of history and is
 * offset by a separate credit-note event at issuedAt. */
function fiscalGrossWhere(closedAt?: Prisma.DateTimeNullableFilter): Prisma.OrderWhereInput {
    return {
        OR: [
            { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
            { status: 'CANCELLED', invoiceFiscalStatus: 'CREDITED' }
        ],
        closedAt: closedAt ? { not: null, ...closedAt } : { not: null }
    };
}
const ACTIVE_ORDER_WHERE: Prisma.OrderWhereInput = {
    status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] }
};
export type ReportPeriod = 'today' | 'week' | 'month' | 'year';

const reportCents = (value: unknown, label: string): number => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`Reporte de ventas no calculado: ${label} inválido`);
    }
    return Math.round(amount * 100);
};

/** Deterministic largest-remainder allocation over persisted line weights. */
function allocateReportCents(total: number, weights: number[], tieBreakers: number[], label: string): number[] {
    if (total === 0) return weights.map(() => 0);
    const denominator = weights.reduce((sum, weight) => sum + weight, 0);
    if (denominator <= 0) {
        throw new Error(`Reporte de ventas no calculado: ${label} no tiene base durable para asignarse`);
    }
    const exact = weights.map((weight) => total * weight / denominator);
    const allocated = exact.map(Math.floor);
    const remainder = total - allocated.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({
        index,
        fraction: value - allocated[index],
        tie: tieBreakers[index]
    })).sort((left, right) => right.fraction - left.fraction || left.tie - right.tie);
    for (let index = 0; index < remainder; index += 1) {
        allocated[order[index].index] += 1;
    }
    return allocated;
}

/** Calendar-relative start instant in the company timezone (not the host TZ). */
function zonedCalendarOffsetStart(
    timeZone: string,
    instant: Date,
    offset: { months?: number; years?: number }
): Date {
    const local = getZonedParts(instant, timeZone);
    const anchor = new Date(Date.UTC(local.year, local.month - 1, local.day));
    if (offset.years) anchor.setUTCFullYear(anchor.getUTCFullYear() + offset.years);
    if (offset.months) anchor.setUTCMonth(anchor.getUTCMonth() + offset.months);
    return zonedDateTimeToUtc({
        year: anchor.getUTCFullYear(),
        month: anchor.getUTCMonth() + 1,
        day: anchor.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0
    }, timeZone);
}

export class ReportService {
    private static async periodStart(companyId: number, period: ReportPeriod): Promise<Date> {
        const now = new Date();
        const timeZone = await SettingService.getTimezone(companyId);
        if (period === 'today') {
            return getZonedDayBounds(timeZone, now).start;
        }
        if (period === 'week') {
            return getZonedDayStartOffset(timeZone, -7, now);
        }
        if (period === 'month') {
            return zonedCalendarOffsetStart(timeZone, now, { months: -1 });
        }
        return zonedCalendarOffsetStart(timeZone, now, { years: -1 });
    }

    /** Immutable credit notes are negative fiscal events in their own period. */
    private static async loadFiscalCredits(companyId: number, filters?: {
        dateFrom?: Date;
        dateTo?: Date;
        branchId?: number;
        userId?: number;
    }) {
        return prisma.fiscalCreditNote.findMany({
            where: {
                companyId,
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                ...(filters?.userId ? { order: { userId: filters.userId } } : {}),
                ...(filters?.dateFrom || filters?.dateTo ? {
                    issuedAt: {
                        ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                        ...(filters?.dateTo ? { lte: filters.dateTo } : {})
                    }
                } : {})
            },
            select: {
                issuedAt: true,
                total: true,
                order: { select: { userId: true } },
                refunds: {
                    select: {
                        amount: true,
                        payment: { select: { paymentMethod: { select: { name: true } } } }
                    }
                },
                lines: {
                    select: {
                        quantity: true,
                        subtotal: true,
                        orderItem: { select: { menuItemId: true } }
                    }
                }
            }
        });
    }

    private static async recipeQuantityInBase(companyId: number, recipe: {
        quantity: Prisma.Decimal | number | string;
        unit?: string | null;
        product: { id: number; name: string; unit: string };
    }): Promise<number> {
        const recipeUnit = recipe.unit || recipe.product.unit;
        try {
            return (await UnitConversionService.convert(
                recipe.product.id, companyId, Number(recipe.quantity), recipeUnit
            )).baseQuantity;
        } catch (error) {
            throw new Error(
                `Reporte no calculado: receta de "${recipe.product.name}" usa la unidad "${recipeUnit}" sin conversión válida: ${(error as Error).message}`
            );
        }
    }

    static async getDashboardStats(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const orderBase: Prisma.OrderWhereInput = { companyId, ...branchFilter };

        const timeZone = await SettingService.getTimezone(companyId);
        const todayBounds = getZonedDayBounds(timeZone);
        const today = todayBounds.start;

        // 1. Sales today
        const [todayOrders, todayCredits] = await Promise.all([
            prisma.order.findMany({
                where: {
                    ...orderBase,
                    ...fiscalGrossWhere({ gte: today })
                },
                select: { total: true }
            }),
            prisma.fiscalCreditNote.findMany({
                where: { companyId, ...branchFilter, issuedAt: { gte: today } },
                select: { total: true }
            })
        ]);

        const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.total), 0)
            - todayCredits.reduce((sum, note) => sum + Number(note.total), 0);

        // 2. Active orders
        const activeOrders = await prisma.order.count({
            where: {
                ...orderBase,
                ...ACTIVE_ORDER_WHERE
            }
        });

        // 3. Pending Purchase Orders
        const pendingPO = await prisma.purchaseOrder.count({
            where: {
                companyId,
                ...branchFilter,
                status: { in: ['DRAFT', 'ISSUED'] }
            }
        });

        // 4. Average Ticket (Today)
        const avgTicket = todayOrders.length > 0 ? todaySales / todayOrders.length : 0;

        // 5. Occupancy Rate
        const tableWhere: Prisma.TableWhereInput = {
            companyId,
            ...branchFilter,
        };
        const totalTables = await prisma.table.count({ where: tableWhere });
        const occupiedTables = await prisma.table.count({
            where: { ...tableWhere, status: 'OCCUPIED' }
        });
        const occupancyRate = totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0;

        // Exact count of settled tickets. The former "clients" proxy mixed
        // reservation guests with orders and could count the same visit twice.
        const settledOrdersCount = todayOrders.length;

        return {
            todaySales,
            activeOrders,
            pendingPurchaseOrders: pendingPO,
            averageTicket: avgTicket,
            occupancyRate,
            settledOrdersCount
        };
    }

    static async getIncomeBreakdown(companyId: number, branchId?: number, period: ReportPeriod = 'month') {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const startDate = await ReportService.periodStart(companyId, period);

        const where: Prisma.OrderItemWhereInput = {
            order: {
                companyId,
                ...fiscalGrossWhere({ gte: startDate }),
                ...branchFilter,
            },
        };

        const [breakdown, credits] = await Promise.all([
            prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where,
                _sum: { subtotal: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: startDate, branchId })
        ]);

        // Fetch categories for these menu items
        const menuItemIds = new Set(breakdown.map((b) => b.menuItemId));
        for (const credit of credits) {
            for (const line of credit.lines) menuItemIds.add(line.orderItem.menuItemId);
        }
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: [...menuItemIds] }, companyId },
            include: { category: true }
        });

        const categoryData: Record<string, { value: number, fill: string }> = {};

        breakdown.forEach((item) => {
            const menuItem = menuItems.find((m) => m.id === item.menuItemId);
            const categoryName = menuItem?.category?.name || 'Otros';
            if (!categoryData[categoryName]) {
                categoryData[categoryName] = {
                    value: 0,
                    fill: CHART_COLORS[Object.keys(categoryData).length % CHART_COLORS.length]
                };
            }
            categoryData[categoryName].value += Number(item._sum.subtotal || 0);
        });
        for (const credit of credits) {
            for (const line of credit.lines) {
                const menuItem = menuItems.find((m) => m.id === line.orderItem.menuItemId);
                const categoryName = menuItem?.category?.name || 'Otros';
                if (!categoryData[categoryName]) {
                    categoryData[categoryName] = {
                        value: 0,
                        fill: CHART_COLORS[Object.keys(categoryData).length % CHART_COLORS.length]
                    };
                }
                categoryData[categoryName].value -= Number(line.subtotal);
            }
        }

        return Object.entries(categoryData).map(([name, data]) => ({
            name,
            value: data.value,
            fill: data.fill
        }));
    }

    static async getOccupancyHeatmap(companyId: number, branchId?: number, period: ReportPeriod = 'week') {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const [startDate, timeZone] = await Promise.all([
            ReportService.periodStart(companyId, period),
            SettingService.getTimezone(companyId)
        ]);
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...settledWhere({ gte: startDate }),
            ...branchFilter,
        };

        const orders = await prisma.order.findMany({
            where,
            select: { createdAt: true }
        });

        const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const heatmap: Record<string, number> = {};

        orders.forEach((order) => {
            const date = new Date(order.createdAt);
            const day = days[zonedWeekday(date, timeZone)];
            const hour = zonedHour(date, timeZone);
            const key = `${day}-${hour}`;
            heatmap[key] = (heatmap[key] || 0) + 1;
        });

        // Normalize to 0-100
        const maxVal = Math.max(...Object.values(heatmap), 1);
        const result: { day: string; hour: number; value: number; id: string }[] = [];
        days.forEach(day => {
            for (let hour = 12; hour <= 21; hour++) {
                const val = heatmap[`${day}-${hour}`] || 0;
                result.push({
                    day,
                    hour,
                    value: Math.round((val / maxVal) * 100),
                    id: `${day}-${hour}`
                });
            }
        });

        return result;
    }

    static async getShiftEvaluation(companyId: number, branchId?: number, period: ReportPeriod = 'week') {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};

        const timeZone = await SettingService.getTimezone(companyId);
        const startDate = await ReportService.periodStart(companyId, period);
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...fiscalGrossWhere({ gte: startDate }),
            ...branchFilter,
        };

        const [orders, credits] = await Promise.all([
            prisma.order.findMany({ where, include: { items: true } }),
            this.loadFiscalCredits(companyId, { dateFrom: startDate, branchId })
        ]);

        const shiftA = orders.filter((o) => zonedHour(o.closedAt as Date, timeZone) < 16);
        const shiftB = orders.filter((o) => zonedHour(o.closedAt as Date, timeZone) >= 16);
        const creditA = credits.filter((credit) => zonedHour(credit.issuedAt, timeZone) < 16)
            .reduce((sum, credit) => sum + Number(credit.total), 0);
        const creditB = credits.filter((credit) => zonedHour(credit.issuedAt, timeZone) >= 16)
            .reduce((sum, credit) => sum + Number(credit.total), 0);

        const getStats = (obs: typeof orders, creditTotal: number) => ({
            ventas: obs.reduce((s, o) => s + Number(o.total), 0) - creditTotal,
            ticket: obs.length > 0
                ? (obs.reduce((s, o) => s + Number(o.total), 0) - creditTotal) / obs.length
                : 0,
            items: obs.length > 0 ? obs.reduce((s, o) => s + o.items.length, 0) / obs.length : 0,
            count: obs.length,
            avgServiceMinutes: (() => {
                const completed = obs.filter((o) => o.deliveredAt);
                if (!completed.length) return 0;
                const totalMinutes = completed.reduce((sum, o) => {
                    const startedAt = new Date(o.createdAt).getTime();
                    const deliveredAt = new Date(o.deliveredAt as Date).getTime();
                    return sum + Math.max(0, (deliveredAt - startedAt) / 60000);
                }, 0);
                return totalMinutes / completed.length;
            })()
        });

        const statsA = getStats(shiftA, creditA);
        const statsB = getStats(shiftB, creditB);

        const relativePair = (a: number, b: number, lowerIsBetter = false) => {
            if (a <= 0 && b <= 0) return [0, 0] as const;
            if (lowerIsBetter) {
                const best = Math.min(...[a, b].filter((v) => v > 0));
                return [a > 0 ? Math.round((best / a) * 100) : 0, b > 0 ? Math.round((best / b) * 100) : 0] as const;
            }
            const best = Math.max(a, b);
            return [Math.round((a / best) * 100), Math.round((b / best) * 100)] as const;
        };
        const metrics = [
            ['Ventas', statsA.ventas, statsB.ventas, false],
            ['Ticket', statsA.ticket, statsB.ticket, false],
            ['Volumen', statsA.count, statsB.count, false],
            ['Mix', statsA.items, statsB.items, false],
            ['Servicio', statsA.avgServiceMinutes, statsB.avgServiceMinutes, true]
        ] as const;
        return metrics.map(([subject, a, b, lowerIsBetter]) => {
            const [A, B] = relativePair(a, b, lowerIsBetter);
            return { subject, A, B, fullMark: 100 };
        });
    }

    static async getConversionFunnel(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const companyBranch = { companyId, ...branchFilter };

        const timeZone = await SettingService.getTimezone(companyId);
        const todayBounds = getZonedDayBounds(timeZone);
        const today = todayBounds.start;

        const reservations = await prisma.reservation.count({
            where: { ...companyBranch, date: { gte: today, lt: todayBounds.endExclusive } }
        });

        const visits = await prisma.order.count({
            where: { ...companyBranch, createdAt: { gte: today } }
        });

        const paid = await prisma.order.count({
            where: { ...companyBranch, closedAt: { gte: today }, financialStatus: 'PAID', status: { not: 'CANCELLED' } }
        });

        const frequentCustomers = await prisma.order.groupBy({
            by: ['customerName'],
            where: {
                ...companyBranch,
                ...SETTLED_ORDER_WHERE,
                closedAt: { gte: today },
                customerName: { not: null }
            },
            _count: { customerName: true }
        });
        const recurrentCount = frequentCustomers.filter((row) => (row._count.customerName || 0) > 1).length;

        return [
            { name: 'Reservas', value: reservations, fill: '#94a3b8' },
            { name: 'Visitas', value: visits, fill: '#60a5fa' },
            { name: 'Pagados', value: paid, fill: '#34d399' },
            { name: 'Frecuentes', value: recurrentCount, fill: '#fbbf24' }
        ];
    }

    static async getServiceTrends(companyId: number, branchId?: number, tipsPeriod: ReportPeriod = 'week', spendPeriod: ReportPeriod = 'week') {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const [tipsStart, spendStart] = await Promise.all([
            ReportService.periodStart(companyId, tipsPeriod),
            ReportService.periodStart(companyId, spendPeriod)
        ]);
        const earliestStart = new Date(Math.min(tipsStart.getTime(), spendStart.getTime()));
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...SETTLED_ORDER_WHERE,
            ...branchFilter,
            deliveredAt: { gte: earliestStart }
        };

        const orders = await prisma.order.findMany({
            where,
            orderBy: { deliveredAt: 'desc' },
            select: {
                createdAt: true,
                closedAt: true,
                deliveredAt: true,
                tipAmount: true,
                total: true
            }
        });

        const tips = orders
            .filter((o) => o.deliveredAt && new Date(o.deliveredAt).getTime() >= tipsStart.getTime())
            .map((o) => ({
                waitTime: Math.round((new Date(o.deliveredAt as Date).getTime() - new Date(o.createdAt).getTime()) / 60000),
                tip: Number(o.tipAmount || 0)
            }));

        const spend = orders
            .filter((o) => o.deliveredAt && new Date(o.deliveredAt).getTime() >= spendStart.getTime())
            .map((o) => ({
                dwellTime: Math.round((new Date(o.deliveredAt as Date).getTime() - new Date(o.createdAt).getTime()) / 60000),
                spend: Number(o.total)
            }));

        return { tips, spend };
    }

    static async getSalesChart(companyId: number, period: 'week' | 'month' = 'week', branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = { companyId, ...branchFilter };
        const timeZone = await SettingService.getTimezone(companyId);

        const endDate = new Date();
        const startDate = period === 'week'
            ? getZonedDayStartOffset(timeZone, -7, endDate)
            : zonedCalendarOffsetStart(timeZone, endDate, { months: -1 });

        const [orders, credits] = await Promise.all([
            prisma.order.findMany({
                where: {
                    ...where,
                    ...fiscalGrossWhere({ gte: startDate, lte: endDate })
                },
                select: {
                    closedAt: true,
                    total: true
                },
                orderBy: {
                    closedAt: 'asc'
                }
            }),
            prisma.fiscalCreditNote.findMany({
                where: {
                    companyId,
                    ...branchFilter,
                    issuedAt: { gte: startDate, lte: endDate }
                },
                select: { issuedAt: true, total: true }
            })
        ]);

        const grouped = orders.reduce((acc, order) => {
            const date = zonedDateKey(order.closedAt as Date, timeZone);
            if (!acc[date]) {
                acc[date] = 0;
            }
            acc[date] += Number(order.total);
            return acc;
        }, {} as Record<string, number>);
        for (const credit of credits) {
            const date = zonedDateKey(credit.issuedAt, timeZone);
            grouped[date] = (grouped[date] || 0) - Number(credit.total);
        }

        const chartData = Object.entries(grouped).map(([date, amount]) => ({
            date,
            amount: amount as number
        }));

        return chartData;
    }

    static async getTopSellingProducts(companyId: number, branchId?: number, limit: number = 10) {
        // Intentional all-time historical demand contract. The dashboard labels
        // this dataset "Demanda histórica" and this API accepts no date window.
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const whereItems: Prisma.OrderItemWhereInput = {
            order: {
                companyId,
                ...fiscalGrossWhere(),
                ...branchFilter,
            },
        };

        const [grossProducts, credits] = await Promise.all([
            prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: whereItems,
                _sum: { quantity: true, subtotal: true }
            }),
            this.loadFiscalCredits(companyId, { branchId })
        ]);

        const productTotals = new Map<number, { quantity: number; revenue: number }>();
        for (const product of grossProducts) {
            productTotals.set(product.menuItemId, {
                quantity: product._sum.quantity || 0,
                revenue: Number(product._sum.subtotal || 0)
            });
        }
        for (const credit of credits) {
            for (const line of credit.lines) {
                const menuItemId = line.orderItem.menuItemId;
                const current = productTotals.get(menuItemId) || { quantity: 0, revenue: 0 };
                current.quantity -= line.quantity;
                current.revenue -= Number(line.subtotal);
                productTotals.set(menuItemId, current);
            }
        }

        const topProducts = [...productTotals.entries()]
            .sort((a, b) => b[1].quantity - a[1].quantity)
            .slice(0, limit);

        const menuItemIds = topProducts.map(([menuItemId]) => menuItemId);
        const menuItems = await prisma.menuItem.findMany({
            where: {
                id: {
                    in: menuItemIds
                },
                companyId
            },
            select: {
                id: true,
                name: true,
                price: true,
                category: {
                    select: { name: true }
                }
            }
        });

        const result = topProducts.map(([menuItemId, totals]) => {
            const menuItem = menuItems.find((m) => m.id === menuItemId);
            return {
                menuItemId,
                name: menuItem?.name || 'Unknown',
                category: menuItem?.category?.name || 'N/A',
                price: Number(menuItem?.price || 0),
                totalQuantity: totals.quantity,
                totalRevenue: totals.revenue
            };
        });

        return result;
    }

    static async getSalesByUser(companyId: number, branchId?: number, startDate?: Date, endDate?: Date) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...fiscalGrossWhere(
                startDate || endDate
                    ? {
                          ...(startDate ? { gte: startDate } : {}),
                          ...(endDate ? { lte: endDate } : {}),
                      }
                    : undefined
            ),
            ...branchFilter,
        };

        const [salesByUser, credits] = await Promise.all([
            prisma.order.groupBy({
                by: ['userId'],
                where,
                _sum: { total: true },
                _count: { id: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: startDate, dateTo: endDate, branchId })
        ]);

        const creditsByUser = new Map<number, number>();
        for (const credit of credits) {
            creditsByUser.set(
                credit.order.userId,
                (creditsByUser.get(credit.order.userId) || 0) + Number(credit.total)
            );
        }

        const userIds = [...new Set([
            ...salesByUser.map((s) => s.userId),
            ...creditsByUser.keys()
        ])];
        const users = await prisma.user.findMany({
            where: {
                id: { in: userIds },
                companyId
            },
            select: {
                id: true,
                name: true,
                role: {
                    select: { name: true }
                }
            }
        });

        const grossByUser = new Map(salesByUser.map((sale) => [sale.userId, sale]));
        const result = userIds.map((userId) => {
            const sale = grossByUser.get(userId);
            const user = users.find((u) => u.id === userId);
            const totalSales = Number(sale?._sum.total || 0) - (creditsByUser.get(userId) || 0);
            const orderCount = sale?._count.id || 0;
            return {
                userId,
                userName: user?.name || 'Unknown',
                userRole: user?.role?.name || 'Unknown',
                totalSales,
                orderCount,
                averageOrderValue: orderCount ? totalSales / orderCount : 0
            };
        }).sort((a, b) => b.totalSales - a.totalSales);

        return result;
    }

    static async getRecentOrders(companyId: number, branchId?: number, limit: number = 5) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = { companyId, ...branchFilter };

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                ...ACTIVE_ORDER_WHERE
            },
            select: {
                id: true,
                table: {
                    select: {
                        number: true
                    }
                },
                total: true,
                status: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });

        return orders.map((order) => ({
            id: `ORD-${order.id}`,
            table: order.table?.number || 'N/A',
            total: Number(order.total),
            status: order.status.toLowerCase(),
            createdAt: order.createdAt
        }));
    }

    static async getRecentInvoices(companyId: number, branchId?: number, limit: number = 5, todayOnly: boolean = false) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        let closedAt: Prisma.DateTimeFilter | undefined;
        let timeZone: string | undefined;
        if (todayOnly) {
            timeZone = await SettingService.getTimezone(companyId);
            const bounds = getZonedDayBounds(timeZone);
            closedAt = { gte: bounds.start, lt: bounds.endExclusive };
        }
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...branchFilter,
            ...(closedAt ? { closedAt } : {}),
        };

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                financialStatus: 'PAID',
                status: { not: 'CANCELLED' },
                invoiceNumber: { not: null },
                closedAt: closedAt ?? { not: null }
            },
            select: {
                id: true,
                invoiceNumber: true,
                total: true,
                status: true,
                closedAt: true,
                items: {
                    select: {
                        id: true
                    }
                }
            },
            orderBy: {
                closedAt: 'desc'
            },
            take: limit
        });

        return orders.map((order) => {
            const time = new Date(order.closedAt as Date);
            return {
                id: order.invoiceNumber || `I-${String(order.id).padStart(3, '0')}`,
                time: time.toLocaleTimeString('es-MX', {
                    hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {})
                }),
                amount: Number(order.total),
                status: 'paid',
                items: order.items?.length || 0
            };
        });
    }

    static async getTodaysReservations(companyId: number, branchId?: number, days: number = 1) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.ReservationWhereInput = { companyId, ...branchFilter };

        const timeZone = await SettingService.getTimezone(companyId);
        const bounds = getZonedDaysBounds(timeZone, days);

        const reservations = await prisma.reservation.findMany({
            where: {
                ...where,
                date: { gte: bounds.start, lt: bounds.endExclusive },
                status: { notIn: ['CANCELLED', 'NO_SHOW'] }
            },
            select: {
                id: true,
                customerName: true,
                date: true,
                peopleCount: true,
                status: true
            },
            orderBy: {
                date: 'asc'
            }
        });

        return reservations.map((res) => {
            const d = new Date(res.date);
            return {
                id: res.id,
                date: res.date,
                time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone }),
                day: d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', timeZone }),
                name: res.customerName,
                pax: res.peopleCount,
                status: res.status.toLowerCase()
            };
        });
    }

    static async getMyStats(userId: number, companyId: number, role: string = 'MESERO') {
        const timeZone = await SettingService.getTimezone(companyId);
        const today = getZonedDayBounds(timeZone).start;

        // ── COCINA ──
        if (role === 'COCINA') {
            const pendingOrders = await prisma.order.count({ where: { companyId, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION'] } } });
            const readyOrders = await prisma.order.count({ where: { companyId, status: 'READY' } });

            const todayPaidItems = await prisma.orderItem.findMany({
                where: { order: { companyId, financialStatus: 'PAID', status: { not: 'CANCELLED' }, closedAt: { gte: today } } },
                select: { quantity: true }
            });
            const dishesToday = todayPaidItems.reduce((s, i) => s + i.quantity, 0);

            const topDishData = await prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: { order: { companyId, createdAt: { gte: today }, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] } } },
                _sum: { quantity: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: 5
            });
            const topDishMenuItems = await prisma.menuItem.findMany({
                where: { id: { in: topDishData.map((td) => td.menuItemId) }, companyId },
                select: { id: true, name: true }
            });
            const topDishNameById = new Map(topDishMenuItems.map((mi) => [mi.id, mi.name]));
            const topDishes = topDishData.map((td) => ({
                menuItemId: td.menuItemId,
                name: topDishNameById.get(td.menuItemId) || '?',
                totalQuantity: td._sum.quantity || 0
            }));

            const queue = await prisma.order.findMany({
                where: { companyId, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } },
                select: { id: true, status: true, createdAt: true, table: { select: { number: true } }, _count: { select: { items: true } } },
                orderBy: { createdAt: 'asc' }, take: 15
            });
            const kitchenQueue = queue.map((o) => {
                const mins = Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000);
                return { id: `ORD-${o.id}`, table: o.table?.number || 'N/A', items: o._count?.items || 0, elapsed: mins, status: o.status.toLowerCase() };
            });

            return { role: 'COCINA', pendingOrders, readyOrders, dishesToday, topDishes, kitchenQueue };
        }

        // ── CHEF (kitchen + inventory) ──
        if (role === 'CHEF') {
            // Kitchen metrics
            const pendingOrders = await prisma.order.count({ where: { companyId, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION'] } } });
            const readyOrders = await prisma.order.count({ where: { companyId, status: 'READY' } });

            const todayPaidItems = await prisma.orderItem.findMany({
                where: { order: { companyId, financialStatus: 'PAID', status: { not: 'CANCELLED' }, closedAt: { gte: today } } },
                select: { quantity: true }
            });
            const dishesToday = todayPaidItems.reduce((s, i) => s + i.quantity, 0);

            const topDishData = await prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: { order: { companyId, createdAt: { gte: today }, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] } } },
                _sum: { quantity: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: 5
            });
            const topDishMenuItems = await prisma.menuItem.findMany({
                where: { id: { in: topDishData.map((td) => td.menuItemId) }, companyId },
                select: { id: true, name: true }
            });
            const topDishNameById = new Map(topDishMenuItems.map((mi) => [mi.id, mi.name]));
            const topDishes = topDishData.map((td) => ({
                menuItemId: td.menuItemId,
                name: topDishNameById.get(td.menuItemId) || '?',
                totalQuantity: td._sum.quantity || 0
            }));

            // Inventory metrics
            const stocks = await prisma.stock.findMany({
                where: { companyId },
                include: { product: { select: { name: true, unit: true, minStock: true } } }
            });
            const lowStock = stocks.filter((s) => Number(s.quantity) <= Number(s.product.minStock) && Number(s.product.minStock) > 0);
            const lowStockProducts = lowStock.slice(0, 8).map((s) => ({
                name: s.product.name, current: Number(s.quantity), min: Number(s.product.minStock), unit: s.product.unit
            }));

            const weekAgo = getZonedDayStartOffset(timeZone, -7);
            const topConsumedData = await prisma.inventoryMovement.groupBy({
                by: ['productId'],
                where: { companyId, type: 'OUT', createdAt: { gte: weekAgo } },
                _sum: { quantity: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: 5
            });
            const topConsumedProducts = await prisma.product.findMany({
                where: { id: { in: topConsumedData.map((tc) => tc.productId) }, companyId },
                select: { id: true, name: true, unit: true }
            });
            const topConsumedProductById = new Map(topConsumedProducts.map((p) => [p.id, p]));
            const topConsumed = topConsumedData.map((tc) => {
                const prod = topConsumedProductById.get(tc.productId);
                return { name: prod?.name || '?', consumed: Number(tc._sum.quantity || 0), unit: prod?.unit || '' };
            });

            return {
                role: 'CHEF', pendingOrders, readyOrders, dishesToday,
                topDishes, lowStockCount: lowStock.length, lowStockProducts, topConsumed
            };
        }

        // ── BODEGA ──
        if (role === 'BODEGA') {
            const stocks = await prisma.stock.findMany({
                where: { companyId },
                include: { product: { select: { name: true, unit: true, minStock: true } } }
            });
            const lowStock = stocks.filter((s) => Number(s.quantity) <= Number(s.product.minStock) && Number(s.product.minStock) > 0);
            const criticalCount = lowStock.filter((s) => Number(s.quantity) === 0).length;
            const lowStockProducts = lowStock.slice(0, 10).map((s) => ({
                name: s.product.name, current: Number(s.quantity), min: Number(s.product.minStock), unit: s.product.unit
            }));

            const recentMoves = await prisma.inventoryMovement.findMany({
                where: { companyId },
                include: { product: { select: { name: true, unit: true } } },
                orderBy: { createdAt: 'desc' }, take: 10
            });
            const recentMovements = recentMoves.map((m) => ({
                product: m.product.name, type: m.type, quantity: Number(m.quantity), unit: m.product.unit,
                reason: m.reason, date: m.createdAt
            }));

            const weekAgo = getZonedDayStartOffset(timeZone, -7);
            const topConsumedData = await prisma.inventoryMovement.groupBy({
                by: ['productId'],
                where: { companyId, type: 'OUT', createdAt: { gte: weekAgo } },
                _sum: { quantity: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: 5
            });
            const topConsumedProducts = await prisma.product.findMany({
                where: { id: { in: topConsumedData.map((tc) => tc.productId) }, companyId },
                select: { id: true, name: true, unit: true }
            });
            const topConsumedProductById = new Map(topConsumedProducts.map((p) => [p.id, p]));
            const topConsumed = topConsumedData.map((tc) => {
                const prod = topConsumedProductById.get(tc.productId);
                return { name: prod?.name || '?', consumed: Number(tc._sum.quantity || 0), unit: prod?.unit || '' };
            });

            const pendingPOs = await prisma.purchaseOrder.count({
                where: { companyId, status: { in: ['DRAFT', 'ISSUED'] } }
            });

            return { role: 'BODEGA', lowStockCount: lowStock.length, criticalCount, lowStockProducts, recentMovements, topConsumed, pendingPOs };
        }

        // ── CAJERO ──
        if (role === 'CAJERO') {
            const [paidOrders, userCreditsToday] = await Promise.all([
                prisma.order.findMany({
                    where: { companyId, userId, ...fiscalGrossWhere({ gte: today }) },
                    select: { total: true }
                }),
                this.loadFiscalCredits(companyId, { dateFrom: today, userId })
            ]);
            const salesToday = paidOrders.reduce((s, o) => s + Number(o.total), 0)
                - userCreditsToday.reduce((s, note) => s + Number(note.total), 0);
            const ordersToday = paidOrders.length;
            const avgTicket = ordersToday > 0 ? salesToday / ordersToday : 0;

            const activeShiftRaw = await prisma.cashShift.findFirst({
                where: { userId, companyId, endDate: null },
                include: { cashRegister: { select: { name: true } }, movements: { select: { type: true, amount: true } } }
            });
            let activeShift = null;
            if (activeShiftRaw) {
                const cashIn = activeShiftRaw.movements
                    .filter((mov) => mov.type === 'IN')
                    .reduce((s, mov) => s + Number(mov.amount), 0);
                activeShift = {
                    registerName: activeShiftRaw.cashRegister?.name || 'Caja',
                    startAmount: Number(activeShiftRaw.startAmount),
                    cashAccumulated: cashIn,
                    startDate: activeShiftRaw.startDate
                };
            }

            const invoicesToday = await prisma.order.count({
                where: { companyId, ...fiscalGrossWhere({ gte: today }) }
            });

            const [paymentRows, companyCreditsToday] = await Promise.all([
                prisma.payment.findMany({
                    where: {
                        createdAt: { gte: today },
                        order: { companyId },
                        OR: [
                            { status: 'ACTIVE' },
                            { fiscalCreditNoteRefunds: { some: {} } }
                        ]
                    },
                    include: { paymentMethod: { select: { name: true } } }
                }),
                this.loadFiscalCredits(companyId, { dateFrom: today })
            ]);
            const breakdownMap = new Map<string, number>();
            for (const p of paymentRows) {
                const method = p.paymentMethod?.name || 'Otro';
                breakdownMap.set(method, (breakdownMap.get(method) || 0) + Number(p.amount));
            }
            for (const note of companyCreditsToday) {
                for (const refund of note.refunds) {
                    const method = refund.payment.paymentMethod?.name || 'Otro';
                    breakdownMap.set(method, (breakdownMap.get(method) || 0) - Number(refund.amount));
                }
            }
            const paymentBreakdown = Array.from(breakdownMap, ([method, total]) => ({ method, total }));

            const myActiveOrders = await prisma.order.findMany({
                where: { companyId, userId, ...ACTIVE_ORDER_WHERE },
                select: { id: true, total: true, status: true, table: { select: { number: true } } },
                orderBy: { createdAt: 'desc' }, take: 10
            });
            const myOrders = myActiveOrders.map((o) => ({
                id: `ORD-${o.id}`, table: o.table?.number || 'Para llevar', total: Number(o.total), status: o.status.toLowerCase()
            }));

            return { role: 'CAJERO', salesToday, ordersToday, avgTicket, activeShift, invoicesToday, paymentBreakdown, myOrders };
        }

        // ── MESERO / HOST / DEFAULT ──
        const [paidOrders, userCreditsToday] = await Promise.all([
            prisma.order.findMany({
                where: { companyId, userId, ...fiscalGrossWhere({ gte: today }) },
                select: { total: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: today, userId })
        ]);
        const salesToday = paidOrders.reduce((s, o) => s + Number(o.total), 0)
            - userCreditsToday.reduce((s, note) => s + Number(note.total), 0);
        const ordersToday = paidOrders.length;
        const avgTicket = ordersToday > 0 ? salesToday / ordersToday : 0;

        const thirtyDaysAgo = getZonedDayStartOffset(timeZone, -30);
        const [topProductData, productCredits] = await Promise.all([
            prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: { order: { userId, companyId, ...fiscalGrossWhere({ gte: thirtyDaysAgo }) } },
                _sum: { quantity: true, subtotal: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: thirtyDaysAgo, userId })
        ]);
        const productTotals = new Map(topProductData.map((product) => [product.menuItemId, {
            quantity: product._sum.quantity || 0,
            revenue: Number(product._sum.subtotal || 0)
        }]));
        for (const note of productCredits) {
            for (const line of note.lines) {
                const menuItemId = line.orderItem.menuItemId;
                const current = productTotals.get(menuItemId) || { quantity: 0, revenue: 0 };
                current.quantity -= line.quantity;
                current.revenue -= Number(line.subtotal);
                productTotals.set(menuItemId, current);
            }
        }
        const rankedProducts = [...productTotals.entries()]
            .sort((a, b) => b[1].quantity - a[1].quantity)
            .slice(0, 5);
        const topProductMenuItems = await prisma.menuItem.findMany({
            where: { id: { in: rankedProducts.map(([menuItemId]) => menuItemId) }, companyId },
            select: { id: true, name: true }
        });
        const topProductNameById = new Map(topProductMenuItems.map((mi) => [mi.id, mi.name]));
        const topProducts = rankedProducts.map(([menuItemId, totals]) => ({
            menuItemId,
            name: topProductNameById.get(menuItemId) || '?',
            totalQuantity: totals.quantity,
            totalRevenue: totals.revenue
        }));

        const activeOrders = await prisma.order.findMany({
                where: { companyId, userId, ...ACTIVE_ORDER_WHERE },
            select: { id: true, total: true, status: true, table: { select: { number: true } }, _count: { select: { items: true } } },
            orderBy: { createdAt: 'desc' }, take: 20
        });
        const myOrders = activeOrders.map((o) => ({
            id: `ORD-${o.id}`, table: o.table?.number || 'Para llevar', total: Number(o.total), status: o.status.toLowerCase(), items: o._count?.items || 0
        }));

        return { role: role || 'MESERO', salesToday, ordersToday, avgTicket, topProduct: topProducts[0]?.name || 'Ninguno', topProducts, myOrders };
    }

    static async getUserActivity(userId: number, companyId: number, limit: number = 20) {
        // Fetch recent orders
        const orders = await prisma.order.findMany({
            where: { userId, companyId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: { id: true, total: true, status: true, createdAt: true }
        });

        // Fetch recent payments if they are tracked separately or just use orders
        // Map them to a unified activity format
        const activities = orders.map((o) => ({
            id: o.id,
            type: 'ORDER',
            description: `Orden #${o.id} - ${o.status}`,
            amount: Number(o.total),
            date: o.createdAt,
            status: o.status
        }));

        return activities;
    }

    /** Weekly performance data for the profile chart */
    static async getMyPerformance(userId: number, companyId: number) {
        const now = new Date();
        const timeZone = await SettingService.getTimezone(companyId);
        const weekAgo = getZonedDayStartOffset(timeZone, -6, now);

        // Daily sales for current user (last 7 days)
        const [myOrders, myCredits] = await Promise.all([
            prisma.order.findMany({
                where: { userId, companyId, ...fiscalGrossWhere({ gte: weekAgo }) },
                select: { total: true, closedAt: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: weekAgo, userId })
        ]);

        // Team average (all users, same period)
        const [teamOrders, teamCredits] = await Promise.all([
            prisma.order.findMany({
                where: { companyId, ...fiscalGrossWhere({ gte: weekAgo }) },
                select: { total: true, userId: true, closedAt: true }
            }),
            this.loadFiscalCredits(companyId, { dateFrom: weekAgo })
        ]);

        // Build daily data
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const dailyData = [];
        const teamUserIds = new Set([
            ...teamOrders.map((o) => o.userId),
            ...teamCredits.map((credit) => credit.order.userId)
        ]);
        const teamSize = Math.max(teamUserIds.size, 1);

        for (let i = 0; i < 7; i++) {
            const dayStart = getZonedDayStartOffset(timeZone, -6 + i, now);
            const dayEnd = new Date(getZonedDayStartOffset(timeZone, -5 + i, now).getTime() - 1);

            const mySales = myOrders
                .filter((o) => new Date(o.closedAt as Date) >= dayStart && new Date(o.closedAt as Date) <= dayEnd)
                .reduce((s, o) => s + Number(o.total), 0)
                - myCredits
                    .filter((credit) => credit.issuedAt >= dayStart && credit.issuedAt <= dayEnd)
                    .reduce((s, credit) => s + Number(credit.total), 0);

            const teamTotal = teamOrders
                .filter((o) => new Date(o.closedAt as Date) >= dayStart && new Date(o.closedAt as Date) <= dayEnd)
                .reduce((s, o) => s + Number(o.total), 0)
                - teamCredits
                    .filter((credit) => credit.issuedAt >= dayStart && credit.issuedAt <= dayEnd)
                    .reduce((s, credit) => s + Number(credit.total), 0);

            dailyData.push({
                day: dayNames[zonedWeekday(dayStart, timeZone)],
                date: zonedDateKey(dayStart, timeZone),
                mySales: Math.round(mySales * 100) / 100,
                teamAvg: Math.round((teamTotal / teamSize) * 100) / 100,
            });
        }

        // Overall comparison
        const myTotal = myOrders.reduce((s, o) => s + Number(o.total), 0)
            - myCredits.reduce((s, credit) => s + Number(credit.total), 0);
        const teamAvgTotal = (
            teamOrders.reduce((s, o) => s + Number(o.total), 0)
            - teamCredits.reduce((s, credit) => s + Number(credit.total), 0)
        ) / teamSize;
        const vsTeam = teamAvgTotal > 0 ? Math.round(((myTotal - teamAvgTotal) / teamAvgTotal) * 100) : 0;

        // Order stats
        const thirtyDaysAgo = getZonedDayStartOffset(timeZone, -30, now);
        const allMyOrders = await prisma.order.groupBy({
            by: ['status'],
            where: { userId, companyId, createdAt: { gte: thirtyDaysAgo } },
            _count: true
        });
        const ordersByStatus: Record<string, number> = {};
        for (const g of allMyOrders) ordersByStatus[g.status] = g._count;

        return {
            dailyData,
            vsTeam,
            myWeekTotal: Math.round(myTotal * 100) / 100,
            ordersByStatus,
        };
    }

    /** Password info for security tab */
    static async getPasswordInfo(userId: number, companyId: number) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { passwordChangedAt: true }
        });

        const expirySetting = await prisma.setting.findFirst({
            where: { companyId, name: `${companyId}_password_expiry_days` }
        });
        const expiryDays = expirySetting ? parseInt(expirySetting.value) : 90;

        let expiresAt = null;
        let daysUntilExpiry = null;
        if (user?.passwordChangedAt && expiryDays > 0) {
            const changed = new Date(user.passwordChangedAt);
            expiresAt = new Date(changed);
            expiresAt.setDate(expiresAt.getDate() + expiryDays);
            daysUntilExpiry = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        }

        return {
            passwordChangedAt: user?.passwordChangedAt || null,
            expiryDays,
            expiresAt,
            daysUntilExpiry,
        };
    }

    static async getCostReport(companyId: number, filters?: {
        dateFrom?: Date;
        dateTo?: Date;
        branchId?: number;
        categoryId?: number;
        productId?: number;
        supplierId?: number;
    }) {
        const poWhere: Prisma.PurchaseOrderWhereInput = {
            companyId,
            status: 'RECEIVED',
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
            ...(filters?.dateFrom || filters?.dateTo
                ? {
                      date: {
                          ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters.dateTo ? { lte: filters.dateTo } : {}),
                      },
                  }
                : {}),
        };

        const purchaseOrders = await prisma.purchaseOrder.findMany({
            where: poWhere,
            include: {
                supplier: { select: { id: true, name: true } },
                branch: { select: { id: true, name: true } },
                items: {
                    include: {
                        product: {
                            select: {
                                id: true, name: true, sku: true, unit: true,
                                categoryId: true, currentAverageCost: true,
                                category: { select: { id: true, name: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        let totalPurchaseCost = 0;
        const productCosts: Record<number, {
            productId: number; productName: string; sku: string | null;
            unit: string; categoryName: string | null;
            totalQuantity: number; totalCost: number; avgUnitCost: number;
            currentAvgCost: number;
        }> = {};
        let excludedLegacyPurchaseLines = 0;
        let excludedLegacyPurchaseAmount = 0;

        for (const po of purchaseOrders) {
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                if (filters?.productId && item.productId !== filters.productId) continue;

                const lineSubtotal = Number(item.subtotal);
                totalPurchaseCost += lineSubtotal;

                // Aggregate volume and cost in BASE units so avgUnitCost is comparable
                // across purchases made in different purchase units. Legacy lines
                // without converted fields are skipped — treating purchase UOM as
                // base would silently misstate kg/g (etc.) volumes and unit costs.
                if (item.baseQuantity == null || item.baseCost == null) {
                    excludedLegacyPurchaseLines += 1;
                    excludedLegacyPurchaseAmount += lineSubtotal;
                    continue;
                }
                const baseQty = Number(item.baseQuantity);
                const baseUnitCost = Number(item.baseCost);

                if (!productCosts[item.productId]) {
                    productCosts[item.productId] = {
                        productId: item.productId,
                        productName: item.product.name,
                        sku: item.product.sku,
                        unit: item.product.unit,
                        categoryName: item.product.category?.name || null,
                        totalQuantity: 0, totalCost: 0, avgUnitCost: 0,
                        currentAvgCost: Number(item.product.currentAverageCost)
                    };
                }
                productCosts[item.productId].totalQuantity += baseQty;
                productCosts[item.productId].totalCost += baseUnitCost * baseQty;
            }
        }

        const productList = Object.values(productCosts).map(p => ({
            ...p,
            avgUnitCost: p.totalQuantity > 0 ? p.totalCost / p.totalQuantity : 0
        }));

        // COGS estimate from sold orders in the period
        const orderWhere: Prisma.OrderWhereInput = {
            companyId,
            ...fiscalGrossWhere(
                filters?.dateFrom || filters?.dateTo
                    ? {
                          ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                      }
                    : undefined
            ),
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
        };

        const soldOrders = await prisma.order.findMany({
            where: orderWhere,
            select: {
                id: true,
                total: true,
                items: {
                    select: {
                        quantity: true,
                        menuItem: {
                            select: {
                                recipes: {
                                    select: {
                                        quantity: true,
                                        unit: true,
                                        product: {
                                            select: {
                                                id: true,
                                                name: true,
                                                unit: true,
                                                currentAverageCost: true,
                                                cost: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // COGS is an inventory event stream, not a property of whatever orders
        // still happen to be PAID. OUT is recognized when consumed and IN when
        // physically returned. Therefore a NO_RETURN credit retains the cost,
        // while RETURN_TO_STOCK publishes a negative COGS event on return date.
        // Fetch all movements in the report period plus any historical movement
        // for current-period sales (the latter only determines fallback eligibility).
        const orderRefs = soldOrders.map((order) => `ORD-${order.id}`);
        const movementWindow = filters?.dateFrom || filters?.dateTo ? {
            ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters?.dateTo ? { lte: filters.dateTo } : {})
        } : undefined;
        const [consumptionMovements, creditNotes] = await Promise.all([
            prisma.inventoryMovement.findMany({
                where: {
                    companyId,
                    type: { in: ['OUT', 'IN'] },
                    reference: { startsWith: 'ORD-' },
                    ...(movementWindow && orderRefs.length > 0 ? {
                        OR: [{ createdAt: movementWindow }, { reference: { in: orderRefs } }]
                    } : movementWindow ? { createdAt: movementWindow } : {})
                },
                select: { id: true, reference: true, type: true, totalCost: true, createdAt: true }
            }),
            prisma.fiscalCreditNote.findMany({
                where: {
                    companyId,
                    ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                    ...(filters?.dateFrom || filters?.dateTo ? {
                        issuedAt: {
                            ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                            ...(filters?.dateTo ? { lte: filters.dateTo } : {})
                        }
                    } : {})
                },
                select: { total: true }
            })
        ]);

        let branchOrderIds: Set<number> | null = null;
        if (filters?.branchId) {
            const movementOrderIds = [...new Set(consumptionMovements.flatMap((movement) => {
                const match = /^ORD-(\d+)$/.exec(movement.reference || '');
                return match ? [Number(match[1])] : [];
            }))];
            const branchOrders = movementOrderIds.length > 0
                ? await prisma.order.findMany({
                    where: { companyId, branchId: filters.branchId, id: { in: movementOrderIds } },
                    select: { id: true }
                })
                : [];
            branchOrderIds = new Set(branchOrders.map((order) => order.id));
        }

        const hasAnyLedger = new Set<string>();
        let estimatedCOGS = 0;
        for (const movement of consumptionMovements) {
            if (!movement.reference) continue;
            const match = /^ORD-(\d+)$/.exec(movement.reference);
            if (!match || (branchOrderIds && !branchOrderIds.has(Number(match[1])))) continue;
            hasAnyLedger.add(movement.reference);
            const isInPeriod = !movementWindow
                || ((!filters?.dateFrom || movement.createdAt >= filters.dateFrom)
                    && (!filters?.dateTo || movement.createdAt <= filters.dateTo));
            if (!isInPeriod) continue;
            const movementCost = movement.totalCost == null ? null : Number(movement.totalCost);
            if (movementCost == null || !Number.isFinite(movementCost) || movementCost < 0) {
                throw new Error(`El movimiento ORD ${movement.id} no tiene costo histórico íntegro; requiere remediación antes de reportar`);
            }
            estimatedCOGS += movement.type === 'OUT' ? movementCost : -movementCost;
        }

        const totalRevenue = soldOrders.reduce((sum, order) => sum + Number(order.total), 0)
            - creditNotes.reduce((sum, note) => sum + Number(note.total), 0);
        for (const order of soldOrders) {
            const orderRef = `ORD-${order.id}`;
            // Only orders with no ledger at any date use the recipe estimate.
            // A ledger outside this window is intentionally not shifted into it.
            if (hasAnyLedger.has(orderRef)) continue;
            for (const item of order.items) {
                for (const recipe of item.menuItem?.recipes || []) {
                    const qtyInBase = await this.recipeQuantityInBase(companyId, recipe);
                    const unitCost = effectiveUnitCost(
                        recipe.product.currentAverageCost,
                        recipe.product.cost
                    );
                    estimatedCOGS += qtyInBase * item.quantity * unitCost;
                }
            }
        }

        return {
            summary: {
                totalPurchaseCost: Math.round(totalPurchaseCost * 100) / 100,
                estimatedCOGS: Math.round(estimatedCOGS * 100) / 100,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                grossProfit: Math.round((totalRevenue - estimatedCOGS) * 100) / 100,
                grossMargin: totalRevenue > 0 ? Math.round((totalRevenue - estimatedCOGS) / totalRevenue * 10000) / 100 : 0,
                purchaseOrderCount: purchaseOrders.length,
                excludedLegacyPurchaseLines,
                excludedLegacyPurchaseAmount: Math.round(excludedLegacyPurchaseAmount * 100) / 100
            },
            byProduct: productList.sort((a, b) => b.totalCost - a.totalCost)
        };
    }

    static async getInventoryReport(companyId: number, filters?: {
        warehouseId?: number;
        categoryId?: number;
        productId?: number;
        lowStockOnly?: boolean;
    }) {
        const stockWhere: Prisma.StockWhereInput = {
            companyId,
            ...(filters?.warehouseId ? { warehouseId: filters.warehouseId } : {}),
            ...(filters?.productId ? { productId: filters.productId } : {}),
            ...(filters?.categoryId ? { product: { categoryId: filters.categoryId } } : {}),
        };

        const stocks = await prisma.stock.findMany({
            where: stockWhere,
            include: {
                product: {
                    select: {
                        id: true, name: true, sku: true, unit: true,
                        baseUnit: { select: { abbreviation: true } },
                        minStock: true, currentAverageCost: true, cost: true,
                        category: { select: { name: true } }
                    }
                },
                warehouse: { select: { name: true } }
            }
        });

        const items = stocks.map(s => {
            const qty = Number(s.quantity);
            const minStock = Number(s.product.minStock);
            const avgCost = effectiveUnitCost(s.product.currentAverageCost, s.product.cost);
            const totalValue = Math.round(qty * avgCost * 100) / 100;
            const status: 'CRITICAL' | 'LOW' | 'OK' = qty <= 0 ? 'CRITICAL' : qty < minStock ? 'LOW' : 'OK';
            return {
                productId: s.product.id,
                productName: s.product.name,
                sku: s.product.sku,
                unit: s.product.baseUnit?.abbreviation || s.product.unit,
                categoryName: s.product.category?.name || null,
                warehouseName: s.warehouse.name,
                quantity: Math.round(qty * 100) / 100,
                minStock: Math.round(minStock * 100) / 100,
                maxStock: null as number | null,
                currentAverageCost: Math.round(avgCost * 100) / 100,
                totalValue,
                status
            };
        });

        const filtered = filters?.lowStockOnly ? items.filter(i => i.status === 'LOW' || i.status === 'CRITICAL') : items;

        const totalValue = Math.round(filtered.reduce((s, i) => s + i.totalValue, 0) * 100) / 100;
        const lowStockCount = filtered.filter(i => i.status === 'LOW').length;
        const criticalCount = filtered.filter(i => i.status === 'CRITICAL').length;

        return {
            items: filtered,
            summary: {
                totalProducts: filtered.length,
                totalValue,
                lowStockCount,
                criticalCount
            }
        };
    }

    static async getPurchasesReport(companyId: number, filters?: {
        dateFrom?: Date;
        dateTo?: Date;
        supplierId?: number;
        categoryId?: number;
        branchId?: number;
        status?: string;
    }) {
        const poWhere: Prisma.PurchaseOrderWhereInput = {
            companyId,
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
            status: filters?.status
                ? filters.status as Prisma.PurchaseOrderWhereInput['status']
                : 'RECEIVED',
            ...(filters?.dateFrom || filters?.dateTo
                ? {
                      date: {
                          ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                      },
                  }
                : {}),
        };

        const purchaseOrders = await prisma.purchaseOrder.findMany({
            where: poWhere,
            include: {
                supplier: { select: { name: true } },
                branch: { select: { name: true } },
                items: {
                    include: {
                        product: {
                            select: {
                                name: true, categoryId: true, unit: true,
                                baseUnit: { select: { abbreviation: true } },
                                category: { select: { name: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        const items: {
            date: Date; poNumber: string | null; supplierName: string;
            productName: string; categoryName: string | null;
            quantity: number | null; unit: string; unitCost: number | null;
            totalCost: number; status: string; dataQuality: 'OK' | 'LEGACY_UOM_MISSING';
        }[] = [];

        const supplierSet = new Set<number>();
        const productSet = new Set<number>();
        let totalAmount = 0;
        let legacyUomLines = 0;
        let legacyUomAmount = 0;

        for (const po of purchaseOrders) {
            supplierSet.add(po.supplierId);
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                productSet.add(item.productId);
                const cost = Math.round(Number(item.subtotal) * 100) / 100;
                totalAmount += cost;
                const hasNormalizedUom = item.baseQuantity != null && item.baseCost != null;
                if (!hasNormalizedUom) {
                    legacyUomLines += 1;
                    legacyUomAmount += cost;
                }
                items.push({
                    date: po.date,
                    poNumber: po.invoiceNumber,
                    supplierName: po.supplier.name,
                    productName: item.product.name,
                    categoryName: item.product.category?.name || null,
                    quantity: hasNormalizedUom ? Math.round(Number(item.baseQuantity) * 100) / 100 : null,
                    unit: hasNormalizedUom
                        ? item.product.baseUnit?.abbreviation || item.product.unit
                        : 'UOM no normalizada',
                    unitCost: hasNormalizedUom ? Math.round(Number(item.baseCost) * 100) / 100 : null,
                    totalCost: cost,
                    status: po.status,
                    dataQuality: hasNormalizedUom ? 'OK' : 'LEGACY_UOM_MISSING'
                });
            }
        }

        return {
            items,
            summary: {
                totalOrders: purchaseOrders.length,
                totalAmount: Math.round(totalAmount * 100) / 100,
                uniqueSuppliers: supplierSet.size,
                uniqueProducts: productSet.size,
                legacyUomLines,
                legacyUomAmount: Math.round(legacyUomAmount * 100) / 100
            }
        };
    }

    static async getSalesReport(companyId: number, filters?: {
        dateFrom?: Date;
        dateTo?: Date;
        branchId?: number;
        categoryId?: number;
        categoryIds?: number[];
        brandId?: number;
        userId?: number;
        paymentMethodId?: number;
    }) {
        const orderWhere: Prisma.OrderWhereInput = {
            companyId,
            ...fiscalGrossWhere(
                filters?.dateFrom || filters?.dateTo
                    ? {
                          ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                      }
                    : undefined
            ),
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.userId ? { userId: filters.userId } : {}),
            ...(filters?.paymentMethodId
                ? { payments: { some: { paymentMethodId: filters.paymentMethodId } } }
                : {}),
        };

        const orders = await prisma.order.findMany({
            where: orderWhere,
            include: {
                items: {
                    include: {
                        menuItem: {
                            select: {
                                name: true, categoryId: true, brandId: true,
                                category: { select: { name: true } },
                                brand: { select: { name: true } }
                            }
                        }
                    }
                },
                payments: {
                    include: {
                        paymentMethod: { select: { name: true } }
                    }
                },
                user: { select: { name: true } },
                branch: { select: { name: true } },
                company: { select: { name: true } }
            },
            orderBy: { closedAt: 'desc' }
        });

        // Counterdocuments belong to their own fiscal date. Query them
        // independently so a note issued today against an older invoice appears
        // as a negative today instead of silently rewriting the old period.
        const creditNotes = await prisma.fiscalCreditNote.findMany({
            where: {
                companyId,
                ...(filters?.branchId ? { branchId: filters.branchId } : {}),
                ...(filters?.userId ? { order: { userId: filters.userId } } : {}),
                ...(filters?.dateFrom || filters?.dateTo ? {
                    issuedAt: {
                        ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                        ...(filters?.dateTo ? { lte: filters.dateTo } : {})
                    }
                } : {}),
                ...(filters?.paymentMethodId ? {
                    refunds: { some: { payment: { paymentMethodId: filters.paymentMethodId } } }
                } : {})
            },
            include: {
                lines: {
                    include: {
                        orderItem: {
                            include: {
                                menuItem: {
                                    select: {
                                        name: true, categoryId: true, brandId: true,
                                        category: { select: { name: true } },
                                        brand: { select: { name: true } }
                                    }
                                }
                            }
                        }
                    }
                },
                refunds: { include: { payment: { include: { paymentMethod: { select: { name: true } } } } } },
                order: {
                    select: {
                        user: { select: { name: true } },
                        branch: { select: { name: true } },
                        company: { select: { name: true } }
                    }
                }
            },
            orderBy: { issuedAt: 'desc' }
        });

        const items: {
            date: Date; orderNumber: string; productName: string;
            categoryName: string | null; brandName: string | null; quantity: number; unitPrice: number;
            discount: number; totalSale: number; paymentMethod: string; userName: string;
            branchName: string | null; companyName: string | null;
        }[] = [];

        let totalSales = 0;
        let totalDiscount = 0;
        let totalTax = 0;
        let totalTip = 0;
        let grossOrderTotal = 0;
        let collected = 0;
        let creditNoteCount = 0;
        const matchedOrderIds = new Set<number>();
        const selectedCategoryIds = filters?.categoryIds?.length
            ? new Set(filters.categoryIds)
            : filters?.categoryId ? new Set([filters.categoryId]) : null;

        for (const order of orders) {
            const paymentMethodName = [...new Set(order.payments.map(p => p.paymentMethod.name))].join(', ') || 'N/A';
            const matchingIndexes = order.items.flatMap((item, index) => {
                if (selectedCategoryIds && (!item.menuItem?.categoryId || !selectedCategoryIds.has(item.menuItem.categoryId))) return [];
                if (filters?.brandId && item.menuItem?.brandId !== filters.brandId) return [];
                return [index];
            });
            const matchingItems = matchingIndexes.map((index) => order.items[index]);

            if (matchingItems.length === 0) continue;

            // Order-level discount/tax/tip are allocated with the same cent-safe
            // basis used by fiscal credit notes: gross line subtotal, then net
            // line subtotal for tax/tip. Every input is a persisted order value;
            // no category-specific rate or synthetic policy is invented here.
            const grossByLine = order.items.map((item, index) =>
                reportCents(item.subtotal, `subtotal del ítem ${item.id || index + 1}`)
            );
            const tieBreakers = order.items.map((item, index) => item.id || index + 1);
            const discountByLine = allocateReportCents(
                reportCents(order.discount, `descuento de la orden ${order.id}`),
                grossByLine,
                tieBreakers,
                `descuento de la orden ${order.id}`
            );
            const netByLine = grossByLine.map((gross, index) => gross - discountByLine[index]);
            if (netByLine.some((amount) => amount < 0)) {
                throw new Error(`Reporte de ventas no calculado: descuento de la orden ${order.id} excede sus líneas`);
            }
            const fiscalWeights = netByLine.some((amount) => amount > 0) ? netByLine : grossByLine;
            const taxByLine = allocateReportCents(
                reportCents(order.tax, `impuesto de la orden ${order.id}`),
                fiscalWeights,
                tieBreakers,
                `impuesto de la orden ${order.id}`
            );
            const tipByLine = allocateReportCents(
                reportCents(order.tipAmount, `propina de la orden ${order.id}`),
                fiscalWeights,
                tieBreakers,
                `propina de la orden ${order.id}`
            );
            const totalByLine = grossByLine.map((gross, index) =>
                gross - discountByLine[index] + taxByLine[index] + tipByLine[index]
            );
            const allocatedOrderTotal = totalByLine.reduce((sum, amount) => sum + amount, 0);
            if (allocatedOrderTotal !== reportCents(order.total, `total de la orden ${order.id}`)) {
                throw new Error(`Reporte de ventas no calculado: la orden ${order.id} no reconcilia en centavos`);
            }
            const collectedCents = reportCents(
                order.payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
                `cobros de la orden ${order.id}`
            );
            const collectedByLine = allocateReportCents(
                collectedCents,
                totalByLine.some((amount) => amount > 0) ? totalByLine : grossByLine,
                tieBreakers,
                `cobros de la orden ${order.id}`
            );
            const selectedCents = (amounts: number[]) =>
                matchingIndexes.reduce((sum, index) => sum + amounts[index], 0);
            const orderDiscount = selectedCents(discountByLine) / 100;
            const selectedTax = selectedCents(taxByLine) / 100;
            const selectedTip = selectedCents(tipByLine) / 100;
            const selectedTotal = selectedCents(totalByLine) / 100;
            const selectedCollected = selectedCents(collectedByLine) / 100;

            matchedOrderIds.add(order.id);
            totalDiscount += orderDiscount;
            totalTax += selectedTax;
            totalTip += selectedTip;
            grossOrderTotal += selectedTotal;
            collected += selectedCollected;

            for (const [itemIndex, item] of matchingItems.entries()) {
                const subtotal = Math.round(Number(item.subtotal) * 100) / 100;
                totalSales += subtotal;
                items.push({
                    date: order.closedAt as Date,
                    orderNumber: order.invoiceNumber || String(order.id),
                    productName: item.menuItem?.name || 'Unknown',
                    categoryName: item.menuItem?.category?.name || null,
                    brandName: item.menuItem?.brand?.name || null,
                    quantity: item.quantity,
                    unitPrice: Math.round(Number(item.price) * 100) / 100,
                    // An order-level discount is shown once so exported rows remain summable.
                    discount: itemIndex === 0 ? orderDiscount : 0,
                    totalSale: subtotal,
                    paymentMethod: paymentMethodName,
                    userName: order.user?.name || 'Unknown',
                    branchName: order.branch?.name || null,
                    companyName: order.company?.name || null
                });
            }
        }

        for (const note of creditNotes) {
            const matchingLines = note.lines.filter((line) => {
                const menuItem = line.orderItem.menuItem;
                if (selectedCategoryIds && (!menuItem.categoryId || !selectedCategoryIds.has(menuItem.categoryId))) return false;
                if (filters?.brandId && menuItem.brandId !== filters.brandId) return false;
                return true;
            });
            if (matchingLines.length === 0) continue;
            creditNoteCount += 1;
            const methodName = [...new Set(note.refunds.map((refund) => refund.payment.paymentMethod.name))].join(', ') || 'N/A';
            for (const line of matchingLines) {
                const gross = Number(line.grossSubtotal);
                const lineDiscount = Number(line.discount);
                const lineTax = Number(line.tax);
                const lineTip = Number(line.tipAmount);
                const lineTotal = Number(line.total);
                totalSales -= gross;
                totalDiscount -= lineDiscount;
                totalTax -= lineTax;
                totalTip -= lineTip;
                grossOrderTotal -= lineTotal;
                collected -= lineTotal;
                items.push({
                    date: note.issuedAt,
                    orderNumber: `${note.originalInvoiceNumber}/${note.number}`,
                    productName: `NC: ${line.orderItem.menuItem.name}`,
                    categoryName: line.orderItem.menuItem.category?.name || null,
                    brandName: line.orderItem.menuItem.brand?.name || null,
                    quantity: -line.quantity,
                    unitPrice: Math.round(Number(line.orderItem.price) * 100) / 100,
                    discount: -lineDiscount,
                    totalSale: -gross,
                    paymentMethod: methodName,
                    userName: note.order.user?.name || 'Unknown',
                    branchName: note.order.branch?.name || null,
                    companyName: note.order.company?.name || null
                });
            }
        }

        return {
            items,
            summary: {
                totalOrders: matchedOrderIds.size,
                creditNoteCount,
                // Backwards compatible: totalSales remains the sum of matching item subtotals.
                totalSales: Math.round(totalSales * 100) / 100,
                netItemSales: Math.round(totalSales * 100) / 100,
                orderDiscount: Math.round(totalDiscount * 100) / 100,
                tax: Math.round(totalTax * 100) / 100,
                tip: Math.round(totalTip * 100) / 100,
                grossOrderTotal: Math.round(grossOrderTotal * 100) / 100,
                collected: Math.round(collected * 100) / 100,
                totalDiscount: Math.round(totalDiscount * 100) / 100,
                // Denominator is gross fiscal tickets, including a ticket later
                // offset by a credit note. Removing that ticket would mix gross
                // event count with net money and inflate the average.
                averageTicket: matchedOrderIds.size > 0 ? Math.round((grossOrderTotal / matchedOrderIds.size) * 100) / 100 : 0
            }
        };
    }

    static async getProfitabilityReport(companyId: number, filters?: {
        categoryId?: number;
        branchId?: number;
    }) {
        const menuItemWhere: Prisma.MenuItemWhereInput = {
            companyId,
            active: true,
            ...(filters?.categoryId ? { categoryId: filters.categoryId } : {}),
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
        };

        const menuItems = await prisma.menuItem.findMany({
            where: menuItemWhere,
            include: {
                category: { select: { name: true } },
                recipes: {
                    select: {
                        quantity: true,
                        unit: true,
                        product: { select: { id: true, name: true, unit: true, currentAverageCost: true, cost: true } }
                    }
                }
            }
        });

        const items: Array<{
            menuItemName: string;
            categoryName: string | null;
            price: number;
            estimatedCost: number;
            grossMargin: number;
            marginPercent: number;
            status: 'HIGH' | 'MEDIUM' | 'LOW';
        }> = [];

        for (const mi of menuItems) {
            const price = Math.round(Number(mi.price) * 100) / 100;

            // Cost per portion: convert each recipe quantity to the product's base
            // unit (the unit `currentAverageCost`/`cost` are expressed in) before
            // multiplying by the unit cost. Without this, a "200 g" recipe over a
            // product costed per kg would massively overstate the cost.
            let rawCost = 0;
            for (const r of mi.recipes) {
                const qtyInBase = await this.recipeQuantityInBase(companyId, r);
                const unitCost = effectiveUnitCost(r.product.currentAverageCost, r.product.cost);
                rawCost += qtyInBase * unitCost;
            }

            const estimatedCost = Math.round(rawCost * 100) / 100;
            const grossMargin = Math.round((price - estimatedCost) * 100) / 100;
            const marginPercent = price > 0 ? Math.round(((price - estimatedCost) / price) * 10000) / 100 : 0;
            const status: 'HIGH' | 'MEDIUM' | 'LOW' = marginPercent > 60 ? 'HIGH' : marginPercent >= 30 ? 'MEDIUM' : 'LOW';

            items.push({
                menuItemName: mi.name,
                categoryName: mi.category?.name || null,
                price,
                estimatedCost,
                grossMargin,
                marginPercent,
                status
            });
        }

        const avgMargin = items.length > 0
            ? Math.round(items.reduce((s, i) => s + i.marginPercent, 0) / items.length * 100) / 100
            : 0;
        const lowMarginCount = items.filter(i => i.status === 'LOW').length;

        return {
            items,
            summary: {
                totalItems: items.length,
                avgMargin,
                lowMarginCount
            }
        };
    }

    static async getLowStockReport(companyId: number, filters?: {
        warehouseId?: number;
        categoryId?: number;
    }) {
        const stockWhere: Prisma.StockWhereInput = {
            companyId,
            ...(filters?.warehouseId ? { warehouseId: filters.warehouseId } : {}),
            ...(filters?.categoryId ? { product: { categoryId: filters.categoryId } } : {}),
            product: {
                ...(filters?.categoryId ? { categoryId: filters.categoryId } : {}),
                minStock: { gt: 0 }
            }
        };

        const stocks = await prisma.stock.findMany({
            where: stockWhere,
            include: {
                product: {
                    select: {
                        name: true, unit: true, minStock: true,
                        category: { select: { name: true } }
                    }
                },
                warehouse: { select: { name: true } }
            }
        });

        // Filter in application: quantity < minStock
        const lowStockItems = stocks
            .filter(s => Number(s.quantity) < Number(s.product.minStock))
            .map(s => {
                const currentStock = Math.round(Number(s.quantity) * 100) / 100;
                const minStock = Math.round(Number(s.product.minStock) * 100) / 100;
                const deficit = Math.round((minStock - currentStock) * 100) / 100;
                const criticality: 'CRITICAL' | 'WARNING' = currentStock <= 0 ? 'CRITICAL' : 'WARNING';

                return {
                    productName: s.product.name,
                    categoryName: s.product.category?.name || null,
                    warehouseName: s.warehouse.name,
                    currentStock,
                    minStock,
                    deficit,
                    unit: s.product.unit,
                    criticality
                };
            });

        const criticalCount = lowStockItems.filter(i => i.criticality === 'CRITICAL').length;
        const warningCount = lowStockItems.filter(i => i.criticality === 'WARNING').length;

        return {
            items: lowStockItems,
            summary: {
                totalLowStock: lowStockItems.length,
                criticalCount,
                warningCount
            }
        };
    }
}
