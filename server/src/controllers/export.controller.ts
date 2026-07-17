import { Request, Response } from 'express';
import { toCSV } from '../utils/csv';
import { ReportService } from '../services/report.service';
import { OrderService } from '../services/order.service';
import { InventoryMovementService } from '../services/inventory-movement.service';
import { getErrorMessage } from '../utils/error';
import { parseOptionalQueryDateFrom, parseOptionalQueryDateTo } from '../utils/date-range';

type OrderListRow = Awaited<ReturnType<typeof OrderService.getAll>>['data'][number];
type InventoryMovementRow = Awaited<ReturnType<typeof InventoryMovementService.getAll>>[number];
type TopProductRow = Awaited<ReturnType<typeof ReportService.getTopSellingProducts>>[number];
type SalesByUserRow = Awaited<ReturnType<typeof ReportService.getSalesByUser>>[number];

function requireExportNumber(value: unknown, field: string, rowId: number): number {
    if (value == null) throw new Error(`Exportación bloqueada: ${field} ausente en registro ${rowId}`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Exportación bloqueada: ${field} inválido en registro ${rowId}`);
    return parsed;
}

function inventoryCostCells(movement: InventoryMovementRow, quantity: number): { unitCost: string; totalCost: string } {
    const rawUnit = movement.unitCost == null ? null : Number(movement.unitCost);
    const rawTotal = movement.totalCost == null ? null : Number(movement.totalCost);
    const unitCost = rawUnit != null && Number.isFinite(rawUnit) && rawUnit >= 0
        ? rawUnit
        : (rawTotal != null && Number.isFinite(rawTotal) && rawTotal >= 0 && quantity > 0 ? rawTotal / quantity : null);
    const totalCost = rawTotal != null && Number.isFinite(rawTotal) && rawTotal >= 0
        ? rawTotal
        : (unitCost != null ? unitCost * quantity : null);
    return {
        unitCost: unitCost == null ? 'N/D' : unitCost.toFixed(6),
        totalCost: totalCost == null ? 'N/D' : totalCost.toFixed(6),
    };
}

export class ExportController {

    // Export sales report to CSV
    static async exportSales(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const { startDate, endDate, branchId } = req.query;

            const filters: NonNullable<Parameters<typeof OrderService.getAll>[1]> = {};
            if (startDate) filters.startDate = parseOptionalQueryDateFrom(startDate as string, req.user!.timezone);
            if (endDate) filters.endDate = parseOptionalQueryDateTo(endDate as string, req.user!.timezone);
            if (branchId) filters.branchId = parseInt(branchId as string);

            // OrderService caps each page at 200. Fetch the complete, fixed
            // createdAt window instead of silently exporting only the first page.
            const exportFilters = { ...filters, endDate: filters.endDate ?? new Date() };
            const orders: OrderListRow[] = [];
            let page = 1;
            let totalPages = 1;
            do {
                const result = await OrderService.getAll(companyId, { ...exportFilters, page, limit: 200 });
                orders.push(...result.data);
                totalPages = result.pagination.totalPages;
                page += 1;
            } while (page <= totalPages);

            // Transform data for CSV
            const data = orders.map((order: OrderListRow) => {
                if (!Array.isArray(order.items)) throw new Error(`Exportación bloqueada: detalle ausente en orden ${order.id}`);
                const subtotal = order.items.reduce(
                    (sum, item) => sum + requireExportNumber(item.subtotal, 'subtotal de línea', order.id),
                    0
                );
                const paymentMethods = Array.from(
                    new Set((order.payments || []).map((payment) => payment.paymentMethod?.name).filter(Boolean))
                );
                return {
                    'ID': order.id,
                    'Fecha': new Date(order.createdAt).toLocaleDateString('es-ES'),
                    'Hora': new Date(order.createdAt).toLocaleTimeString('es-ES'),
                    'Mesa': order.table?.number || 'N/A',
                    'Mesero': order.user?.name || 'N/A',
                    'Cliente': order.customerName || 'N/A',
                    'Estado': order.status,
                    'Subtotal': subtotal.toFixed(2),
                    'Impuestos': requireExportNumber(order.tax, 'impuesto', order.id).toFixed(2),
                    'Total': requireExportNumber(order.total, 'total', order.id).toFixed(2),
                    'Método de Pago': paymentMethods.length > 0 ? paymentMethods.join(' / ') : 'N/A'
                };
            });

            const fields = ['ID', 'Fecha', 'Hora', 'Mesa', 'Mesero', 'Cliente', 'Estado', 'Subtotal', 'Impuestos', 'Total', 'Método de Pago'];
            const csv = toCSV(data, fields);

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=ventas_${Date.now()}.csv`);
            res.send('\uFEFF' + csv); // UTF-8 BOM for Excel compatibility
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: getErrorMessage(error) });
        }
    }

    // Export inventory movements to CSV
    static async exportInventory(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const { startDate, endDate, warehouseId } = req.query;

            const filters: NonNullable<Parameters<typeof InventoryMovementService.getAll>[1]> = {};
            if (startDate) filters.startDate = parseOptionalQueryDateFrom(startDate as string, req.user!.timezone);
            if (endDate) filters.endDate = parseOptionalQueryDateTo(endDate as string, req.user!.timezone);
            if (warehouseId) filters.warehouseId = parseInt(warehouseId as string);

            // InventoryMovementService caps each page at 500. Keep a fixed upper
            // time bound and walk every page so historical exports are complete.
            const exportFilters = { ...filters, endDate: filters.endDate ?? new Date(), limit: 500 };
            const movements: InventoryMovementRow[] = [];
            for (let page = 1; ; page += 1) {
                const batch = await InventoryMovementService.getAll(companyId, { ...exportFilters, page });
                movements.push(...batch);
                if (batch.length < 500) break;
            }

            const data = movements.map((movement: InventoryMovementRow) => {
                const quantity = requireExportNumber(movement.quantity, 'cantidad', movement.id);
                const costs = inventoryCostCells(movement, quantity);
                return {
                    'ID': movement.id,
                    'Fecha': new Date(movement.createdAt).toLocaleDateString('es-ES'),
                    'Producto': movement.product?.name || 'N/A',
                    'Tipo': movement.type,
                    'Cantidad': quantity,
                    'Unidad': movement.product?.unit || 'N/A',
                    'Costo Unitario': costs.unitCost,
                    'Costo Total': costs.totalCost,
                    'Almacén': movement.warehouse?.name || 'N/A',
                    'Usuario': movement.user?.name || 'Sistema',
                    'Notas': movement.reason || ''
                };
            });

            const fields = ['ID', 'Fecha', 'Producto', 'Tipo', 'Cantidad', 'Unidad', 'Costo Unitario', 'Costo Total', 'Almacén', 'Usuario', 'Notas'];
            const csv = toCSV(data, fields);

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=inventario_${Date.now()}.csv`);
            res.send('\uFEFF' + csv);
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: getErrorMessage(error) });
        }
    }

    // Export top products report to CSV
    static async exportTopProducts(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const { branchId, limit } = req.query;

            const topProducts = await ReportService.getTopSellingProducts(
                companyId,
                branchId ? parseInt(branchId as string) : undefined,
                limit ? parseInt(limit as string) : 20
            );

            const data = topProducts.map((product: TopProductRow, index: number) => ({
                'Posición': index + 1,
                'Producto': product.name,
                'Cantidad Vendida': product.totalQuantity,
                'Ingresos Totales': product.totalRevenue
            }));

            const fields = ['Posición', 'Producto', 'Cantidad Vendida', 'Ingresos Totales'];
            const csv = toCSV(data, fields);

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=productos_top_${Date.now()}.csv`);
            res.send('\uFEFF' + csv);
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: getErrorMessage(error) });
        }
    }

    // Export sales by user report to CSV
    static async exportSalesByUser(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const { branchId, startDate, endDate } = req.query;

            const salesByUser = await ReportService.getSalesByUser(
                companyId,
                branchId ? parseInt(branchId as string) : undefined,
                parseOptionalQueryDateFrom(startDate as string | undefined, req.user!.timezone),
                parseOptionalQueryDateTo(endDate as string | undefined, req.user!.timezone)
            );

            const data = salesByUser.map((user: SalesByUserRow, index: number) => ({
                'Posición': index + 1,
                'Mesero': user.userName,
                'Rol': user.userRole,
                'Órdenes': user.orderCount,
                'Ventas Totales': user.totalSales
            }));

            const fields = ['Posición', 'Mesero', 'Rol', 'Órdenes', 'Ventas Totales'];
            const csv = toCSV(data, fields);

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=ventas_por_mesero_${Date.now()}.csv`);
            res.send('\uFEFF' + csv);
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: getErrorMessage(error) });
        }
    }
}
