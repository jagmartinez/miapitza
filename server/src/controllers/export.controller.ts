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

            const result = await OrderService.getAll(companyId, { ...filters, limit: 10000 });

            // Transform data for CSV
            const data = result.data.map((order: OrderListRow) => {
                const subtotal = (order.items || []).reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
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
                    'Impuestos': Number(order.tax || 0).toFixed(2),
                    'Total': Number(order.total || 0).toFixed(2),
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

            const movements = await InventoryMovementService.getAll(companyId, filters);

            const data = movements.map((movement: InventoryMovementRow) => ({
                'ID': movement.id,
                'Fecha': new Date(movement.createdAt).toLocaleDateString('es-ES'),
                'Producto': movement.product?.name || 'N/A',
                'Tipo': movement.type,
                'Cantidad': movement.quantity,
                'Unidad': movement.product?.unit || 'N/A',
                'Almacén': movement.warehouse?.name || 'N/A',
                'Usuario': movement.user?.name || 'Sistema',
                'Notas': movement.reason || ''
            }));

            const fields = ['ID', 'Fecha', 'Producto', 'Tipo', 'Cantidad', 'Unidad', 'Almacén', 'Usuario', 'Notas'];
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
