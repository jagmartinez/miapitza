import { useState, useEffect, useCallback } from 'react';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI } from '../services/api';
import Select from '../components/Select';
import Button from '../components/Button';
import { DollarSign, TrendingUp, ShoppingCart, BarChart3, Filter } from 'lucide-react';
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

export default function CostReport() {
    const [summary, setSummary] = useState<CostSummary | null>(null);
    const [products, setProducts] = useState<ProductCost[]>([]);
    const [loading, setLoading] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [categories, setCategories] = useState<CategoryOption[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);

    const [filters, setFilters] = useState({
        dateFrom: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        dateTo: new Date().toISOString().split('T')[0],
        branchId: '',
        categoryId: '',
        supplierId: ''
    });

    useEffect(() => {
        Promise.all([
            branchesAPI.getAll(),
            categoriesAPI.getAll(),
            suppliersAPI.getAll()
        ]).then(([bRes, cRes, sRes]) => {
            setBranches(bRes.data.data || []);
            setCategories(cRes.data.data || []);
            setSuppliers(sRes.data.data || []);
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

    const cs = '$';

    const marginClass = summary
        ? summary.grossMargin >= 50 ? 'margin-good' : summary.grossMargin >= 30 ? 'margin-warn' : 'margin-bad'
        : '';

    return (
        <div className="cost-report-page">
            <div className="cost-report-header">
                <div className="header-title-section">
                    <h1><BarChart3 size={32} /> Reporte de Costos</h1>
                </div>
                <Button onClick={loadReport} disabled={loading}>
                    {loading ? 'Cargando...' : 'Actualizar'}
                </Button>
            </div>

            {/* Filters */}
            <div className="cost-report-filters">
                <div className="cost-report-date-range">
                    <Filter size={16} />
                    <input type="date" className="table-filter-input" value={filters.dateFrom}
                        onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} />
                    <span>-</span>
                    <input type="date" className="table-filter-input" value={filters.dateTo}
                        onChange={e => setFilters({ ...filters, dateTo: e.target.value })} />
                </div>
                <div className="cost-report-select-wrapper">
                    <Select options={[{ value: '', label: 'Todas Sucursales' }, ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))]}
                        value={{ value: filters.branchId, label: filters.branchId ? branches.find((b) => b.id.toString() === filters.branchId)?.name : 'Todas Sucursales' }}
                        onChange={(opt) => opt && setFilters({ ...filters, branchId: opt.value })} isSearchable={false} />
                </div>
                <div className="cost-report-select-wrapper">
                    <Select options={[{ value: '', label: 'Todas Categorías' }, ...categories.map((c) => ({ value: c.id.toString(), label: c.name }))]}
                        value={{ value: filters.categoryId, label: filters.categoryId ? categories.find((c) => c.id.toString() === filters.categoryId)?.name : 'Todas Categorías' }}
                        onChange={(opt) => opt && setFilters({ ...filters, categoryId: opt.value })} isSearchable={false} />
                </div>
                <div className="cost-report-select-wrapper">
                    <Select options={[{ value: '', label: 'Todos Proveedores' }, ...suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))]}
                        value={{ value: filters.supplierId, label: filters.supplierId ? suppliers.find((s) => s.id.toString() === filters.supplierId)?.name : 'Todos Proveedores' }}
                        onChange={(opt) => opt && setFilters({ ...filters, supplierId: opt.value })} isSearchable={false} />
                </div>
                <Button variant="secondary" onClick={loadReport}>Aplicar Filtros</Button>
            </div>

            {/* KPI Cards */}
            {summary && (
                <div className="cost-report-kpi-grid">
                    <div className="cost-kpi-card">
                        <div className="cost-kpi-label">
                            <ShoppingCart size={18} /> Costo Total Compras
                        </div>
                        <div className="cost-kpi-value">{cs}{summary.totalPurchaseCost.toFixed(2)}</div>
                        <div className="cost-kpi-detail">{summary.purchaseOrderCount} órdenes de compra</div>
                    </div>
                    <div className="cost-kpi-card">
                        <div className="cost-kpi-label">
                            <DollarSign size={18} /> COGS Estimado
                        </div>
                        <div className="cost-kpi-value">{cs}{summary.estimatedCOGS.toFixed(2)}</div>
                        <div className="cost-kpi-detail">Basado en recetas x costo promedio</div>
                    </div>
                    <div className="cost-kpi-card">
                        <div className="cost-kpi-label">
                            <TrendingUp size={18} /> Revenue
                        </div>
                        <div className="cost-kpi-value">{cs}{summary.totalRevenue.toFixed(2)}</div>
                    </div>
                    <div className={`cost-kpi-card ${marginClass}`}>
                        <div className="cost-kpi-label">
                            <BarChart3 size={18} /> Margen Bruto
                        </div>
                        <div className={`cost-kpi-value cost-margin-value ${marginClass}`}>
                            {summary.grossMargin.toFixed(1)}%
                        </div>
                        <div className="cost-kpi-detail">(Revenue - COGS) / Revenue</div>
                    </div>
                </div>
            )}

            {/* Product Cost Table */}
            <div className="cost-report-table-wrapper">
                <div className="cost-report-table-header">
                    Detalle por Producto ({products.length})
                </div>
                <div className="cost-report-table-scroll">
                    <table className="cost-report-table">
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
                            {products.map(p => (
                                <tr key={p.productId}>
                                    <td>
                                        <div className="product-cell-name">{p.productName}</div>
                                        {p.sku && <div className="product-cell-sku">{p.sku}</div>}
                                    </td>
                                    <td className="text-secondary">{p.categoryName || '-'}</td>
                                    <td className="text-right">{p.totalQuantity.toFixed(2)} {p.unit}</td>
                                    <td className="text-right font-semibold">{cs}{p.totalCost.toFixed(2)}</td>
                                    <td className="text-right">{cs}{p.avgUnitCost.toFixed(2)}</td>
                                    <td className="text-right">{cs}{p.currentAvgCost.toFixed(2)}</td>
                                </tr>
                            ))}
                            {products.length === 0 && (
                                <tr><td colSpan={6} className="cost-report-empty">Sin datos para los filtros seleccionados</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
