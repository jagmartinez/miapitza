import { useState, useEffect, useCallback } from 'react';
import { reportsAPI, branchesAPI, categoriesAPI, suppliersAPI, settingsAPI } from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import { Search } from 'lucide-react';
import type { Branch, Supplier } from '../types';
import catalog from './catalog.module.css';
import {
    AppSelect, Button, DataTable, DateInput, EmptyState, LoadErrorState, PageContent, PageHeader, StatCard, TableToolbar,
    formatNumber, type Column, type Tone,
} from '@/ui';

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

    const marginTone: Tone = summary
        ? summary.grossMargin >= 50 ? 'success' : summary.grossMargin >= 30 ? 'warning' : 'danger'
        : 'neutral';

    return (
        <PageContent>
            <PageHeader
                title="Reporte de costos"
                description="Análisis de costos de compra, COGS estimado y margen bruto por período."
            />

            {filterWarning && <p className={catalog.alert} role="status">{filterWarning}</p>}
            {summary && summary.excludedLegacyPurchaseLines > 0 && (
                <p className={catalog.alert} role="status">
                    {summary.excludedLegacyPurchaseLines} línea(s) histórica(s) por {formatCurrency(summary.excludedLegacyPurchaseAmount, settings)}
                    {' '}no tienen cantidad/costo en UOM base. El total monetario sí las incluye, pero se excluyen del desglose por producto para no reinterpretar unidades.
                </p>
            )}
            {error && <LoadErrorState message={error} onRetry={() => { void loadReport(); }} />}

            {summary && (
                <div className={catalog.kpiGrid}>
                    <StatCard
                        label="Margen bruto"
                        tone={marginTone}
                        value={`${formatNumber(summary.grossMargin)} %`}
                        context={`Ingresos ${formatCurrency(summary.totalRevenue, settings)} − costo de ventas ${formatCurrency(summary.estimatedCOGS, settings)} · compras del período ${formatCurrency(summary.totalPurchaseCost, settings)}`}
                    />
                </div>
            )}

            <DataTable
                ariaLabel="Detalle de costos por producto"
                rows={products}
                rowKey={(p) => p.productId}
                loading={loading}
                defaultPageSize={PAGE_SIZE}
                pageSizeOptions={[10, 20, 50, 100]}
                resetKey={`${filters.dateFrom}|${filters.dateTo}|${filters.branchId}|${filters.categoryId}|${filters.supplierId}`}
                footerLabel={`Total de la página · ${products.length} productos`}
                empty={<EmptyState title="Sin datos para los filtros seleccionados" />}
                toolbar={(
                    <TableToolbar actions={(
                        <Button variant="primary" icon={Search} onClick={loadReport} loading={loading}>Aplicar filtros</Button>
                    )}>
                        <DateInput aria-label="Desde" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} />
                        <DateInput aria-label="Hasta" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} />
                        <AppSelect
                            aria-label="Sucursal"
                            options={branches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                            value={filters.branchId || null}
                            onChange={(v) => setFilters({ ...filters, branchId: v || '' })}
                            placeholder="Todas las sucursales"
                            isClearable
                        />
                        <AppSelect
                            aria-label="Categoría"
                            options={categories.map((c) => ({ value: c.id.toString(), label: c.name }))}
                            value={filters.categoryId || null}
                            onChange={(v) => setFilters({ ...filters, categoryId: v || '' })}
                            placeholder="Todas las categorías"
                            isClearable
                        />
                        <AppSelect
                            aria-label="Proveedor"
                            options={suppliers.map((s) => ({ value: s.id.toString(), label: s.name }))}
                            value={filters.supplierId || null}
                            onChange={(v) => setFilters({ ...filters, supplierId: v || '' })}
                            placeholder="Todos los proveedores"
                            isClearable
                        />
                    </TableToolbar>
                )}
                columns={[
                    { key: 'product', header: 'Producto', render: (p) => (
                        <div className={catalog.cellStack}>
                            <span className={catalog.cellTitle}>{p.productName}</span>
                            {p.sku && <span className={catalog.muted}>{p.sku}</span>}
                        </div>
                    ) },
                    { key: 'category', header: 'Categoría', render: (p) => p.categoryName || '—' },
                    { key: 'qty', header: 'Cant. comprada', type: 'qty', render: (p) => `${formatNumber(p.totalQuantity)} ${p.unit}` },
                    { key: 'totalCost', header: 'Costo total', type: 'money', total: true, accessor: (p) => p.totalCost },
                    { key: 'avg', header: 'Costo unit. prom.', type: 'money', render: (p) => formatCurrency(p.avgUnitCost, settings) },
                    { key: 'current', header: 'Costo actual', type: 'money', render: (p) => formatCurrency(p.currentAvgCost, settings) },
                ] as Column<(typeof products)[number]>[]}
            />
        </PageContent>
    );
}
