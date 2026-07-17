import { useState, useEffect, useCallback } from 'react';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, settingsAPI } from '../services/api';
import Select from '../components/Select';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import {
    DollarSign, TrendingUp, ShoppingCart, BarChart3,
    Search, RefreshCw, Calendar, Tag, Building2, Truck, Package, AlertTriangle
} from 'lucide-react';
import type { Branch, Supplier } from '../types';
import './CostReport.css';

interface CategoryOption {
    id: number;
    name: string;
}

interface CostSummary {
    totalPurchaseCost: number;
    estimatedCOGS: number;
    totalRevenue: number;
    grossMargin: number;
    purchaseOrderCount: number;
    excludedLegacyPurchaseLines: number;
    excludedLegacyPurchaseAmount: number;
}

interface ProductCost {
    productId: number;
    productName: string;
    sku: string | null;
    unit: string;
    categoryName: string | null;
    totalQuantity: number;
    totalCost: number;
    avgUnitCost: number;
    currentAvgCost: number;
}

const PAGE_SIZE = 20;

export default function CostReport() {
    const [summary, setSummary] = useState<CostSummary | null>(null);
    const [products, setProducts] = useState<ProductCost[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filterWarning, setFilterWarning] = useState<string | null>(null);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [page, setPage] = useState(1);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);

    const [filters, setFilters] = useState({
        dateFrom: formatLocalDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
        dateTo: formatLocalDateInput(),
        branchId: '',
        categoryId: '',
        supplierId: ''
    });

    useEffect(() => {
        Promise.allSettled([
            branchesAPI.getAll(),
            categoriesAPI.getAll(),
            suppliersAPI.getAll(),
            settingsAPI.getAll(),
        ]).then(([bRes, cRes, sRes, settingsRes]) => {
            const failed: string[] = [];
            if (bRes.status === 'fulfilled') setBranches(bRes.value.data.data || []);
            else failed.push('sucursales');
            if (cRes.status === 'fulfilled') setCategories(cRes.value.data.data || []);
            else failed.push('categorías');
            if (sRes.status === 'fulfilled') setSuppliers(sRes.value.data.data || []);
            else failed.push('proveedores');
            if (settingsRes.status === 'fulfilled') setSettings(settingsRes.value.data.data || {});
            else failed.push('configuración');
            setFilterWarning(
                failed.length > 0
                    ? `No se pudieron cargar filtros: ${failed.join(', ')}. Algunas opciones pueden estar incompletas.`
                    : null
            );
        });
    }, []);

    const loadReport = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params: Record<string, string> = {};
            if (filters.dateFrom) params.dateFrom = filters.dateFrom;
            if (filters.dateTo) params.dateTo = filters.dateTo;
            if (filters.branchId) params.branchId = filters.branchId;
            if (filters.categoryId) params.categoryId = filters.categoryId;
            if (filters.supplierId) params.supplierId = filters.supplierId;

            const res = await reportsAPI.getCostReport(params);
            setSummary(res.data.data.summary);
            setProducts(res.data.data.byProduct || []);
            setPage(1);
        } catch (err: unknown) {
            const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
                || (err as Error)?.message
                || 'Error al cargar el reporte de costos';
            setError(message);
            setSummary(null);
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        void loadReport();
    }, [loadReport]);

    useEffect(() => {
        setPage(1);
    }, [filters.dateFrom, filters.dateTo, filters.branchId, filters.categoryId, filters.supplierId]);

    const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
    const pagedProducts = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const marginClass = summary
        ? summary.grossMargin >= 50 ? 'kpi-success' : summary.grossMargin >= 30 ? 'kpi-warning' : 'kpi-danger'
        : '';

    return (
        <div className="page-wrapper cost-report-page">
            <div className="page-header-bar">
                <div className="header-title-section">
                    <h1><BarChart3 size={28} /> Reporte de Costos</h1>
                    <p className="header-subtitle">
                        Análisis de costos de compra, COGS estimado y margen bruto por período.
                    </p>
                </div>
                <div className="page-header-actions">
                    <Button onClick={loadReport} disabled={loading}>
                        {loading ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {loading ? 'Cargando...' : 'Actualizar'}
                    </Button>
                </div>
            </div>

            {filterWarning && (
                <div className="state-placeholder" role="status" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
                    <AlertTriangle size={18} />
                    <p className="state-error" style={{ margin: 0 }}>{filterWarning}</p>
                </div>
            )}
            {summary && summary.excludedLegacyPurchaseLines > 0 && (
                <div className="state-placeholder" role="status" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
                    <AlertTriangle size={18} />
                    <p className="state-error" style={{ margin: 0 }}>
                        {summary.excludedLegacyPurchaseLines} línea(s) histórica(s) por {formatCurrency(summary.excludedLegacyPurchaseAmount, settings)}
                        {' '}no tienen cantidad/costo en UOM base. El total monetario sí las incluye, pero se excluyen del desglose por producto para no reinterpretar unidades.
                    </p>
                </div>
            )}
            {error && (
                <div className="state-placeholder" role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}>
                    <AlertTriangle size={18} />
                    <p className="state-error" style={{ margin: 0 }}>{error}</p>
                    <Button onClick={loadReport} disabled={loading}>
                        <RefreshCw size={14} /> Reintentar
                    </Button>
                </div>
            )}

            {/* Filters Toolbar */}
            <div className="filters-toolbar">
                <div className="filter-field filter-field-wide">
                    <label className="filter-field-label">
                        <Calendar size={12} /> Rango de Fechas
                    </label>
                    <div className="filter-field-date-range">
                        <input
                            type="date"
                            className="filter-input"
                            value={filters.dateFrom}
                            onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
                        />
                        <span className="filter-range-sep">→</span>
                        <input
                            type="date"
                            className="filter-input"
                            value={filters.dateTo}
                            onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
                        />
                    </div>
                </div>

                <div className="filter-field">
                    <Select
                        label={<><Building2 size={12} /> Sucursal</>}
                        options={[{ value: '', label: 'Todas las Sucursales' }, ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))]}
                        value={{ value: filters.branchId, label: filters.branchId ? branches.find((b) => b.id.toString() === filters.branchId)?.name || '' : 'Todas las Sucursales' }}
                        onChange={(opt) => opt && setFilters({ ...filters, branchId: opt.value })}
                        isSearchable={false}
                    />
                </div>

                <div className="filter-field filter-field-category">
                    <Select
                        label={<><Tag size={12} /> Categoría</>}
                        options={[{ value: '', label: 'Todas las Categorías' }, ...categories.map((c) => ({ value: c.id.toString(), label: c.name }))]}
                        value={{ value: filters.categoryId, label: filters.categoryId ? categories.find((c) => c.id.toString() === filters.categoryId)?.name || '' : 'Todas las Categorías' }}
                        onChange={(opt) => opt && setFilters({ ...filters, categoryId: opt.value })}
                        isSearchable={false}
                    />
                </div>

                <div className="filter-field">
                    <Select
                        label={<><Truck size={12} /> Proveedor</>}
                        options={[{ value: '', label: 'Todos los Proveedores' }, ...suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))]}
                        value={{ value: filters.supplierId, label: filters.supplierId ? suppliers.find((s) => s.id.toString() === filters.supplierId)?.name || '' : 'Todos los Proveedores' }}
                        onChange={(opt) => opt && setFilters({ ...filters, supplierId: opt.value })}
                        isSearchable={false}
                    />
                </div>

                <div className="filter-spacer" />

                <div className="filter-actions">
                    <Button onClick={loadReport} disabled={loading}>
                        <Search size={16} /> Aplicar Filtros
                    </Button>
                </div>
            </div>

            {/* KPI Cards */}
            {summary && (
                <div className="kpi-grid">
                    <div className="kpi-card kpi-neutral">
                        <div className="kpi-label">
                            <ShoppingCart size={14} /> Costo Total Compras
                        </div>
                        <div className="kpi-value">{formatCurrency(summary.totalPurchaseCost, settings)}</div>
                        <div className="kpi-detail">{summary.purchaseOrderCount} órdenes de compra</div>
                    </div>
                    <div className="kpi-card kpi-warning">
                        <div className="kpi-label">
                            <DollarSign size={14} /> COGS Estimado
                        </div>
                        <div className="kpi-value">{formatCurrency(summary.estimatedCOGS, settings)}</div>
                        <div className="kpi-detail">Ledger ORD-* (receta × costo solo si no hay movimientos)</div>
                    </div>
                    <div className="kpi-card kpi-success">
                        <div className="kpi-label">
                            <TrendingUp size={14} /> Ingresos
                        </div>
                        <div className="kpi-value">{formatCurrency(summary.totalRevenue, settings)}</div>
                    </div>
                    <div className={`kpi-card ${marginClass}`}>
                        <div className="kpi-label">
                            <BarChart3 size={14} /> Margen Bruto
                        </div>
                        <div className="kpi-value">
                            {summary.grossMargin.toFixed(1)}%
                        </div>
                        <div className="kpi-detail">(Ingresos − COGS) / Ingresos</div>
                    </div>
                </div>
            )}

            {/* Product Cost Table */}
            <div className="data-table-wrapper">
                <div className="data-table-header">
                    <span>Detalle por Producto</span>
                    <span className="data-table-count">{products.length} productos</span>
                </div>
                <div className="data-table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Categoría</th>
                                <th className="text-right">Cant. Comprada</th>
                                <th className="text-right">Costo Total</th>
                                <th className="text-right">Costo Unit. Prom.</th>
                                <th className="text-right">Costo Actual</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedProducts.map(p => (
                                <tr key={p.productId}>
                                    <td>
                                        <div className="product-cell-name">{p.productName}</div>
                                        {p.sku && <div className="product-cell-sku">{p.sku}</div>}
                                    </td>
                                    <td className="text-secondary">{p.categoryName || '-'}</td>
                                    <td className="text-right">{p.totalQuantity.toFixed(2)} {p.unit}</td>
                                    <td className="text-right font-semibold">{formatCurrency(p.totalCost, settings)}</td>
                                    <td className="text-right">{formatCurrency(p.avgUnitCost, settings)}</td>
                                    <td className="text-right">{formatCurrency(p.currentAvgCost, settings)}</td>
                                </tr>
                            ))}
                            {products.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={6} className="data-table-empty">
                                        <Package size={32} style={{ opacity: 0.4 }} />
                                        <p style={{ marginTop: 8 }}>Sin datos para los filtros seleccionados</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <Pagination
                    page={page}
                    totalPages={totalPages}
                    totalItems={products.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                />
            </div>
        </div>
    );
}
