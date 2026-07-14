import { useState, useEffect, useMemo } from 'react';
import { productionRecipesAPI, productsAPI, unitsAPI } from '../services/api';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import Input from '../components/Input';
import Card from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { useCurrency } from '../hooks/useCurrency';
import { getUserRoleNames } from '../utils/authz';
import {
    FlaskConical, Plus, Pencil, Power, Copy, Trash2, Save, Info, Layers,
    Search, Calculator, Eye, Package, Box, DollarSign, Activity, FileText, Scale
} from 'lucide-react';
import type { SingleValue } from 'react-select';
import type { ProductionRecipe, Product, UnitOfMeasure, RecipeCost } from '../types';
import './Inventory.css';
import './ProductionRecipes.css';

type StrOption = { value: string; label: string };

interface ComponentRow {
    key: string;
    componentProductId: string;
    quantity: string;
    unitId: string;
}

/** Product types that can be produced (act as a recipe output). */
const PRODUCIBLE_TYPES: Product['type'][] = ['INTERMEDIATE', 'PRODUCT_FOR_SALE', 'BOTH'];

const TYPE_LABELS: Record<Product['type'], string> = {
    INGREDIENT: 'Ingrediente',
    PRODUCT_FOR_SALE: 'Producto terminado',
    BOTH: 'Mixto',
    INTERMEDIATE: 'Intermedio',
    PACKAGING: 'Empaque',
};

function errMsg(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}

function makeRowKey(): string {
    return Math.random().toString(36).slice(2, 11);
}

function displayedYieldUnit(recipe: ProductionRecipe): string {
    return recipe.yieldUnitAbbreviation?.trim()
        || recipe.yieldUnit?.abbreviation?.trim()
        || recipe.product?.baseUnit?.abbreviation?.trim()
        || recipe.product?.unit?.trim()
        || 'sin unidad';
}

function emptyRow(): ComponentRow {
    return { key: makeRowKey(), componentProductId: '', quantity: '', unitId: '' };
}

export default function ProductionRecipes() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError, warning: showWarning } = useAppToast();
    const { formatMoney } = useCurrency();

    const userRoleNames = getUserRoleNames(user);
    const canManage = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF'].includes(role));
    const canDelete = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));

    const [recipes, setRecipes] = useState<ProductionRecipe[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [units, setUnits] = useState<UnitOfMeasure[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewingRecipe, setViewingRecipe] = useState<ProductionRecipe | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'DRAFT' | 'INACTIVE'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // Sidebar / form state
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingRecipe, setEditingRecipe] = useState<ProductionRecipe | null>(null);
    const [saving, setSaving] = useState(false);
    const [productId, setProductId] = useState('');
    const [name, setName] = useState('');
    const [yieldQuantity, setYieldQuantity] = useState('');
    const [yieldUnitId, setYieldUnitId] = useState('');
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<ComponentRow[]>([emptyRow()]);
    const [activateOnSave, setActivateOnSave] = useState(false);
    const [previewCost, setPreviewCost] = useState<RecipeCost | null>(null);
    const [previewCostError, setPreviewCostError] = useState<string | null>(null);
    const [previewCostLoading, setPreviewCostLoading] = useState(false);
    const [activeFormTab, setActiveFormTab] = useState<'recipe' | 'components' | 'cost'>('recipe');

    useEffect(() => {
        loadAll();
    }, []);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, searchQuery]);

    useEffect(() => {
        if (!isSidebarOpen || !productId || !yieldQuantity) {
            setPreviewCost(null);
            setPreviewCostError(null);
            return;
        }
        const components = rows
            .filter(row => row.componentProductId && Number(row.quantity) > 0)
            .map(row => ({
                componentProductId: Number(row.componentProductId),
                quantity: Number(row.quantity),
                unitId: row.unitId ? Number(row.unitId) : undefined,
            }));
        if (components.length === 0 || !(Number(yieldQuantity) > 0)) {
            setPreviewCost(null);
            setPreviewCostError(null);
            return;
        }

        let active = true;
        const timer = window.setTimeout(async () => {
            setPreviewCostLoading(true);
            try {
                const response = await productionRecipesAPI.previewCost({
                    productId: Number(productId),
                    yieldQuantity: Number(yieldQuantity),
                    yieldUnitId: yieldUnitId ? Number(yieldUnitId) : undefined,
                    components,
                });
                if (!active) return;
                setPreviewCost(response.data.data as RecipeCost);
                setPreviewCostError(null);
            } catch (error: unknown) {
                if (!active) return;
                setPreviewCost(null);
                setPreviewCostError(errMsg(error, 'No se pudo calcular el costo con las unidades seleccionadas'));
            } finally {
                if (active) setPreviewCostLoading(false);
            }
        }, 300);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [isSidebarOpen, productId, yieldQuantity, yieldUnitId, rows]);

    const loadAll = async () => {
        try {
            const [recipesRes, productsRes, unitsRes] = await Promise.all([
                productionRecipesAPI.getAll(),
                productsAPI.getAll({ limit: 1000, active: true }),
                unitsAPI.getAll(),
            ]);
            setRecipes(Array.isArray(recipesRes.data.data) ? recipesRes.data.data : []);
            setProducts(Array.isArray(productsRes.data.data) ? productsRes.data.data : []);
            setUnits(Array.isArray(unitsRes.data.data) ? unitsRes.data.data : []);
        } catch (error) {
            console.error('Error loading production recipes:', error);
            setRecipes([]);
        } finally {
            setLoading(false);
        }
    };

    const loadRecipes = async () => {
        try {
            const res = await productionRecipesAPI.getAll();
            setRecipes(Array.isArray(res.data.data) ? res.data.data : []);
        } catch (error) {
            console.error('Error reloading production recipes:', error);
        }
    };

    const handleView = async (recipe: ProductionRecipe) => {
        setViewingRecipe(recipe);
        setDetailLoading(true);
        try {
            const response = await productionRecipesAPI.getById(recipe.id);
            setViewingRecipe(response.data.data as ProductionRecipe);
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo cargar el detalle de la receta'));
            setViewingRecipe(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const producibleProducts = useMemo(
        () => products.filter((p) => PRODUCIBLE_TYPES.includes(p.type)),
        [products]
    );

    const productOptions: StrOption[] = useMemo(
        () => producibleProducts.map((p) => ({
            value: String(p.id),
            label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${TYPE_LABELS[p.type]}`,
        })),
        [producibleProducts]
    );

    const componentOptions: StrOption[] = useMemo(
        () => products
            .filter((p) => String(p.id) !== productId)
            .map((p) => ({
                value: String(p.id),
                label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${TYPE_LABELS[p.type]}`,
            })),
        [products, productId]
    );

    const unitOptions: StrOption[] = useMemo(
        () => units.map((u) => ({ value: String(u.id), label: `${u.name} (${u.abbreviation})` })),
        [units]
    );

    const productById = useMemo(() => {
        const map = new Map<number, Product>();
        products.forEach((p) => map.set(p.id, p));
        return map;
    }, [products]);

    const resetForm = () => {
        setEditingRecipe(null);
        setProductId('');
        setName('');
        setYieldQuantity('');
        setYieldUnitId('');
        setNotes('');
        setRows([emptyRow()]);
        setActivateOnSave(false);
        setPreviewCost(null);
        setPreviewCostError(null);
        setActiveFormTab('recipe');
    };

    const handleOpenCreate = () => {
        if (!canManage) {
            showWarning('No tienes permisos para gestionar recetas de producción');
            return;
        }
        resetForm();
        setIsSidebarOpen(true);
    };

    const handleOpenEdit = (recipe: ProductionRecipe) => {
        if (!canManage) {
            showWarning('No tienes permisos para gestionar recetas de producción');
            return;
        }
        if (recipe.status === 'INACTIVE') {
            showWarning('Las recetas inactivas no se pueden editar');
            return;
        }
        setEditingRecipe(recipe);
        setProductId(String(recipe.productId));
        setName(recipe.name || '');
        setYieldQuantity(recipe.yieldQuantity != null ? String(recipe.yieldQuantity) : '');
        setYieldUnitId(recipe.yieldUnitId != null ? String(recipe.yieldUnitId) : '');
        setNotes(recipe.notes || '');
        setRows(
            recipe.components.length > 0
                ? recipe.components.map((c) => ({
                    key: makeRowKey(),
                    componentProductId: String(c.componentProductId),
                    quantity: c.quantity != null ? String(c.quantity) : '',
                    unitId: c.unitId != null ? String(c.unitId) : '',
                }))
                : [emptyRow()]
        );
        setActivateOnSave(false);
        setIsSidebarOpen(true);
    };

    const handleCloseSidebar = () => {
        setIsSidebarOpen(false);
        resetForm();
    };

    const handleProductChange = (value: string) => {
        setProductId(value);
        // Default yield unit to the product's base unit when known.
        const prod = value ? productById.get(Number(value)) : undefined;
        if (prod?.baseUnitId) {
            setYieldUnitId(String(prod.baseUnitId));
        }
    };

    const updateRow = (key: string, patch: Partial<ComponentRow>) => {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    };

    const addRow = () => setRows((prev) => [...prev, emptyRow()]);

    const removeRow = (key: string) => {
        setRows((prev) => (prev.length <= 1 ? [emptyRow()] : prev.filter((r) => r.key !== key)));
    };

    const estimatedRowCost = (row: ComponentRow): number => {
        const line = previewCost?.lines.find(candidate => candidate.componentProductId === Number(row.componentProductId));
        return Number(line?.totalCost) || 0;
    };

    const validateForm = (): string | null => {
        if (!productId) return 'Selecciona el producto que genera esta receta';
        const qty = parseFloat(yieldQuantity);
        if (!Number.isFinite(qty) || qty <= 0) return 'El rendimiento por lote debe ser mayor a 0';

        const filled = rows.filter((r) => r.componentProductId);
        if (filled.length === 0) return 'Agrega al menos un componente a la receta';

        const seen = new Set<string>();
        for (const r of filled) {
            if (seen.has(r.componentProductId)) {
                return 'Hay componentes duplicados; usa cada producto una sola vez';
            }
            seen.add(r.componentProductId);
            const cqty = parseFloat(r.quantity);
            if (!Number.isFinite(cqty) || cqty <= 0) {
                return 'Cada componente debe tener una cantidad mayor a 0';
            }
        }
        return null;
    };

    const handleSave = async () => {
        if (!canManage) {
            showWarning('No tienes permisos para gestionar recetas de producción');
            return;
        }
        const validationError = validateForm();
        if (validationError) {
            setActiveFormTab(validationError.includes('componente') || validationError.includes('duplicados')
                ? 'components'
                : 'recipe');
            showWarning(validationError);
            return;
        }
        if (previewCostLoading) {
            showWarning('Espera a que termine el cálculo de costo');
            return;
        }
        if (previewCostError || !previewCost) {
            setActiveFormTab('cost');
            showWarning(previewCostError || 'No se pudo validar el costo y las unidades de la receta');
            return;
        }

        const components = rows
            .filter((r) => r.componentProductId)
            .map((r) => ({
                componentProductId: Number(r.componentProductId),
                quantity: Number(r.quantity),
                unitId: r.unitId ? Number(r.unitId) : undefined,
            }));

        setSaving(true);
        try {
            if (editingRecipe) {
                await productionRecipesAPI.update(editingRecipe.id, {
                    name: name.trim() || undefined,
                    yieldQuantity: Number(yieldQuantity),
                    yieldUnitId: yieldUnitId ? Number(yieldUnitId) : undefined,
                    notes: notes.trim() || undefined,
                    components,
                });
                showSuccess('Receta actualizada correctamente');
            } else {
                await productionRecipesAPI.create({
                    productId: Number(productId),
                    name: name.trim() || undefined,
                    yieldQuantity: Number(yieldQuantity),
                    yieldUnitId: yieldUnitId ? Number(yieldUnitId) : undefined,
                    notes: notes.trim() || undefined,
                    components,
                    activate: activateOnSave,
                });
                showSuccess('Receta creada correctamente');
            }
            handleCloseSidebar();
            await loadRecipes();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo guardar la receta'));
        } finally {
            setSaving(false);
        }
    };

    const handleSetStatus = async (recipe: ProductionRecipe, status: 'ACTIVE' | 'INACTIVE') => {
        if (!canManage) {
            showWarning('No tienes permisos para gestionar recetas de producción');
            return;
        }
        try {
            await productionRecipesAPI.setStatus(recipe.id, status);
            showSuccess(status === 'ACTIVE' ? 'Receta activada' : 'Receta desactivada');
            await loadRecipes();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo cambiar el estado de la receta'));
        }
    };

    const handleCreateVersion = async (recipe: ProductionRecipe) => {
        if (!canManage) {
            showWarning('No tienes permisos para gestionar recetas de producción');
            return;
        }
        try {
            await productionRecipesAPI.createVersion(recipe.id);
            showSuccess('Se creó una nueva versión en borrador');
            await loadRecipes();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo crear una nueva versión'));
        }
    };

    const handleDelete = async (recipe: ProductionRecipe) => {
        if (!canDelete) {
            showWarning('No tienes permisos para eliminar recetas');
            return;
        }
        const ok = await confirm(
            `¿Eliminar la receta "${recipe.name || recipe.product?.name}" (v${recipe.version})?`,
            { title: 'Confirmar acción' }
        );
        if (!ok) return;
        try {
            await productionRecipesAPI.delete(recipe.id);
            showSuccess('Receta eliminada');
            await loadRecipes();
        } catch (error: unknown) {
            showError(errMsg(error, 'No se pudo eliminar la receta'));
        }
    };

    const getStatusBadge = (status: ProductionRecipe['status']) => {
        const map: Record<ProductionRecipe['status'], { cls: string; label: string }> = {
            DRAFT: { cls: 'pr-status-draft', label: 'Borrador' },
            ACTIVE: { cls: 'pr-status-active', label: 'Activa' },
            INACTIVE: { cls: 'pr-status-inactive', label: 'Inactiva' },
        };
        const { cls, label } = map[status];
        return <span className={`pr-status-badge ${cls}`}>{label}</span>;
    };

    const filteredRecipes = recipes.filter((recipe) => {
        const matchesStatus = statusFilter === 'all' || recipe.status === statusFilter;
        const q = searchQuery.trim().toLowerCase();
        if (!q) return matchesStatus;
        const matchesSearch =
            (recipe.product?.name || '').toLowerCase().includes(q) ||
            (recipe.product?.sku || '').toLowerCase().includes(q) ||
            (recipe.name || '').toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
    });

    const totalPages = Math.ceil(filteredRecipes.length / itemsPerPage);
    const paginatedRecipes = filteredRecipes.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const activeCount = recipes.filter((r) => r.status === 'ACTIVE').length;
    const draftCount = recipes.filter((r) => r.status === 'DRAFT').length;
    const inactiveCount = recipes.filter((r) => r.status === 'INACTIVE').length;

    const selectedProduct = productId ? productById.get(Number(productId)) : undefined;

    if (loading) return <div className="inventory-loading">Cargando recetas...</div>;

    const statusFilters: Array<{ key: typeof statusFilter; label: string }> = [
        { key: 'all', label: 'Todas' },
        { key: 'ACTIVE', label: 'Activas' },
        { key: 'DRAFT', label: 'Borradores' },
        { key: 'INACTIVE', label: 'Inactivas' },
    ];

    return (
        <div className="inventory-page production-recipes-page">
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><FlaskConical size={32} /> Recetas de Producción</h1>
                    <p className="pr-subtitle">Define recetas multinivel para productos intermedios y terminados</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Button onClick={handleOpenCreate} disabled={!canManage}>
                        <Plus size={18} />
                        Nueva Receta
                    </Button>
                </div>
            </div>

            <div className="inventory-filters-row">
                <div className="inventory-status-filters">
                    {statusFilters.map((s) => (
                        <button
                            key={s.key}
                            type="button"
                            className={`inventory-status-btn ${statusFilter === s.key ? 'active' : ''}`}
                            onClick={() => setStatusFilter(s.key)}
                        >
                            {s.label}
                        </button>
                    ))}
                    <span className="pr-filter-summary">
                        {activeCount} activas · {draftCount} borradores · {inactiveCount} inactivas
                    </span>
                </div>
                <div className="filter-right-section">
                    <div className="pr-search-wrapper">
                        <Search size={16} className="pr-search-icon" />
                        <input
                            type="text"
                            placeholder="Buscar por producto, SKU o receta..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input inventory-search"
                        />
                    </div>
                </div>
            </div>

            <Card className="pr-table-card">
                <div className="inventory-table-wrapper">
                    <table className="inventory-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Receta</th>
                                <th>Versión</th>
                                <th>Estado</th>
                                <th className="text-right"># Componentes</th>
                                <th className="text-right">Rendimiento</th>
                                <th className="text-right">Costo unitario estimado</th>
                                <th className="text-right">Costo lote</th>
                                <th className="text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedRecipes.map((recipe) => (
                                <tr key={recipe.id}>
                                    <td data-label="Producto" className="cell-name">
                                        <span className="cell-name-title">{recipe.product?.name || `#${recipe.productId}`}</span>
                                        {recipe.product?.sku && (
                                            <span className="cell-name-sku">{recipe.product.sku}</span>
                                        )}
                                    </td>
                                    <td data-label="Receta">
                                        {recipe.name || <span className="text-muted">—</span>}
                                    </td>
                                    <td data-label="Versión">
                                        <span className="pr-version">v{recipe.version}</span>
                                    </td>
                                    <td data-label="Estado">{getStatusBadge(recipe.status)}</td>
                                    <td data-label="# Componentes" className="text-right">
                                        {recipe.components?.length ?? 0}
                                    </td>
                                    <td data-label="Rendimiento" className="text-right">
                                        {Number(recipe.yieldQuantity).toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                                        {displayedYieldUnit(recipe)}
                                    </td>
                                    <td data-label="Costo unitario estimado" className="text-right">
                                        {recipe.cost
                                            ? formatMoney(Number(recipe.cost.unitCost) || 0)
                                            : <span className="text-danger" title={recipe.costError || undefined}>Revisar UOM</span>}
                                    </td>
                                    <td data-label="Costo lote" className="text-right">
                                        {recipe.cost
                                            ? formatMoney(Number(recipe.cost.batchCost) || 0)
                                            : <span className="text-danger" title={recipe.costError || undefined}>Revisar UOM</span>}
                                    </td>
                                    <td data-label="Acciones" className="text-right">
                                        <div className="table-actions">
                                            <button
                                                type="button"
                                                className="table-action-btn"
                                                onClick={() => handleView(recipe)}
                                                title="Ver detalle"
                                                aria-label={`Ver detalle de ${recipe.product?.name || recipe.name}`}
                                            >
                                                <Eye size={16} />
                                            </button>
                                            {canManage && recipe.status === 'DRAFT' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={() => handleOpenEdit(recipe)}
                                                    title="Editar"
                                                >
                                                    <Pencil size={16} />
                                                </button>
                                            )}
                                            {canManage && recipe.status !== 'ACTIVE' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn success"
                                                    onClick={() => handleSetStatus(recipe, 'ACTIVE')}
                                                    title="Activar"
                                                >
                                                    <Power size={16} />
                                                </button>
                                            )}
                                            {canManage && recipe.status === 'ACTIVE' && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={() => handleSetStatus(recipe, 'INACTIVE')}
                                                    title="Desactivar"
                                                >
                                                    <Power size={16} />
                                                </button>
                                            )}
                                            {canManage && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn"
                                                    onClick={() => handleCreateVersion(recipe)}
                                                    title="Nueva versión"
                                                >
                                                    <Copy size={16} />
                                                </button>
                                            )}
                                            {canDelete && (
                                                <button
                                                    type="button"
                                                    className="table-action-btn danger"
                                                    onClick={() => handleDelete(recipe)}
                                                    title="Eliminar"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredRecipes.length === 0 && (
                                <tr>
                                    <td colSpan={9}>
                                        <div className="empty-state">
                                            <FlaskConical size={48} />
                                            <p>
                                                {recipes.length === 0
                                                    ? 'Aún no hay recetas de producción. Crea la primera para empezar.'
                                                    : 'No se encontraron recetas con los filtros seleccionados.'}
                                            </p>
                                            {canManage && recipes.length === 0 && (
                                                <Button onClick={handleOpenCreate}>
                                                    <Plus size={18} />
                                                    Nueva Receta
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <Pagination
                        page={currentPage}
                        totalPages={totalPages}
                        totalItems={filteredRecipes.length}
                        pageSize={itemsPerPage}
                        onPageChange={setCurrentPage}
                    />
                </div>
            </Card>

            <Sidebar
                isOpen={!!viewingRecipe}
                onClose={() => setViewingRecipe(null)}
                title="Detalle de la Receta"
                width="large"
                footer={viewingRecipe ? (
                    <div className="inventory-detail-footer">
                        <Button type="button" variant="ghost" onClick={() => setViewingRecipe(null)}>
                            Cerrar
                        </Button>
                        {canManage && viewingRecipe.status === 'DRAFT' && (
                            <div className="inventory-detail-footer-actions">
                                <Button type="button" onClick={() => { const recipe = viewingRecipe; setViewingRecipe(null); handleOpenEdit(recipe); }}>
                                    <Pencil size={16} /> Editar receta
                                </Button>
                            </div>
                        )}
                    </div>
                ) : undefined}
            >
                {viewingRecipe && (() => {
                    const outputProduct = productById.get(viewingRecipe.productId);
                    const outputName = viewingRecipe.product?.name || outputProduct?.name || `Producto #${viewingRecipe.productId}`;
                    const outputSku = viewingRecipe.product?.sku || outputProduct?.sku;
                    const outputType = outputProduct?.type || viewingRecipe.product?.type;
                    const yieldUnit = displayedYieldUnit(viewingRecipe);
                    const statusLabel = viewingRecipe.status === 'ACTIVE' ? 'Activa' : viewingRecipe.status === 'DRAFT' ? 'Borrador' : 'Inactiva';
                    const batchCost = viewingRecipe.cost ? Number(viewingRecipe.cost.batchCost) || 0 : null;
                    const unitCost = viewingRecipe.cost ? Number(viewingRecipe.cost.unitCost) || 0 : null;

                    if (detailLoading) return <div className="inventory-loading">Cargando detalle...</div>;

                    return (
                        <div className="inventory-detail pr-recipe-detail" data-testid="production-recipe-detail">
                            <div className="inventory-detail-hero">
                                <div className="inventory-detail-hero-main">
                                    <div className="inventory-detail-icon" aria-hidden="true"><FlaskConical size={28} /></div>
                                    <div className="inventory-detail-identity">
                                        <span className="inventory-detail-eyebrow">Ficha de producción</span>
                                        <h3>{outputName}</h3>
                                        <div className="inventory-detail-meta">
                                            {outputSku && <span className="inventory-detail-badge sku">SKU {outputSku}</span>}
                                            <div className="inventory-detail-status-row">
                                                <span className={`inventory-detail-badge ${viewingRecipe.status === 'ACTIVE' ? 'active' : viewingRecipe.status === 'DRAFT' ? 'warning' : 'inactive'}`}>{statusLabel}</span>
                                                <span className="inventory-detail-badge ok">Versión {viewingRecipe.version}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="inventory-detail-stock-summary pr-recipe-yield-summary">
                                    <span>Rendimiento del lote</span>
                                    <strong>{Number(viewingRecipe.yieldQuantity).toLocaleString('es-NI', { maximumFractionDigits: 6 })}<small>{yieldUnit}</small></strong>
                                    <div className="inventory-detail-stock-track" aria-hidden="true"><span style={{ width: '100%' }} /></div>
                                    <small>{viewingRecipe.components.length} componentes definidos</small>
                                </div>
                            </div>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header"><Box size={18} /><h3>Perfil de la receta</h3></div>
                                <div className="inventory-detail-profile-grid">
                                    <div className="inventory-detail-profile-item"><Package size={18} /><div><span>Producto de salida</span><strong>{outputName}</strong></div></div>
                                    <div className="inventory-detail-profile-item"><Layers size={18} /><div><span>Tipo de producto</span><strong>{outputType ? TYPE_LABELS[outputType] : 'Sin clasificar'}</strong></div></div>
                                    <div className="inventory-detail-profile-item"><Scale size={18} /><div><span>Rendimiento</span><strong>{Number(viewingRecipe.yieldQuantity).toLocaleString('es-NI', { maximumFractionDigits: 6 })} {yieldUnit}</strong></div></div>
                                    <div className="inventory-detail-profile-item"><Info size={18} /><div><span>Nombre de receta</span><strong>{viewingRecipe.name || 'Sin nombre adicional'}</strong></div></div>
                                </div>
                            </section>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header"><DollarSign size={18} /><h3>Costos de producción</h3></div>
                                <div className="inventory-detail-finance">
                                    <div className="inventory-detail-effective-cost">
                                        <div><span>Costo total del lote</span><strong>{batchCost === null ? 'No disponible' : formatMoney(batchCost)}</strong></div>
                                        <span className="inventory-detail-cost-source">Costo calculado</span>
                                    </div>
                                    <dl className="inventory-detail-finance-breakdown">
                                        <div><dt>Costo unitario</dt><dd>{unitCost === null ? 'No disponible' : formatMoney(unitCost)}</dd></div>
                                        <div><dt>Base calculada</dt><dd>{viewingRecipe.cost ? `${Number(viewingRecipe.cost.yieldBaseQuantity).toLocaleString('es-NI', { maximumFractionDigits: 6 })} ${viewingRecipe.cost.yieldBaseUnit}` : 'No disponible'}</dd></div>
                                        <div><dt>Componentes</dt><dd>{viewingRecipe.components.length}</dd></div>
                                    </dl>
                                    <p className="inventory-detail-finance-note">{viewingRecipe.costError || 'El costo se calcula con las cantidades y el costo efectivo vigente de cada componente.'}</p>
                                </div>
                            </section>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header"><Layers size={18} /><h3>Componentes de la preparación</h3></div>
                                <div className="pr-detail-component-list">
                                    {viewingRecipe.components.map((component, index) => {
                                        const costLine = viewingRecipe.cost?.lines.find((line) => line.componentProductId === component.componentProductId);
                                        const unit = component.unit || costLine?.unit || component.componentProduct?.unit || '';
                                        return (
                                            <article key={component.id ?? component.componentProductId} className="pr-detail-component">
                                                <span className="pr-detail-component-index">{index + 1}</span>
                                                <div className="pr-detail-component-identity"><strong>{component.componentProduct?.name || `Producto #${component.componentProductId}`}</strong><span>{component.componentProduct?.sku ? `SKU ${component.componentProduct.sku}` : 'Sin SKU registrado'}</span></div>
                                                <div className="pr-detail-component-quantity"><span>Cantidad</span><strong>{Number(component.quantity).toLocaleString('es-NI', { maximumFractionDigits: 6 })} {unit}</strong></div>
                                                <div className="pr-detail-component-cost"><span>Costo</span><strong>{costLine ? formatMoney(Number(costLine.totalCost) || 0) : '—'}</strong></div>
                                            </article>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className="inventory-detail-section inventory-detail-operational-note">
                                <Activity size={18} aria-hidden="true" />
                                <div><strong>Trazabilidad de producción</strong><p>Creada por {viewingRecipe.createdBy?.name || 'usuario no disponible'} el {new Date(viewingRecipe.createdAt).toLocaleString('es-NI')}. Última actualización: {new Date(viewingRecipe.updatedAt).toLocaleString('es-NI')}.</p></div>
                            </section>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header"><FileText size={18} /><h3>Indicaciones y observaciones</h3></div>
                                <p className="inventory-detail-observation">{viewingRecipe.notes || 'Esta receta no tiene indicaciones adicionales.'}</p>
                            </section>
                        </div>
                    );
                })()}
            </Sidebar>

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={handleCloseSidebar}
                title={editingRecipe ? `Editar Receta · ${editingRecipe.product?.name ?? ''}` : 'Nueva Receta de Producción'}
                width="large"
            >
                <div className="premium-modal-content production-recipe-modal-content">
                    <div className="modal-tabs" role="tablist" aria-label="Secciones de la receta">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeFormTab === 'recipe'}
                            className={`modal-tab ${activeFormTab === 'recipe' ? 'active' : ''}`}
                            onClick={() => setActiveFormTab('recipe')}
                        >
                            <FlaskConical size={18} />
                            <span>Receta</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeFormTab === 'components'}
                            className={`modal-tab ${activeFormTab === 'components' ? 'active' : ''}`}
                            onClick={() => setActiveFormTab('components')}
                        >
                            <Layers size={18} />
                            <span>Componentes</span>
                            <span className="pr-tab-count" aria-label={`${rows.length} componentes`}>{rows.length}</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeFormTab === 'cost'}
                            className={`modal-tab ${activeFormTab === 'cost' ? 'active' : ''}`}
                            onClick={() => setActiveFormTab('cost')}
                        >
                            <Calculator size={18} />
                            <span>Costo</span>
                        </button>
                    </div>
                    <div className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeFormTab === 'recipe' && <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Info size={18} />
                                    <h3>Datos de la receta</h3>
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label">Producto que genera la receta *</label>
                                    <Select
                                        variant="modal"
                                        options={productOptions}
                                        value={productOptions.find((o) => o.value === productId) ?? null}
                                        onChange={(opt: SingleValue<StrOption>) => handleProductChange(opt?.value ?? '')}
                                        placeholder="Selecciona un intermedio o producto terminado..."
                                        isClearable
                                        isDisabled={!!editingRecipe}
                                    />
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="pr-name">Nombre de la receta</label>
                                    <Input
                                        id="pr-name"
                                        variant="modal"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder={selectedProduct ? `Receta de ${selectedProduct.name}` : 'Receta de ...'}
                                    />
                                </div>

                                <div className="modal-form-row">
                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="pr-yield">Rendimiento por lote *</label>
                                        <Input
                                            id="pr-yield"
                                            variant="modal"
                                            type="number"
                                            min="0"
                                            step="0.0001"
                                            value={yieldQuantity}
                                            onChange={(e) => setYieldQuantity(e.target.value)}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Unidad de rendimiento</label>
                                        <Select
                                            variant="modal"
                                            options={unitOptions}
                                            value={unitOptions.find((o) => o.value === yieldUnitId) ?? null}
                                            onChange={(opt: SingleValue<StrOption>) => setYieldUnitId(opt?.value ?? '')}
                                            placeholder="Unidad..."
                                            isClearable
                                        />
                                    </div>
                                </div>
                                <p className="pr-helper-text">Cantidad que produce una corrida de esta receta.</p>
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="pr-notes">Notas de producción</label>
                                    <textarea
                                        id="pr-notes"
                                        className="modal-textarea"
                                        rows={4}
                                        value={notes}
                                        onChange={(event) => setNotes(event.target.value)}
                                        placeholder="Preparación, controles o indicaciones para el lote..."
                                    />
                                    <span className="pr-helper-text">Información operativa que acompañará la receta.</span>
                                </div>
                            </div>}

                            {activeFormTab === 'components' && <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Layers size={18} />
                                    <h3>Componentes</h3>
                                </div>

                                <div className="pr-components">
                                    <div className="pr-component-head">
                                        <span>Producto</span>
                                        <span>Cantidad</span>
                                        <span>Unidad</span>
                                        <span className="pr-col-cost">Costo est.</span>
                                        <span aria-hidden="true" />
                                    </div>
                                    {rows.map((row) => (
                                        <div key={row.key} className="pr-component-row">
                                            <div className="pr-col-product">
                                                <Select
                                                    variant="modal"
                                                    options={componentOptions}
                                                    value={componentOptions.find((o) => o.value === row.componentProductId) ?? null}
                                                    onChange={(opt: SingleValue<StrOption>) => updateRow(row.key, { componentProductId: opt?.value ?? '' })}
                                                    placeholder="Componente..."
                                                    isClearable
                                                />
                                            </div>
                                            <div className="pr-col-qty">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.0001"
                                                    className="modal-standard-input"
                                                    placeholder="Cant"
                                                    value={row.quantity}
                                                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                                                />
                                            </div>
                                            <div className="pr-col-unit">
                                                <Select
                                                    variant="modal"
                                                    options={unitOptions}
                                                    value={unitOptions.find((o) => o.value === row.unitId) ?? null}
                                                    onChange={(opt: SingleValue<StrOption>) => updateRow(row.key, { unitId: opt?.value ?? '' })}
                                                    placeholder="Base"
                                                    isClearable
                                                />
                                            </div>
                                            <div className="pr-col-cost">
                                                {formatMoney(estimatedRowCost(row))}
                                            </div>
                                            <div className="pr-col-remove">
                                                <button
                                                    type="button"
                                                    className="pr-remove-btn"
                                                    onClick={() => removeRow(row.key)}
                                                    title="Quitar componente"
                                                    aria-label="Quitar componente"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <Button type="button" variant="secondary" onClick={addRow} className="pr-add-component">
                                    <Plus size={16} />
                                    Agregar componente
                                </Button>
                            </div>}

                            {activeFormTab === 'cost' && <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Info size={18} />
                                    <h3>Costo estimado</h3>
                                </div>

                                {previewCost ? (
                                    <div className="pr-cost-panel">
                                        <div className="pr-cost-lines">
                                            {previewCost.lines.map((line) => (
                                                <div key={line.componentProductId} className="pr-cost-line">
                                                    <span className="pr-cost-line-name">{line.componentName}</span>
                                                    <span className="pr-cost-line-qty">
                                                        {line.quantity} {line.unit}
                                                    </span>
                                                    <span className="pr-cost-line-total">{formatMoney(Number(line.totalCost) || 0)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="pr-cost-totals">
                                            <div className="pr-cost-total-row">
                                                <span>Costo del lote</span>
                                                <strong>{formatMoney(Number(previewCost.batchCost) || 0)}</strong>
                                            </div>
                                            <div className="pr-cost-total-row highlight">
                                                <span>
                                                    Costo unitario
                                                    {previewCost.yieldBaseUnit ? ` (por ${previewCost.yieldBaseUnit})` : ''}
                                                </span>
                                                <strong>{formatMoney(Number(previewCost.unitCost) || 0)}</strong>
                                            </div>
                                        </div>
                                    </div>
                                ) : previewCostError ? (
                                    <div className="pr-cost-panel">
                                        <p className="text-danger">{previewCostError}</p>
                                        <p className="pr-helper-text">Corrige la unidad o su factor antes de guardar.</p>
                                    </div>
                                ) : (
                                    <div className="pr-cost-panel">
                                        <div className="pr-cost-total-row highlight">
                                            <span>Costo estimado</span>
                                            <strong>{previewCostLoading ? 'Calculando…' : '—'}</strong>
                                        </div>
                                        <p className="pr-helper-text">
                                            Cálculo autoritativo con conversión a unidad base y costo operativo vigente.
                                        </p>
                                    </div>
                                )}
                            </div>}

                            {activeFormTab === 'cost' && !editingRecipe && (
                                <div className="modal-section animate-slide-in">
                                    <label className="pr-activate-toggle">
                                        <input
                                            type="checkbox"
                                            checked={activateOnSave}
                                            onChange={(e) => setActivateOnSave(e.target.checked)}
                                        />
                                        <span>Activar al guardar</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={handleCloseSidebar}>
                                Cancelar
                            </Button>
                            <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
                                <Save size={18} />
                                {saving ? 'Guardando...' : 'Guardar'}
                            </Button>
                        </div>
                    </div>
                </div>
            </Sidebar>
        </div>
    );
}
