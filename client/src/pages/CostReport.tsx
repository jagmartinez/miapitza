import { useState, useEffect, useCallback } from 'react';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI } from '../services/api';
import Select from '../components/Select';
import Button from '../components/Button';
import { DollarSign, TrendingUp, ShoppingCart, BarChart3, Filter } from 'lucide-react';
import type { Branch, Supplier } from '../types';
import './Inventory.css';

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

    return (
        <div className="inventory-page">
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><BarChart3 size={32} /> Reporte de Costos</h1>
                </div>
                <Button onClick={loadReport} disabled={loading}>
                    {loading ? 'Cargando...' : 'Actualizar'}
                </Button>
            </div>

            {/* Filters */}
            <div className="inventory-filters-row" style={{ flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={16} />
                    <input type="date" className="table-filter-input" value={filters.dateFrom}
                        onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} />
                    <span>-</span>
                    <input type="date" className="table-filter-input" value={filters.dateTo}
                        onChange={e => setFilters({ ...filters, dateTo: e.target.value })} />
                </div>
                <div style={{ minWidth: '150px' }}>
                    <Select options={[{ value: '', label: 'Todas Sucursales' }, ...branches.map((b) => ({ value: b.id.toString(), label: b.name }))]}
                        value={{ value: filters.branchId, label: filters.branchId ? branches.find((b) => b.id.toString() === filters.branchId)?.name : 'Todas Sucursales' }}
                        onChange={(opt) => opt && setFilters({ ...filters, branchId: opt.value })} isSearchable={false} />
                </div>
                <div style={{ minWidth: '150px' }}>
                    <Select options={[{ value: '', label: 'Todas Categorías' }, ...categories.map((c) => ({ value: c.id.toString(), label: c.name }))]}
                        value={{ value: filters.categoryId, label: filters.categoryId ? categories.find((c) => c.id.toString() === filters.categoryId)?.name : 'Todas Categorías' }}
                        onChange={(opt) => opt && setFilters({ ...filters, categoryId: opt.value })} isSearchable={false} />
                </div>
                <div style={{ minWidth: '150px' }}>
                    <Select options={[{ value: '', label: 'Todos Proveedores' }, ...suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))]}
                        value={{ value: filters.supplierId, label: filters.supplierId ? suppliers.find((s) => s.id.toString() === filters.supplierId)?.name : 'Todos Proveedores' }}
                        onChange={(opt) => opt && setFilters({ ...filters, supplierId: opt.value })} isSearchable={false} />
                </div>
                <Button variant="secondary" onClick={loadReport}>Aplicar Filtros</Button>
            </div>

            {/* KPI Cards */}
            {summary && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', margin: '20px 0' }}>
                    <div style={{ padding: '20px', borderRadius: '12px', background: 'var(--color-neutral-50)', border: '1px solid var(--color-neutral-200)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-neutral-500)', fontSize: '0.85rem', marginBottom: '8px' }}>
                            <ShoppingCart size={18} /> Costo Total Compras
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{cs}{summary.totalPurchaseCost.toFixed(2)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-400)' }}>{summary.purchaseOrderCount} órdenes de compra</div>
                    </div>
                    <div style={{ padding: '20px', borderRadius: '12px', background: 'var(--color-neutral-50)', border: '1px solid var(--color-neutral-200)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-neutral-500)', fontSize: '0.85rem', marginBottom: '8px' }}>
                            <DollarSign size={18} /> COGS Estimado
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{cs}{summary.estimatedCOGS.toFixed(2)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-400)' }}>Basado en recetas x costo promedio</div>
                    </div>
                    <div style={{ padding: '20px', borderRadius: '12px', background: 'var(--color-neutral-50)', border: '1px solid var(--color-neutral-200)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-neutral-500)', fontSize: '0.85rem', marginBottom: '8px' }}>
                            <TrendingUp size={18} /> Revenue
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{cs}{summary.totalRevenue.toFixed(2)}</div>
                    </div>
                    <div style={{ padding: '20px', borderRadius: '12px', background: summary.grossMargin >= 50 ? '#F0FDF4' : summary.grossMargin >= 30 ? '#FFFBEB' : '#FEF2F2', border: `1px solid ${summary.grossMargin >= 50 ? '#BBF7D0' : summary.grossMargin >= 30 ? '#FDE68A' : '#FECACA'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-neutral-500)', fontSize: '0.85rem', marginBottom: '8px' }}>
                            <BarChart3 size={18} /> Margen Bruto
                        </div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 700, color: summary.grossMargin >= 50 ? '#16A34A' : summary.grossMargin >= 30 ? '#D97706' : '#DC2626' }}>
                            {summary.grossMargin.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-400)' }}>(Revenue - COGS) / Revenue</div>
                    </div>
                </div>
            )}

            {/* Product Cost Table */}
            <div style={{ background: 'var(--color-neutral-50)', borderRadius: '12px', border: '1px solid var(--color-neutral-200)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-neutral-200)', fontWeight: 600, fontSize: '1rem' }}>
                    Detalle por Producto ({products.length})
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-neutral-100)' }}>
                                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>Producto</th>
                                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600 }}>Categoría</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>Cant. Comprada</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>Costo Total</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>Costo Unit. Prom.</th>
                                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>Costo Actual</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.map(p => (
                                <tr key={p.productId} style={{ borderBottom: '1px solid var(--color-neutral-200)' }}>
                                    <td style={{ padding: '10px 16px' }}>
                                        <div style={{ fontWeight: 600 }}>{p.productName}</div>
                                        {p.sku && <div style={{ fontSize: '0.75rem', color: 'var(--color-neutral-400)' }}>{p.sku}</div>}
                                    </td>
                                    <td style={{ padding: '10px 16px', color: 'var(--color-neutral-500)' }}>{p.categoryName || '-'}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>{p.totalQuantity.toFixed(2)} {p.unit}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>{cs}{p.totalCost.toFixed(2)}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>{cs}{p.avgUnitCost.toFixed(2)}</td>
                                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>{cs}{p.currentAvgCost.toFixed(2)}</td>
                                </tr>
                            ))}
                            {products.length === 0 && (
                                <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: 'var(--color-neutral-400)' }}>Sin datos para los filtros seleccionados</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
