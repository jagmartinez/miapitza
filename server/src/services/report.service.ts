import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from './unit-conversion.service';

const CHART_COLORS = ['#60a5fa', '#34d399', '#818cf8', '#fbbf24', '#f87171', '#a78bfa'];

export class ReportService {
    static async getDashboardStats(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const orderBase: Prisma.OrderWhereInput = { companyId, ...branchFilter };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 1. Sales today
        const todayOrders = await prisma.order.findMany({
            where: {
                ...orderBase,
                createdAt: { gte: today },
                status: 'PAID'
            },
            select: { total: true }
        });

        const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.total), 0);

        // 2. Active orders
        const activeOrders = await prisma.order.count({
            where: {
                ...orderBase,
                status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] }
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

        // 6. Clients (Proxy: Sum of PeopleCount in Reservations today + Number of paid orders)
        const todayReservations = await prisma.reservation.aggregate({
            where: {
                companyId,
                ...branchFilter,
                date: { gte: today, lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
                status: 'COMPLETED'
            },
            _sum: { peopleCount: true }
        });

        const clientsCount = (todayReservations._sum.peopleCount || 0) + todayOrders.length;

        return {
            todaySales,
            activeOrders,
            pendingPurchaseOrders: pendingPO,
            averageTicket: avgTicket,
            occupancyRate,
            clientsCount
        };
    }

    static async getIncomeBreakdown(companyId: number, branchId?: number, period: 'today' | 'week' | 'month' | 'year' = 'month') {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};

        const startDate = new Date();
        if (period === 'today') startDate.setHours(0, 0, 0, 0);
        else if (period === 'week') startDate.setDate(startDate.getDate() - 7);
        else if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
        else startDate.setFullYear(startDate.getFullYear() - 1);

        const where: Prisma.OrderItemWhereInput = {
            order: {
                companyId,
                status: 'PAID',
                ...branchFilter,
                createdAt: { gte: startDate },
            },
        };

        const breakdown = await prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where,
            _sum: { subtotal: true }
        });

        // Fetch categories for these menu items
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: breakdown.map((b) => b.menuItemId) }, companyId },
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

        return Object.entries(categoryData).map(([name, data]) => ({
            name,
            value: data.value,
            fill: data.fill
        }));
    }

    static async getOccupancyHeatmap(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};

        // Last 30 days of data for the heatmap
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const where: Prisma.OrderWhereInput = {
            companyId,
            status: 'PAID',
            ...branchFilter,
            createdAt: { gte: startDate },
        };

        const orders = await prisma.order.findMany({
            where,
            select: { createdAt: true }
        });

        const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const heatmap: Record<string, number> = {};

        orders.forEach((order) => {
            const date = new Date(order.createdAt);
            const day = days[date.getDay()];
            const hour = date.getHours();
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

    static async getShiftEvaluation(companyId: number, branchId?: number) {
        // This is a complex metric, we'll simplify it for now to return aggregations by shift (AM/PM)
        // Radar expects: { subject, A, B, fullMark }
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const where: Prisma.OrderWhereInput = {
            companyId,
            status: 'PAID',
            ...branchFilter,
            createdAt: { gte: today },
        };

        const orders = await prisma.order.findMany({
            where,
            include: { items: true }
        });

        const shiftA = orders.filter((o) => new Date(o.createdAt).getHours() < 16);
        const shiftB = orders.filter((o) => new Date(o.createdAt).getHours() >= 16);

        const getStats = (obs: typeof orders) => ({
            ventas: obs.reduce((s, o) => s + Number(o.total), 0),
            ticket: obs.length > 0 ? obs.reduce((s, o) => s + Number(o.total), 0) / obs.length : 0,
            items: obs.length > 0 ? obs.reduce((s, o) => s + o.items.length, 0) / obs.length : 0,
            count: obs.length,
            avgServiceMinutes: (() => {
                const completed = obs.filter((o) => o.closedAt);
                if (!completed.length) return 0;
                const totalMinutes = completed.reduce((sum, o) => {
                    const startedAt = new Date(o.createdAt).getTime();
                    const closedAt = new Date(o.closedAt as Date).getTime();
                    return sum + Math.max(0, (closedAt - startedAt) / 60000);
                }, 0);
                return totalMinutes / completed.length;
            })()
        });

        const statsA = getStats(shiftA);
        const statsB = getStats(shiftB);

        const maxShiftCount = Math.max(statsA.count, statsB.count, 1);
        const serviceScore = (avgMinutes: number) => {
            // 15 min => ~150, 90+ min => low score. Avoid placeholder constants.
            if (avgMinutes <= 0) return 0;
            const normalized = Math.max(0, 150 - ((avgMinutes - 15) * 2));
            return Math.min(150, Math.round(normalized));
        };

        // Normalize for Radar (0-150) using only real measured data.
        return [
            { subject: 'Ventas', A: Math.min(150, statsA.ventas / 100), B: Math.min(150, statsB.ventas / 100), fullMark: 150 },
            { subject: 'Ticket', A: Math.min(150, statsA.ticket / 5), B: Math.min(150, statsB.ticket / 5), fullMark: 150 },
            { subject: 'Volumen', A: Math.min(150, statsA.count * 10), B: Math.min(150, statsB.count * 10), fullMark: 150 },
            { subject: 'Mix', A: Math.min(150, statsA.items * 30), B: Math.min(150, statsB.items * 30), fullMark: 150 },
            { subject: 'Servicio', A: serviceScore(statsA.avgServiceMinutes), B: serviceScore(statsB.avgServiceMinutes), fullMark: 150 },
            { subject: 'Eficiencia', A: Math.round((statsA.count / maxShiftCount) * 150), B: Math.round((statsB.count / maxShiftCount) * 150), fullMark: 150 },
        ];
    }

    static async getConversionFunnel(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const companyBranch = { companyId, ...branchFilter };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const reservations = await prisma.reservation.count({
            where: { ...companyBranch, date: { gte: today } }
        });

        const visits = await prisma.order.count({
            where: { ...companyBranch, createdAt: { gte: today } }
        });

        const paid = await prisma.order.count({
            where: { ...companyBranch, createdAt: { gte: today }, status: 'PAID' }
        });

        const frequentCustomers = await prisma.order.groupBy({
            by: ['customerName'],
            where: {
                ...companyBranch,
                createdAt: { gte: today },
                status: 'PAID',
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

    static async getServiceTrends(companyId: number, branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = {
            companyId,
            status: 'PAID',
            ...branchFilter,
        };

        const orders = await prisma.order.findMany({
            where,
            take: 50,
            orderBy: { createdAt: 'desc' },
            select: {
                createdAt: true,
                closedAt: true,
                tipAmount: true,
                total: true
            }
        });

        const tips = orders
            .filter((o) => o.closedAt)
            .map((o) => ({
                waitTime: Math.round((new Date(o.closedAt as Date).getTime() - new Date(o.createdAt).getTime()) / 60000),
                tip: Number(o.tipAmount || 0)
            }));

        const spend = orders
            .filter((o) => o.closedAt)
            .map((o) => ({
                dwellTime: Math.round((new Date(o.closedAt as Date).getTime() - new Date(o.createdAt).getTime()) / 60000),
                spend: Number(o.total)
            }));

        return { tips, spend };
    }

    static async getSalesChart(companyId: number, period: 'week' | 'month' = 'week', branchId?: number) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = { companyId, ...branchFilter };

        const endDate = new Date();
        const startDate = new Date();

        if (period === 'week') {
            startDate.setDate(endDate.getDate() - 7);
        } else {
            startDate.setMonth(endDate.getMonth() - 1);
        }

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                createdAt: {
                    gte: startDate,
                    lte: endDate
                },
                status: 'PAID'
            },
            select: {
                createdAt: true,
                total: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        const grouped = orders.reduce((acc, order) => {
            const date = order.createdAt.toISOString().split('T')[0];
            if (!acc[date]) {
                acc[date] = 0;
            }
            acc[date] += Number(order.total);
            return acc;
        }, {} as Record<string, number>);

        const chartData = Object.entries(grouped).map(([date, amount]) => ({
            date,
            amount: amount as number
        }));

        return chartData;
    }

    static async getTopSellingProducts(companyId: number, branchId?: number, limit: number = 10) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const whereItems: Prisma.OrderItemWhereInput = {
            order: {
                companyId,
                status: 'PAID',
                ...branchFilter,
            },
        };

        const topProducts = await prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: whereItems,
            _sum: {
                quantity: true,
                subtotal: true
            },
            orderBy: {
                _sum: {
                    quantity: 'desc'
                }
            },
            take: limit
        });

        const menuItemIds = topProducts.map((p) => p.menuItemId);
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

        const result = topProducts.map((product) => {
            const menuItem = menuItems.find((m) => m.id === product.menuItemId);
            return {
                menuItemId: product.menuItemId,
                name: menuItem?.name || 'Unknown',
                category: menuItem?.category?.name || 'N/A',
                price: menuItem?.price || 0,
                totalQuantity: product._sum.quantity || 0,
                totalRevenue: product._sum.subtotal || 0
            };
        });

        return result;
    }

    static async getSalesByUser(companyId: number, branchId?: number, startDate?: Date, endDate?: Date) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = {
            companyId,
            status: 'PAID',
            ...branchFilter,
            ...(startDate || endDate
                ? {
                      createdAt: {
                          ...(startDate ? { gte: startDate } : {}),
                          ...(endDate ? { lte: endDate } : {}),
                      },
                  }
                : {}),
        };

        const salesByUser = await prisma.order.groupBy({
            by: ['userId'],
            where,
            _sum: {
                total: true
            },
            _count: {
                id: true
            },
            orderBy: {
                _sum: {
                    total: 'desc'
                }
            }
        });

        const userIds = salesByUser.map((s) => s.userId);
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

        const result = salesByUser.map((sale) => {
            const user = users.find((u) => u.id === sale.userId);
            return {
                userId: sale.userId,
                userName: user?.name || 'Unknown',
                userRole: user?.role?.name || 'Unknown',
                totalSales: sale._sum.total || 0,
                orderCount: sale._count.id || 0,
                averageOrderValue: sale._count.id ? Number(sale._sum.total || 0) / sale._count.id : 0
            };
        });

        return result;
    }

    static async getRecentOrders(companyId: number, branchId?: number, limit: number = 5) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.OrderWhereInput = { companyId, ...branchFilter };

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                status: {
                    in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED']
                }
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
        if (todayOnly) {
            const start = new Date(); start.setHours(0, 0, 0, 0);
            const end = new Date(); end.setHours(23, 59, 59, 999);
            closedAt = { gte: start, lte: end };
        }
        const where: Prisma.OrderWhereInput = {
            companyId,
            ...branchFilter,
            ...(closedAt ? { closedAt } : {}),
        };

        const orders = await prisma.order.findMany({
            where: {
                ...where,
                status: {
                    in: ['PAID', 'CANCELLED']
                }
            },
            select: {
                id: true,
                total: true,
                status: true,
                createdAt: true,
                items: {
                    select: {
                        id: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: limit
        });

        return orders.map((order) => {
            const time = new Date(order.createdAt);
            return {
                id: `I-${String(order.id).padStart(3, '0')}`,
                time: time.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                amount: Number(order.total),
                status: order.status === 'PAID' ? 'paid' : 'cancelled',
                items: order.items?.length || 0
            };
        });
    }

    static async getTodaysReservations(companyId: number, branchId?: number, days: number = 1) {
        const branchFilter: { branchId?: number } = branchId ? { branchId } : {};
        const where: Prisma.ReservationWhereInput = { companyId, ...branchFilter };

        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + days);

        const reservations = await prisma.reservation.findMany({
            where: {
                ...where,
                date: { gte: start, lt: end },
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
                time: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
                day: d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }),
                name: res.customerName,
                pax: res.peopleCount,
                status: res.status.toLowerCase()
            };
        });
    }

    static async getMyStats(userId: number, companyId: number, role: string = 'MESERO') {
        const today = new Date(); today.setHours(0, 0, 0, 0);

        // ── COCINA ──
        if (role === 'COCINA') {
            const pendingOrders = await prisma.order.count({ where: { companyId, status: { in: ['SENT_TO_KITCHEN', 'IN_PREPARATION'] } } });
            const readyOrders = await prisma.order.count({ where: { companyId, status: 'READY' } });

            const todayPaidItems = await prisma.orderItem.findMany({
                where: { order: { companyId, status: 'PAID', createdAt: { gte: today } } },
                select: { quantity: true }
            });
            const dishesToday = todayPaidItems.reduce((s, i) => s + i.quantity, 0);

            const topDishData = await prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: { order: { companyId, createdAt: { gte: today }, status: { in: ['PAID', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } } },
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
                where: { order: { companyId, status: 'PAID', createdAt: { gte: today } } },
                select: { quantity: true }
            });
            const dishesToday = todayPaidItems.reduce((s, i) => s + i.quantity, 0);

            const topDishData = await prisma.orderItem.groupBy({
                by: ['menuItemId'],
                where: { order: { companyId, createdAt: { gte: today }, status: { in: ['PAID', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'] } } },
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

            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
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

            const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
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
            const paidOrders = await prisma.order.findMany({
                where: { companyId, userId, createdAt: { gte: today }, status: 'PAID' },
                select: { total: true }
            });
            const salesToday = paidOrders.reduce((s, o) => s + Number(o.total), 0);
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
                where: { companyId, status: 'PAID', closedAt: { gte: today } }
            });

            const paymentRows = await prisma.payment.findMany({
                where: { order: { companyId, status: 'PAID', closedAt: { gte: today } } },
                include: { paymentMethod: { select: { name: true } } }
            });
            const breakdownMap = new Map<string, number>();
            for (const p of paymentRows) {
                const method = p.paymentMethod?.name || 'Otro';
                breakdownMap.set(method, (breakdownMap.get(method) || 0) + Number(p.amount));
            }
            const paymentBreakdown = Array.from(breakdownMap, ([method, total]) => ({ method, total }));

            const myActiveOrders = await prisma.order.findMany({
                where: { companyId, userId, status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] } },
                select: { id: true, total: true, status: true, table: { select: { number: true } } },
                orderBy: { createdAt: 'desc' }, take: 10
            });
            const myOrders = myActiveOrders.map((o) => ({
                id: `ORD-${o.id}`, table: o.table?.number || 'Para llevar', total: Number(o.total), status: o.status.toLowerCase()
            }));

            return { role: 'CAJERO', salesToday, ordersToday, avgTicket, activeShift, invoicesToday, paymentBreakdown, myOrders };
        }

        // ── MESERO / HOST / DEFAULT ──
        const paidOrders = await prisma.order.findMany({
            where: { companyId, userId, createdAt: { gte: today }, status: 'PAID' },
            select: { total: true }
        });
        const salesToday = paidOrders.reduce((s, o) => s + Number(o.total), 0);
        const ordersToday = paidOrders.length;
        const avgTicket = ordersToday > 0 ? salesToday / ordersToday : 0;

        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const topProductData = await prisma.orderItem.groupBy({
            by: ['menuItemId'],
            where: { order: { userId, companyId, status: 'PAID', createdAt: { gte: thirtyDaysAgo } } },
            _sum: { quantity: true, subtotal: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 5
        });
        const topProductMenuItems = await prisma.menuItem.findMany({
            where: { id: { in: topProductData.map((tp) => tp.menuItemId) }, companyId },
            select: { id: true, name: true }
        });
        const topProductNameById = new Map(topProductMenuItems.map((mi) => [mi.id, mi.name]));
        const topProducts = topProductData.map((tp) => ({
            menuItemId: tp.menuItemId,
            name: topProductNameById.get(tp.menuItemId) || '?',
            totalQuantity: tp._sum.quantity || 0,
            totalRevenue: Number(tp._sum.subtotal || 0)
        }));

        const activeOrders = await prisma.order.findMany({
                where: { companyId, userId, status: { in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'] } },
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
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 6);
        weekAgo.setHours(0, 0, 0, 0);

        // Daily sales for current user (last 7 days)
        const myOrders = await prisma.order.findMany({
            where: { userId, companyId, status: 'PAID', createdAt: { gte: weekAgo } },
            select: { total: true, createdAt: true }
        });

        // Team average (all users, same period)
        const teamOrders = await prisma.order.findMany({
            where: { companyId, status: 'PAID', createdAt: { gte: weekAgo } },
            select: { total: true, userId: true, createdAt: true }
        });

        // Build daily data
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const dailyData = [];
        const teamUserIds = new Set(teamOrders.map((o) => o.userId));
        const teamSize = Math.max(teamUserIds.size, 1);

        for (let i = 0; i < 7; i++) {
            const d = new Date(weekAgo);
            d.setDate(weekAgo.getDate() + i);
            const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);

            const mySales = myOrders
                .filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) <= dayEnd)
                .reduce((s, o) => s + Number(o.total), 0);

            const teamTotal = teamOrders
                .filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) <= dayEnd)
                .reduce((s, o) => s + Number(o.total), 0);

            dailyData.push({
                day: dayNames[d.getDay()],
                date: d.toISOString().slice(0, 10),
                mySales: Math.round(mySales * 100) / 100,
                teamAvg: Math.round((teamTotal / teamSize) * 100) / 100,
            });
        }

        // Overall comparison
        const myTotal = myOrders.reduce((s, o) => s + Number(o.total), 0);
        const teamAvgTotal = teamOrders.reduce((s, o) => s + Number(o.total), 0) / teamSize;
        const vsTeam = teamAvgTotal > 0 ? Math.round(((myTotal - teamAvgTotal) / teamAvgTotal) * 100) : 0;

        // Order stats
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
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
            where: { companyId, name: 'password_expiry_days' }
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

        for (const po of purchaseOrders) {
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                if (filters?.productId && item.productId !== filters.productId) continue;

                const cost = Number(item.subtotal);
                totalPurchaseCost += cost;

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
                productCosts[item.productId].totalQuantity += Number(item.quantity);
                productCosts[item.productId].totalCost += cost;
            }
        }

        const productList = Object.values(productCosts).map(p => ({
            ...p,
            avgUnitCost: p.totalQuantity > 0 ? p.totalCost / p.totalQuantity : 0
        }));

        // COGS estimate from sold orders in the period
        const orderWhere: Prisma.OrderWhereInput = {
            companyId,
            status: { in: ['PAID', 'DELIVERED'] },
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.dateFrom || filters?.dateTo
                ? {
                      createdAt: {
                          ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                      },
                  }
                : {}),
        };

        const soldOrders = await prisma.order.findMany({
            where: orderWhere,
            select: {
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
                                        product: { select: { id: true, unit: true, currentAverageCost: true, cost: true } }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        let estimatedCOGS = 0;
        let totalRevenue = 0;
        for (const order of soldOrders) {
            totalRevenue += Number(order.total);
            for (const item of order.items) {
                for (const recipe of (item.menuItem?.recipes || [])) {
                    const recipeUnit = recipe.unit || recipe.product.unit;
                    let qtyInBase = Number(recipe.quantity);
                    try {
                        const conv = await UnitConversionService.convert(
                            recipe.product.id,
                            companyId,
                            Number(recipe.quantity),
                            recipeUnit
                        );
                        qtyInBase = conv.baseQuantity;
                    } catch {
                        // Fallback to legacy quantity when conversion is not configured
                    }
                    const unitCost = Number(recipe.product.currentAverageCost || recipe.product.cost || 0);
                    estimatedCOGS += qtyInBase * item.quantity * unitCost;
                }
            }
        }

        return {
            summary: {
                totalPurchaseCost: Math.round(totalPurchaseCost * 100) / 100,
                estimatedCOGS: Math.round(estimatedCOGS * 100) / 100,
                totalRevenue: Math.round(totalRevenue * 100) / 100,
                grossMargin: totalRevenue > 0 ? Math.round((totalRevenue - estimatedCOGS) / totalRevenue * 10000) / 100 : 0,
                purchaseOrderCount: purchaseOrders.length
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
                        minStock: true, currentAverageCost: true,
                        category: { select: { name: true } }
                    }
                },
                warehouse: { select: { name: true } }
            }
        });

        const items = stocks.map(s => {
            const qty = Number(s.quantity);
            const minStock = Number(s.product.minStock);
            const avgCost = Number(s.product.currentAverageCost);
            const totalValue = Math.round(qty * avgCost * 100) / 100;
            const status: 'CRITICAL' | 'LOW' | 'OK' = qty <= 0 ? 'CRITICAL' : qty < minStock ? 'LOW' : 'OK';
            return {
                productId: s.product.id,
                productName: s.product.name,
                sku: s.product.sku,
                unit: s.product.unit,
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
            ...(filters?.status ? { status: filters.status as any } : {}),
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
                                name: true, categoryId: true,
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
            quantity: number; unitCost: number; totalCost: number; status: string;
        }[] = [];

        const supplierSet = new Set<number>();
        const productSet = new Set<number>();
        let totalAmount = 0;

        for (const po of purchaseOrders) {
            supplierSet.add(po.supplierId);
            for (const item of po.items) {
                if (filters?.categoryId && item.product.categoryId !== filters.categoryId) continue;
                productSet.add(item.productId);
                const cost = Math.round(Number(item.subtotal) * 100) / 100;
                totalAmount += cost;
                items.push({
                    date: po.date,
                    poNumber: po.invoiceNumber,
                    supplierName: po.supplier.name,
                    productName: item.product.name,
                    categoryName: item.product.category?.name || null,
                    quantity: Math.round(Number(item.quantity) * 100) / 100,
                    unitCost: Math.round(Number(item.cost) * 100) / 100,
                    totalCost: cost,
                    status: po.status
                });
            }
        }

        return {
            items,
            summary: {
                totalOrders: purchaseOrders.length,
                totalAmount: Math.round(totalAmount * 100) / 100,
                uniqueSuppliers: supplierSet.size,
                uniqueProducts: productSet.size
            }
        };
    }

    static async getSalesReport(companyId: number, filters?: {
        dateFrom?: Date;
        dateTo?: Date;
        branchId?: number;
        categoryId?: number;
        brandId?: number;
        userId?: number;
        paymentMethodId?: number;
    }) {
        const orderWhere: Prisma.OrderWhereInput = {
            companyId,
            status: 'PAID',
            ...(filters?.branchId ? { branchId: filters.branchId } : {}),
            ...(filters?.userId ? { userId: filters.userId } : {}),
            ...(filters?.dateFrom || filters?.dateTo
                ? {
                      createdAt: {
                          ...(filters?.dateFrom ? { gte: filters.dateFrom } : {}),
                          ...(filters?.dateTo ? { lte: filters.dateTo } : {}),
                      },
                  }
                : {}),
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
            orderBy: { createdAt: 'desc' }
        });

        const items: {
            date: Date; orderNumber: string; productName: string;
            categoryName: string | null; brandName: string | null; quantity: number; unitPrice: number;
            discount: number; totalSale: number; paymentMethod: string; userName: string;
            branchName: string | null; companyName: string | null;
        }[] = [];

        let totalSales = 0;
        let totalDiscount = 0;

        for (const order of orders) {
            const paymentMethodName = order.payments.map(p => p.paymentMethod.name).join(', ') || 'N/A';
            const orderDiscount = Math.round(Number(order.discount) * 100) / 100;
            totalDiscount += orderDiscount;

            for (const item of order.items) {
                if (filters?.categoryId && item.menuItem?.categoryId !== filters.categoryId) continue;
                if (filters?.brandId && item.menuItem?.brandId !== filters.brandId) continue;
                const subtotal = Math.round(Number(item.subtotal) * 100) / 100;
                totalSales += subtotal;
                items.push({
                    date: order.createdAt,
                    orderNumber: order.invoiceNumber || String(order.id),
                    productName: item.menuItem?.name || 'Unknown',
                    categoryName: item.menuItem?.category?.name || null,
                    brandName: item.menuItem?.brand?.name || null,
                    quantity: item.quantity,
                    unitPrice: Math.round(Number(item.price) * 100) / 100,
                    discount: orderDiscount,
                    totalSale: subtotal,
                    paymentMethod: paymentMethodName,
                    userName: order.user?.name || 'Unknown',
                    branchName: order.branch?.name || null,
                    companyName: order.company?.name || null
                });
            }
        }

        return {
            items,
            summary: {
                totalOrders: orders.length,
                totalSales: Math.round(totalSales * 100) / 100,
                totalDiscount: Math.round(totalDiscount * 100) / 100,
                averageTicket: orders.length > 0 ? Math.round((totalSales / orders.length) * 100) / 100 : 0
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
                        product: { select: { id: true, unit: true, currentAverageCost: true, cost: true } }
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
                const recipeUnit = r.unit || r.product.unit;
                let qtyInBase = Number(r.quantity);
                try {
                    const conv = await UnitConversionService.convert(
                        r.product.id,
                        companyId,
                        Number(r.quantity),
                        recipeUnit
                    );
                    qtyInBase = conv.baseQuantity;
                } catch {
                    // Legacy products without configured units fall back to 1:1.
                }
                const unitCost = Number(r.product.currentAverageCost || r.product.cost || 0);
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
