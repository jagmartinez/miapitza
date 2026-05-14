import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, warehousesAPI } from '../services/api';
import Button from '../components/Button';
import Select from '../components/Select';
import {
    Package, ShoppingCart, DollarSign, TrendingUp, BarChart3, AlertTriangle,
    ArrowLeft, Download, Filter, Search, FileSpreadsheet, Truck,
    RefreshCw, FileText, Calendar
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
            <div className="reports-search-bar">
                <Search size={16} />
                <input
                    type="text"
                    className="table-filter-input"
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
                            <div key={r.id} className="reports-card" onClick={() => onSelect(r)}>
                                <div className="reports-card-icon">
                                    <r.icon size={22} />
                                </div>
                                <div className="reports-card-body">
                                    <h4>{r.name}</h4>
                                    <p>{r.description}</p>
                                </div>
                                <span className="reports-card-arrow">→</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            {grouped.length === 0 && (
                <div className="reports-empty">
                    <Search size={48} />
                    <p>No se encontraron reportes que coincidan con &ldquo;{search}&rdquo;</p>
                </div>
            )}
        </div>
    );
}

// ── Report Detail ──
function ReportDetail({ reportId }: { reportId: string }) {
    const navigate = useNavigate();
    const reportDef = REPORT_CATALOG.find(r => r.id === reportId);

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
        setFilters({ dateFrom: monthStartStr(), dateTo: todayStr(), warehouseId: '', categoryId: '', supplierId: '', branchId: '', lowStockOnly: '' });
    };

    if (!reportDef) {
        return (
            <div className="reports-empty">
                <AlertTriangle size={48} />
                <p>Reporte no encontrado</p>
                <Button variant="secondary" onClick={() => navigate('/reporteria')}>
                    <ArrowLeft size={16} /> Volver a Reportería
                </Button>
            </div>
        );
    }

    const items = data?.items || [];
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const paginatedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const set = (key: string, val: string) => setFilters(f => ({ ...f, [key]: val }));

    return (
        <div className="reports-detail-page">
            {/* Header — matches cost-report-header */}
            <div className="cost-report-header">
                <div className="header-title-section">
                    <Button variant="ghost" onClick={() => navigate('/reporteria')} style={{ marginBottom: '8px' }}>
                        <ArrowLeft size={16} /> Volver a Reportería
                    </Button>
                    <h1><reportDef.icon size={32} /> {reportDef.name}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>{reportDef.description}</p>
                </div>
                <Button onClick={handleExport} disabled={exporting || !data}>
                    {exporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                    {exporting ? 'Exportando...' : 'Exportar Excel'}
                </Button>
            </div>

            {/* Filters — matches cost-report-filters pattern */}
            <div className="cost-report-filters">
                {(reportId === 'purchases' || reportId === 'sales') && (
                    <div className="cost-report-date-range">
                        <Calendar size={16} />
                        <input type="date" className="table-filter-input" value={filters.dateFrom}
                            onChange={e => set('dateFrom', e.target.value)} />
                        <span>-</span>
                        <input type="date" className="table-filter-input" value={filters.dateTo}
                            onChange={e => set('dateTo', e.target.value)} />
                    </div>
                )}
                {(reportId === 'inventory' || reportId === 'low-stock') && (
                    <div className="cost-report-select-wrapper">
                        <Select
                            options={[{ value: '', label: 'Todos Almacenes' }, ...warehouses.map(w => ({ value: w.id.toString(), label: w.name }))]}
                            value={{ value: filters.warehouseId, label: filters.warehouseId ? warehouses.find(w => w.id.toString() === filters.warehouseId)?.name || '' : 'Todos Almacenes' }}
                            onChange={(opt) => opt && set('warehouseId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}
                {(reportId === 'inventory' || reportId === 'purchases' || reportId === 'sales' || reportId === 'profitability' || reportId === 'low-stock') && (
                    <div className="cost-report-select-wrapper">
                        <Select
                            options={[{ value: '', label: 'Todas Categorías' }, ...categories.map(c => ({ value: c.id.toString(), label: c.name }))]}
                            value={{ value: filters.categoryId, label: filters.categoryId ? categories.find(c => c.id.toString() === filters.categoryId)?.name || '' : 'Todas Categorías' }}
                            onChange={(opt) => opt && set('categoryId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}
                {(reportId === 'purchases') && (
                    <div className="cost-report-select-wrapper">
                        <Select
                            options={[{ value: '', label: 'Todos Proveedores' }, ...suppliers.map(s => ({ value: s.id.toString(), label: s.name }))]}
                            value={{ value: filters.supplierId, label: filters.supplierId ? suppliers.find(s => s.id.toString() === filters.supplierId)?.name || '' : 'Todos Proveedores' }}
                            onChange={(opt) => opt && set('supplierId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}
                {(reportId === 'sales' || reportId === 'purchases') && (
                    <div className="cost-report-select-wrapper">
                        <Select
                            options={[{ value: '', label: 'Todas Sucursales' }, ...branches.map(b => ({ value: b.id.toString(), label: b.name }))]}
                            value={{ value: filters.branchId, label: filters.branchId ? branches.find(b => b.id.toString() === filters.branchId)?.name || '' : 'Todas Sucursales' }}
                            onChange={(opt) => opt && set('branchId', (opt as { value: string }).value)}
                            isSearchable={false}
                        />
                    </div>
                )}
                {reportId === 'inventory' && (
                    <div className="cost-report-select-wrapper">
                        <Select
                            options={[{ value: '', label: 'No' }, { value: 'true', label: 'Sí' }]}
                            value={{ value: filters.lowStockOnly, label: filters.lowStockOnly === 'true' ? 'Sí' : 'No' }}
                            onChange={(opt) => opt && set('lowStockOnly', (opt as { value: string }).value)}
                            isSearchable={false}
                            label="Solo stock bajo"
                        />
                    </div>
                )}
                <Button onClick={loadReport} disabled={loading}>
                    <Filter size={16} />
                    {loading ? 'Cargando...' : 'Aplicar Filtros'}
                </Button>
                <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>
            </div>

            {/* KPI Summary Cards — matches cost-report-kpi-grid */}
            {data?.summary && !loading && (
                <div className="cost-report-kpi-grid">
                    {Object.entries(data.summary).map(([key, val]) => {
                        const isCurrency = /value|amount|sales|cost|discount|ticket/i.test(key) && !/count/i.test(key);
                        const isPercent = /margin/i.test(key) && !/count/i.test(key);
                        return (
                            <div key={key} className="cost-kpi-card">
                                <div className="cost-kpi-label">{formatSummaryLabel(key)}</div>
                                <div className="cost-kpi-value">
                                    {isCurrency ? fmtCurrency(val) : isPercent ? fmtPercent(val) : fmtNumber(val)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="reports-empty">
                    <RefreshCw size={32} className="animate-spin" />
                    <p>Cargando reporte...</p>
                </div>
            )}

            {/* Error */}
            {error && !loading && (
                <div className="reports-empty">
                    <AlertTriangle size={32} />
                    <p style={{ color: '#ef4444' }}>{error}</p>
                    <Button variant="secondary" onClick={loadReport}><RefreshCw size={14} /> Reintentar</Button>
                </div>
            )}

            {/* Empty */}
            {!loading && !error && items.length === 0 && data && (
                <div className="reports-empty">
                    <FileText size={48} />
                    <p>No se encontraron resultados con los filtros seleccionados.</p>
                </div>
            )}

            {/* Table — matches cost-report-table-wrapper */}
            {!loading && !error && items.length > 0 && (
                <>
                    <div className="cost-report-table-wrapper">
                        <div className="cost-report-table-header">
                            {reportDef.name} ({items.length})
                        </div>
                        <div className="cost-report-table-scroll">
                            <table className="cost-report-table">
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
                                    {items.length === 0 && (
                                        <tr><td colSpan={getColumns(reportId).length} className="cost-report-empty">Sin datos para los filtros seleccionados</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {totalPages > 1 && (
                        <div className="kardex-pagination" style={{ marginTop: '16px' }}>
                            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                Anterior
                            </Button>
                            <span className="pagination-info">
                                Página {page} de {totalPages}
                                <span className="total-records"> ({items.length} registros)</span>
                            </span>
                            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                                Siguiente
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
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
        totalProducts: 'Total Productos', totalValue: 'Valor Total',
        lowStockCount: 'Stock Bajo', criticalCount: 'Crítico',
        totalOrders: 'Total Órdenes', totalAmount: 'Monto Total',
        uniqueSuppliers: 'Proveedores', uniqueProducts: 'Productos',
        totalSales: 'Ventas Totales', totalDiscount: 'Descuento Total',
        averageTicket: 'Ticket Promedio', totalItems: 'Total Items',
        avgMargin: 'Margen Promedio', lowMarginCount: 'Bajo Margen',
        totalLowStock: 'Total Bajo Stock', warningCount: 'Advertencia',
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
        <div className="cost-report-page">
            {!reportId && (
                <>
                    <div className="cost-report-header">
                        <div className="header-title-section">
                            <h1><BarChart3 size={32} /> Reportería</h1>
                            <p style={{ color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
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
