import { useState, useEffect, useCallback } from 'react';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, settingsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import {
    DollarSign, TrendingUp, ShoppingCart, BarChart3,
    Search, RefreshCw, Calendar
} from 'lucide-react';
import type { Branch, Supplier } from '../types';
import './CostReport.css';
import { AppSelect, Button, DataTable, EmptyState, Field, PageHeader, formatNumber, type Column } from '@/ui';

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
    const [settings, setSettings] = useState<CurrencySettings>({});
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
        Promise.all([
            branchesAPI.getAll(),
            categoriesAPI.getAll(),
            suppliersAPI.getAll(),
            settingsAPI.getAll().catch(() => ({ data: { data: {} } })),
        ]).then(([bRes, cRes, sRes, settingsRes]) => {
            setBranches(bRes.data.data || []);
            setCategories(cRes.data.data || []);
            setSuppliers(sRes.data.data || []);
            setSettings(settingsRes.data.data || {});
        });
    }, []);

    const loadReport = useCallback(async () => {
        setLoading(true);
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
        } catch (err) {
            console.error('Error loading cost report:', err);
        } finally {
            setLoading(false);
        }
    }, [filters]);

    useEffect(() => {
        void loadReport();
    }, [loadReport]);

    const marginClass = summary
        ? summary.grossMargin >= 50 ? 'kpi-success' : summary.grossMargin >= 30 ? 'kpi-warning' : 'kpi-danger'
        : '';

    return (
        <div className="page-wrapper cost-report-page">
            <PageHeader
                title="Reporte de Costos"
                description="Análisis de costos de compra, COGS estimado y margen bruto por período."
                actions={(
                    <>
                    <Button variant="primary" onClick={loadReport} disabled={loading}>
                        {loading ? <RefreshCw size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {loading ? 'Cargando...' : 'Actualizar'}
                    </Button>
                    </>
                )}
            />

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
                    <Field label="Sucursal" htmlFor="sel-151">
<AppSelect inputId="sel-151" options={[{ value: '', label: 'Todas las Sucursales' }, ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))]} value={filters.branchId ?? null} onChange={(__v) => { const opt = ([{ value: '', label: 'Todas las Sucursales' }, ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))]).find((o) => o.value === __v) ?? null; return opt && setFilters({ ...filters, branchId: opt.value }); }} />
</Field>
                </div>

                <div className="filter-field">
                    <Field label="Categoría" htmlFor="sel-161">
<AppSelect inputId="sel-161" options={[{ value: '', label: 'Todas las Categorías' }, ...categories.map((c) => ({ value: c.id.toString(), label: c.name }))]} value={filters.categoryId ?? null} onChange={(__v) => { const opt = ([{ value: '', label: 'Todas las Categorías' }, ...categories.map((c) => ({ value: c.id.toString(), label: c.name }))]).find((o) => o.value === __v) ?? null; return opt && setFilters({ ...filters, categoryId: opt.value }); }} />
</Field>
                </div>

                <div className="filter-field">
                    <Field label="Proveedor" htmlFor="sel-171">
<AppSelect inputId="sel-171" options={[{ value: '', label: 'Todos los Proveedores' }, ...suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))]} value={filters.supplierId ?? null} onChange={(__v) => { const opt = ([{ value: '', label: 'Todos los Proveedores' }, ...suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))]).find((o) => o.value === __v) ?? null; return opt && setFilters({ ...filters, supplierId: opt.value }); }} />
</Field>
                </div>

                <div className="filter-spacer" />

                <div className="filter-actions">
                    <Button variant="primary" onClick={loadReport} disabled={loading}>
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
                        <div className="kpi-detail">Basado en recetas × costo promedio</div>
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
                            {formatNumber(summary.grossMargin, 1)}%
                        </div>
                        <div className="kpi-detail">(Ingresos − COGS) / Ingresos</div>
                    </div>
                </div>
            )}

            {/* Product Cost Table */}
            <DataTable
                ariaLabel="Detalle de costos por producto"
                rows={products}
                rowKey={(p) => p.productId}
                loading={loading}
                defaultPageSize={PAGE_SIZE}
                pageSizeOptions={[10, 20, 50, 100]}
                resetKey={`${filters.dateFrom}|${filters.dateTo}|${filters.branchId}|${filters.categoryId}|${filters.supplierId}`}
                footerLabel={`${products.length} productos`}
                empty={<EmptyState title="Sin datos para los filtros seleccionados" />}
                columns={[
                    { key: 'product', header: 'Producto', render: (p) => (
                        <div>
                            <div className="product-cell-name">{p.productName}</div>
                            {p.sku && <div className="product-cell-sku">{p.sku}</div>}
                        </div>
                    ) },
                    { key: 'category', header: 'Categoría', render: (p) => p.categoryName || '-' },
                    { key: 'qty', header: 'Cant. Comprada', type: 'qty', render: (p) => `${formatNumber(p.totalQuantity)} ${p.unit}` },
                    { key: 'totalCost', header: 'Costo Total', type: 'money', render: (p) => formatCurrency(p.totalCost, settings) },
                    { key: 'avg', header: 'Costo Unit. Prom.', type: 'money', render: (p) => formatCurrency(p.avgUnitCost, settings) },
                    { key: 'current', header: 'Costo Actual', type: 'money', render: (p) => formatCurrency(p.currentAvgCost, settings) },
                ] as Column<(typeof products)[number]>[]}
            />
        </div>
    );
}
