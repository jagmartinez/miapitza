import { useState, useEffect, useCallback, useMemo } from 'react';
import { productionOrdersAPI, productsAPI, warehousesAPI, branchesAPI } from '../services/api';
import {
    AppSelect, Badge, Button, Checkbox, ConfirmDialog, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, SegmentedControl, Skeleton, StatCard, TableToolbar, Textarea, formatNumber, formatPercent,
    type Column, type Opt, type Tone, LoadErrorState,
} from '@/ui';
import { useCurrency } from '../hooks/useCurrency';
import { useAuth } from '../hooks/useAuth';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import {
    Factory, Plus, Eye, CheckCircle, Ban, Play, Clock, Calculator,
    AlertTriangle, Save, Info
} from 'lucide-react';
import type {
    ProductionOrder, ProductionOrderItem, ProductionOrderStatus, ProductionPreview, ProductionRequirementLine, Product, Warehouse, Branch
} from '../types';
import { costVariationOf, monthlyOverrun, monthlyYield } from './productionOrderInsights';
import s from './Production.module.css';

const PRODUCIBLE_TYPES = ['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH'];

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

const STATUS_META: Record<ProductionOrderStatus, { label: string; tone: Tone }> = {
    DRAFT: { label: 'Borrador', tone: 'neutral' },
    PENDING: { label: 'Pendiente', tone: 'warning' },
    IN_PROGRESS: { label: 'En proceso', tone: 'primary' },
    FINISHED: { label: 'Finalizada', tone: 'success' },
    CANCELLED: { label: 'Anulada', tone: 'neutral' },
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'Todas' },
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'PENDING', label: 'Pendiente' },
    { value: 'IN_PROGRESS', label: 'En proceso' },
    { value: 'FINISHED', label: 'Finalizada' },
    { value: 'CANCELLED', label: 'Anulada' },
];

function formatDate(value?: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Agrupa por receta; sin receta, por producto. */
function recipeKey(order: ProductionOrder): string {
    return order.recipeId ? `r${order.recipeId}` : `p${order.productId}`;
}

/** Rendimiento real (producido / planificado) solo para órdenes finalizadas. */
function yieldPct(order: ProductionOrder): number | null {
    const planned = Number(order.plannedQuantity);
    if (order.status !== 'FINISHED' || !planned) return null;
    return (Number(order.producedQuantity) / planned) * 100;
}

function outputUnit(product?: Pick<Product, 'unit' | 'baseUnit'> | null): string {
    return product?.baseUnit?.abbreviation || product?.unit || '';
}

export default function ProductionOrders() {
    const { user } = useAuth();
    const { success: showSuccess, error: showError, warning: showWarning } = useAppToast();
    const { formatMoney, symbol } = useCurrency();

    const userRoleNames = getUserRoleNames(user);
    const canManage = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'].includes(role));
    const isSuperAdmin = userRoleNames.includes('SUPERADMIN');
    const canOverrideNegativeStock = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));

    const [orders, setOrders] = useState<ProductionOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [recipeFilter, setRecipeFilter] = useState<string | null>(null);

    // Create flow
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [createForm, setCreateForm] = useState({ productId: '', warehouseId: '', branchId: '', plannedQuantity: '1', notes: '' });
    const [preview, setPreview] = useState<ProductionPreview | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState('');
    const [creating, setCreating] = useState(false);

    // Detail modal
    const [detailOrder, setDetailOrder] = useState<ProductionOrder | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Finish modal
    const [finishOrder, setFinishOrder] = useState<ProductionOrder | null>(null);
    const [finishForm, setFinishForm] = useState<{ producedQuantity: string; notes: string; allowNegative: boolean }>({ producedQuantity: '', notes: '', allowNegative: false });
    const [finishConsumptions, setFinishConsumptions] = useState<Record<number, string>>({});
    const [finishing, setFinishing] = useState(false);

    // Cancel modal
    const [cancelOrder, setCancelOrder] = useState<ProductionOrder | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const loadOrders = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const res = await productionOrdersAPI.getAll();
            setOrders(Array.isArray(res.data.data) ? res.data.data : []);
            setLoadError(null);
        } catch (error) {
            console.error('Error loading production orders:', error);
            setOrders([]);
            setLoadError(errMsg(error, 'No se pudieron cargar las órdenes de producción.') + ' Las órdenes no cargadas no entran en ningún total.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadFormDependencies = useCallback(async () => {
        setFormError(null);
        try {
            const [prodRes, whRes, branchRes] = await Promise.all([
                productsAPI.getAll({ limit: 1000, active: true }),
                warehousesAPI.getAll(),
                isSuperAdmin ? branchesAPI.getAll() : Promise.resolve(null),
            ]);
            const allProducts: Product[] = Array.isArray(prodRes.data.data) ? prodRes.data.data : [];
            setProducts(allProducts.filter((p) => PRODUCIBLE_TYPES.includes(p.type)));
            setWarehouses(Array.isArray(whRes.data.data) ? whRes.data.data : []);
            if (branchRes && Array.isArray(branchRes.data.data)) {
                setBranches(branchRes.data.data);
            }
        } catch (error) {
            console.error('Error loading form dependencies:', error);
            setFormError(errMsg(error, 'No se pudieron cargar los productos, almacenes o sucursales.'));
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const filteredOrders = useMemo(() => {
        const searchLower = searchQuery.toLowerCase().trim();
        return orders.filter((order) => {
            const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
            const matchesSearch = !searchLower ||
                order.code?.toLowerCase().includes(searchLower) ||
                order.product?.name?.toLowerCase().includes(searchLower) ||
                order.product?.sku?.toLowerCase().includes(searchLower);
            const day = (order.date ?? '').slice(0, 10);
            const matchesDate = (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
            const matchesRecipe = !recipeFilter || recipeKey(order) === recipeFilter;
            return matchesStatus && matchesSearch && matchesDate && matchesRecipe;
        });
    }, [orders, statusFilter, searchQuery, dateFrom, dateTo, recipeFilter]);

    const recipeOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const order of orders) {
            const key = recipeKey(order);
            if (key && !seen.has(key)) seen.set(key, order.recipe?.name ?? order.product?.name ?? key);
        }
        return [...seen.entries()]
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }, [orders]);

    // ----- Create flow -----
    const handleOpenCreate = () => {
        if (!canManage) {
            showWarning('No tienes permisos para crear órdenes de producción');
            return;
        }
        setCreateForm({ productId: '', warehouseId: '', branchId: '', plannedQuantity: '1', notes: '' });
        setPreview(null);
        setPreviewError('');
        setIsSidebarOpen(true);
        void loadFormDependencies();
    };

    const runPreview = useCallback(async () => {
        const productId = Number(createForm.productId);
        const warehouseId = Number(createForm.warehouseId);
        const plannedQuantity = Number(createForm.plannedQuantity);
        if (!productId || !warehouseId || !plannedQuantity || plannedQuantity <= 0) {
            setPreview(null);
            return;
        }
        setPreviewLoading(true);
        setPreviewError('');
        try {
            const res = await productionOrdersAPI.preview({ productId, plannedQuantity, warehouseId });
            setPreview(res.data.data as ProductionPreview);
        } catch (error) {
            setPreview(null);
            setPreviewError(errMsg(error, 'No se pudieron calcular los insumos'));
        } finally {
            setPreviewLoading(false);
        }
    }, [createForm.productId, createForm.warehouseId, createForm.plannedQuantity]);

    // Auto-recalculate with debounce when inputs change
    useEffect(() => {
        if (!isSidebarOpen) return;
        const productId = Number(createForm.productId);
        const warehouseId = Number(createForm.warehouseId);
        const plannedQuantity = Number(createForm.plannedQuantity);
        if (!productId || !warehouseId || !plannedQuantity || plannedQuantity <= 0) {
            setPreview(null);
            return;
        }
        const timer = setTimeout(() => { void runPreview(); }, 500);
        return () => clearTimeout(timer);
    }, [isSidebarOpen, createForm.productId, createForm.warehouseId, createForm.plannedQuantity, runPreview]);

    const handleCreate = async () => {
        const productId = Number(createForm.productId);
        const warehouseId = Number(createForm.warehouseId);
        const plannedQuantity = Number(createForm.plannedQuantity);
        if (!productId) { showWarning('Seleccione el producto a producir'); return; }
        if (!warehouseId) { showWarning('Seleccione el almacén de destino'); return; }
        if (!plannedQuantity || plannedQuantity <= 0) { showWarning('La cantidad a producir debe ser mayor a 0'); return; }
        if (isSuperAdmin && !createForm.branchId) { showWarning('Seleccione la sucursal'); return; }

        setCreating(true);
        try {
            const payload: Record<string, unknown> = { productId, warehouseId, plannedQuantity };
            if (isSuperAdmin && createForm.branchId) payload.branchId = Number(createForm.branchId);
            if (createForm.notes.trim()) payload.notes = createForm.notes.trim();
            await productionOrdersAPI.create(payload);
            showSuccess('Orden de producción creada como borrador');
            setIsSidebarOpen(false);
            void loadOrders();
        } catch (error) {
            showError(errMsg(error, 'Error al crear la orden de producción'));
        } finally {
            setCreating(false);
        }
    };

    // ----- Detail -----
    const handleOpenDetail = async (id: number) => {
        setDetailLoading(true);
        setDetailOrder(null);
        try {
            const res = await productionOrdersAPI.getById(id);
            setDetailOrder(res.data.data as ProductionOrder);
        } catch (error) {
            showError(errMsg(error, 'No se pudo cargar el detalle'));
        } finally {
            setDetailLoading(false);
        }
    };

    // ----- Status transitions -----
    const handleSetStatus = async (id: number, status: 'DRAFT' | 'PENDING' | 'IN_PROGRESS') => {
        try {
            await productionOrdersAPI.setStatus(id, status);
            showSuccess('Estado actualizado');
            await loadOrders();
            if (detailOrder?.id === id) {
                const res = await productionOrdersAPI.getById(id);
                setDetailOrder(res.data.data as ProductionOrder);
            }
        } catch (error) {
            showError(errMsg(error, 'Error al actualizar el estado'));
        }
    };

    // ----- Finish -----
    const handleOpenFinish = async (id: number) => {
        try {
            const res = await productionOrdersAPI.getById(id);
            const order = res.data.data as ProductionOrder;
            setFinishOrder(order);
            setFinishForm({ producedQuantity: String(Number(order.plannedQuantity)), notes: '', allowNegative: false });
            const consumptions: Record<number, string> = {};
            for (const item of order.items) {
                consumptions[item.componentProductId] = String(Number(item.requiredQuantity));
            }
            setFinishConsumptions(consumptions);
        } catch (error) {
            showError(errMsg(error, 'No se pudo abrir la producción'));
        }
    };

    const handleFinish = async () => {
        if (!finishOrder) return;
        const producedQuantity = Number(finishForm.producedQuantity);
        if (!producedQuantity || producedQuantity <= 0) { showWarning('La cantidad producida debe ser mayor a 0'); return; }

        setFinishing(true);
        try {
            const consumptions = finishOrder.items.map((item) => ({
                componentProductId: item.componentProductId,
                consumedQuantity: Number(finishConsumptions[item.componentProductId] ?? item.requiredQuantity),
            }));
            await productionOrdersAPI.finish(finishOrder.id, {
                producedQuantity,
                consumptions,
                notes: finishForm.notes.trim() || undefined,
                allowNegative: finishForm.allowNegative,
            });
            showSuccess('Producción finalizada e inventario actualizado');
            setFinishOrder(null);
            void loadOrders();
        } catch (error) {
            showError(errMsg(error, 'Error al finalizar la producción'));
        } finally {
            setFinishing(false);
        }
    };

    const finishYield = useMemo(() => {
        if (!finishOrder) return 0;
        const planned = Number(finishOrder.plannedQuantity);
        const produced = Number(finishForm.producedQuantity);
        if (!planned || !produced) return 0;
        return (produced / planned) * 100;
    }, [finishOrder, finishForm.producedQuantity]);

    // ----- Cancel -----
    const handleCancel = async () => {
        if (!cancelOrder) return;
        const reason = cancelReason.trim();
        if (!reason) {
            showWarning('Indica el motivo de anulación');
            return;
        }
        setCancelling(true);
        try {
            await productionOrdersAPI.cancel(cancelOrder.id, reason);
            showSuccess('Orden anulada');
            setCancelOrder(null);
            setCancelReason('');
            void loadOrders();
        } catch (error) {
            showError(errMsg(error, 'Error al anular la orden'));
        } finally {
            setCancelling(false);
        }
    };

    const canFinish = (status: ProductionOrderStatus) => status === 'IN_PROGRESS';
    const canCancel = (status: ProductionOrderStatus) => status !== 'CANCELLED';
    const unitOf = (item: { unit?: string | null; componentProduct?: { unit?: string } | null }) => item.unit ?? item.componentProduct?.unit ?? '';

    const productOptions: Opt<string>[] = products.map((p) => ({
        value: p.id.toString(),
        label: p.sku ? `${p.name} (${p.sku})` : p.name,
    }));
    const warehouseOptions: Opt<string>[] = warehouses.map((w) => ({
        value: w.id.toString(),
        label: w.branch?.name ? `${w.name} (${w.branch.name})` : w.name,
    }));
    const branchOptions: Opt<string>[] = branches.map((b) => ({ value: b.id.toString(), label: b.name }));

    const overrun = monthlyOverrun(orders);
    const yieldInfo = monthlyYield(orders);
    const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatNumber(Math.abs(value))}`;

    if (loading) {
        return (
            <PageContent>
                <PageHeader title="Órdenes de producción" description="Cargando órdenes…" />
                <Skeleton height={240} />
            </PageContent>
        );
    }

    const columns: Column<ProductionOrder>[] = [
        { key: 'code', header: 'Código', width: '1fr', render: (order) => <span className={s.cellTitle}>{order.code}</span> },
        {
            key: 'product',
            header: 'Producto',
            width: '2fr',
            render: (order) => (
                <div className={s.cellStack}>
                    <span className={s.cellTitle}>{order.product?.name ?? '-'}</span>
                    {order.product?.sku && <span className={s.cellSub}>{order.product.sku}</span>}
                </div>
            ),
        },
        {
            key: 'planned',
            header: 'Cant. planificada',
            type: 'qty',
            width: '1.2fr',
            hideBelow: 'md',
            render: (order) => `${formatNumber(order.plannedQuantity)} ${outputUnit(order.product)}`,
        },
        {
            key: 'produced',
            header: 'Cant. producida',
            type: 'qty',
            width: '1.2fr',
            hideBelow: 'md',
            render: (order) => `${formatNumber(order.producedQuantity)} ${outputUnit(order.product)}`,
        },
        {
            key: 'yield',
            header: 'Rendimiento',
            type: 'percent',
            width: '1fr',
            hideBelow: 'md',
            render: (order) => {
                const pct = yieldPct(order);
                return pct === null ? <span className={s.nd}>-</span> : formatPercent(pct);
            },
        },
        {
            key: 'status',
            header: 'Estado',
            width: '1fr',
            type: 'status',
            render: (order) => <Badge tone={STATUS_META[order.status].tone}>{STATUS_META[order.status].label}</Badge>,
        },
        {
            key: 'estimated',
            header: `Costo estimado (${symbol})`,
            type: 'money',
            width: '1.1fr',
            total: true,
            accessor: (order) => (order.status === 'FINISHED' ? Number(order.estimatedCost) || 0 : 0),
            render: (order) => (Number(order.estimatedCost) > 0 ? formatNumber(order.estimatedCost) : <span className={s.nd} title="Sin costo estimado calculado">N/D</span>),
        },
        {
            key: 'real',
            header: `Costo real (${symbol})`,
            type: 'money',
            width: '1.1fr',
            total: true,
            accessor: (order) => (order.status === 'FINISHED' ? Number(order.realCost) || 0 : 0),
            render: (order) => {
                if (order.status !== 'FINISHED') return <span className={s.nd}>-</span>;
                return Number(order.realCost) > 0 ? formatNumber(order.realCost) : <span className={s.nd} title="La orden no registró costo real">N/D</span>;
            },
        },
        {
            key: 'variation',
            header: 'Variación',
            type: 'money',
            width: '1.2fr',
            hideBelow: 'lg',
            render: (order) => {
                const v = costVariationOf(order);
                if (!v) return <span className={s.nd}>{order.status === 'FINISHED' ? 'N/D' : '-'}</span>;
                return <span className={v.delta > 0 ? s.bad : v.delta < 0 ? s.good : undefined}>{signed(v.delta)} ({formatPercent(v.pct)})</span>;
            },
        },
        { key: 'date', header: 'Fecha', type: 'date', width: '1fr', hideBelow: 'lg', render: (order) => formatDate(order.date) },
        { key: 'user', header: 'Responsable', width: '1.2fr', hideBelow: 'lg', render: (order) => order.user?.name ?? '-' },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '8rem',
            render: (order) => (
                <div className={s.rowActions}>
                    <IconButton icon={Eye} size="sm" label={`Ver detalle de ${order.code}`} onClick={() => void handleOpenDetail(order.id)} />
                    {canManage && canFinish(order.status) && (
                        <IconButton icon={CheckCircle} size="sm" label="Finalizar producción" onClick={() => void handleOpenFinish(order.id)} />
                    )}
                    {canManage && canCancel(order.status) && (
                        <IconButton icon={Ban} size="sm" label="Anular orden" onClick={() => { setCancelOrder(order); setCancelReason(''); }} />
                    )}
                </div>
            ),
        },
    ];

    const requirementColumns: Column<ProductionRequirementLine>[] = [
        {
            key: 'name',
            header: 'Insumo',
            width: '2fr',
            render: (line) => (
                <div className={s.cellStack}>
                    <span>{line.componentName}</span>
                    {!line.sufficient && line.producible && (
                        <span className={s.cellSub} title="Este insumo se puede producir con una orden de producción">Se puede producir</span>
                    )}
                </div>
            ),
        },
        { key: 'required', header: 'Requerido', type: 'qty', width: '1.2fr', render: (line) => `${formatNumber(line.requiredQuantity)} ${line.unit}` },
        { key: 'available', header: 'Disponible', type: 'qty', width: '1.2fr', render: (line) => `${formatNumber(line.availableQuantity)} ${line.unit}` },
        {
            key: 'state',
            header: 'Estado',
            type: 'status',
            width: '1fr',
            render: (line) => <Badge tone={line.sufficient ? 'success' : 'danger'}>{line.sufficient ? 'Suficiente' : 'Faltante'}</Badge>,
        },
    ];

    const detailColumns: Column<ProductionOrderItem>[] = [
        { key: 'name', header: 'Insumo', width: '2fr', render: (item) => item.componentProduct?.name ?? `#${item.componentProductId}` },
        { key: 'required', header: 'Requerido', type: 'qty', width: '1.2fr', render: (item) => `${formatNumber(item.requiredQuantity)} ${unitOf(item)}` },
        { key: 'consumed', header: 'Consumido', type: 'qty', width: '1.2fr', render: (item) => `${formatNumber(item.consumedQuantity)} ${unitOf(item)}` },
        {
            key: 'unitCost',
            header: `Costo unit. (${symbol})`,
            type: 'money',
            width: '1fr',
            render: (item) => (Number(item.unitCost) > 0 ? formatNumber(item.unitCost) : <span className={s.nd}>N/D</span>),
        },
        {
            key: 'totalCost',
            header: `Costo total (${symbol})`,
            type: 'money',
            width: '1fr',
            render: (item) => (Number(item.totalCost) > 0 ? formatNumber(item.totalCost) : <span className={s.nd}>N/D</span>),
        },
    ];

    const finishColumns: Column<ProductionOrderItem>[] = [
        { key: 'name', header: 'Insumo', width: '2fr', render: (item) => item.componentProduct?.name ?? `#${item.componentProductId}` },
        { key: 'required', header: 'Requerido', type: 'qty', width: '1.2fr', render: (item) => `${formatNumber(item.requiredQuantity)} ${unitOf(item)}` },
        {
            key: 'consumed',
            header: 'Consumo real',
            type: 'qty',
            width: '1.4fr',
            render: (item) => (
                <Input
                    type="number"
                    min={0}
                    step="any"
                    aria-label={`Consumo real de ${item.componentProduct?.name ?? item.componentProductId}`}
                    value={finishConsumptions[item.componentProductId] ?? ''}
                    onChange={(e) => setFinishConsumptions((prev) => ({ ...prev, [item.componentProductId]: e.target.value }))}
                />
            ),
        },
    ];

    return (
        <PageContent>
            <PageHeader
                title="Órdenes de producción"
                description="Produce intermedios y terminados consumiendo insumos del inventario"
                actions={<Button variant="primary" icon={Plus} onClick={handleOpenCreate} disabled={!canManage}>Nueva producción</Button>}
            />

            {loadError && <LoadErrorState message={loadError} onRetry={() => { void loadOrders(); }} />}

            {(overrun || yieldInfo) && (
                <div className={s.stats}>
                    {overrun && (
                        <StatCard
                            label="Sobrecosto del mes"
                            value={`${overrun.overrun > 0 ? '+' : ''}${formatMoney(overrun.overrun)}`}
                            context={`Real ${formatMoney(overrun.real)} vs estimado ${formatMoney(overrun.estimated)} (${formatPercent(overrun.pct)}) en ${overrun.count} órdenes finalizadas.${overrun.excluded > 0 ? ` ${overrun.excluded} sin costo estimado o real quedan fuera.` : ''}`}
                            tone={overrun.overrun > 0 ? 'danger' : 'success'}
                        />
                    )}
                    {yieldInfo && (
                        <StatCard
                            label="Rendimiento real vs estándar"
                            value={formatPercent(yieldInfo.avgPct)}
                            context={`Promedio de ${yieldInfo.count} órdenes finalizadas este mes frente a lo planificado por la receta. La más baja: ${yieldInfo.lowest.code} (${formatPercent(yieldInfo.lowest.pct)}).`}
                            tone={yieldInfo.avgPct < 95 ? 'warning' : 'success'}
                        />
                    )}
                </div>
            )}

            <DataTable<ProductionOrder>
                ariaLabel="Órdenes de producción"
                columns={columns}
                rows={filteredOrders}
                rowKey={(order) => order.id}
                resetKey={`${statusFilter}-${searchQuery}-${dateFrom}-${dateTo}-${recipeFilter}`}
                footerLabel="Total finalizadas (página)"
                toolbar={(
                    <div className={s.toolbarStack}>
                        <TableToolbar>
                            <Input
                                type="search"
                                aria-label="Buscar orden"
                                placeholder="Buscar por código o producto..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <DateInput aria-label="Desde" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                            <DateInput aria-label="Hasta" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                            <AppSelect
                                aria-label="Filtrar por receta"
                                options={recipeOptions}
                                value={recipeFilter}
                                onChange={setRecipeFilter}
                                placeholder="Todas las recetas"
                                isClearable
                            />
                        </TableToolbar>
                        <div className={s.segmentWrap}>
                            <SegmentedControl ariaLabel="Filtrar por estado" size="sm" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTERS} />
                        </div>
                    </div>
                )}
                onRowClick={(order) => void handleOpenDetail(order.id)}
                empty={<EmptyState icon={Factory} title="No se encontraron órdenes de producción" />}
            />

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title="Nueva Orden de Producción"
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" icon={Save} loading={creating} disabled={creating} onClick={() => void handleCreate()}>
                            {creating ? 'Creando...' : 'Crear orden'}
                        </Button>
                    </>
                )}
            >
                <div className={s.form}>
                    {formError && (
                        <div className={s.banner} role="alert">
                            <span>{formError}</span>
                            <Button size="sm" onClick={() => void loadFormDependencies()}>Reintentar</Button>
                        </div>
                    )}
                    <FormSection title="Datos de la producción">
                        <FormGrid>
                            <Field label="Producto a producir" htmlFor="prod-product" required>
                                <AppSelect<string>
                                    inputId="prod-product"
                                    options={productOptions}
                                    value={createForm.productId || null}
                                    onChange={(v) => setCreateForm((prev) => ({ ...prev, productId: v ?? '' }))}
                                    placeholder="Seleccione el producto (intermedio o terminado)"
                                />
                            </Field>
                            {isSuperAdmin && (
                                <Field label="Sucursal" htmlFor="prod-branch" required>
                                    <AppSelect<string>
                                        inputId="prod-branch"
                                        options={branchOptions}
                                        value={createForm.branchId || null}
                                        onChange={(v) => setCreateForm((prev) => ({ ...prev, branchId: v ?? '' }))}
                                        placeholder="Seleccione la sucursal"
                                    />
                                </Field>
                            )}
                            <Field label="Almacén destino" htmlFor="prod-warehouse" required>
                                <AppSelect<string>
                                    inputId="prod-warehouse"
                                    options={warehouseOptions}
                                    value={createForm.warehouseId || null}
                                    onChange={(v) => setCreateForm((prev) => ({ ...prev, warehouseId: v ?? '' }))}
                                    placeholder="Seleccione el almacén"
                                />
                            </Field>
                            <Field label="Cantidad a producir" htmlFor="prod-quantity" required hint="En la unidad base del producto">
                                <Input
                                    id="prod-quantity"
                                    type="number"
                                    min={0.001}
                                    step="any"
                                    value={createForm.plannedQuantity}
                                    onChange={(e) => setCreateForm((prev) => ({ ...prev, plannedQuantity: e.target.value }))}
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Notas" htmlFor="prod-notes">
                            <Textarea
                                id="prod-notes"
                                rows={2}
                                value={createForm.notes}
                                onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                                placeholder="Observaciones de la producción..."
                            />
                        </Field>
                    </FormSection>

                    <FormSection title="Insumos requeridos">
                        <div className={s.sectionActions}>
                            <Button
                                variant="ghost"
                                icon={Calculator}
                                onClick={() => { void runPreview(); }}
                                disabled={previewLoading || !createForm.productId || !createForm.warehouseId}
                            >
                                {previewLoading ? 'Calculando...' : 'Calcular insumos'}
                            </Button>
                        </div>

                        {previewError && (
                            <div className={s.banner} role="alert">
                                <AlertTriangle size={18} aria-hidden="true" />
                                <span>{previewError}</span>
                            </div>
                        )}

                        {!previewError && !preview && !previewLoading && (
                            <p className={s.hint}>
                                <Info size={14} aria-hidden="true" /> Seleccione producto, almacén y cantidad para calcular los insumos.
                            </p>
                        )}

                        {preview && (
                            <>
                                <div className={`${s.banner} ${preview.canProduce ? s.bannerOk : ''}`} role="status">
                                    {preview.canProduce ? <CheckCircle size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
                                    <span>
                                        {preview.canProduce
                                            ? 'Inventario suficiente'
                                            : 'Faltan insumos: produzca primero los intermedios o ajuste inventario'}
                                    </span>
                                </div>

                                <DataTable<ProductionRequirementLine>
                                    ariaLabel="Insumos requeridos"
                                    columns={requirementColumns}
                                    rows={preview.requirements}
                                    rowKey={(line) => line.componentProductId}
                                    minWidth="32rem"
                                    rowTone={(line) => (line.sufficient ? undefined : 'danger')}
                                />

                                <div className={s.stats}>
                                    <StatCard
                                        label="Costo estimado total"
                                        value={Number(preview.estimatedCost) > 0 ? formatMoney(preview.estimatedCost) : 'N/D'}
                                        context="Con el costo efectivo vigente de cada insumo."
                                        tone="primary"
                                    />
                                    <StatCard
                                        label="Costo unitario estimado"
                                        value={Number(preview.estimatedUnitCost) > 0 ? formatMoney(preview.estimatedUnitCost) : 'N/D'}
                                        context="Costo total entre las unidades base que rinde la orden."
                                        tone="neutral"
                                    />
                                </div>
                            </>
                        )}
                    </FormSection>
                </div>
            </FullScreenModal>

            <FullScreenModal
                isOpen={!!detailOrder || detailLoading}
                onClose={() => setDetailOrder(null)}
                title={detailOrder ? `Producción ${detailOrder.code}` : 'Detalle de producción'}
                subtitle={detailOrder?.product?.name}
                status={detailOrder ? <Badge tone={STATUS_META[detailOrder.status].tone}>{STATUS_META[detailOrder.status].label}</Badge> : undefined}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cerrar</Button>
                        {detailOrder && canManage && (
                            <>
                                {detailOrder.status === 'DRAFT' && (
                                    <Button icon={Clock} onClick={() => void handleSetStatus(detailOrder.id, 'PENDING')}>Marcar pendiente</Button>
                                )}
                                {(detailOrder.status === 'DRAFT' || detailOrder.status === 'PENDING') && (
                                    <Button icon={Play} onClick={() => void handleSetStatus(detailOrder.id, 'IN_PROGRESS')}>Iniciar</Button>
                                )}
                                {canFinish(detailOrder.status) && (
                                    <Button variant="primary" icon={CheckCircle} onClick={() => { const id = detailOrder.id; setDetailOrder(null); void handleOpenFinish(id); }}>
                                        Finalizar
                                    </Button>
                                )}
                                {canCancel(detailOrder.status) && (
                                    <Button variant="danger" icon={Ban} onClick={() => { setCancelOrder(detailOrder); setCancelReason(''); setDetailOrder(null); }}>
                                        Anular
                                    </Button>
                                )}
                            </>
                        )}
                    </>
                )}
            >
                {detailLoading && <Skeleton height={200} />}
                {detailOrder && !detailLoading && (
                    <div className={s.form}>
                        <FormSection title="Datos de la orden">
                            <dl className={s.facts}>
                                <div><dt>Producto</dt><dd>{detailOrder.product?.name ?? '-'} {detailOrder.product?.sku ? `(${detailOrder.product.sku})` : ''}</dd></div>
                                <div><dt>Receta</dt><dd>{detailOrder.recipe ? `${detailOrder.recipe.name} v${detailOrder.recipe.version}` : '-'}</dd></div>
                                <div><dt>Almacén</dt><dd>{detailOrder.warehouse?.name ?? '-'}</dd></div>
                                <div><dt>Cant. planificada</dt><dd>{formatNumber(detailOrder.plannedQuantity)} {outputUnit(detailOrder.product)}</dd></div>
                                <div><dt>Cant. producida</dt><dd>{formatNumber(detailOrder.producedQuantity)} {outputUnit(detailOrder.product)}</dd></div>
                                <div>
                                    <dt>Costo estimado</dt>
                                    <dd>{Number(detailOrder.estimatedCost) > 0 ? `${formatMoney(detailOrder.estimatedCost)} (${formatMoney(detailOrder.estimatedUnitCost)}/u)` : 'N/D'}</dd>
                                </div>
                                <div>
                                    <dt>Costo real</dt>
                                    <dd>{detailOrder.status !== 'FINISHED' ? '-' : Number(detailOrder.realCost) > 0 ? `${formatMoney(detailOrder.realCost)} (${formatMoney(detailOrder.realUnitCost)}/u)` : 'N/D'}</dd>
                                </div>
                                <div>
                                    <dt>Variación</dt>
                                    <dd>{(() => {
                                        const v = costVariationOf(detailOrder);
                                        return v ? `${signed(v.delta)} (${formatPercent(v.pct)})` : detailOrder.status === 'FINISHED' ? 'N/D' : '-';
                                    })()}</dd>
                                </div>
                                <div><dt>Responsable</dt><dd>{detailOrder.user?.name ?? '-'}</dd></div>
                                <div><dt>Fecha</dt><dd>{formatDate(detailOrder.date)}</dd></div>
                                <div><dt>Finalizada</dt><dd>{formatDate(detailOrder.finishedAt)}</dd></div>
                                {detailOrder.cancelReason && <div><dt>Motivo de anulación</dt><dd>{detailOrder.cancelReason}</dd></div>}
                                {detailOrder.notes && <div><dt>Notas</dt><dd>{detailOrder.notes}</dd></div>}
                            </dl>
                        </FormSection>

                        <FormSection title="Insumos">
                            <DataTable<ProductionOrderItem>
                                ariaLabel="Insumos de la orden"
                                columns={detailColumns}
                                rows={detailOrder.items}
                                rowKey={(item) => item.id}
                                minWidth="36rem"
                                empty={<EmptyState title="Sin insumos registrados" />}
                            />
                        </FormSection>
                    </div>
                )}
            </FullScreenModal>

            <FullScreenModal
                isOpen={!!finishOrder}
                onClose={() => setFinishOrder(null)}
                title={finishOrder ? `Finalizar ${finishOrder.code}` : 'Finalizar producción'}
                subtitle={finishOrder?.product?.name}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" icon={CheckCircle} loading={finishing} disabled={finishing} onClick={() => void handleFinish()}>
                            {finishing ? 'Finalizando...' : 'Finalizar producción'}
                        </Button>
                    </>
                )}
            >
                {finishOrder && (
                    <div className={s.form}>
                        <FormSection title="Resultado de la producción">
                            <FormGrid>
                                <Field
                                    label="Cantidad realmente producida"
                                    htmlFor="finish-produced"
                                    required
                                    hint={`Planificado: ${formatNumber(finishOrder.plannedQuantity)} ${outputUnit(finishOrder.product)} · Rendimiento: ${formatPercent(finishYield, 1)}`}
                                >
                                    <Input
                                        id="finish-produced"
                                        type="number"
                                        min={0.001}
                                        step="any"
                                        value={finishForm.producedQuantity}
                                        onChange={(e) => setFinishForm((prev) => ({ ...prev, producedQuantity: e.target.value }))}
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>

                        <FormSection title="Consumo de insumos">
                            <DataTable<ProductionOrderItem>
                                ariaLabel="Consumo real de insumos"
                                columns={finishColumns}
                                rows={finishOrder.items}
                                rowKey={(item) => item.id}
                                minWidth="32rem"
                                empty={<EmptyState title="Sin insumos registrados" />}
                            />
                        </FormSection>

                        <Field label="Notas" htmlFor="finish-notes">
                            <Textarea
                                id="finish-notes"
                                rows={2}
                                value={finishForm.notes}
                                onChange={(e) => setFinishForm((prev) => ({ ...prev, notes: e.target.value }))}
                                placeholder="Mermas, observaciones de rendimiento..."
                            />
                        </Field>

                        {canOverrideNegativeStock && (
                            <Checkbox
                                label="Permitir inventario negativo si falta stock (excepción administrativa)"
                                checked={finishForm.allowNegative}
                                onChange={(e) => setFinishForm((prev) => ({ ...prev, allowNegative: e.target.checked }))}
                            />
                        )}
                    </div>
                )}
            </FullScreenModal>

            <ConfirmDialog
                isOpen={!!cancelOrder}
                title={cancelOrder ? `Anular ${cancelOrder.code}` : 'Anular orden'}
                tone="danger"
                confirmLabel={cancelling ? 'Anulando...' : 'Anular orden'}
                loading={cancelling}
                onCancel={() => setCancelOrder(null)}
                onConfirm={() => void handleCancel()}
                message={cancelOrder && (
                    <div className={s.form}>
                        <p>
                            {cancelOrder.status === 'FINISHED'
                                ? 'Esta orden ya fue finalizada. Anularla revertirá los movimientos de inventario.'
                                : 'La orden quedará anulada y no podrá editarse.'}
                        </p>
                        <Field label="Motivo de anulación" htmlFor="cancel-reason" required>
                            <Textarea
                                id="cancel-reason"
                                rows={3}
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder="Indique el motivo..."
                            />
                        </Field>
                    </div>
                )}
            />
        </PageContent>
    );
}
