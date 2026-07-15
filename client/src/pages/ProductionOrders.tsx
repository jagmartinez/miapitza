import { useState, useEffect, useCallback, useMemo } from 'react';
import { productionOrdersAPI, productsAPI, warehousesAPI, branchesAPI } from '../services/api';
import api from '../services/api';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import Input from '../components/Input';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import {
    Factory, Plus, Eye, CheckCircle, Ban, Play, Clock, Calculator,
    AlertTriangle, Save, Info, Check, X
} from 'lucide-react';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import type { SingleValue } from 'react-select';
import type {
    ProductionOrder, ProductionOrderStatus, ProductionPreview, Product, Warehouse, Branch
} from '../types';
import './Inventory.css';
import './ProductionOrders.css';

type SelectOption = { value: string; label: string };

const PRODUCIBLE_TYPES = ['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH'];

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

const STATUS_META: Record<ProductionOrderStatus, { label: string; className: string }> = {
    DRAFT: { label: 'Borrador', className: 'po-status-draft' },
    PENDING: { label: 'Pendiente', className: 'po-status-pending' },
    IN_PROGRESS: { label: 'En Proceso', className: 'po-status-progress' },
    FINISHED: { label: 'Finalizada', className: 'po-status-finished' },
    CANCELLED: { label: 'Anulada', className: 'po-status-cancelled' },
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'Todas' },
    { value: 'DRAFT', label: 'Borrador' },
    { value: 'PENDING', label: 'Pendiente' },
    { value: 'IN_PROGRESS', label: 'En Proceso' },
    { value: 'FINISHED', label: 'Finalizada' },
    { value: 'CANCELLED', label: 'Anulada' },
];

function formatDate(value?: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function outputUnit(product?: Pick<Product, 'unit' | 'baseUnit'> | null): string {
    return product?.baseUnit?.abbreviation || product?.unit || '';
}

export default function ProductionOrders() {
    const { user } = useAuth();
    const { success: showSuccess, error: showError, warning: showWarning } = useAppToast();

    const userRoleNames = getUserRoleNames(user);
    const canManage = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'].includes(role));
    const isSuperAdmin = userRoleNames.includes('SUPERADMIN');
    const canOverrideNegativeStock = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));

    const [orders, setOrders] = useState<ProductionOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

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
        try {
            const res = await productionOrdersAPI.getAll();
            setOrders(Array.isArray(res.data.data) ? res.data.data : []);
        } catch (error) {
            console.error('Error loading production orders:', error);
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadSettings = useCallback(async () => {
        try {
            const res = await api.get('/settings');
            setSettings(res.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }, []);

    const loadFormDependencies = useCallback(async () => {
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
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        void loadOrders();
        void loadSettings();
    }, [loadOrders, loadSettings]);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, searchQuery]);

    const filteredOrders = useMemo(() => {
        const searchLower = searchQuery.toLowerCase().trim();
        return orders.filter((order) => {
            const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
            const matchesSearch = !searchLower ||
                order.code?.toLowerCase().includes(searchLower) ||
                order.product?.name?.toLowerCase().includes(searchLower) ||
                order.product?.sku?.toLowerCase().includes(searchLower);
            return matchesStatus && matchesSearch;
        });
    }, [orders, statusFilter, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage));
    const paginatedOrders = filteredOrders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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

    const statusBadge = (status: ProductionOrderStatus) => {
        const meta = STATUS_META[status];
        return <span className={`po-status-badge ${meta.className}`}>{meta.label}</span>;
    };

    const canFinish = (status: ProductionOrderStatus) => status === 'IN_PROGRESS';
    const canCancel = (status: ProductionOrderStatus) => status !== 'CANCELLED';

    const productOptions: SelectOption[] = products.map((p) => ({
        value: p.id.toString(),
        label: p.sku ? `${p.name} (${p.sku})` : p.name,
    }));
    const warehouseOptions: SelectOption[] = warehouses.map((w) => ({
        value: w.id.toString(),
        label: w.branch?.name ? `${w.name} (${w.branch.name})` : w.name,
    }));
    const branchOptions: SelectOption[] = branches.map((b) => ({ value: b.id.toString(), label: b.name }));

    if (loading) return <div className="inventory-loading">Cargando órdenes de producción...</div>;

    return (
        <div className="inventory-page production-orders-page">
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><Factory size={32} /> Órdenes de Producción</h1>
                    <p className="po-subtitle">Produce intermedios y terminados consumiendo insumos del inventario</p>
                </div>
                <div className="po-header-actions">
                    <Button onClick={handleOpenCreate} disabled={!canManage}>
                        <Plus size={18} />
                        Nueva Producción
                    </Button>
                </div>
            </div>

            <div className="inventory-filters-row">
                <div className="inventory-status-filters">
                    {STATUS_FILTERS.map((filter) => (
                        <button
                            key={filter.value}
                            type="button"
                            className={`inventory-status-btn ${statusFilter === filter.value ? 'active' : ''}`}
                            onClick={() => setStatusFilter(filter.value)}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
                <div className="filter-right-section">
                    <input
                        type="text"
                        placeholder="Buscar por código o producto..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input inventory-search"
                    />
                </div>
            </div>

            <div className="inventory-table-wrapper">
                <table className="inventory-table modern-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Producto</th>
                            <th className="text-right">Cant. Planificada</th>
                            <th className="text-right">Cant. Producida</th>
                            <th>Estado</th>
                            <th className="text-right">Costo estimado</th>
                            <th className="text-right">Costo real</th>
                            <th>Fecha</th>
                            <th className="text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedOrders.map((order) => (
                            <tr key={order.id}>
                                <td data-label="Código" className="cell-name">
                                    <span className="cell-name-title po-code">{order.code}</span>
                                </td>
                                <td data-label="Producto">
                                    <div className="po-product-cell">
                                        <span className="po-product-name">{order.product?.name ?? '-'}</span>
                                        {order.product?.sku && <span className="po-product-sku">{order.product.sku}</span>}
                                    </div>
                                </td>
                                <td data-label="Cant. Planificada" className="text-right">
                                    {Number(order.plannedQuantity).toFixed(2)} {outputUnit(order.product)}
                                </td>
                                <td data-label="Cant. Producida" className="text-right">
                                    {Number(order.producedQuantity).toFixed(2)} {outputUnit(order.product)}
                                </td>
                                <td data-label="Estado">{statusBadge(order.status)}</td>
                                <td data-label="Costo estimado" className="text-right">{formatCurrency(Number(order.estimatedCost) || 0, settings)}</td>
                                <td data-label="Costo real" className="text-right">
                                    {order.status === 'FINISHED' ? formatCurrency(Number(order.realCost) || 0, settings) : <span className="text-muted">-</span>}
                                </td>
                                <td data-label="Fecha">{formatDate(order.date)}</td>
                                <td data-label="Acciones" className="text-right">
                                    <div className="table-actions">
                                        <button
                                            type="button"
                                            className="table-action-btn"
                                            onClick={() => handleOpenDetail(order.id)}
                                            title="Ver detalle"
                                        >
                                            <Eye size={16} />
                                        </button>
                                        {canManage && canFinish(order.status) && (
                                            <button
                                                type="button"
                                                className="table-action-btn success"
                                                onClick={() => handleOpenFinish(order.id)}
                                                title="Finalizar producción"
                                            >
                                                <CheckCircle size={16} />
                                            </button>
                                        )}
                                        {canManage && canCancel(order.status) && (
                                            <button
                                                type="button"
                                                className="table-action-btn danger"
                                                onClick={() => { setCancelOrder(order); setCancelReason(''); }}
                                                title="Anular orden"
                                            >
                                                <Ban size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredOrders.length === 0 && (
                            <tr>
                                <td colSpan={9}>
                                    <div className="po-empty-state">
                                        <Factory size={48} />
                                        <p>No se encontraron órdenes de producción</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>

                <Pagination
                    page={currentPage}
                    totalPages={totalPages}
                    totalItems={filteredOrders.length}
                    pageSize={itemsPerPage}
                    onPageChange={setCurrentPage}
                />
            </div>

            {/* Create Sidebar */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title="Nueva Orden de Producción"
                width="large"
            >
                <div className="premium-modal-content po-production-form">
                    <div className="modal-tab-content">
                        <div className="modal-content-group">
                            <div className="modal-section-header">
                                <Factory size={18} />
                                <h3>Datos de la producción</h3>
                            </div>
                            <div className="form-grid-modern">
                                <div className="modal-input-group full-width">
                                    <label className="modal-input-label" htmlFor="prod-product">Producto a producir *</label>
                                    {(() => {
                                        const selected = productOptions.find((o) => o.value === createForm.productId) ?? null;
                                        return (
                                            <Select
                                                inputId="prod-product"
                                                variant="modal"
                                                options={productOptions}
                                                value={selected}
                                                onChange={(option: SingleValue<SelectOption>) => setCreateForm((prev) => ({ ...prev, productId: option?.value ?? '' }))}
                                                placeholder="Seleccione el producto (intermedio o terminado)"
                                            />
                                        );
                                    })()}
                                </div>

                                {isSuperAdmin && (
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="prod-branch">Sucursal *</label>
                                        {(() => {
                                            const selected = branchOptions.find((o) => o.value === createForm.branchId) ?? null;
                                            return (
                                                <Select
                                                    inputId="prod-branch"
                                                    variant="modal"
                                                    options={branchOptions}
                                                    value={selected}
                                                    onChange={(option: SingleValue<SelectOption>) => setCreateForm((prev) => ({ ...prev, branchId: option?.value ?? '' }))}
                                                    placeholder="Seleccione la sucursal"
                                                />
                                            );
                                        })()}
                                    </div>
                                )}

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="prod-warehouse">Almacén destino *</label>
                                    {(() => {
                                        const selected = warehouseOptions.find((o) => o.value === createForm.warehouseId) ?? null;
                                        return (
                                            <Select
                                                inputId="prod-warehouse"
                                                variant="modal"
                                                options={warehouseOptions}
                                                value={selected}
                                                onChange={(option: SingleValue<SelectOption>) => setCreateForm((prev) => ({ ...prev, warehouseId: option?.value ?? '' }))}
                                                placeholder="Seleccione el almacén"
                                            />
                                        );
                                    })()}
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="prod-quantity">Cantidad a producir *</label>
                                    <Input
                                        id="prod-quantity"
                                        type="number"
                                        min={0.001}
                                        step="any"
                                        value={createForm.plannedQuantity}
                                        onChange={(e) => setCreateForm((prev) => ({ ...prev, plannedQuantity: e.target.value }))}
                                        variant="modal"
                                    />
                                    <span className="po-field-hint">En la unidad base del producto</span>
                                </div>

                                <div className="modal-input-group full-width">
                                    <label className="modal-input-label" htmlFor="prod-notes">Notas</label>
                                    <textarea
                                        id="prod-notes"
                                        className="modal-textarea"
                                        rows={2}
                                        value={createForm.notes}
                                        onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                                        placeholder="Observaciones de la producción..."
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="modal-content-group">
                            <div className="modal-section-header po-section-header-actions">
                                <div className="po-section-heading">
                                    <Calculator size={18} />
                                    <h3>Insumos requeridos</h3>
                                </div>
                                <Button
                                    variant="ghost"
                                    type="button"
                                    onClick={() => { void runPreview(); }}
                                    disabled={previewLoading || !createForm.productId || !createForm.warehouseId}
                                >
                                    <Calculator size={16} />
                                    {previewLoading ? 'Calculando...' : 'Calcular insumos'}
                                </Button>
                            </div>

                            {previewError && (
                                <div className="po-banner po-banner-error">
                                    <AlertTriangle size={18} />
                                    <span>{previewError}</span>
                                </div>
                            )}

                            {!previewError && !preview && !previewLoading && (
                                <p className="po-preview-placeholder">
                                    <Info size={14} /> Seleccione producto, almacén y cantidad para calcular los insumos.
                                </p>
                            )}

                            {preview && (
                                <>
                                    <div className={`po-banner ${preview.canProduce ? 'po-banner-success' : 'po-banner-warning'}`}>
                                        {preview.canProduce ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                                        <span>
                                            {preview.canProduce
                                                ? 'Inventario suficiente'
                                                : 'Faltan insumos: produzca primero los intermedios o ajuste inventario'}
                                        </span>
                                    </div>

                                    <div className="po-req-table-wrapper">
                                        <table className="po-req-table">
                                            <thead>
                                                <tr>
                                                    <th>Insumo</th>
                                                    <th className="text-right">Requerido</th>
                                                    <th className="text-right">Disponible</th>
                                                    <th>Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview.requirements.map((line) => (
                                                    <tr key={line.componentProductId} className={line.sufficient ? 'row-ok' : 'row-short'}>
                                                        <td data-label="Insumo">
                                                            <div className="po-req-name">
                                                                <span>{line.componentName}</span>
                                                                {!line.sufficient && line.producible && (
                                                                    <span className="po-producible-badge" title="Este insumo se puede producir con una orden de producción">
                                                                        Se puede producir
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td data-label="Requerido" className="text-right">{Number(line.requiredQuantity).toFixed(2)} {line.unit}</td>
                                                        <td data-label="Disponible" className="text-right">{Number(line.availableQuantity).toFixed(2)} {line.unit}</td>
                                                        <td data-label="Estado">
                                                            {line.sufficient ? (
                                                                <span className="po-req-status ok"><Check size={14} /> Suficiente</span>
                                                            ) : (
                                                                <span className="po-req-status short"><X size={14} /> Faltante</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="po-cost-summary">
                                        <div className="po-cost-row">
                                            <span>Costo estimado total</span>
                                            <strong>{formatCurrency(Number(preview.estimatedCost) || 0, settings)}</strong>
                                        </div>
                                        <div className="po-cost-row">
                                            <span>Costo unitario estimado</span>
                                            <strong>{formatCurrency(Number(preview.estimatedUnitCost) || 0, settings)}</strong>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="modal-footer">
                        <div className="action-buttons po-modal-actions">
                            <Button variant="secondary" type="button" onClick={() => setIsSidebarOpen(false)}>Cancelar</Button>
                            <Button type="button" className="save-btn-premium" disabled={creating} onClick={handleCreate}>
                                <Save size={20} />
                                <span>{creating ? 'Creando...' : 'Crear orden'}</span>
                            </Button>
                        </div>
                    </div>
                </div>
            </Sidebar>

            {/* Detail Modal */}
            <Modal
                isOpen={!!detailOrder || detailLoading}
                onClose={() => setDetailOrder(null)}
                title={detailOrder ? `Producción ${detailOrder.code}` : 'Detalle de producción'}
                size="lg"
            >
                {detailLoading && <p className="po-modal-loading">Cargando detalle...</p>}
                {detailOrder && !detailLoading && (
                    <div className="po-detail">
                        <div className="po-detail-grid">
                            <div className="po-detail-item"><span className="po-detail-label">Producto</span><span className="po-detail-value">{detailOrder.product?.name ?? '-'} {detailOrder.product?.sku ? `(${detailOrder.product.sku})` : ''}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Receta</span><span className="po-detail-value">{detailOrder.recipe ? `${detailOrder.recipe.name} v${detailOrder.recipe.version}` : '-'}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Almacén</span><span className="po-detail-value">{detailOrder.warehouse?.name ?? '-'}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Estado</span><span className="po-detail-value">{statusBadge(detailOrder.status)}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Cant. planificada</span><span className="po-detail-value">{Number(detailOrder.plannedQuantity).toFixed(2)} {outputUnit(detailOrder.product)}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Cant. producida</span><span className="po-detail-value">{Number(detailOrder.producedQuantity).toFixed(2)} {outputUnit(detailOrder.product)}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Costo estimado</span><span className="po-detail-value">{formatCurrency(Number(detailOrder.estimatedCost) || 0, settings)} ({formatCurrency(Number(detailOrder.estimatedUnitCost) || 0, settings)}/u)</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Costo real</span><span className="po-detail-value">{formatCurrency(Number(detailOrder.realCost) || 0, settings)} ({formatCurrency(Number(detailOrder.realUnitCost) || 0, settings)}/u)</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Responsable</span><span className="po-detail-value">{detailOrder.user?.name ?? '-'}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Fecha</span><span className="po-detail-value">{formatDate(detailOrder.date)}</span></div>
                            <div className="po-detail-item"><span className="po-detail-label">Finalizada</span><span className="po-detail-value">{formatDate(detailOrder.finishedAt)}</span></div>
                            {detailOrder.cancelReason && (
                                <div className="po-detail-item full"><span className="po-detail-label">Motivo de anulación</span><span className="po-detail-value">{detailOrder.cancelReason}</span></div>
                            )}
                            {detailOrder.notes && (
                                <div className="po-detail-item full"><span className="po-detail-label">Notas</span><span className="po-detail-value">{detailOrder.notes}</span></div>
                            )}
                        </div>

                        <div className="po-req-table-wrapper">
                            <table className="po-req-table">
                                <thead>
                                    <tr>
                                        <th>Insumo</th>
                                        <th className="text-right">Requerido</th>
                                        <th className="text-right">Consumido</th>
                                        <th className="text-right">Costo unit.</th>
                                        <th className="text-right">Costo total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detailOrder.items.map((item) => (
                                        <tr key={item.id}>
                                            <td data-label="Insumo">{item.componentProduct?.name ?? `#${item.componentProductId}`}</td>
                                            <td data-label="Requerido" className="text-right">{Number(item.requiredQuantity).toFixed(2)} {item.unit ?? item.componentProduct?.unit ?? ''}</td>
                                            <td data-label="Consumido" className="text-right">{Number(item.consumedQuantity).toFixed(2)} {item.unit ?? item.componentProduct?.unit ?? ''}</td>
                                            <td data-label="Costo unit." className="text-right">{formatCurrency(Number(item.unitCost) || 0, settings)}</td>
                                            <td data-label="Costo total" className="text-right">{formatCurrency(Number(item.totalCost) || 0, settings)}</td>
                                        </tr>
                                    ))}
                                    {detailOrder.items.length === 0 && (
                                        <tr><td colSpan={5} className="po-empty-cell">Sin insumos registrados</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {canManage && (
                            <div className="modal-footer">
                                <div className="action-buttons po-modal-actions po-modal-actions-wrap">
                                    {(detailOrder.status === 'DRAFT') && (
                                        <Button variant="secondary" type="button" onClick={() => handleSetStatus(detailOrder.id, 'PENDING')}>
                                            <Clock size={18} /> Marcar Pendiente
                                        </Button>
                                    )}
                                    {(detailOrder.status === 'DRAFT' || detailOrder.status === 'PENDING') && (
                                        <Button variant="secondary" type="button" onClick={() => handleSetStatus(detailOrder.id, 'IN_PROGRESS')}>
                                            <Play size={18} /> Iniciar
                                        </Button>
                                    )}
                                    {canFinish(detailOrder.status) && (
                                        <Button type="button" onClick={() => { const id = detailOrder.id; setDetailOrder(null); void handleOpenFinish(id); }}>
                                            <CheckCircle size={18} /> Finalizar
                                        </Button>
                                    )}
                                    {canCancel(detailOrder.status) && (
                                        <Button variant="danger" type="button" onClick={() => { setCancelOrder(detailOrder); setCancelReason(''); setDetailOrder(null); }}>
                                            <Ban size={18} /> Anular
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* Finish Modal */}
            <Modal
                isOpen={!!finishOrder}
                onClose={() => setFinishOrder(null)}
                title={finishOrder ? `Finalizar ${finishOrder.code}` : 'Finalizar producción'}
                size="lg"
            >
                {finishOrder && (
                    <div className="po-finish">
                        <div className="form-grid-modern">
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="finish-produced">Cantidad realmente producida *</label>
                                <Input
                                    id="finish-produced"
                                    type="number"
                                    min={0.001}
                                    step="any"
                                    value={finishForm.producedQuantity}
                                    onChange={(e) => setFinishForm((prev) => ({ ...prev, producedQuantity: e.target.value }))}
                                    variant="modal"
                                />
                                <span className="po-field-hint">
                                    Planificado: {Number(finishOrder.plannedQuantity).toFixed(2)} {outputUnit(finishOrder.product)} · Rendimiento: {finishYield.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        <div className="po-req-table-wrapper">
                            <table className="po-req-table">
                                <thead>
                                    <tr>
                                        <th>Insumo</th>
                                        <th className="text-right">Requerido</th>
                                        <th className="text-right">Consumo real</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {finishOrder.items.map((item) => (
                                        <tr key={item.id}>
                                            <td data-label="Insumo">{item.componentProduct?.name ?? `#${item.componentProductId}`}</td>
                                            <td data-label="Requerido" className="text-right">{Number(item.requiredQuantity).toFixed(2)} {item.unit ?? item.componentProduct?.unit ?? ''}</td>
                                            <td data-label="Consumo real" className="text-right">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step="any"
                                                    className="po-consume-input"
                                                    value={finishConsumptions[item.componentProductId] ?? ''}
                                                    onChange={(e) => setFinishConsumptions((prev) => ({ ...prev, [item.componentProductId]: e.target.value }))}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                    {finishOrder.items.length === 0 && (
                                        <tr><td colSpan={3} className="po-empty-cell">Sin insumos registrados</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="modal-input-group full-width">
                            <label className="modal-input-label" htmlFor="finish-notes">Notas</label>
                            <textarea
                                id="finish-notes"
                                className="modal-textarea"
                                rows={2}
                                value={finishForm.notes}
                                onChange={(e) => setFinishForm((prev) => ({ ...prev, notes: e.target.value }))}
                                placeholder="Mermas, observaciones de rendimiento..."
                            />
                        </div>

                        {canOverrideNegativeStock && (
                            <label className="po-checkbox-row">
                                <input
                                    type="checkbox"
                                    checked={finishForm.allowNegative}
                                    onChange={(e) => setFinishForm((prev) => ({ ...prev, allowNegative: e.target.checked }))}
                                />
                                <span>Permitir inventario negativo si falta stock (excepción administrativa)</span>
                            </label>
                        )}

                        <div className="modal-footer">
                            <div className="action-buttons po-modal-actions">
                                <Button variant="secondary" type="button" onClick={() => setFinishOrder(null)}>Cancelar</Button>
                                <Button type="button" className="save-btn-premium" disabled={finishing} onClick={handleFinish}>
                                    <CheckCircle size={20} />
                                    <span>{finishing ? 'Finalizando...' : 'Finalizar producción'}</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Cancel Modal */}
            <Modal
                isOpen={!!cancelOrder}
                onClose={() => setCancelOrder(null)}
                title={cancelOrder ? `Anular ${cancelOrder.code}` : 'Anular orden'}
            >
                {cancelOrder && (
                    <div className="po-cancel">
                        <div className="po-banner po-banner-warning">
                            <AlertTriangle size={18} />
                            <span>
                                {cancelOrder.status === 'FINISHED'
                                    ? 'Esta orden ya fue finalizada. Anularla revertirá los movimientos de inventario.'
                                    : 'La orden quedará anulada y no podrá editarse.'}
                            </span>
                        </div>
                        <div className="modal-input-group full-width">
                            <label className="modal-input-label" htmlFor="cancel-reason">Motivo de anulación</label>
                            <textarea
                                id="cancel-reason"
                                className="modal-textarea"
                                rows={3}
                                value={cancelReason}
                                onChange={(e) => setCancelReason(e.target.value)}
                                placeholder="Indique el motivo..."
                            />
                        </div>
                        <div className="modal-footer">
                            <div className="action-buttons po-modal-actions">
                                <Button variant="secondary" type="button" onClick={() => setCancelOrder(null)}>Cancelar</Button>
                                <Button variant="danger" type="button" disabled={cancelling || !cancelReason.trim()} onClick={handleCancel}>
                                    <Ban size={20} />
                                    <span>{cancelling ? 'Anulando...' : 'Anular orden'}</span>
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
