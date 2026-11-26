import { useState, useEffect, useMemo } from 'react';
import { productionRecipesAPI, productsAPI, unitsAPI } from '../services/api';
import {
    AppSelect, Badge, Button, Checkbox, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, SegmentedControl, Skeleton, StatCard, TableToolbar, Textarea, formatNumber, formatPercent,
    type Column, type Opt, type Tone, LoadErrorState,
} from '@/ui';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { useCurrency } from '../hooks/useCurrency';
import { getUserRoleNames } from '../utils/authz';
import { FlaskConical, Plus, Pencil, Power, Copy, Trash2, Save, Eye, X } from 'lucide-react';

/** Columnas de la lista cuando el detalle ocupa el panel derecho (maestro-detalle). */
const MASTER_KEYS = ['product', 'version', 'status', 'unitCost'];
import type { ProductionRecipe, Product, UnitOfMeasure, RecipeCost } from '../types';
import {
    COST_VARIATION_ALERT_PCT, costVariation, ingredientWeights, previousVersion, usedIn,
    type CostVariation,
} from './recipeInsights';
import s from './Production.module.css';
import './ProductionRecipes.css';
import { getApiErrorMessage } from '../utils/apiError';

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
    const { formatMoney, symbol } = useCurrency();

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
    const [focus, setFocus] = useState<'all' | 'rising' | 'nocost'>('all');
    const [loadError, setLoadError] = useState<string | null>(null);

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
        setLoading(true);
        setLoadError(null);
        try {
            const [recipesRes, productsRes, unitsRes] = await Promise.all([
                productionRecipesAPI.getAll(),
                productsAPI.getAll({ limit: 1000, active: true }),
                unitsAPI.getAll(),
            ]);
            setRecipes(Array.isArray(recipesRes.data.data) ? recipesRes.data.data : []);
            setProducts(Array.isArray(productsRes.data.data) ? productsRes.data.data : []);
            setUnits(Array.isArray(unitsRes.data.data) ? unitsRes.data.data : []);
            setLoadError(null);
        } catch (error) {
            console.error('Error loading production recipes:', error);
            setRecipes([]);
            setLoadError(errMsg(error, 'No se pudieron cargar las recetas, productos o unidades.') + ' Las recetas no disponibles no se muestran ni entran en ningún total.');
        } finally {
            setLoading(false);
        }
    };

    const loadRecipes = async () => {
        try {
            const res = await productionRecipesAPI.getAll();
            setRecipes(Array.isArray(res.data.data) ? res.data.data : []);
            setLoadError(null);
        } catch (error) {
            console.error('Error reloading production recipes:', error);
            setLoadError(getApiErrorMessage(error, 'No se pudo actualizar el listado de recetas (se conserva la última información disponible)'));
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

    const productOptions: Opt<string>[] = useMemo(
        () => producibleProducts.map((p) => ({
            value: String(p.id),
            label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${TYPE_LABELS[p.type]}`,
        })),
        [producibleProducts]
    );

    const componentOptions: Opt<string>[] = useMemo(
        () => products
            .filter((p) => String(p.id) !== productId)
            .map((p) => ({
                value: String(p.id),
                label: `${p.name}${p.sku ? ` (${p.sku})` : ''} — ${TYPE_LABELS[p.type]}`,
            })),
        [products, productId]
    );

    const unitOptions: Opt<string>[] = useMemo(
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

    /** null = sin cálculo disponible (se muestra N/D, nunca 0). */
    const estimatedRowCost = (row: ComponentRow): number | null => {
        const line = previewCost?.lines.find(candidate => candidate.componentProductId === Number(row.componentProductId));
        return line ? Number(line.totalCost) : null;
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

    const STATUS_TONE_BY_RECIPE: Record<ProductionRecipe['status'], { tone: Tone; label: string }> = {
        DRAFT: { tone: 'warning', label: 'Borrador' },
        ACTIVE: { tone: 'success', label: 'Activa' },
        INACTIVE: { tone: 'neutral', label: 'Inactiva' },
    };

    /** Variación contra la versión anterior de cada receta (null = no calculable o sin versión previa). */
    const variationById = new Map<number, CostVariation | null>(
        recipes.map((recipe) => [recipe.id, costVariation(recipe, previousVersion(recipe, recipes))])
    );
    const isRising = (recipe: ProductionRecipe) => {
        const v = variationById.get(recipe.id);
        return recipe.status === 'ACTIVE' && !!v && v.deltaPct >= COST_VARIATION_ALERT_PCT;
    };
    const hasNoCost = (recipe: ProductionRecipe) => recipe.status !== 'INACTIVE' && !recipe.cost;

    const filteredRecipes = recipes.filter((recipe) => {
        const matchesStatus = statusFilter === 'all' || recipe.status === statusFilter;
        const matchesFocus = focus === 'all' || (focus === 'rising' ? isRising(recipe) : hasNoCost(recipe));
        const q = searchQuery.trim().toLowerCase();
        if (!q) return matchesStatus && matchesFocus;
        const matchesSearch =
            (recipe.product?.name || '').toLowerCase().includes(q) ||
            (recipe.product?.sku || '').toLowerCase().includes(q) ||
            (recipe.name || '').toLowerCase().includes(q);
        return matchesStatus && matchesFocus && matchesSearch;
    });

    const risingCount = recipes.filter(isRising).length;
    const noCostCount = recipes.filter(hasNoCost).length;
    const countBy = (status: ProductionRecipe['status']) => recipes.filter((r) => r.status === status).length;

    const selectedProduct = productId ? productById.get(Number(productId)) : undefined;

    if (loading) {
        return (
            <PageContent>
                <PageHeader title="Recetas de producción" description="Cargando recetas…" />
                <Skeleton height={240} />
            </PageContent>
        );
    }

    const statusFilters: Array<{ value: typeof statusFilter; label: string }> = [
        { value: 'all', label: `Todas (${recipes.length})` },
        { value: 'ACTIVE', label: `Activas (${countBy('ACTIVE')})` },
        { value: 'DRAFT', label: `Borradores (${countBy('DRAFT')})` },
        { value: 'INACTIVE', label: `Inactivas (${countBy('INACTIVE')})` },
    ];

    const columns: Column<ProductionRecipe>[] = [
        {
            key: 'product',
            header: 'Producto',
            width: '2fr',
            render: (recipe) => (
                <div className={s.cellStack}>
                    <span className={s.cellTitle}>{recipe.product?.name || `#${recipe.productId}`}</span>
                    {(recipe.name || recipe.product?.sku) && (
                        <span className={s.cellSub}>{[recipe.name, recipe.product?.sku].filter(Boolean).join(' · ')}</span>
                    )}
                </div>
            ),
        },
        { key: 'version', header: 'Versión', width: '0.7fr', render: (recipe) => `v${recipe.version}` },
        {
            key: 'status',
            header: 'Estado',
            width: '1fr',
            type: 'status',
            render: (recipe) => <Badge tone={STATUS_TONE_BY_RECIPE[recipe.status].tone}>{STATUS_TONE_BY_RECIPE[recipe.status].label}</Badge>,
        },
        { key: 'components', header: '# Componentes', type: 'number', width: '0.9fr', hideBelow: 'lg', accessor: (recipe) => recipe.components?.length ?? 0, decimals: 0 },
        {
            key: 'yield',
            header: 'Rendimiento',
            type: 'number',
            width: '1.2fr',
            hideBelow: 'md',
            render: (recipe) => `${formatNumber(recipe.yieldQuantity, 2)} ${displayedYieldUnit(recipe)}`,
        },
        {
            key: 'unitCost',
            header: `Costo unitario (${symbol})`,
            type: 'money',
            width: '1.1fr',
            render: (recipe) => recipe.cost
                ? formatNumber(recipe.cost.unitCost)
                : <span className={s.bad} title={recipe.costError || undefined}>Revisar UOM</span>,
        },
        {
            key: 'variation',
            header: 'Vs. versión anterior',
            type: 'percent',
            width: '1.1fr',
            hideBelow: 'lg',
            render: (recipe) => {
                const v = variationById.get(recipe.id);
                if (!v) return <span className={s.nd} title="Sin versión anterior o sin costo calculable">N/D</span>;
                const sign = v.deltaPct > 0 ? '+' : '';
                return <span className={v.deltaPct >= COST_VARIATION_ALERT_PCT ? s.bad : undefined}>{sign}{formatPercent(v.deltaPct)}</span>;
            },
        },
        {
            key: 'batchCost',
            header: `Costo lote (${symbol})`,
            type: 'money',
            width: '1.1fr',
            hideBelow: 'md',
            render: (recipe) => recipe.cost
                ? formatNumber(recipe.cost.batchCost)
                : <span className={s.bad} title={recipe.costError || undefined}>Revisar UOM</span>,
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '11rem',
            render: (recipe) => (
                <div className={s.rowActions}>
                    <IconButton icon={Eye} size="sm" label={`Ver detalle de ${recipe.product?.name || recipe.name}`} onClick={() => void handleView(recipe)} />
                    {canManage && recipe.status === 'DRAFT' && (
                        <IconButton icon={Pencil} size="sm" label="Editar" onClick={() => handleOpenEdit(recipe)} />
                    )}
                    {canManage && recipe.status !== 'ACTIVE' && (
                        <IconButton icon={Power} size="sm" label="Activar" onClick={() => void handleSetStatus(recipe, 'ACTIVE')} />
                    )}
                    {canManage && recipe.status === 'ACTIVE' && (
                        <IconButton icon={Power} size="sm" label="Desactivar" onClick={() => void handleSetStatus(recipe, 'INACTIVE')} />
                    )}
                    {canManage && <IconButton icon={Copy} size="sm" label="Nueva versión" onClick={() => void handleCreateVersion(recipe)} />}
                    {canDelete && <IconButton icon={Trash2} size="sm" label="Eliminar" onClick={() => void handleDelete(recipe)} />}
                </div>
            ),
        },
    ];

    const detail = viewingRecipe && (() => {
        const outputProduct = productById.get(viewingRecipe.productId);
        const outputName = viewingRecipe.product?.name || outputProduct?.name || `Producto #${viewingRecipe.productId}`;
        const outputSku = viewingRecipe.product?.sku || outputProduct?.sku;
        const outputType = outputProduct?.type || viewingRecipe.product?.type;
        const yieldUnit = displayedYieldUnit(viewingRecipe);
        const statusLabel = viewingRecipe.status === 'ACTIVE' ? 'Activa' : viewingRecipe.status === 'DRAFT' ? 'Borrador' : 'Inactiva';
        const unitCost = viewingRecipe.cost ? Number(viewingRecipe.cost.unitCost) : null;
        const previous = previousVersion(viewingRecipe, recipes);
        const variation = costVariation(viewingRecipe, previous);
        const weights = new Map(ingredientWeights(viewingRecipe).map((w) => [w.componentProductId, w.pct]));
        const parents = usedIn(viewingRecipe, recipes);

        if (detailLoading) return <Skeleton height={240} />;

        const componentRows = viewingRecipe.components.map((component, index) => {
            const costLine = viewingRecipe.cost?.lines.find((line) => line.componentProductId === component.componentProductId);
            return {
                key: component.id ?? `${component.componentProductId}-${index}`,
                name: component.componentProduct?.name || `Producto #${component.componentProductId}`,
                sku: component.componentProduct?.sku,
                quantity: Number(component.quantity),
                unit: component.unit || costLine?.unit || component.componentProduct?.unit || '',
                unitCost: costLine ? Number(costLine.unitCost) : null,
                totalCost: costLine ? Number(costLine.totalCost) : null,
                weight: weights.get(component.componentProductId),
            };
        });
        type ComponentRow = (typeof componentRows)[number];

        return (
            <div className={s.recipeDetail} data-testid="production-recipe-detail">
                <header className={s.recipeHead}>
                    <div className={s.cellStack}>
                        <h2 className={s.recipeTitle}>{outputName}</h2>
                        <div className={s.recipeMeta}>
                            <Badge tone={STATUS_TONE_BY_RECIPE[viewingRecipe.status].tone} dot>{statusLabel} · v{viewingRecipe.version}</Badge>
                            {outputSku && <span className={s.cellSub}>SKU {outputSku}</span>}
                            {viewingRecipe.name && <span className={s.cellSub}>{viewingRecipe.name}</span>}
                        </div>
                    </div>
                    <div className={s.rowActions}>
                        {canManage && <Button size="sm" icon={Copy} onClick={() => void handleCreateVersion(viewingRecipe)}>Nueva versión</Button>}
                        {canManage && viewingRecipe.status === 'DRAFT' && (
                            <Button size="sm" variant="primary" icon={Pencil} onClick={() => { const recipe = viewingRecipe; setViewingRecipe(null); handleOpenEdit(recipe); }}>
                                Editar receta
                            </Button>
                        )}
                        <IconButton icon={X} size="sm" label="Cerrar detalle" onClick={() => setViewingRecipe(null)} />
                    </div>
                </header>

                {variation && Math.abs(variation.deltaPct) >= 0.005 && (
                    <div className={`${s.variation} ${variation.deltaPct >= COST_VARIATION_ALERT_PCT ? s.variationUp : ''}`} role="status">
                        <strong>
                            El costo unitario {variation.deltaPct > 0 ? 'subió' : 'bajó'} {formatPercent(Math.abs(variation.deltaPct))} frente a la v{previous?.version}
                        </strong>
                        <span>
                            De {formatMoney(variation.previousUnitCost)} a {formatMoney(variation.unitCost)}.
                            {variation.cause ? ` Insumo causante: ${variation.cause.name} (${variation.cause.deltaUnitCost > 0 ? '+' : '-'}${formatMoney(Math.abs(variation.cause.deltaUnitCost))} por unidad).` : ''}
                        </span>
                    </div>
                )}

                <dl className={s.facts}>
                    <div><dt>Rendimiento del lote</dt><dd>{formatNumber(viewingRecipe.yieldQuantity, 2)} {yieldUnit}</dd></div>
                    <div><dt>Costo del lote</dt><dd>{viewingRecipe.cost ? formatMoney(viewingRecipe.cost.batchCost) : 'N/D'}</dd></div>
                    <div><dt>Costo unitario</dt><dd>{unitCost === null ? 'N/D' : formatMoney(unitCost)}</dd></div>
                    <div><dt>Tipo de producto</dt><dd>{outputType ? TYPE_LABELS[outputType] : 'Sin clasificar'}</dd></div>
                </dl>
                {viewingRecipe.costError && <p className={s.cellSub} role="alert">{viewingRecipe.costError}</p>}

                <section aria-label="Componentes de la preparación" className={s.recipeSection}>
                    <h3 className={s.recipeSectionTitle}>
                        Componentes de la preparación
                        <span className={s.cellSub}>Costos al promedio ponderado vigente</span>
                    </h3>
                    <DataTable<ComponentRow>
                        ariaLabel="Componentes de la receta"
                        rows={componentRows}
                        rowKey={(row) => row.key}
                        minWidth="36rem"
                        footerLabel="Costo total del lote"
                        empty="La receta no tiene componentes."
                        columns={[
                            {
                                key: 'name',
                                header: 'Insumo',
                                width: '2fr',
                                render: (row) => (
                                    <div className={s.cellStack}>
                                        <span className={s.cellTitle}>{row.name}</span>
                                        {row.sku && <span className={s.cellSub}>{row.sku}</span>}
                                    </div>
                                ),
                            },
                            { key: 'quantity', header: 'Cantidad', type: 'qty', width: '1fr', accessor: (row) => row.quantity },
                            { key: 'unit', header: 'Unidad', width: '0.7fr' },
                            {
                                key: 'unitCost', header: `Costo unit. (${symbol})`, type: 'money', width: '1fr',
                                render: (row) => (row.unitCost === null ? 'N/D' : formatNumber(row.unitCost, row.unitCost !== 0 && Math.abs(row.unitCost) < 1 ? 4 : 2)),
                            },
                            {
                                key: 'totalCost', header: `Costo (${symbol})`, type: 'money', width: '1fr', total: true,
                                accessor: (row) => row.totalCost ?? 0,
                                render: (row) => (row.totalCost === null ? 'N/D' : formatNumber(row.totalCost)),
                            },
                            {
                                key: 'weight', header: 'Peso en costo', type: 'percent', width: '1fr',
                                render: (row) => (row.weight === undefined ? 'N/D' : formatPercent(row.weight)),
                            },
                        ]}
                    />
                </section>

                <section aria-label="Se usa en" className={s.recipeSection}>
                    <h3 className={s.recipeSectionTitle}>Se usa en</h3>
                    {parents.length > 0 ? (
                        <ul className={s.usedIn}>
                            {parents.map((parent) => (
                                <li key={parent.id}>
                                    <button type="button" className={s.linkButton} onClick={() => void handleView(parent)}>
                                        {parent.product?.name || `Producto #${parent.productId}`} · v{parent.version}
                                    </button>
                                    <Badge tone={STATUS_TONE_BY_RECIPE[parent.status].tone}>{STATUS_TONE_BY_RECIPE[parent.status].label}</Badge>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className={s.cellSub}>Ninguna receta vigente usa este producto como componente.</p>
                    )}
                </section>

                <section aria-label="Indicaciones y observaciones" className={s.recipeSection}>
                    <h3 className={s.recipeSectionTitle}>Indicaciones y observaciones</h3>
                    <p className={s.cellSub}>{viewingRecipe.notes || 'Esta receta no tiene indicaciones adicionales.'}</p>
                    <p className={s.cellSub}>
                        Creada por {viewingRecipe.createdBy?.name || 'usuario no disponible'} el {new Date(viewingRecipe.createdAt).toLocaleString('es-NI')}.
                        {' '}Última actualización: {new Date(viewingRecipe.updatedAt).toLocaleString('es-NI')}.
                    </p>
                </section>
            </div>
        );
    })();

    return (
        <PageContent>
            <PageHeader
                title="Recetas de producción"
                description="Define recetas multinivel para productos intermedios y terminados"
                actions={<Button variant="primary" icon={Plus} onClick={handleOpenCreate} disabled={!canManage}>Nueva receta</Button>}
            />

            {loadError && <LoadErrorState message={loadError} onRetry={() => { void loadAll(); }} />}

            {(risingCount > 0 || noCostCount > 0) && (
                <div className={s.stats}>
                    {risingCount > 0 && (
                        <StatCard
                            label="Recetas activas con costo al alza"
                            value={formatNumber(risingCount, 0)}
                            context={`El costo unitario subió ${formatNumber(COST_VARIATION_ALERT_PCT, 0)} % o más frente a la versión anterior; revisa el insumo causante.`}
                            tone="warning"
                            action={{ label: 'Ver recetas', onClick: () => setFocus('rising') }}
                        />
                    )}
                    {noCostCount > 0 && (
                        <StatCard
                            label="Recetas sin costo calculable"
                            value={formatNumber(noCostCount, 0)}
                            context="Una unidad o un factor de conversión impide calcular el costo; no entran en ningún total."
                            tone="danger"
                            action={{ label: 'Ver recetas', onClick: () => setFocus('nocost') }}
                        />
                    )}
                </div>
            )}

            <TableToolbar
                actions={focus !== 'all' ? <Button size="sm" onClick={() => setFocus('all')}>Quitar filtro</Button> : undefined}
            >
                <SegmentedControl ariaLabel="Filtrar por estado" size="sm" value={statusFilter} onChange={setStatusFilter} options={statusFilters} />
                <div className={s.search}>
                    <Input
                        type="search"
                        aria-label="Buscar receta"
                        placeholder="Buscar por producto, SKU o receta..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </TableToolbar>

            {/* Sin receta seleccionada la tabla usa todo el ancho; el panel aparece al elegir una fila. */}
            <div className={detail ? s.masterDetail : undefined}>
                <div className={s.master}>
                    <DataTable<ProductionRecipe>
                        ariaLabel="Recetas de producción"
                        columns={detail ? columns.filter((c) => MASTER_KEYS.includes(c.key)) : columns}
                        rows={filteredRecipes}
                        rowKey={(recipe) => recipe.id}
                        resetKey={`${statusFilter}-${focus}-${searchQuery}`}
                        minWidth={detail ? '0' : '64rem'}
                        rowTone={(recipe) => (recipe.id === viewingRecipe?.id ? 'primary' : undefined)}
                        onRowClick={(recipe) => void handleView(recipe)}
                        empty={
                            <EmptyState
                                icon={FlaskConical}
                                title={recipes.length === 0 ? 'Aún no hay recetas de producción' : 'No se encontraron recetas con los filtros seleccionados'}
                                description={recipes.length === 0 ? 'Crea la primera para empezar.' : undefined}
                                action={canManage && recipes.length === 0 ? <Button variant="primary" icon={Plus} onClick={handleOpenCreate}>Nueva receta</Button> : undefined}
                            />
                        }
                    />
                </div>
                {detail && (
                    <aside className={s.detail} aria-label="Detalle de la receta">
                        {detail}
                    </aside>
                )}
            </div>

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={handleCloseSidebar}
                title={editingRecipe ? `Editar receta · ${editingRecipe.product?.name ?? ''}` : 'Nueva receta de producción'}
                tabs={[
                    { id: 'recipe', label: 'Receta' },
                    { id: 'components', label: 'Componentes', badge: rows.length },
                    { id: 'cost', label: 'Costo' },
                ]}
                activeTab={activeFormTab}
                onTabChange={(id) => setActiveFormTab(id as typeof activeFormTab)}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" icon={Save} onClick={() => void handleSave()} loading={saving} disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar'}
                        </Button>
                    </>
                )}
            >
                <div className={s.form}>
                    {activeFormTab === 'recipe' && (
                        <FormSection title="Datos de la receta">
                            <FormGrid>
                                <Field label="Producto que genera la receta" htmlFor="pr-product" required>
                                    <AppSelect<string>
                                        inputId="pr-product"
                                        options={productOptions}
                                        value={productId || null}
                                        onChange={(v) => handleProductChange(v ?? '')}
                                        placeholder="Selecciona un intermedio o producto terminado..."
                                        isDisabled={!!editingRecipe}
                                    />
                                </Field>
                                <Field label="Nombre de la receta" htmlFor="pr-name">
                                    <Input
                                        id="pr-name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder={selectedProduct ? `Receta de ${selectedProduct.name}` : 'Receta de ...'}
                                    />
                                </Field>
                                <Field label="Rendimiento por lote" htmlFor="pr-yield" required hint="Cantidad que produce una corrida de esta receta.">
                                    <Input
                                        id="pr-yield"
                                        type="number"
                                        min="0"
                                        step="0.0001"
                                        value={yieldQuantity}
                                        onChange={(e) => setYieldQuantity(e.target.value)}
                                        placeholder="0"
                                    />
                                </Field>
                                <Field label="Unidad de rendimiento" htmlFor="pr-yield-unit">
                                    <AppSelect<string>
                                        inputId="pr-yield-unit"
                                        options={unitOptions}
                                        value={yieldUnitId || null}
                                        onChange={(v) => setYieldUnitId(v ?? '')}
                                        placeholder="Unidad..."
                                    />
                                </Field>
                            </FormGrid>
                            <Field label="Notas de producción" htmlFor="pr-notes" hint="Información operativa que acompañará la receta.">
                                <Textarea
                                    id="pr-notes"
                                    rows={4}
                                    value={notes}
                                    onChange={(event) => setNotes(event.target.value)}
                                    placeholder="Preparación, controles o indicaciones para el lote..."
                                />
                            </Field>
                        </FormSection>
                    )}

                    {activeFormTab === 'components' && (
                        <FormSection title="Componentes">
                            <div className={s.components}>
                                {rows.map((row, index) => {
                                    const cost = estimatedRowCost(row);
                                    return (
                                        <div key={row.key} className={s.componentRow}>
                                            <div className={s.componentProduct}>
                                                <AppSelect<string>
                                                    aria-label={`Componente ${index + 1}`}
                                                    options={componentOptions}
                                                    value={row.componentProductId || null}
                                                    onChange={(v) => updateRow(row.key, { componentProductId: v ?? '' })}
                                                    placeholder="Componente..."
                                                />
                                            </div>
                                            <div className={s.componentQty}>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.0001"
                                                    aria-label={`Cantidad del componente ${index + 1}`}
                                                    placeholder="Cant"
                                                    value={row.quantity}
                                                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                                                />
                                            </div>
                                            <div className={s.componentUnit}>
                                                <AppSelect<string>
                                                    aria-label={`Unidad del componente ${index + 1}`}
                                                    options={unitOptions}
                                                    value={row.unitId || null}
                                                    onChange={(v) => updateRow(row.key, { unitId: v ?? '' })}
                                                    placeholder="Base"
                                                />
                                            </div>
                                            <div className={s.componentCost} aria-label={`Costo estimado del componente ${index + 1}`}>
                                                {cost === null ? <span className={s.nd} title="Se calcula al completar producto, cantidad y rendimiento">N/D</span> : formatMoney(cost)}
                                            </div>
                                            <IconButton icon={Trash2} size="sm" label="Quitar componente" onClick={() => removeRow(row.key)} />
                                        </div>
                                    );
                                })}
                            </div>
                            <div>
                                <Button icon={Plus} onClick={addRow}>Agregar componente</Button>
                            </div>
                        </FormSection>
                    )}

                    {activeFormTab === 'cost' && (
                        <FormSection title="Costo estimado">
                            {previewCost ? (
                                <div className="pr-cost-panel">
                                    <div className="pr-cost-lines">
                                        {previewCost.lines.map((line) => (
                                            <div key={line.componentProductId} className="pr-cost-line">
                                                <span className="pr-cost-line-name">{line.componentName}</span>
                                                <span className="pr-cost-line-qty">
                                                    {line.quantity} {line.unit}
                                                </span>
                                                <span className="pr-cost-line-total">{formatMoney(Number(line.totalCost))}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="pr-cost-totals">
                                        <div className="pr-cost-total-row">
                                            <span>Costo del lote</span>
                                            <strong>{formatMoney(Number(previewCost.batchCost))}</strong>
                                        </div>
                                        <div className="pr-cost-total-row highlight">
                                            <span>
                                                Costo unitario
                                                {previewCost.yieldBaseUnit ? ` (por ${previewCost.yieldBaseUnit})` : ''}
                                            </span>
                                            <strong>{formatMoney(Number(previewCost.unitCost))}</strong>
                                        </div>
                                    </div>
                                </div>
                            ) : previewCostError ? (
                                <div className="pr-cost-panel" role="alert">
                                    <p className={s.bad}>{previewCostError}</p>
                                    <p className="pr-helper-text">Corrige la unidad o su factor antes de guardar.</p>
                                </div>
                            ) : (
                                <div className="pr-cost-panel">
                                    <div className="pr-cost-total-row highlight">
                                        <span>Costo estimado</span>
                                        <strong>{previewCostLoading ? 'Calculando…' : 'N/D'}</strong>
                                    </div>
                                    <p className="pr-helper-text">
                                        Cálculo autoritativo con conversión a unidad base y costo operativo vigente.
                                    </p>
                                </div>
                            )}
                            {!editingRecipe && (
                                <Checkbox
                                    label="Activar al guardar"
                                    checked={activateOnSave}
                                    onChange={(e) => setActivateOnSave(e.target.checked)}
                                />
                            )}
                        </FormSection>
                    )}
                </div>
            </FullScreenModal>
        </PageContent>
    );
}
