import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, warehousesAPI, menuBrandsAPI, productionReportsAPI } from '../services/api';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, Input, LoadErrorState, PageContent, PageHeader, Switch,
    formatMoney, formatNumber, formatPercent, getUiPrefs, type Column, type Tone,
} from '@/ui';
import { ParetoBars } from '@/ui/charts';
import {
    Package, ShoppingCart, DollarSign, TrendingUp, BarChart3, AlertTriangle,
    ArrowLeft, Download, Search, FileSpreadsheet, Truck,
    FileText, Calendar, Clock, Users, PieChart, Shield,
    GitCompare, Activity, CreditCard, Building2, Factory
} from 'lucide-react';
import type { Branch, Supplier } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import {
    buildChartSeries, buildQuickRead, compareSummaries, isAdditiveColumn, previousPeriod,
} from './reports/reportInsights';
import './reports/reports.css';

interface CategoryOption { id: number; name: string }
interface WarehouseOption { id: number; name: string }
interface BrandOption { id: number; name: string }
const fmtDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('es-NI');
};

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
};

type ReportDef = {
    id: string;
    name: string;
    description: string;
    icon: typeof Package;
    category: string;
    navigateTo?: string;
    hiddenInHub?: boolean;
};

const REPORT_CATALOG: ReportDef[] = [
    // Inventario
    { id: 'inventory', name: 'Inventario Actual', description: 'Existencias por producto, almacén y categoría con valorización. Incluye vista de stock bajo.', icon: Package, category: 'Inventario' },
    { id: 'kardex', name: 'Kardex de Movimientos', description: 'Entradas, salidas, ajustes y traslados de inventario.', icon: FileSpreadsheet, category: 'Inventario', navigateTo: '/kardex' },
    { id: 'low-stock', name: 'Stock Bajo', description: 'Productos con inventario por debajo del mínimo configurado.', icon: AlertTriangle, category: 'Inventario', hiddenInHub: true },
    // Compras
    { id: 'purchases', name: 'Compras General', description: 'Análisis consolidado de compras. Incluye vistas por día, mes, proveedor y productos.', icon: Truck, category: 'Compras' },
    { id: 'purchases-by-day', name: 'Compras por Día', description: 'Historial de compras diario con montos y cantidad de órdenes.', icon: Calendar, category: 'Compras', hiddenInHub: true },
    { id: 'purchases-by-month', name: 'Compras por Mes', description: 'Tendencia mensual de compras acumuladas.', icon: BarChart3, category: 'Compras', hiddenInHub: true },
    { id: 'purchases-by-supplier', name: 'Compras por Proveedor', description: 'Distribución del gasto entre proveedores con porcentaje del total.', icon: Truck, category: 'Compras', hiddenInHub: true },
    { id: 'price-comparison', name: 'Comparación de Precios', description: 'Matriz de precios por producto y proveedor con variación.', icon: GitCompare, category: 'Compras', hiddenInHub: true },
    { id: 'most-purchased', name: 'Productos Más Comprados', description: 'Top de productos por volumen y costo total de compra.', icon: TrendingUp, category: 'Compras', hiddenInHub: true },
    // Ventas
    { id: 'sales', name: 'Ventas General', description: 'Ventas consolidadas con vistas por día, mes, categoría, método de pago, canal, hora y usuario.', icon: ShoppingCart, category: 'Ventas' },
    { id: 'sales-daily', name: 'Ventas Diarias', description: 'Resumen de ventas día a día con ticket promedio.', icon: Calendar, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-monthly', name: 'Ventas Mensuales', description: 'Ventas por mes con variación mes a mes.', icon: BarChart3, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-category', name: 'Ventas por Categoría', description: 'Distribución de ventas por categoría con porcentaje del total.', icon: PieChart, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-product', name: 'Ventas por Producto', description: 'Unidades, órdenes e ingresos por producto dentro de un rango de fechas, categoría y sucursal.', icon: Package, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-brand', name: 'Ventas por Empresa', description: 'Distribución de ventas por empresa/marca con porcentaje del total. El arqueo de caja sigue siendo único.', icon: Building2, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-payment-method', name: 'Ventas por Método de Pago', description: 'Desglose de pagos: efectivo, tarjeta, transferencia, etc.', icon: CreditCard, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-waiter', name: 'Ventas por Mesero', description: 'Rendimiento de ventas por usuario/mesero.', icon: Users, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-channel', name: 'Ventas por Canal', description: 'Restaurante vs Delivery vs PedidosYa con comisiones y margen.', icon: Activity, category: 'Ventas', hiddenInHub: true },
    { id: 'sales-by-hour', name: 'Ventas por Hora', description: 'Análisis de horas pico y distribución horaria de ventas.', icon: Clock, category: 'Ventas', hiddenInHub: true },
    // Costos
    { id: 'costs', name: 'Costos', description: 'COGS estimado, costos de compra y margen bruto por período.', icon: DollarSign, category: 'Costos', navigateTo: '/cost-report' },
    { id: 'profitability', name: 'Rentabilidad por Producto', description: 'Análisis consolidado de rentabilidad, food cost y margen por producto/categoría.', icon: TrendingUp, category: 'Costos' },
    { id: 'food-cost-by-category', name: 'Food Cost por Categoría', description: 'Porcentaje de food cost y margen bruto por categoría.', icon: PieChart, category: 'Costos', hiddenInHub: true },
    { id: 'margin-by-product', name: 'Margen por Producto', description: 'Productos más rentables ordenados por margen de contribución.', icon: TrendingUp, category: 'Costos', hiddenInHub: true },
    // Auditoría y Control
    { id: 'audit', name: 'Registro de Auditoría', description: 'Log de acciones del sistema: quién hizo qué y cuándo.', icon: Shield, category: 'Auditoría' },
    // Toma de Decisiones
    { id: 'day-analysis', name: 'Análisis por Día', description: 'Días más fuertes y débiles de la semana para planificación.', icon: Calendar, category: 'Decisiones' },
    { id: 'month-comparison', name: 'Comparación Mes vs Mes', description: 'Compara ventas entre dos meses con variación absoluta y porcentual.', icon: GitCompare, category: 'Decisiones' },
    // Producción
    { id: 'recipe-cost', name: 'Costos de Recetas', description: 'Análisis consolidado de producción: costo receta, rendimiento, productos estrella y proyección de compras.', icon: FileText, category: 'Producción' },
    { id: 'production-yield', name: 'Rendimiento de Producción', description: 'Porciones posibles con stock actual y ingrediente limitante.', icon: Package, category: 'Producción', hiddenInHub: true },
    { id: 'menu-engineering', name: 'Productos Estrella', description: 'Clasificación BCG: Estrellas, Puzzles, Caballos de Trabajo y Perros.', icon: TrendingUp, category: 'Producción', hiddenInHub: true },
    { id: 'purchase-projection', name: 'Proyección de Compras', description: 'Estimación de necesidades de compra basado en velocidad de ventas.', icon: ShoppingCart, category: 'Producción', hiddenInHub: true },
    { id: 'prod-orders', name: 'Producciones Realizadas', description: 'Órdenes de producción del período con cantidades y costos.', icon: Factory, category: 'Producción' },
    { id: 'prod-plan-vs-real', name: 'Plan vs Real (Rendimiento)', description: 'Diferencias entre cantidad planificada y real, merma y variación de costo.', icon: GitCompare, category: 'Producción', hiddenInHub: true },
    { id: 'prod-input-consumption', name: 'Consumo de Insumos', description: 'Insumos consumidos por producción agregados por producto.', icon: Package, category: 'Producción', hiddenInHub: true },
    { id: 'prod-profitability', name: 'Rentabilidad de Producidos', description: 'Costo de producción vs precio de venta de productos fabricados.', icon: TrendingUp, category: 'Producción', hiddenInHub: true },
    { id: 'prod-kardex', name: 'Kardex de Producidos', description: 'Movimientos de inventario generados por producción.', icon: FileSpreadsheet, category: 'Producción', hiddenInHub: true },
];

const CATEGORIES_ORDER = ['Inventario', 'Compras', 'Ventas', 'Costos', 'Producción', 'Auditoría', 'Decisiones'];

const REPORT_GROUPS: Array<{ key: string; reports: string[] }> = [
    { key: 'inventory', reports: ['inventory', 'low-stock'] },
    { key: 'purchases', reports: ['purchases', 'purchases-by-day', 'purchases-by-month', 'purchases-by-supplier', 'price-comparison', 'most-purchased'] },
    { key: 'sales', reports: ['sales', 'sales-by-product', 'sales-daily', 'sales-monthly', 'sales-by-category', 'sales-by-brand', 'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel', 'sales-by-hour'] },
    { key: 'costs-analytics', reports: ['profitability', 'food-cost-by-category', 'margin-by-product'] },
    { key: 'production', reports: ['recipe-cost', 'production-yield', 'menu-engineering', 'purchase-projection'] },
    { key: 'production-orders', reports: ['prod-orders', 'prod-plan-vs-real', 'prod-input-consumption', 'prod-profitability', 'prod-kardex'] },
];

// ── Producción (órdenes) report ids and data shapes ──
const PRODUCTION_REPORT_IDS = new Set([
    'prod-orders', 'prod-plan-vs-real', 'prod-input-consumption', 'prod-profitability', 'prod-kardex',
]);

interface ProdProductRef {
    name: string;
    sku: string | null;
    type?: string;
    unit?: string;
    baseUnit?: { abbreviation: string } | null;
}
interface ProdWarehouseRef { name: string }
interface QuantityByUnit { unit: string; quantity: number }

interface ProdOrderRow {
    code: string;
    status: string;
    date: string;
    finishedAt: string | null;
    plannedQuantity: number;
    producedQuantity: number;
    estimatedCost: number;
    realCost: number;
    realUnitCost: number;
    product: ProdProductRef | null;
    warehouse: ProdWarehouseRef | null;
}
interface ProdOrdersSummary {
    count: number; finished: number; cancelled: number;
    totalPlanned: number | null; totalProduced: number | null;
    plannedQuantities: QuantityByUnit[]; producedQuantities: QuantityByUnit[];
    mixedOutputUnits: boolean;
    totalEstimatedCost: number; totalRealCost: number;
}
interface ProdOrdersResponse { summary: ProdOrdersSummary; items: ProdOrderRow[] }

interface PlanVsRealRow {
    id: number; code: string; product: ProdProductRef | null; finishedAt: string | null;
    unit: string;
    plannedQuantity: number; producedQuantity: number; quantityDiff: number; yieldPct: number;
    estimatedCost: number; realCost: number; costVariance: number;
    estimatedUnitCost: number; realUnitCost: number;
}
interface PlanVsRealSummary {
    count: number; totalPlanned: number | null; totalProduced: number | null;
    plannedQuantities: QuantityByUnit[]; producedQuantities: QuantityByUnit[];
    mixedOutputUnits: boolean;
    totalCostVariance: number; avgYieldPct: number;
}
interface PlanVsRealResponse { summary: PlanVsRealSummary; items: PlanVsRealRow[] }

interface InputConsumptionRow {
    componentProductId: number; name: string; sku: string | null; unit: string;
    consumedQuantity: number; totalCost: number; orders: number;
}
interface InputConsumptionResponse { summary: { components: number; totalCost: number }; items: InputConsumptionRow[] }

interface ProdProfitabilityRow {
    productId: number; name: string; sku: string | null; type: string;
    averageCost: number; lastProductionUnitCost: number | null; salePrice: number | null;
    margin: number | null; marginPct: number | null;
}
interface ProdProfitabilityResponse { summary: { products: number }; items: ProdProfitabilityRow[] }

interface ProdKardexRow {
    id: number; type: string; quantity: number; unitCost: number; totalCost: number;
    balanceQty: number; balanceCost: number; reason: string | null; reference: string | null;
    createdAt: string; product: ProdProductRef | null; warehouse: ProdWarehouseRef | null;
}
interface ProdKardexResponse { items: ProdKardexRow[] }

type ProductionReportData = { items: Record<string, unknown>[]; summary: Record<string, number> };

function physicalProductionSummary(summary: ProdOrdersSummary | PlanVsRealSummary): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(summary)) {
        if (key === 'totalPlanned' || key === 'totalProduced' || key === 'plannedQuantities' ||
            key === 'producedQuantities' || key === 'mixedOutputUnits') continue;
        if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    }
    for (const row of summary.plannedQuantities) result[`plannedQuantity__${row.unit}`] = row.quantity;
    for (const row of summary.producedQuantities) result[`producedQuantity__${row.unit}`] = row.quantity;
    return result;
}

async function loadProductionReport(reportId: string, params: Record<string, string>): Promise<ProductionReportData> {
    switch (reportId) {
        case 'prod-orders': {
            const d = (await productionReportsAPI.getProductions(params)).data.data as ProdOrdersResponse;
            return {
                summary: physicalProductionSummary(d.summary),
                items: d.items.map((o) => ({
                    code: o.code,
                    productName: o.product?.name ?? '-',
                    sku: o.product?.sku ?? '-',
                    warehouseName: o.warehouse?.name ?? '-',
                    unit: o.product?.baseUnit?.abbreviation || o.product?.unit || '-',
                    date: o.date,
                    plannedQuantity: o.plannedQuantity,
                    producedQuantity: o.producedQuantity,
                    estimatedCost: o.estimatedCost,
                    realCost: o.realCost,
                    realUnitCost: o.realUnitCost,
                    status: o.status,
                })),
            };
        }
        case 'prod-plan-vs-real': {
            const d = (await productionReportsAPI.getPlanVsReal(params)).data.data as PlanVsRealResponse;
            return {
                summary: physicalProductionSummary(d.summary),
                items: d.items.map((o) => ({
                    code: o.code,
                    productName: o.product?.name ?? '-',
                    sku: o.product?.sku ?? '-',
                    finishedAt: o.finishedAt,
                    unit: o.unit,
                    plannedQuantity: o.plannedQuantity,
                    producedQuantity: o.producedQuantity,
                    quantityDiff: o.quantityDiff,
                    yieldPct: o.yieldPct,
                    estimatedCost: o.estimatedCost,
                    realCost: o.realCost,
                    costVariance: o.costVariance,
                    estimatedUnitCost: o.estimatedUnitCost,
                    realUnitCost: o.realUnitCost,
                })),
            };
        }
        case 'prod-input-consumption': {
            const d = (await productionReportsAPI.getInputConsumption(params)).data.data as InputConsumptionResponse;
            return {
                summary: { ...d.summary },
                items: d.items.map((c) => ({
                    name: c.name,
                    sku: c.sku ?? '-',
                    unit: c.unit,
                    consumedQuantity: c.consumedQuantity,
                    totalCost: c.totalCost,
                    orders: c.orders,
                })),
            };
        }
        case 'prod-profitability': {
            const d = (await productionReportsAPI.getProfitability(params)).data.data as ProdProfitabilityResponse;
            return {
                summary: { ...d.summary },
                items: d.items.map((p) => ({
                    name: p.name,
                    sku: p.sku ?? '-',
                    type: p.type,
                    averageCost: p.averageCost,
                    lastProductionUnitCost: p.lastProductionUnitCost,
                    salePrice: p.salePrice,
                    margin: p.margin,
                    marginPct: p.marginPct,
                })),
            };
        }
        case 'prod-kardex': {
            const d = (await productionReportsAPI.getProducedKardex(params)).data.data as ProdKardexResponse;
            return {
                summary: {},
                items: d.items.map((m) => ({
                    createdAt: m.createdAt,
                    productName: m.product?.name ?? '-',
                    sku: m.product?.sku ?? '-',
                    warehouseName: m.warehouse?.name ?? '-',
                    type: m.type,
                    quantity: m.quantity,
                    unitCost: m.unitCost,
                    totalCost: m.totalCost,
                    balanceQty: m.balanceQty,
                    balanceCost: m.balanceCost,
                    reference: m.reference ?? '-',
                    reason: m.reason ?? '-',
                })),
            };
        }
        default:
            throw new Error('Reporte de producción no encontrado');
    }
}

function getGroupReports(reportId: string) {
    const group = REPORT_GROUPS.find(g => g.reports.includes(reportId));
    return group ? group.reports : [reportId];
}

function downloadBlob(data: ArrayBuffer, filename: string) {
    const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function fetchReportData(reportId: string, params: Record<string, string>): Promise<ReportData> {
    if (PRODUCTION_REPORT_IDS.has(reportId)) return loadProductionReport(reportId, params);
    let res;
    switch (reportId) {
        case 'inventory': res = await reportsAPI.getInventoryReport(params); break;
        case 'purchases': res = await reportsAPI.getPurchasesReport(params); break;
        case 'sales': res = await reportsAPI.getSalesReport(params); break;
        case 'profitability': res = await reportsAPI.getProfitabilityReport(params); break;
        case 'low-stock': res = await reportsAPI.getLowStockReport(params); break;
        case 'purchases-by-day': res = await reportsAPI.getPurchasesByDay(params); break;
        case 'purchases-by-month': res = await reportsAPI.getPurchasesByMonth(params); break;
        case 'price-comparison': res = await reportsAPI.getPriceComparison(params); break;
        case 'most-purchased': res = await reportsAPI.getMostPurchased(params); break;
        case 'purchases-by-supplier': res = await reportsAPI.getPurchasesBySupplier(params); break;
        case 'sales-by-category': res = await reportsAPI.getSalesByCategory(params); break;
        case 'sales-by-product': res = await reportsAPI.getSalesByProduct(params); break;
        case 'sales-by-brand': res = await reportsAPI.getSalesByBrand(params); break;
        case 'sales-daily': res = await reportsAPI.getSalesDaily(params); break;
        case 'sales-monthly': res = await reportsAPI.getSalesMonthly(params); break;
        case 'sales-by-payment-method': res = await reportsAPI.getSalesByPaymentMethod(params); break;
        case 'sales-by-waiter': res = await reportsAPI.getSalesByWaiter(params); break;
        case 'sales-by-channel': res = await reportsAPI.getSalesByChannel(params); break;
        case 'sales-by-hour': res = await reportsAPI.getSalesByHour(params); break;
        case 'food-cost-by-category': res = await reportsAPI.getFoodCostByCategory(params); break;
        case 'margin-by-product': res = await reportsAPI.getMarginByProduct(params); break;
        case 'audit': res = await reportsAPI.getAuditReport(params); break;
        case 'day-analysis': res = await reportsAPI.getDayAnalysis(params); break;
        case 'month-comparison': res = await reportsAPI.getMonthComparison(params); break;
        case 'recipe-cost': res = await reportsAPI.getRecipeCostAnalysis(params); break;
        case 'production-yield': res = await reportsAPI.getProductionYield(params); break;
        case 'menu-engineering': res = await reportsAPI.getMenuEngineering(params); break;
        case 'purchase-projection': res = await reportsAPI.getPurchaseProjection(params); break;
        default: throw new Error('Reporte no encontrado');
    }
    return res.data.data;
}

async function exportReportData(reportId: string, params: Record<string, string>) {
    let res;
    switch (reportId) {
        case 'inventory': res = await reportsAPI.exportInventoryReport(params); break;
        case 'purchases': res = await reportsAPI.exportPurchasesReport(params); break;
        case 'sales': res = await reportsAPI.exportSalesReport(params); break;
        case 'profitability': res = await reportsAPI.exportProfitabilityReport(params); break;
        case 'low-stock': res = await reportsAPI.exportLowStockReport(params); break;
        case 'purchases-by-day': res = await reportsAPI.exportPurchasesByDay(params); break;
        case 'purchases-by-month': res = await reportsAPI.exportPurchasesByMonth(params); break;
        case 'price-comparison': res = await reportsAPI.exportPriceComparison(params); break;
        case 'most-purchased': res = await reportsAPI.exportMostPurchased(params); break;
        case 'purchases-by-supplier': res = await reportsAPI.exportPurchasesBySupplier(params); break;
        case 'sales-by-category': res = await reportsAPI.exportSalesByCategory(params); break;
        case 'sales-by-product': res = await reportsAPI.exportSalesByProduct(params); break;
        case 'sales-by-brand': res = await reportsAPI.exportSalesByBrand(params); break;
        case 'sales-daily': res = await reportsAPI.exportSalesDaily(params); break;
        case 'sales-monthly': res = await reportsAPI.exportSalesMonthly(params); break;
        case 'sales-by-payment-method': res = await reportsAPI.exportSalesByPaymentMethod(params); break;
        case 'sales-by-waiter': res = await reportsAPI.exportSalesByWaiter(params); break;
        case 'sales-by-channel': res = await reportsAPI.exportSalesByChannel(params); break;
        case 'sales-by-hour': res = await reportsAPI.exportSalesByHour(params); break;
        case 'food-cost-by-category': res = await reportsAPI.exportFoodCostByCategory(params); break;
        case 'margin-by-product': res = await reportsAPI.exportMarginByProduct(params); break;
        case 'audit': res = await reportsAPI.exportAuditReport(params); break;
        case 'day-analysis': res = await reportsAPI.exportDayAnalysis(params); break;
        case 'month-comparison': res = await reportsAPI.exportMonthComparison(params); break;
        case 'recipe-cost': res = await reportsAPI.exportRecipeCostAnalysis(params); break;
        case 'production-yield': res = await reportsAPI.exportProductionYield(params); break;
        case 'menu-engineering': res = await reportsAPI.exportMenuEngineering(params); break;
        case 'purchase-projection': res = await reportsAPI.exportPurchaseProjection(params); break;
        default: return null;
    }
    return res;
}

// ── Presentación de celdas ──
type ReportData = { items: Record<string, unknown>[]; summary: Record<string, number> };
type Row = Record<string, unknown>;

const ND = 'N/D';
const isMissing = (v: unknown) => v === null || v === undefined || v === '' || !Number.isFinite(Number(v));

const STATUS_LABELS: Record<string, string> = {
    OK: 'OK', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo',
    WARNING: 'Advertencia', CRITICAL: 'Crítico',
    DRAFT: 'Borrador', ISSUED: 'Emitida', RECEIVED: 'Recibida', CANCELLED: 'Cancelada',
    PENDING: 'Pendiente', IN_PROGRESS: 'En Proceso', FINISHED: 'Finalizada',
};
const statusTone = (s: string): Tone =>
    s === 'OK' || s === 'HIGH' || s === 'FINISHED' ? 'success'
        : s === 'MEDIUM' || s === 'WARNING' || s === 'LOW' || s === 'IN_PROGRESS' || s === 'PENDING' ? 'warning'
            : s === 'CRITICAL' || s === 'CANCELLED' ? 'danger'
                : 'neutral';

function signClass(value: unknown, invert?: boolean): string {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    const good = invert ? n < 0 : n > 0;
    return good ? 'reports-positive' : 'reports-negative';
}

const nd = <span className="reports-nd" title="Dato no disponible">{ND}</span>;

function toTableColumns(defs: ColDef[], money: (n: number) => string): Column<Row>[] {
    return defs.map((def, i): Column<Row> => {
        const base: Column<Row> = {
            key: def.key,
            header: def.header,
            accessor: (r) => r[def.key],
            width: def.format ? '1fr' : i === 0 ? '1.6fr' : '1.2fr',
        };
        const signed = (r: Row, text: (n: number) => string) =>
            isMissing(r[def.key])
                ? nd
                : def.signColor
                    ? <span className={signClass(r[def.key], def.invertSign)}>{text(Number(r[def.key]))}</span>
                    : text(Number(r[def.key]));
        switch (def.format) {
            case 'currency':
                return { ...base, type: 'money', total: isAdditiveColumn(def), render: (r) => signed(r, money) };
            case 'number':
                return { ...base, type: 'number', render: (r) => signed(r, (n) => formatNumber(n)) };
            case 'percent':
                return { ...base, type: 'percent', render: (r) => (isMissing(r[def.key]) ? nd : formatPercent(Number(r[def.key]))) };
            case 'date':
                return { ...base, type: 'date', render: (r) => (r[def.key] ? fmtDate(String(r[def.key])) : '—') };
            case 'status':
                return {
                    ...base,
                    type: 'status',
                    render: (r) => {
                        const s = String(r[def.key] ?? '').toUpperCase();
                        return s ? <Badge tone={statusTone(s)} dot>{STATUS_LABELS[s] || s}</Badge> : '—';
                    },
                };
            default:
                return { ...base, render: (r) => (r[def.key] === null || r[def.key] === undefined || r[def.key] === '' ? '—' : String(r[def.key])) };
        }
    });
}

const MONEY_SUMMARY = /value|amount|sales|cost|discount|ticket|revenue|cogs|spent|income|commission|variation/i;
const NOT_MONEY_SUMMARY = /count|pct|percent/i;
const PERCENT_SUMMARY = /margin|foodcost|variation|yield/i;
const PERCENT_SUMMARY_2 = /pct|percent|overall/i;

function formatSummaryValue(key: string, val: unknown, money: (n: number) => string): string {
    if (typeof val === 'string') return val;
    if (isMissing(val)) return ND;
    const n = Number(val);
    if (MONEY_SUMMARY.test(key) && !NOT_MONEY_SUMMARY.test(key)) return money(n);
    if (PERCENT_SUMMARY.test(key) && PERCENT_SUMMARY_2.test(key)) return formatPercent(n);
    return formatNumber(n);
}


// ── Filter visibility helpers ──
const DATE_FILTER_REPORTS = new Set([
    'purchases', 'sales', 'purchases-by-day', 'purchases-by-month', 'price-comparison',
    'most-purchased', 'purchases-by-supplier', 'sales-by-category', 'sales-by-product', 'sales-by-brand', 'sales-daily',
    'sales-monthly', 'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel',
    'sales-by-hour', 'food-cost-by-category', 'margin-by-product', 'audit', 'day-analysis',
    'menu-engineering', 'purchase-projection',
    'prod-orders', 'prod-plan-vs-real', 'prod-input-consumption', 'prod-kardex',
]);
const BRANCH_FILTER_REPORTS = new Set([
    'purchases', 'sales', 'purchases-by-day', 'purchases-by-month', 'most-purchased',
    'purchases-by-supplier', 'sales-by-category', 'sales-by-product', 'sales-by-brand', 'sales-daily', 'sales-monthly',
    'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel', 'sales-by-hour',
    'food-cost-by-category', 'margin-by-product', 'day-analysis', 'month-comparison',
    'recipe-cost', 'production-yield', 'menu-engineering', 'purchase-projection',
    'prod-orders', 'prod-plan-vs-real', 'prod-input-consumption',
]);
const CATEGORY_FILTER_REPORTS = new Set([
    'inventory', 'purchases', 'sales', 'profitability', 'low-stock',
    'price-comparison', 'sales-by-category', 'sales-by-product', 'margin-by-product',
    'recipe-cost',
]);
const MULTI_CATEGORY_FILTER_REPORTS = new Set([
    'sales', 'sales-by-category', 'sales-by-product', 'margin-by-product',
]);
const SUPPLIER_FILTER_REPORTS = new Set([
    'purchases', 'purchases-by-day', 'purchases-by-month', 'price-comparison',
]);
const BRAND_FILTER_REPORTS = new Set([
    'sales',
]);

function hasDateFilter(id: string) { return DATE_FILTER_REPORTS.has(id); }
function hasBranchFilter(id: string) { return BRANCH_FILTER_REPORTS.has(id); }
function hasCategoryFilter(id: string) { return CATEGORY_FILTER_REPORTS.has(id); }
function hasMultiCategoryFilter(id: string) { return MULTI_CATEGORY_FILTER_REPORTS.has(id); }
function hasSupplierFilter(id: string) { return SUPPLIER_FILTER_REPORTS.has(id); }
function hasBrandFilter(id: string) { return BRAND_FILTER_REPORTS.has(id); }



// ── Column Definitions ──
type ColDef = { key: string; header: string; align?: 'right' | 'center'; format?: 'currency' | 'number' | 'percent' | 'date' | 'status'; signColor?: boolean; invertSign?: boolean };

function getColumns(reportId: string): ColDef[] {
    switch (reportId) {
        case 'inventory': return [
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'warehouseName', header: 'Almacén' },
            { key: 'unit', header: 'Unidad' },
            { key: 'quantity', header: 'Stock Actual', align: 'right', format: 'number' },
            { key: 'minStock', header: 'Stock Mín.', align: 'right', format: 'number' },
            { key: 'currentAverageCost', header: 'Costo Prom.', align: 'right', format: 'currency' },
            { key: 'totalValue', header: 'Valor Total', align: 'right', format: 'currency' },
            { key: 'status', header: 'Estado', format: 'status' },
        ];
        case 'purchases': return [
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'poNumber', header: 'OC #' },
            { key: 'supplierName', header: 'Proveedor' },
            { key: 'productName', header: 'Producto' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'quantity', header: 'Cantidad', align: 'right', format: 'number' },
            { key: 'unit', header: 'Unidad' },
            { key: 'unitCost', header: 'Costo Unit.', align: 'right', format: 'currency' },
            { key: 'totalCost', header: 'Costo Total', align: 'right', format: 'currency' },
            { key: 'status', header: 'Estado', format: 'status' },
        ];
        case 'sales': return [
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'orderNumber', header: 'Orden #' },
            { key: 'productName', header: 'Producto' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'brandName', header: 'Empresa/Marca' },
            { key: 'quantity', header: 'Cant.', align: 'right', format: 'number' },
            { key: 'unitPrice', header: 'Precio Unit.', align: 'right', format: 'currency' },
            { key: 'discount', header: 'Descuento', align: 'right', format: 'currency' },
            { key: 'totalSale', header: 'Total', align: 'right', format: 'currency' },
            { key: 'paymentMethod', header: 'Método Pago' },
            { key: 'userName', header: 'Usuario' },
            { key: 'branchName', header: 'Sucursal' },
            { key: 'companyName', header: 'Empresa' },
        ];
        case 'profitability': return [
            { key: 'menuItemName', header: 'Producto / Menú' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'price', header: 'Precio Venta', align: 'right', format: 'currency' },
            { key: 'estimatedCost', header: 'Costo Estimado', align: 'right', format: 'currency' },
            { key: 'grossMargin', header: 'Margen Bruto', align: 'right', format: 'currency' },
            { key: 'marginPercent', header: '% Margen', align: 'right', format: 'percent' },
            { key: 'status', header: 'Estado', format: 'status' },
        ];
        case 'low-stock': return [
            { key: 'productName', header: 'Producto' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'warehouseName', header: 'Almacén' },
            { key: 'currentStock', header: 'Stock Actual', align: 'right', format: 'number' },
            { key: 'minStock', header: 'Stock Mín.', align: 'right', format: 'number' },
            { key: 'deficit', header: 'Déficit', align: 'right', format: 'number' },
            { key: 'unit', header: 'Unidad' },
            { key: 'criticality', header: 'Criticidad', format: 'status' },
        ];
        case 'purchases-by-day': return [
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'totalAmount', header: 'Monto Total', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'itemCount', header: '# Items', align: 'right', format: 'number' },
        ];
        case 'purchases-by-month': return [
            { key: 'month', header: 'Mes' },
            { key: 'totalAmount', header: 'Monto Total', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
        ];
        case 'price-comparison': return [
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'supplierName', header: 'Proveedor' },
            { key: 'avgCost', header: 'Costo Prom.', align: 'right', format: 'currency' },
            { key: 'minCost', header: 'Costo Mín.', align: 'right', format: 'currency' },
            { key: 'maxCost', header: 'Costo Máx.', align: 'right', format: 'currency' },
            { key: 'priceVariation', header: 'Variación %', align: 'right', format: 'number' },
            { key: 'totalQuantity', header: 'Qty Total', align: 'right', format: 'number' },
        ];
        case 'most-purchased': return [
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'unit', header: 'Unidad' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'totalQuantity', header: 'Qty Total', align: 'right', format: 'number' },
            { key: 'totalCost', header: 'Costo Total', align: 'right', format: 'currency' },
            { key: 'avgUnitCost', header: 'Costo Unit. Prom.', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# OC', align: 'right', format: 'number' },
        ];
        case 'purchases-by-supplier': return [
            { key: 'supplierName', header: 'Proveedor' },
            { key: 'totalAmount', header: 'Monto Total', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgPerOrder', header: 'Prom. por OC', align: 'right', format: 'currency' },
            { key: 'percentOfTotal', header: '% del Total', align: 'right', format: 'number' },
        ];
        case 'sales-by-category': return [
            { key: 'categoryName', header: 'Categoría' },
            { key: 'totalSales', header: 'Ventas Totales', align: 'right', format: 'currency' },
            { key: 'percentOfTotal', header: '% del Total', align: 'right', format: 'number' },
            { key: 'itemCount', header: '# Items', align: 'right', format: 'number' },
            { key: 'unitsSold', header: 'Unidades', align: 'right', format: 'number' },
        ];
        case 'sales-by-product': return [
            { key: 'productName', header: 'Producto' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'unitsSold', header: 'Unidades', align: 'right', format: 'number' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'lineCount', header: '# Líneas', align: 'right', format: 'number' },
            { key: 'averageUnitPrice', header: 'Precio Prom.', align: 'right', format: 'currency' },
            { key: 'totalSales', header: 'Ventas Totales', align: 'right', format: 'currency' },
        ];
        case 'sales-by-brand': return [
            { key: 'brandName', header: 'Empresa / Marca' },
            { key: 'totalSales', header: 'Ventas Totales', align: 'right', format: 'currency' },
            { key: 'percentOfTotal', header: '% del Total', align: 'right', format: 'number' },
            { key: 'itemCount', header: '# Items', align: 'right', format: 'number' },
            { key: 'unitsSold', header: 'Unidades', align: 'right', format: 'number' },
        ];
        case 'sales-daily': return [
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'totalSales', header: 'Ventas', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgTicket', header: 'Ticket Prom.', align: 'right', format: 'currency' },
            { key: 'totalDiscount', header: 'Descuentos', align: 'right', format: 'currency' },
        ];
        case 'sales-monthly': return [
            { key: 'month', header: 'Mes' },
            { key: 'totalSales', header: 'Ventas', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgTicket', header: 'Ticket Prom.', align: 'right', format: 'currency' },
            { key: 'variationPct', header: 'Var. %', align: 'right', format: 'number' },
        ];
        case 'sales-by-payment-method': return [
            { key: 'methodName', header: 'Método de Pago' },
            { key: 'totalAmount', header: 'Monto Total', align: 'right', format: 'currency' },
            { key: 'transactionCount', header: '# Transacciones', align: 'right', format: 'number' },
            { key: 'percentOfTotal', header: '% del Total', align: 'right', format: 'number' },
        ];
        case 'sales-by-waiter': return [
            { key: 'userName', header: 'Usuario' },
            { key: 'roleName', header: 'Rol' },
            { key: 'branchName', header: 'Sucursal' },
            { key: 'companyName', header: 'Empresa' },
            { key: 'totalSales', header: 'Ventas', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgTicket', header: 'Ticket Prom.', align: 'right', format: 'currency' },
        ];
        case 'sales-by-channel': return [
            { key: 'channelName', header: 'Canal' },
            { key: 'grossSales', header: 'Ventas Brutas', align: 'right', format: 'currency' },
            { key: 'commission', header: 'Comisión', align: 'right', format: 'currency' },
            { key: 'netIncome', header: 'Ingreso Neto', align: 'right', format: 'currency' },
            { key: 'estimatedCOGS', header: 'COGS Est.', align: 'right', format: 'currency' },
            { key: 'margin', header: 'Margen', align: 'right', format: 'currency' },
            { key: 'marginPct', header: 'Margen %', align: 'right', format: 'number' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'percentOfTotal', header: '% del Total', align: 'right', format: 'number' },
        ];
        case 'sales-by-hour': return [
            { key: 'hourLabel', header: 'Hora' },
            { key: 'totalSales', header: 'Ventas', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgTicket', header: 'Ticket Prom.', align: 'right', format: 'currency' },
        ];
        case 'food-cost-by-category': return [
            { key: 'categoryName', header: 'Categoría' },
            { key: 'revenue', header: 'Ingresos', align: 'right', format: 'currency' },
            { key: 'cogs', header: 'COGS', align: 'right', format: 'currency' },
            { key: 'grossMargin', header: 'Margen Bruto', align: 'right', format: 'currency' },
            { key: 'foodCostPct', header: 'Food Cost %', align: 'right', format: 'number' },
            { key: 'marginPct', header: 'Margen %', align: 'right', format: 'number' },
        ];
        case 'margin-by-product': return [
            { key: 'menuItemName', header: 'Producto' },
            { key: 'categoryName', header: 'Categoría' },
            { key: 'revenue', header: 'Ingresos', align: 'right', format: 'currency' },
            { key: 'cogs', header: 'COGS', align: 'right', format: 'currency' },
            { key: 'margin', header: 'Margen', align: 'right', format: 'currency' },
            { key: 'marginPct', header: 'Margen %', align: 'right', format: 'number' },
            { key: 'foodCostPct', header: 'Food Cost %', align: 'right', format: 'number' },
            { key: 'unitsSold', header: 'Uds. Vendidas', align: 'right', format: 'number' },
        ];
        case 'audit': return [
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'userName', header: 'Usuario' },
            { key: 'roleName', header: 'Rol' },
            { key: 'entityType', header: 'Entidad' },
            { key: 'entityId', header: 'ID', align: 'right', format: 'number' },
            { key: 'action', header: 'Acción' },
            { key: 'details', header: 'Detalles' },
        ];
        case 'day-analysis': return [
            { key: 'rank', header: '#', align: 'right', format: 'number' },
            { key: 'dayName', header: 'Día' },
            { key: 'totalSales', header: 'Ventas Totales', align: 'right', format: 'currency' },
            { key: 'avgDailySales', header: 'Prom. Diario', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
            { key: 'avgTicket', header: 'Ticket Prom.', align: 'right', format: 'currency' },
        ];
        case 'month-comparison': return [
            { key: 'month', header: 'Mes' },
            { key: 'label', header: 'Etiqueta' },
            { key: 'totalSales', header: 'Ventas', align: 'right', format: 'currency' },
            { key: 'orderCount', header: '# Órdenes', align: 'right', format: 'number' },
        ];
        case 'recipe-cost': return [
            { key: 'menuItemName', header: 'Plato' },
            { key: 'category', header: 'Categoría' },
            { key: 'price', header: 'Precio', align: 'right', format: 'currency' },
            { key: 'totalCost', header: 'Costo', align: 'right', format: 'currency' },
            { key: 'margin', header: 'Margen', align: 'right', format: 'currency' },
            { key: 'foodCostPct', header: 'Food Cost %', align: 'right', format: 'percent' },
            { key: 'ingredientCount', header: '# Ingred.', align: 'right', format: 'number' },
        ];
        case 'production-yield': return [
            { key: 'menuItemName', header: 'Plato' },
            { key: 'category', header: 'Categoría' },
            { key: 'maxPortions', header: 'Porciones Posibles', align: 'right', format: 'number' },
            { key: 'limitingIngredient', header: 'Ingrediente Limitante' },
            { key: 'ingredientCount', header: '# Ingred.', align: 'right', format: 'number' },
        ];
        case 'menu-engineering': return [
            { key: 'menuItemName', header: 'Plato' },
            { key: 'classification', header: 'Clasificación' },
            { key: 'price', header: 'Precio', align: 'right', format: 'currency' },
            { key: 'cost', header: 'Costo', align: 'right', format: 'currency' },
            { key: 'margin', header: 'Margen', align: 'right', format: 'currency' },
            { key: 'qtySold', header: 'Qty Vendida', align: 'right', format: 'number' },
            { key: 'revenue', header: 'Ingresos', align: 'right', format: 'currency' },
            { key: 'totalProfit', header: 'Ganancia', align: 'right', format: 'currency' },
        ];
        case 'purchase-projection': return [
            { key: 'productName', header: 'Producto' },
            { key: 'category', header: 'Categoría' },
            { key: 'unit', header: 'Unidad' },
            { key: 'currentStock', header: 'Stock Actual', align: 'right', format: 'number' },
            { key: 'dailyUsage', header: 'Uso Diario', align: 'right', format: 'number' },
            { key: 'suggestedPurchase', header: 'Compra Sugerida', align: 'right', format: 'number' },
            { key: 'daysUntilStockout', header: 'Días p/ Agotar', align: 'right', format: 'number' },
            { key: 'estimatedCost', header: 'Costo Est.', align: 'right', format: 'currency' },
        ];
        case 'prod-orders': return [
            { key: 'code', header: 'Código' },
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'warehouseName', header: 'Almacén' },
            { key: 'unit', header: 'Unidad' },
            { key: 'date', header: 'Fecha', format: 'date' },
            { key: 'plannedQuantity', header: 'Planificado', align: 'right', format: 'number' },
            { key: 'producedQuantity', header: 'Producido', align: 'right', format: 'number' },
            { key: 'estimatedCost', header: 'Costo Est.', align: 'right', format: 'currency' },
            { key: 'realCost', header: 'Costo Real', align: 'right', format: 'currency' },
            { key: 'realUnitCost', header: 'Costo Unit. Real', align: 'right', format: 'currency' },
            { key: 'status', header: 'Estado', format: 'status' },
        ];
        case 'prod-plan-vs-real': return [
            { key: 'code', header: 'Código' },
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'finishedAt', header: 'Finalizado', format: 'date' },
            { key: 'unit', header: 'Unidad' },
            { key: 'plannedQuantity', header: 'Planificado', align: 'right', format: 'number' },
            { key: 'producedQuantity', header: 'Producido', align: 'right', format: 'number' },
            { key: 'quantityDiff', header: 'Diferencia', align: 'right', format: 'number', signColor: true },
            { key: 'yieldPct', header: 'Rendimiento %', align: 'right', format: 'percent' },
            { key: 'estimatedCost', header: 'Costo Est.', align: 'right', format: 'currency' },
            { key: 'realCost', header: 'Costo Real', align: 'right', format: 'currency' },
            { key: 'costVariance', header: 'Var. Costo', align: 'right', format: 'currency', signColor: true, invertSign: true },
            { key: 'estimatedUnitCost', header: 'C.Unit Est.', align: 'right', format: 'currency' },
            { key: 'realUnitCost', header: 'C.Unit Real', align: 'right', format: 'currency' },
        ];
        case 'prod-input-consumption': return [
            { key: 'name', header: 'Insumo' },
            { key: 'sku', header: 'SKU' },
            { key: 'unit', header: 'Unidad' },
            { key: 'consumedQuantity', header: 'Cant. Consumida', align: 'right', format: 'number' },
            { key: 'totalCost', header: 'Costo Total', align: 'right', format: 'currency' },
            { key: 'orders', header: '# Órdenes', align: 'right', format: 'number' },
        ];
        case 'prod-profitability': return [
            { key: 'name', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'type', header: 'Tipo' },
            { key: 'averageCost', header: 'Costo Prom.', align: 'right', format: 'currency' },
            { key: 'lastProductionUnitCost', header: 'Últ. Costo Prod.', align: 'right', format: 'currency' },
            { key: 'salePrice', header: 'Precio Venta', align: 'right', format: 'currency' },
            { key: 'margin', header: 'Margen', align: 'right', format: 'currency', signColor: true },
            { key: 'marginPct', header: '% Margen', align: 'right', format: 'percent' },
        ];
        case 'prod-kardex': return [
            { key: 'createdAt', header: 'Fecha', format: 'date' },
            { key: 'productName', header: 'Producto' },
            { key: 'sku', header: 'SKU' },
            { key: 'warehouseName', header: 'Almacén' },
            { key: 'type', header: 'Tipo' },
            { key: 'quantity', header: 'Cantidad', align: 'right', format: 'number' },
            { key: 'unitCost', header: 'Costo Unit.', align: 'right', format: 'currency' },
            { key: 'totalCost', header: 'Costo Total', align: 'right', format: 'currency' },
            { key: 'balanceQty', header: 'Saldo Cant.', align: 'right', format: 'number' },
            { key: 'balanceCost', header: 'Saldo Costo', align: 'right', format: 'currency' },
            { key: 'reference', header: 'Referencia' },
            { key: 'reason', header: 'Motivo' },
        ];
        default: return [];
    }
}


function formatSummaryLabel(key: string): string {
    if (key.startsWith('plannedQuantity__')) return `Planificado (${key.slice('plannedQuantity__'.length)})`;
    if (key.startsWith('producedQuantity__')) return `Producido (${key.slice('producedQuantity__'.length)})`;
    const map: Record<string, string> = {
        totalProducts: 'Total Productos', totalValue: 'Valor Total',
        lowStockCount: 'Stock Bajo', criticalCount: 'Crítico',
        totalOrders: 'Total Órdenes', totalAmount: 'Monto Total',
        uniqueSuppliers: 'Proveedores', uniqueProducts: 'Productos',
        totalSales: 'Ventas netas por lineas', netItemSales: 'Ventas netas por lineas',
        totalDiscount: 'Descuento por orden', orderDiscount: 'Descuento por orden',
        tax: 'Impuesto', tip: 'Propina', grossOrderTotal: 'Total bruto de ordenes',
        collected: 'Total cobrado',
        averageTicket: 'Ticket Promedio', totalItems: 'Total Items',
        avgMargin: 'Margen Promedio', lowMarginCount: 'Bajo Margen',
        totalLowStock: 'Total Bajo Stock', warningCount: 'Advertencia',
        totalDays: 'Total Días', avgPerDay: 'Promedio Diario',
        totalMonths: 'Total Meses', totalComparisons: 'Comparaciones',
        avgVariation: 'Variación Promedio', totalSpent: 'Total Gastado',
        totalSuppliers: 'Total Proveedores', topSupplier: 'Top Proveedor',
        totalCategories: 'Total Categorías', topCategory: 'Top Categoría',
        totalBrands: 'Total Empresas', topBrand: 'Top Empresa',
        avgDailySales: 'Promedio Diario', avgTicket: 'Ticket Promedio',
        totalMethods: 'Métodos de Pago', dominantMethod: 'Método Dominante',
        totalUsers: 'Total Usuarios', topWaiter: 'Top Mesero',
        totalChannels: 'Total Canales', totalGrossSales: 'Ventas Brutas',
        totalCommissions: 'Total Comisiones', totalNetIncome: 'Ingreso Neto',
        peakHour: 'Hora Pico', peakSales: 'Ventas Hora Pico',
        totalRevenue: 'Ingresos Totales', totalCOGS: 'COGS Total',
        overallFoodCost: 'Food Cost General', overallMargin: 'Margen General',
        totalMargin: 'Margen Total', mostProfitable: 'Más Rentable',
        totalEvents: 'Total Eventos', uniqueUsers: 'Usuarios Únicos',
        actionBreakdown: 'Acciones', strongestDay: 'Día Más Fuerte',
        weakestDay: 'Día Más Débil', salesMonthA: 'Ventas Mes A',
        salesMonthB: 'Ventas Mes B', absoluteVariation: 'Variación Absoluta',
        percentVariation: 'Variación %',
        // Production reports
        totalMenuItems: 'Total Platillos', withRecipes: 'Con Recetas',
        withoutRecipes: 'Sin Recetas', avgFoodCostPct: 'Food Cost Promedio %',
        highCostItems: 'Alto Costo (>35%)', totalPossiblePortions: 'Porciones Posibles',
        itemsWithZeroStock: 'Sin Stock', avgPortionsPerItem: 'Prom. Porciones',
        totalAnalyzed: 'Total Analizados', stars: 'Estrellas', puzzles: 'Puzzles',
        horses: 'Caballos', dogs: 'Perros', avgQtySold: 'Prom. Qty Vendida',
        projectionDays: 'Días Proyección', urgentItems: 'Urgentes (≤3 días)',
        estimatedTotalCost: 'Costo Estimado Total', avgDaysUntilStockout: 'Prom. Días p/ Agotar',
        // Production orders reports
        count: 'Órdenes', finished: 'Finalizadas', cancelled: 'Canceladas',
        totalPlanned: 'Total Planificado', totalProduced: 'Total Producido',
        totalEstimatedCost: 'Costo Estimado', totalRealCost: 'Costo Real',
        totalCostVariance: 'Variación de Costo', avgYieldPct: 'Rendimiento Prom.',
        components: 'Insumos', totalCost: 'Costo Total', products: 'Productos',
    };
    return map[key] || key;
}


// ── Catálogo lateral ──
const activeCatalogId = (reportId?: string) => {
    if (!reportId) return undefined;
    const group = getGroupReports(reportId);
    return group.find((id) => REPORT_CATALOG.find((r) => r.id === id && !r.hiddenInHub)) ?? reportId;
};

function ReportsCatalog({ reportId, onSelect }: { reportId?: string; onSelect: (r: ReportDef) => void }) {
    const [search, setSearch] = useState('');
    const term = search.trim().toLowerCase();
    const grouped = CATEGORIES_ORDER.map((category) => ({
        category,
        reports: REPORT_CATALOG.filter(
            (r) => r.category === category && !r.hiddenInHub && (r.name.toLowerCase().includes(term) || r.description.toLowerCase().includes(term)),
        ),
    })).filter((g) => g.reports.length > 0);
    const active = activeCatalogId(reportId);

    const selectOptions = grouped.map((g) => ({
        label: g.category,
        options: g.reports.map((r) => ({ value: r.id, label: r.name })),
    }));

    return (
        <aside className="reports-catalog" aria-label="Catálogo de reportes">
            <Input
                type="search"
                aria-label="Buscar reportes"
                placeholder="Buscar reportes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />
            <div className="reports-catalog__select">
                <AppSelect<string>
                    aria-label="Reporte"
                    isClearable={false}
                    placeholder="Elige un reporte"
                    options={selectOptions}
                    value={active ?? null}
                    onChange={(id) => {
                        const def = REPORT_CATALOG.find((r) => r.id === id);
                        if (def) onSelect(def);
                    }}
                />
            </div>
            <nav className="reports-catalog__list" aria-label="Reportes por grupo">
                {grouped.length === 0 ? <p className="reports-catalog__empty">Sin reportes con ese texto.</p> : null}
                {grouped.map((g) => (
                    <section key={g.category} className="reports-catalog__group">
                        <h2 className="reports-catalog__title">{g.category}</h2>
                        <ul>
                            {g.reports.map((r) => {
                                const Icon = r.icon;
                                return (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            className={`reports-catalog__item ${active === r.id ? 'is-active' : ''}`}
                                            aria-current={active === r.id ? 'page' : undefined}
                                            onClick={() => onSelect(r)}
                                        >
                                            <Icon size={16} aria-hidden="true" />
                                            <span className="reports-catalog__text">
                                                <strong>{r.name}</strong>
                                                <small>{r.description}</small>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </nav>
        </aside>
    );
}

// ── Visor ──
function ReportViewer({ reportId }: { reportId: string }) {
    const { symbol } = useCurrency();
    const money = useCallback((n: number) => formatMoney(n, symbol || 'C$'), [symbol]);
    const navigate = useNavigate();
    const reportDef = REPORT_CATALOG.find(r => r.id === reportId);
    const groupedReportIds = getGroupReports(reportId);
    const groupedReports = groupedReportIds
        .map(id => REPORT_CATALOG.find(r => r.id === id))
        .filter((r): r is ReportDef => Boolean(r));

    const [data, setData] = useState<ReportData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [filterWarning, setFilterWarning] = useState('');
    const [exporting, setExporting] = useState(false);
    const [compare, setCompare] = useState(false);
    const [previous, setPrevious] = useState<{ summary: Record<string, number> | null; failed: boolean } | null>(null);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [brands, setBrands] = useState<BrandOption[]>([]);

    const defaultBranch = () => {
        const id = getUiPrefs().defaultBranchId;
        return hasBranchFilter(reportId) && id ? String(id) : '';
    };
    const [filters, setFilters] = useState<Record<string, string>>({
        dateFrom: monthStartStr(),
        dateTo: todayStr(),
        warehouseId: '',
        categoryId: '',
        categoryIds: '',
        supplierId: '',
        branchId: defaultBranch(),
        brandId: '',
        lowStockOnly: '',
    });

    const loadFilterOptions = useCallback(() => {
        const labels = ['sucursales', 'categorías', 'proveedores', 'almacenes', 'marcas'];
        Promise.allSettled([
            branchesAPI.getAll(),
            categoriesAPI.getAll(),
            suppliersAPI.getAll(),
            warehousesAPI.getAll(),
            menuBrandsAPI.getAll(),
        ]).then((results) => {
            const failedNames = results
                .map((r, i) => (r.status === 'rejected' ? labels[i] : null))
                .filter((name): name is string => Boolean(name));
            if (failedNames.length > 0) {
                console.error('Error loading report filter options:', failedNames);
                setFilterWarning(
                    `No se pudieron cargar filtros: ${failedNames.join(', ')}. Las listas pueden estar incompletas; no asuma que "todas" incluye opciones faltantes.`
                );
            } else {
                setFilterWarning('');
            }
            const branchList: Branch[] = results[0].status === 'fulfilled' ? results[0].value.data.data || [] : [];
            setBranches(branchList);
            // La sucursal predeterminada solo aplica si el usuario realmente puede elegirla.
            if (results[0].status === 'fulfilled') {
                setFilters((f) => (f.branchId && !branchList.some((b) => String(b.id) === f.branchId) ? { ...f, branchId: '' } : f));
            }
            setCategories(results[1].status === 'fulfilled' ? results[1].value.data.data || [] : []);
            setSuppliers(results[2].status === 'fulfilled' ? results[2].value.data.data || [] : []);
            setWarehouses(results[3].status === 'fulfilled' ? results[3].value.data.data || [] : []);
            setBrands(results[4].status === 'fulfilled' ? results[4].value.data.data || [] : []);
        });
    }, []);

    useEffect(() => { loadFilterOptions(); }, [loadFilterOptions]);

    const buildParams = useCallback(() => {
        const params: Record<string, string> = {};
        Object.entries(filters).forEach(([k, v]) => {
            if (v) params[k] = v;
        });
        return params;
    }, [filters]);

    const loadReport = useCallback(async () => {
        setLoading(true);
        setError('');
        setPrevious(null);
        try {
            const params = buildParams();
            const current = await fetchReportData(reportId, params);
            setData(current);
            const prevRange = hasDateFilter(reportId) ? previousPeriod(filters.dateFrom, filters.dateTo) : null;
            if (compare && prevRange) {
                try {
                    const prev = await fetchReportData(reportId, { ...params, ...prevRange });
                    setPrevious({ summary: prev.summary ?? null, failed: false });
                } catch {
                    setPrevious({ summary: null, failed: true });
                }
            }
        } catch (err: unknown) {
            const e = err as { response?: { data?: { message?: string } }; message?: string };
            setData(null);
            setError(e?.response?.data?.message || e?.message || 'Error al cargar el reporte');
        } finally {
            setLoading(false);
        }
    }, [reportId, buildParams, compare, filters.dateFrom, filters.dateTo]);

    useEffect(() => { loadReport(); }, [loadReport]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const params = buildParams();
            const res = await exportReportData(reportId, params);
            if (!res) return;
            downloadBlob(res.data, `reporte_${reportId}_${todayStr()}.xlsx`);
        } catch {
            setError('Error al exportar el reporte');
        } finally {
            setExporting(false);
        }
    };

    const clearFilters = () => {
        setFilters({ dateFrom: monthStartStr(), dateTo: todayStr(), warehouseId: '', categoryId: '', categoryIds: '', supplierId: '', branchId: defaultBranch(), brandId: '', lowStockOnly: '' });
    };

    const set = (key: string, val: string) => setFilters(f => ({ ...f, [key]: val }));
    const defs = useMemo(() => getColumns(reportId), [reportId]);
    const columns = useMemo(() => toTableColumns(defs, money), [defs, money]);
    const items = useMemo(() => data?.items ?? [], [data]);
    const chart = useMemo(() => buildChartSeries(items, defs), [items, defs]);
    const quickRead = useMemo(
        () => buildQuickRead({
            items,
            cols: defs,
            format: (col, v) => (col.format === 'currency' ? money(v) : formatNumber(v)),
        }),
        [items, defs, money],
    );
    const summaryEntries = useMemo(
        () => (data?.summary ? Object.entries(data.summary).filter(([key]) => key !== 'actionBreakdown') : []),
        [data],
    );
    const deltas = useMemo(
        () => compareSummaries(data?.summary ?? {}, previous?.summary ?? null),
        [data, previous],
    );
    const prevRange = hasDateFilter(reportId) ? previousPeriod(filters.dateFrom, filters.dateTo) : null;

    if (!reportDef) {
        return (
            <EmptyState
                icon={AlertTriangle}
                title="Reporte no encontrado"
                action={<Button variant="ghost" onClick={() => navigate('/reporteria')}><ArrowLeft size={16} /> Volver a Reportería</Button>}
            />
        );
    }

    const hasDates = hasDateFilter(reportId);
    const opt = (all: string, list: { id: number; name: string }[]) => [
        { value: '', label: all },
        ...list.map((x) => ({ value: x.id.toString(), label: x.name })),
    ];

    return (
        <section className="reports-viewer" aria-label={reportDef.name}>
            <PageHeader
                title={reportDef.name}
                description={reportDef.description}
                breadcrumb={['Reportería', reportDef.category]}
                actions={
                    <>
                        {groupedReports.length > 1 && (
                            <div className="reports-view-select">
                                <AppSelect<string>
                                    aria-label="Vista del reporte"
                                    isClearable={false}
                                    options={groupedReports.map((r) => ({ value: r.id, label: r.name }))}
                                    value={reportId}
                                    onChange={(id) => { if (id) navigate(`/reporteria/${id}`); }}
                                />
                            </div>
                        )}
                        {!PRODUCTION_REPORT_IDS.has(reportId) && (
                            <Button onClick={handleExport} disabled={exporting || !data} title="Exportar a Excel">
                                <Download size={16} aria-hidden="true" /> {exporting ? 'Exportando…' : 'Excel'}
                            </Button>
                        )}
                    </>
                }
            />

            {filterWarning && (
                <div className="reports-warning" role="status">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <p>{filterWarning}</p>
                    <Button variant="ghost" size="sm" onClick={loadFilterOptions}>Reintentar filtros</Button>
                </div>
            )}

            <div className="reports-filters" role="group" aria-label="Filtros del reporte">
                {hasDates && (
                    <>
                        <Field label="Desde" htmlFor="rep-from">
                            <DateInput id="rep-from" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={e => set('dateFrom', e.target.value)} />
                        </Field>
                        <Field label="Hasta" htmlFor="rep-to">
                            <DateInput id="rep-to" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={e => set('dateTo', e.target.value)} />
                        </Field>
                    </>
                )}

                {(reportId === 'inventory' || reportId === 'low-stock' || reportId === 'prod-kardex') && (
                    <div className="reports-filters__select">
                        <AppSelect<string> aria-label="Almacén" isClearable={false} options={opt('Todos los almacenes', warehouses)} value={filters.warehouseId} onChange={(v) => set('warehouseId', v ?? '')} />
                    </div>
                )}

                {hasCategoryFilter(reportId) && (
                    <div className="reports-filters__select reports-filters__select--wide">
                        {hasMultiCategoryFilter(reportId) ? (
                            <AppSelect<string>
                                kind="multi"
                                aria-label="Categorías"
                                placeholder="Todas las categorías"
                                noOptionsText="No hay más categorías"
                                options={categories.map(c => ({ value: c.id.toString(), label: c.name }))}
                                value={filters.categoryIds ? filters.categoryIds.split(',').filter(Boolean) : []}
                                onChange={(ids) => set('categoryIds', ids.join(','))}
                            />
                        ) : (
                            <AppSelect<string> aria-label="Categoría" isClearable={false} options={opt('Todas las categorías', categories)} value={filters.categoryId} onChange={(v) => set('categoryId', v ?? '')} />
                        )}
                    </div>
                )}

                {hasBrandFilter(reportId) && (
                    <div className="reports-filters__select">
                        <AppSelect<string> aria-label="Empresa o marca" isClearable={false} options={opt('Todas las empresas', brands)} value={filters.brandId} onChange={(v) => set('brandId', v ?? '')} />
                    </div>
                )}

                {hasSupplierFilter(reportId) && (
                    <div className="reports-filters__select">
                        <AppSelect<string> aria-label="Proveedor" isClearable={false} options={opt('Todos los proveedores', suppliers)} value={filters.supplierId} onChange={(v) => set('supplierId', v ?? '')} />
                    </div>
                )}

                {hasBranchFilter(reportId) && (
                    <div className="reports-filters__select">
                        <AppSelect<string> aria-label="Sucursal" isClearable={false} options={opt('Todas las sucursales', branches)} value={filters.branchId} onChange={(v) => set('branchId', v ?? '')} />
                    </div>
                )}

                {reportId === 'inventory' && (
                    <div className="reports-filters__select reports-filters__select--narrow">
                        <AppSelect<string>
                            aria-label="Solo stock bajo"
                            isClearable={false}
                            options={[{ value: '', label: 'Todo el stock' }, { value: 'true', label: 'Solo stock bajo' }]}
                            value={filters.lowStockOnly}
                            onChange={(v) => set('lowStockOnly', v ?? '')}
                        />
                    </div>
                )}

                {prevRange && (
                    <Switch
                        id="rep-compare"
                        label="Comparar con el periodo anterior"
                        checked={compare}
                        onChange={setCompare}
                    />
                )}

                <div className="reports-filters__actions">
                    <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>
                    <Button onClick={loadReport} disabled={loading}>
                        <Search size={16} aria-hidden="true" /> {loading ? 'Cargando…' : 'Aplicar filtros'}
                    </Button>
                </div>
            </div>

            {error && !loading ? <LoadErrorState message={error} onRetry={loadReport} /> : null}

            {!error && data && !loading && items.length > 0 && (
                <>
                    <section className="reports-read" aria-label="Lectura rápida">
                        <h2 className="reports-read__title">Lectura rápida</h2>
                        <ul>
                            {quickRead.map((line) => <li key={line}>{line}</li>)}
                        </ul>
                    </section>

                    {summaryEntries.length > 0 && (
                        <section className="reports-totals" aria-label="Totales del reporte">
                            <h2 className="reports-read__title">Totales del periodo</h2>
                            <dl>
                                {summaryEntries.map(([key, val]) => {
                                    const d = deltas.find((x) => x.key === key);
                                    return (
                                        <div key={key} className="reports-totals__item">
                                            <dt>{formatSummaryLabel(key)}</dt>
                                            <dd>{formatSummaryValue(key, val, money)}</dd>
                                            {compare && prevRange ? (
                                                <dd className="reports-totals__delta">
                                                    {previous?.failed
                                                        ? 'Comparación no disponible'
                                                        : d
                                                            ? d.pct === null
                                                                ? `Periodo anterior: ${formatSummaryValue(key, d.previous, money)}`
                                                                : `${d.pct >= 0 ? '+' : ''}${formatPercent(d.pct)} vs periodo anterior`
                                                            : null}
                                                </dd>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </dl>
                            {compare && prevRange ? (
                                <p className="reports-totals__range">
                                    Periodo anterior: {fmtDate(prevRange.dateFrom)} al {fmtDate(prevRange.dateTo)}.
                                </p>
                            ) : null}
                        </section>
                    )}

                    {chart && (
                        <section className="reports-chart" aria-label={chart.title}>
                            <h2 className="reports-read__title">{chart.title}</h2>
                            <ParetoBars items={chart.items} format={(v) => (defs.find((c) => c.format === 'currency') ? money(v) : formatNumber(v))} ariaLabel={chart.title} />
                            {chart.skipped > 0 ? <p className="reports-chart__note">{chart.skipped} fila{chart.skipped === 1 ? '' : 's'} sin dato (N/D) excluida{chart.skipped === 1 ? '' : 's'} del gráfico.</p> : null}
                        </section>
                    )}
                </>
            )}

            {!error && (loading || items.length > 0) ? (
                <DataTable<Row>
                    ariaLabel={reportDef.name}
                    columns={columns}
                    rows={items}
                    rowKey={(row) => items.indexOf(row)}
                    loading={loading}
                    resetKey={`${reportId}|${JSON.stringify(filters)}`}
                    footerLabel="Total de la página"
                    minWidth={`${Math.max(48, columns.length * 9)}rem`}
                />
            ) : null}

            {!error && !loading && data && items.length === 0 ? (
                <EmptyState icon={FileText} title="Sin resultados" description="No se encontraron resultados con los filtros seleccionados." />
            ) : null}
        </section>
    );
}

// ── Main Component ──
export default function Reports() {
    const { reportId } = useParams<{ reportId?: string }>();
    const navigate = useNavigate();

    const handleSelect = (r: ReportDef) => {
        if (r.navigateTo) {
            navigate(r.navigateTo);
        } else {
            navigate(`/reporteria/${r.id}`);
        }
    };

    return (
        <PageContent>
            {!reportId && (
                <PageHeader title="Reportería" description="Consulta, filtra y exporta información clave del negocio." />
            )}
            <div className="reports-workspace">
                <ReportsCatalog reportId={reportId} onSelect={handleSelect} />
                <div className="reports-main">
                    {reportId ? (
                        <ReportViewer key={reportId} reportId={reportId} />
                    ) : (
                        <EmptyState
                            icon={BarChart3}
                            title="Elige un reporte"
                            description="Selecciona un reporte del catálogo para ver su lectura rápida, gráfico y tabla."
                        />
                    )}
                </div>
            </div>
        </PageContent>
    );
}
