import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, warehousesAPI } from '../services/api';
import {
    Package, ShoppingCart, DollarSign, TrendingUp, BarChart3, AlertTriangle,
    ArrowLeft, Download, Filter, Search, FileSpreadsheet, Truck,
    RefreshCw, ChevronDown, ChevronUp
} from 'lucide-react';
import type { Branch, Supplier } from '../types';
import './Reports.css';

interface CategoryOption { id: number; name: string }
interface WarehouseOption { id: number; name: string }

const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO', minimumFractionDigits: 2 }).format(n);

const fmtNumber = (n: number) =>
    new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 }).format(n);

const fmtPercent = (n: number) => `${n.toFixed(1)}%`;

const fmtDate = (d: string) => {
    if (!d) return '-';
    const date = new Date(d);
    return date.toLocaleDateString('es-NI');
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
};

const REPORT_CATALOG: ReportDef[] = [
    { id: 'inventory', name: 'Inventario Actual', description: 'Existencias por producto, almacén y categoría con valorización.', icon: Package, category: 'Inventario' },
    { id: 'kardex', name: 'Kardex de Movimientos', description: 'Entradas, salidas, ajustes y traslados de inventario.', icon: FileSpreadsheet, category: 'Inventario', navigateTo: '/kardex' },
    { id: 'low-stock', name: 'Stock Bajo', description: 'Productos con inventario por debajo del mínimo configurado.', icon: AlertTriangle, category: 'Inventario' },
    { id: 'purchases', name: 'Compras', description: 'Análisis de compras por proveedor, producto y período.', icon: Truck, category: 'Compras' },
    { id: 'sales', name: 'Ventas', description: 'Ventas por período, producto, categoría, usuario y método de pago.', icon: ShoppingCart, category: 'Ventas' },
    { id: 'costs', name: 'Costos', description: 'COGS estimado, costos de compra y margen bruto por período.', icon: DollarSign, category: 'Costos', navigateTo: '/cost-report' },
    { id: 'profitability', name: 'Rentabilidad por Producto', description: 'Precio de venta vs costo estimado y margen por platillo.', icon: TrendingUp, category: 'Costos' },
];

const CATEGORIES_ORDER = ['Inventario', 'Compras', 'Ventas', 'Costos'];

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
    const filtered = REPORT_CATALOG.filter(r =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        r.description.toLowerCase().includes(search.toLowerCase())
    );

    const grouped = CATEGORIES_ORDER.map(cat => ({
        category: cat,
        reports: filtered.filter(r => r.category === cat),
    })).filter(g => g.reports.length > 0);

    return (
        <div className="reports-hub">
            <div className="reports-search">
                <Search size={16} className="reports-search-icon" />
                <input
                    type="text"
                    placeholder="Buscar reportes..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {grouped.map(g => (
                <div key={g.category} className="reports-category">
                    <h3>{g.category}</h3>
                    <div className="reports-grid">
                        {g.reports.map(r => (
                            <div key={r.id} className="report-card" onClick={() => onSelect(r)}>
                                <div className="report-card-header">
                                    <div className="report-card-icon">
                                        <r.icon size={20} />
                                    </div>
                                    <div>
                                        <h4>{r.name}</h4>
                                        <p>{r.description}</p>
                                    </div>
                                </div>
                                <div className="report-card-footer">
                                    <span className="report-card-category">{r.category}</span>
                                    <span className="report-card-link">Ver reporte →</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {grouped.length === 0 && (
                <div className="report-empty-state">
                    <Search size={48} />
                    <p>No se encontraron reportes que coincidan con "{search}"</p>
                </div>
            )}
        </div>
    );
}

// ── Report Detail ──
function ReportDetail({ reportId }: { reportId: string }) {
    const navigate = useNavigate();
    const reportDef = REPORT_CATALOG.find(r => r.id === reportId);

    const [data, setData] = useState<{ items: any[]; summary: Record<string, number> } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [exporting, setExporting] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(true);
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 50;

    // Filter options
    const [branches, setBranches] = useState<Branch[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);

    // Filter values
    const [filters, setFilters] = useState<Record<string, string>>({
        dateFrom: monthStartStr(),
        dateTo: todayStr(),
        warehouseId: '',
        categoryId: '',
        supplierId: '',
        branchId: '',
        lowStockOnly: '',
    });

    useEffect(() => {
        Promise.all([
            branchesAPI.getAll().catch(() => ({ data: { data: [] } })),
            categoriesAPI.getAll().catch(() => ({ data: { data: [] } })),
            suppliersAPI.getAll().catch(() => ({ data: { data: [] } })),
            warehousesAPI.getAll().catch(() => ({ data: { data: [] } })),
        ]).then(([bRes, cRes, sRes, wRes]) => {
            setBranches(bRes.data.data || []);
            setCategories(cRes.data.data || []);
            setSuppliers(sRes.data.data || []);
            setWarehouses(wRes.data.data || []);
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
                default: throw new Error('Reporte no encontrado');
            }
            setData(res.data.data);
        } catch (err: any) {
            setError(err?.response?.data?.message || err?.message || 'Error al cargar el reporte');
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
                default: return;
            }
            const date = todayStr();
            downloadBlob(res.data, `reporte_${reportId}_${date}.xlsx`);
        } catch {
            setError('Error al exportar el reporte');
        } finally {
            setExporting(false);
        }
    };

    const clearFilters = () => {
        setFilters({
            dateFrom: monthStartStr(),
            dateTo: todayStr(),
            warehouseId: '',
            categoryId: '',
            supplierId: '',
            branchId: '',
            lowStockOnly: '',
        });
    };

    if (!reportDef) {
        return (
            <div className="report-error">
                <AlertTriangle size={48} />
                <p>Reporte no encontrado</p>
                <button className="report-back-btn" onClick={() => navigate('/reporteria')}>
                    <ArrowLeft size={16} /> Volver a Reportería
                </button>
            </div>
        );
    }

    const items = data?.items || [];
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const paginatedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div className="report-detail">
            <div className="report-detail-header">
                <button className="report-back-btn" onClick={() => navigate('/reporteria')}>
                    <ArrowLeft size={16} /> Volver a Reportería
                </button>
                <div className="report-detail-title">
                    <h1><reportDef.icon size={28} /> {reportDef.name}</h1>
                    <p>{reportDef.description}</p>
                </div>
                <button className="export-btn" onClick={handleExport} disabled={exporting || !data}>
                    {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                    {exporting ? 'Exportando...' : 'Exportar Excel'}
                </button>
            </div>

            {/* Filters */}
            <div className="report-filters-container">
                <button className="report-filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)}>
                    <Filter size={16} /> Filtros
                    {filtersOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {filtersOpen && (
                    <div className="report-filters">
                        {renderFilters(reportId, filters, setFilters, branches, categories, suppliers, warehouses)}
                        <div className="report-filters-actions">
                            <button className="btn-apply" onClick={loadReport}>
                                <Filter size={14} /> Aplicar Filtros
                            </button>
                            <button className="btn-clear" onClick={clearFilters}>Limpiar</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Summary Cards */}
            {data?.summary && !loading && (
                <div className="report-summary-cards">
                    {Object.entries(data.summary).map(([key, val]) => (
                        <div key={key} className="report-summary-card">
                            <div className="label">{formatSummaryLabel(key)}</div>
                            <div className="value">
                                {typeof val === 'number' && key.toLowerCase().includes('value') || key.toLowerCase().includes('amount') || key.toLowerCase().includes('sales') || key.toLowerCase().includes('cost') || key.toLowerCase().includes('discount') || key.toLowerCase().includes('ticket')
                                    ? fmtCurrency(val as number)
                                    : typeof val === 'number' && key.toLowerCase().includes('margin') && !key.toLowerCase().includes('count')
                                    ? fmtPercent(val as number)
                                    : fmtNumber(val as number)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* States */}
            {loading && (
                <div className="report-loading">
                    <RefreshCw size={32} className="animate-spin" />
                    <p>Cargando reporte...</p>
                </div>
            )}

            {error && !loading && (
                <div className="report-error">
                    <AlertTriangle size={32} />
                    <p>{error}</p>
                    <button className="btn-apply" onClick={loadReport}><RefreshCw size={14} /> Reintentar</button>
                </div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className="report-empty-state">
                    <Search size={48} />
                    <p>No se encontraron resultados con los filtros seleccionados.</p>
                </div>
            )}

            {/* Table */}
            {!loading && !error && items.length > 0 && (
                <>
                    <div className="report-table-wrapper">
                        <table className="report-table">
                            <thead>
                                <tr>{getColumns(reportId).map(col => (
                                    <th key={col.key} className={col.align === 'right' ? 'text-right' : ''}>{col.header}</th>
                                ))}</tr>
                            </thead>
                            <tbody>
                                {paginatedItems.map((row, i) => (
                                    <tr key={i}>{getColumns(reportId).map(col => (
                                        <td key={col.key} className={col.align === 'right' ? 'text-right' : ''}>
                                            {renderCell(row[col.key], col)}
                                        </td>
                                    ))}</tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div className="report-pagination">
                            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
                            <span>Página {page} de {totalPages} ({items.length} registros)</span>
                            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ── Filter Renderers ──
function renderFilters(
    reportId: string,
    filters: Record<string, string>,
    setFilters: (fn: (f: Record<string, string>) => Record<string, string>) => void,
    branches: Branch[],
    categories: CategoryOption[],
    suppliers: Supplier[],
    warehouses: WarehouseOption[],
) {
    const set = (key: string, val: string) => setFilters(f => ({ ...f, [key]: val }));

    const dateFilters = (
        <>
            <div className="report-filter-group">
                <label>Desde</label>
                <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)} />
            </div>
            <div className="report-filter-group">
                <label>Hasta</label>
                <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)} />
            </div>
        </>
    );

    const branchFilter = (
        <div className="report-filter-group">
            <label>Sucursal</label>
            <select value={filters.branchId} onChange={e => set('branchId', e.target.value)}>
                <option value="">Todas</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
        </div>
    );

    const categoryFilter = (
        <div className="report-filter-group">
            <label>Categoría</label>
            <select value={filters.categoryId} onChange={e => set('categoryId', e.target.value)}>
                <option value="">Todas</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        </div>
    );

    const warehouseFilter = (
        <div className="report-filter-group">
            <label>Almacén</label>
            <select value={filters.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
                <option value="">Todos</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
        </div>
    );

    const supplierFilter = (
        <div className="report-filter-group">
            <label>Proveedor</label>
            <select value={filters.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Todos</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
        </div>
    );

    switch (reportId) {
        case 'inventory':
            return <>{warehouseFilter}{categoryFilter}
                <div className="report-filter-group">
                    <label>Solo stock bajo</label>
                    <select value={filters.lowStockOnly} onChange={e => set('lowStockOnly', e.target.value)}>
                        <option value="">No</option>
                        <option value="true">Sí</option>
                    </select>
                </div>
            </>;
        case 'purchases':
            return <>{dateFilters}{supplierFilter}{categoryFilter}{branchFilter}</>;
        case 'sales':
            return <>{dateFilters}{branchFilter}{categoryFilter}</>;
        case 'profitability':
            return <>{categoryFilter}</>;
        case 'low-stock':
            return <>{warehouseFilter}{categoryFilter}</>;
        default:
            return null;
    }
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
            { key: 'quantity', header: 'Cant.', align: 'right', format: 'number' },
            { key: 'unitPrice', header: 'Precio Unit.', align: 'right', format: 'currency' },
            { key: 'discount', header: 'Descuento', align: 'right', format: 'currency' },
            { key: 'totalSale', header: 'Total', align: 'right', format: 'currency' },
            { key: 'paymentMethod', header: 'Método Pago' },
            { key: 'userName', header: 'Usuario' },
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
        default: return [];
    }
}

function renderCell(value: unknown, col: ColDef) {
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
            return <span className={`report-status-badge ${cls}`}>{labels[s] || s}</span>;
        }
        default: return String(value);
    }
}

function formatSummaryLabel(key: string): string {
    const map: Record<string, string> = {
        totalProducts: 'Total Productos',
        totalValue: 'Valor Total',
        lowStockCount: 'Stock Bajo',
        criticalCount: 'Crítico',
        totalOrders: 'Total Órdenes',
        totalAmount: 'Monto Total',
        uniqueSuppliers: 'Proveedores',
        uniqueProducts: 'Productos',
        totalSales: 'Ventas Totales',
        totalDiscount: 'Descuento Total',
        averageTicket: 'Ticket Promedio',
        totalItems: 'Total Items',
        avgMargin: 'Margen Promedio',
        lowMarginCount: 'Bajo Margen',
        totalLowStock: 'Total Bajo Stock',
        warningCount: 'Advertencia',
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
        <div className="reports-page">
            {!reportId && (
                <>
                    <div className="reports-header">
                        <div>
                            <h1><BarChart3 size={28} /> Reportería</h1>
                            <p>Consulta, filtra y exporta información clave del negocio.</p>
                        </div>
                    </div>
                    <ReportsHub onSelect={handleSelect} />
                </>
            )}
            {reportId && <ReportDetail reportId={reportId} />}
        </div>
    );
}
