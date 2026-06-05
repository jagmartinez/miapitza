import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, warehousesAPI, menuBrandsAPI } from '../services/api';
import Button from '../components/Button';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import {
    Package, ShoppingCart, DollarSign, TrendingUp, BarChart3, AlertTriangle,
    ArrowLeft, Download, Search, FileSpreadsheet, Truck,
    RefreshCw, FileText, Calendar, Clock, Users, PieChart, Shield,
    GitCompare, Activity, CreditCard, Building2, Tag, Warehouse, ChevronRight
} from 'lucide-react';
import type { Branch, Supplier } from '../types';
import { formatCurrency } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import './Reports.css';

interface CategoryOption { id: number; name: string }
interface WarehouseOption { id: number; name: string }
interface BrandOption { id: number; name: string }

const fmtNumber = (n: number) =>
    new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 }).format(n);

const fmtPercent = (n: number) => `${n.toFixed(1)}%`;

const fmtDate = (d: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('es-NI');
};

const todayStr = () => new Date().toISOString().split('T')[0];
const monthStartStr = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
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
];

const CATEGORIES_ORDER = ['Inventario', 'Compras', 'Ventas', 'Costos', 'Producción', 'Auditoría', 'Decisiones'];

const REPORT_GROUPS: Array<{ key: string; reports: string[] }> = [
    { key: 'inventory', reports: ['inventory', 'low-stock'] },
    { key: 'purchases', reports: ['purchases', 'purchases-by-day', 'purchases-by-month', 'purchases-by-supplier', 'price-comparison', 'most-purchased'] },
    { key: 'sales', reports: ['sales', 'sales-daily', 'sales-monthly', 'sales-by-category', 'sales-by-brand', 'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel', 'sales-by-hour'] },
    { key: 'costs-analytics', reports: ['profitability', 'food-cost-by-category', 'margin-by-product'] },
    { key: 'production', reports: ['recipe-cost', 'production-yield', 'menu-engineering', 'purchase-projection'] },
];

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

// ── Hub View ──
function ReportsHub({ onSelect }: { onSelect: (r: ReportDef) => void }) {
    const [search, setSearch] = useState('');
    const term = search.toLowerCase();
    const filtered = REPORT_CATALOG.filter(r => {
        if (r.hiddenInHub) return false;
        return r.name.toLowerCase().includes(term) || r.description.toLowerCase().includes(term);
    });

    const grouped = CATEGORIES_ORDER.map(cat => ({
        category: cat,
        reports: filtered.filter(r => r.category === cat),
    })).filter(g => g.reports.length > 0);

    return (
        <div className="reports-hub">
            <div className="search-box reports-search-box">
                <Search size={16} />
                <input
                    type="text"
                    placeholder="Buscar reportes..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {grouped.map(g => (
                <div key={g.category} className="reports-category-section">
                    <h3 className="reports-category-title">{g.category}</h3>
                    <div className="reports-card-grid">
                        {g.reports.map(r => (
                            <button
                                key={r.id}
                                type="button"
                                className="reports-card"
                                onClick={() => onSelect(r)}
                            >
                                <div className="reports-card-icon">
                                    <r.icon size={22} />
                                </div>
                                <div className="reports-card-body">
                                    <h4>{r.name}</h4>
                                    <p>{r.description}</p>
                                </div>
                                <ChevronRight size={18} className="reports-card-arrow" />
                            </button>
                        ))}
                    </div>
                </div>
            ))}

            {grouped.length === 0 && (
                <div className="state-placeholder">
                    <Search size={48} />
                    <p>No se encontraron reportes que coincidan con &ldquo;{search}&rdquo;</p>
                </div>
            )}
        </div>
    );
}

// ── Report Detail ──
function ReportDetail({ reportId }: { reportId: string }) {
    const { formatMoney: fmtCurrency } = useCurrency();
    const navigate = useNavigate();
    const reportDef = REPORT_CATALOG.find(r => r.id === reportId);
    const groupedReportIds = getGroupReports(reportId);
    const groupedReports = groupedReportIds
        .map(id => REPORT_CATALOG.find(r => r.id === id))
        .filter((r): r is ReportDef => Boolean(r));

    const [data, setData] = useState<{ items: Record<string, unknown>[]; summary: Record<string, number> } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [exporting, setExporting] = useState(false);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 50;

    const [branches, setBranches] = useState<Branch[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [brands, setBrands] = useState<BrandOption[]>([]);

    const [filters, setFilters] = useState<Record<string, string>>({
        dateFrom: monthStartStr(),
        dateTo: todayStr(),
        warehouseId: '',
        categoryId: '',
        supplierId: '',
        branchId: '',
        brandId: '',
        lowStockOnly: '',
    });

    useEffect(() => {
        Promise.all([
            branchesAPI.getAll().catch(() => ({ data: { data: [] } })),
            categoriesAPI.getAll().catch(() => ({ data: { data: [] } })),
            suppliersAPI.getAll().catch(() => ({ data: { data: [] } })),
            warehousesAPI.getAll().catch(() => ({ data: { data: [] } })),
            menuBrandsAPI.getAll().catch(() => ({ data: { data: [] } })),
        ]).then(([bRes, cRes, sRes, wRes, brRes]) => {
            setBranches(bRes.data.data || []);
            setCategories(cRes.data.data || []);
            setSuppliers(sRes.data.data || []);
            setWarehouses(wRes.data.data || []);
            setBrands(brRes.data.data || []);
        });
    }, []);

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
        setPage(1);
        try {
            const params = buildParams();
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
            setData(res.data.data);
        } catch (err: unknown) {
            const e = err as { response?: { data?: { message?: string } }; message?: string };
            setError(e?.response?.data?.message || e?.message || 'Error al cargar el reporte');
        } finally {
            setLoading(false);
        }
    }, [reportId, buildParams]);

    useEffect(() => { loadReport(); }, [loadReport]);

    const handleExport = async () => {
        setExporting(true);
        try {
            const params = buildParams();
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
                default: return;
            }
            downloadBlob(res.data, `reporte_${reportId}_${todayStr()}.xlsx`);
        } catch {
            setError('Error al exportar el reporte');
        } finally {
            setExporting(false);
        }
    };

    const clearFilters = () => {
        setFilters({ dateFrom: monthStartStr(), dateTo: todayStr(), warehouseId: '', categoryId: '', supplierId: '', branchId: '', brandId: '', lowStockOnly: '' });
    };

    if (!reportDef) {
        return (
            <div className="page-wrapper">
                <div className="state-placeholder">
                    <AlertTriangle size={48} />
                    <p>Reporte no encontrado</p>
                    <Button variant="ghost" onClick={() => navigate('/reporteria')}>
                        <ArrowLeft size={16} /> Volver a Reportería
                    </Button>
                </div>
            </div>
        );
    }

    const items = data?.items || [];
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const paginatedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const set = (key: string, val: string) => setFilters(f => ({ ...f, [key]: val }));

    const Icon = reportDef.icon;
    const summaryEntries = data?.summary
        ? Object.entries(data.summary).filter(([key]) => key !== 'actionBreakdown')
        : [];

    return (
        <div className="page-wrapper reports-detail-page">
            {/* Header */}
            <button
                type="button"
                className="back-link-btn"
                onClick={() => navigate('/reporteria')}
            >
                <ArrowLeft size={14} /> Volver a Reportería
            </button>

            <div className="page-header-bar">
                <div className="header-title-section">
                    <h1><Icon size={28} /> {reportDef.name}</h1>
                    <p className="header-subtitle">{reportDef.description}</p>
                </div>
                <div className="page-header-actions">
                    {groupedReports.length > 1 && (
                        <Select
                            label="Vista"
                            className="filter-field-wide"
                            value={{
                                value: reportId,
                                label: groupedReports.find((r) => r.id === reportId)?.name || reportId
                            }}
                            onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                option && navigate(`/reporteria/${option.value}`)}
                            options={groupedReports.map((r) => ({ value: r.id, label: r.name }))}
                            isSearchable={false}
                        />
                    )}
                    <Button onClick={handleExport} disabled={exporting || !data} title="Exportar a Excel">
                        {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                        Excel
                    </Button>
                </div>
            </div>

            {/* Filters Toolbar */}
            <div className="filters-toolbar">
                {hasDateFilter(reportId) && (
                    <div className="filter-field filter-field-wide">
                        <label className="filter-field-label">
                            <Calendar size={12} /> Rango de Fechas
                        </label>
                        <div className="filter-field-date-range">
                            <input
                                type="date"
                                className="filter-input"
                                value={filters.dateFrom}
                                onChange={e => set('dateFrom', e.target.value)}
                            />
                            <span className="filter-range-sep">→</span>
                            <input
                                type="date"
                                className="filter-input"
                                value={filters.dateTo}
                                onChange={e => set('dateTo', e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {(reportId === 'inventory' || reportId === 'low-stock') && (
                    <div className="filter-field">
                        <Select
                            label={<><Warehouse size={12} /> Almacén</>}
                            options={[{ value: '', label: 'Todos los Almacenes' }, ...warehouses.map(w => ({ value: w.id.toString(), label: w.name }))]}
                            value={{ value: filters.warehouseId, label: filters.warehouseId ? warehouses.find(w => w.id.toString() === filters.warehouseId)?.name || '' : 'Todos los Almacenes' }}
                            onChange={(opt) => opt && set('warehouseId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                {hasCategoryFilter(reportId) && (
                    <div className="filter-field">
                        <Select
                            label={<><Tag size={12} /> Categoría</>}
                            options={[{ value: '', label: 'Todas las Categorías' }, ...categories.map(c => ({ value: c.id.toString(), label: c.name }))]}
                            value={{ value: filters.categoryId, label: filters.categoryId ? categories.find(c => c.id.toString() === filters.categoryId)?.name || '' : 'Todas las Categorías' }}
                            onChange={(opt) => opt && set('categoryId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                {hasBrandFilter(reportId) && (
                    <div className="filter-field">
                        <Select
                            label={<><Building2 size={12} /> Empresa/Marca</>}
                            options={[{ value: '', label: 'Todas las Empresas' }, ...brands.map(b => ({ value: b.id.toString(), label: b.name }))]}
                            value={{ value: filters.brandId, label: filters.brandId ? brands.find(b => b.id.toString() === filters.brandId)?.name || '' : 'Todas las Empresas' }}
                            onChange={(opt) => opt && set('brandId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                {hasSupplierFilter(reportId) && (
                    <div className="filter-field">
                        <Select
                            label={<><Truck size={12} /> Proveedor</>}
                            options={[{ value: '', label: 'Todos los Proveedores' }, ...suppliers.map(s => ({ value: s.id.toString(), label: s.name }))]}
                            value={{ value: filters.supplierId, label: filters.supplierId ? suppliers.find(s => s.id.toString() === filters.supplierId)?.name || '' : 'Todos los Proveedores' }}
                            onChange={(opt) => opt && set('supplierId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                {hasBranchFilter(reportId) && (
                    <div className="filter-field">
                        <Select
                            label={<><Building2 size={12} /> Sucursal</>}
                            options={[{ value: '', label: 'Todas las Sucursales' }, ...branches.map(b => ({ value: b.id.toString(), label: b.name }))]}
                            value={{ value: filters.branchId, label: filters.branchId ? branches.find(b => b.id.toString() === filters.branchId)?.name || '' : 'Todas las Sucursales' }}
                            onChange={(opt) => opt && set('branchId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                {reportId === 'inventory' && (
                    <div className="filter-field filter-field-narrow">
                        <Select
                            label={<><AlertTriangle size={12} /> Solo Stock Bajo</>}
                            options={[{ value: '', label: 'No' }, { value: 'true', label: 'Sí' }]}
                            value={{ value: filters.lowStockOnly, label: filters.lowStockOnly === 'true' ? 'Sí' : 'No' }}
                            onChange={(opt) => opt && set('lowStockOnly', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}

                <div className="filter-spacer" />

                <div className="filter-actions">
                    <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>
                    <Button onClick={loadReport} disabled={loading}>
                        {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                        {loading ? 'Cargando...' : 'Aplicar Filtros'}
                    </Button>
                </div>
            </div>

            {/* KPI Summary Cards */}
            {summaryEntries.length > 0 && !loading && (
                <div className="kpi-grid">
                    {summaryEntries.map(([key, val]) => {
                        const isString = typeof val === 'string';
                        const isCurrency = !isString && /value|amount|sales|cost|discount|ticket|revenue|cogs|spent|income|commission|variation/i.test(key) && !/count|pct|percent/i.test(key);
                        const isPercent = !isString && /margin|foodcost|variation/i.test(key) && /pct|percent|overall/i.test(key);
                        return (
                            <div key={key} className={`kpi-card ${getKpiVariant(key)}`}>
                                <div className="kpi-label">
                                    {getKpiIcon(key)}
                                    {formatSummaryLabel(key)}
                                </div>
                                <div className="kpi-value">
                                    {isString ? String(val) : isCurrency ? fmtCurrency(Number(val)) : isPercent ? fmtPercent(Number(val)) : fmtNumber(Number(val))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="state-placeholder">
                    <RefreshCw size={32} className="animate-spin" />
                    <p>Cargando reporte...</p>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="state-placeholder">
                    <AlertTriangle size={32} />
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={loadReport}>
                        <RefreshCw size={14} /> Reintentar
                    </Button>
                </div>
            )}

            {/* Empty */}
            {!loading && !error && items.length === 0 && data && (
                <div className="state-placeholder">
                    <FileText size={48} />
                    <p>No se encontraron resultados con los filtros seleccionados.</p>
                </div>
            )}

            {/* Table */}
            {!loading && !error && items.length > 0 && (
                <>
                    <div className="data-table-wrapper">
                        <div className="data-table-header">
                            <span>{reportDef.name}</span>
                            <span className="data-table-count">{items.length} registros</span>
                        </div>
                        <div className="data-table-scroll">
                            <table className="data-table">
                                <thead>
                                    <tr>{getColumns(reportId).map(col => (
                                        <th key={col.key} className={col.align === 'right' ? 'text-right' : ''}>{col.header}</th>
                                    ))}</tr>
                                </thead>
                                <tbody>
                                    {paginatedItems.map((row, i) => (
                                        <tr key={i}>{getColumns(reportId).map(col => (
                                            <td key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                                                {renderCell(row[col.key], col, fmtCurrency)}
                                            </td>
                                        ))}</tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {totalPages > 1 && (
                        <div className="pagination-bar">
                            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                Anterior
                            </Button>
                            <span className="pagination-info">
                                Página {page} de {totalPages}
                                <span className="total-records"> ({items.length} registros)</span>
                            </span>
                            <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                Siguiente
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── Filter visibility helpers ──
const DATE_FILTER_REPORTS = new Set([
    'purchases', 'sales', 'purchases-by-day', 'purchases-by-month', 'price-comparison',
    'most-purchased', 'purchases-by-supplier', 'sales-by-category', 'sales-by-brand', 'sales-daily',
    'sales-monthly', 'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel',
    'sales-by-hour', 'food-cost-by-category', 'margin-by-product', 'audit', 'day-analysis',
    'menu-engineering', 'purchase-projection',
]);
const BRANCH_FILTER_REPORTS = new Set([
    'purchases', 'sales', 'purchases-by-day', 'purchases-by-month', 'most-purchased',
    'purchases-by-supplier', 'sales-by-category', 'sales-by-brand', 'sales-daily', 'sales-monthly',
    'sales-by-payment-method', 'sales-by-waiter', 'sales-by-channel', 'sales-by-hour',
    'food-cost-by-category', 'margin-by-product', 'day-analysis', 'month-comparison',
    'recipe-cost', 'production-yield', 'menu-engineering', 'purchase-projection',
]);
const CATEGORY_FILTER_REPORTS = new Set([
    'inventory', 'purchases', 'sales', 'profitability', 'low-stock',
    'price-comparison', 'sales-by-category', 'margin-by-product',
    'recipe-cost',
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
function hasSupplierFilter(id: string) { return SUPPLIER_FILTER_REPORTS.has(id); }
function hasBrandFilter(id: string) { return BRAND_FILTER_REPORTS.has(id); }

// ── KPI Icons / variants ──
function getKpiIcon(key: string) {
    const k = key.toLowerCase();
    if (/total|count|number|orders|items|products|users|methods|channels|categories|suppliers|portions|events|days|months/i.test(k)) return <Package size={14} />;
    if (/value|amount|sales|cost|spent|income|revenue|commission|cogs|margin/i.test(k)) return <DollarSign size={14} />;
    if (/critical|lowstock|low/i.test(k)) return <AlertTriangle size={14} />;
    if (/percent|pct|variation/i.test(k)) return <TrendingUp size={14} />;
    if (/hour|peak|time/i.test(k)) return <Clock size={14} />;
    if (/top|max|best/i.test(k)) return <TrendingUp size={14} />;
    return <BarChart3 size={14} />;
}

function getKpiVariant(key: string): string {
    const k = key.toLowerCase();
    if (/critical|urgent/i.test(k)) return 'kpi-danger';
    if (/warning|low|lowstock/i.test(k)) return 'kpi-warning';
    if (/total|value|sales|revenue|income|margin/i.test(k)) return 'kpi-success';
    return '';
}

// ── Column Definitions ──
type ColDef = { key: string; header: string; align?: 'right' | 'center'; format?: 'currency' | 'number' | 'percent' | 'date' | 'status' };

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
        default: return [];
    }
}

function renderCell(value: unknown, col: ColDef, fmtCurrency: (n: number) => string = (n) => formatCurrency(n)) {
    if (value === null || value === undefined) return '-';
    switch (col.format) {
        case 'currency': return fmtCurrency(Number(value));
        case 'number': return fmtNumber(Number(value));
        case 'percent': return fmtPercent(Number(value));
        case 'date': return fmtDate(String(value));
        case 'status': {
            const s = String(value).toUpperCase();
            const cls = s === 'OK' || s === 'HIGH' ? 'status-ok'
                : s === 'MEDIUM' || s === 'WARNING' || s === 'LOW' ? 'status-warning'
                : s === 'CRITICAL' ? 'status-critical'
                : 'status-default';
            const labels: Record<string, string> = {
                OK: 'OK', HIGH: 'Alto', MEDIUM: 'Medio', LOW: 'Bajo',
                WARNING: 'Advertencia', CRITICAL: 'Crítico',
                DRAFT: 'Borrador', ISSUED: 'Emitida', RECEIVED: 'Recibida', CANCELLED: 'Cancelada',
            };
            return <span className={`status-pill ${cls}`}>{labels[s] || s}</span>;
        }
        default: return String(value);
    }
}

function formatSummaryLabel(key: string): string {
    const map: Record<string, string> = {
        totalProducts: 'Total Productos', totalValue: 'Valor Total',
        lowStockCount: 'Stock Bajo', criticalCount: 'Crítico',
        totalOrders: 'Total Órdenes', totalAmount: 'Monto Total',
        uniqueSuppliers: 'Proveedores', uniqueProducts: 'Productos',
        totalSales: 'Ventas Totales', totalDiscount: 'Descuento Total',
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
    };
    return map[key] || key;
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
        <div className="page-wrapper reports-page">
            {!reportId && (
                <>
                    <div className="page-header-bar">
                        <div className="header-title-section">
                            <h1><BarChart3 size={28} /> Reportería</h1>
                            <p className="header-subtitle">
                                Consulta, filtra y exporta información clave del negocio.
                            </p>
                        </div>
                    </div>
                    <ReportsHub onSelect={handleSelect} />
                </>
            )}
            {reportId && <ReportDetail reportId={reportId} />}
        </div>
    );
}
