import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoPurchaseOrdersAPI, branchesAPI, productsAPI, inventoryMovementsAPI, categoriesAPI, suppliersAPI, unitsAPI, settingsAPI } from '../services/api';
// import Input from '../components/Input';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { hasAnyRole } from '../utils/authz';
import {
    AlertTriangle, Package, Plus, Pencil, Trash2,
    Activity, ShoppingBag, Layers, FileText,
    Upload, Download, FileSpreadsheet, Search, Printer,
    Eye
} from 'lucide-react';
import type { AutoPurchaseSuggestion, Branch, Product, ProductAllowedUnit, Supplier, UnitOfMeasure, Warehouse } from '../types';
import { formatCurrency, getCurrencySymbol, type CurrencySettings } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { isCategoryVisibleInInventory } from '../utils/categoryVisibility';
import { resolveEffectiveUnitCost, type ProductCostResolution } from '../utils/productCost';
import { newIdempotencyKey } from '../utils/idempotency';
import s from './Inventory.module.css';
import { buildWarehouseBreakdown, type WarehouseStockInput } from '../utils/inventoryWarehouses';
import { buildInventoryCountSheetHtml } from '../utils/inventoryCountSheet';
import catalog from './catalog.module.css';
import {
    AppSelect, Button, Checkbox, Tabs, Field, FormGrid, FormSection, FullScreenModal, Badge, DataTable, EmptyState, IconButton, Input, PageContent,
    PageHeader, TableToolbar, Textarea, Tooltip, formatNumber, type Column,
} from '@/ui';
import { getApiErrorMessage } from '../utils/apiError';

// Suggestions carry the line already expressed in the product's default
// purchase unit (purchaseQuantity/purchaseUnit/purchaseUnitCost). The unit cost
// is sent unrounded: a per-gram cost like 0.004 must not collapse to 0.00.
type AutoPurchaseSuggestionLine = AutoPurchaseSuggestion & {
    unit?: string;
    purchaseUnit?: string;
    purchaseQuantity?: number;
    purchaseUnitCost?: number;
};

function toAutoPurchaseLine(suggestion: AutoPurchaseSuggestionLine) {
    const purchaseQuantity = Number(suggestion.purchaseQuantity);
    const usePurchaseUnit = Number.isFinite(purchaseQuantity) && purchaseQuantity > 0 && !!suggestion.purchaseUnit;
    const purchaseUnitCost = Number(suggestion.purchaseUnitCost);
    return {
        productId: suggestion.productId,
        quantity: usePurchaseUnit ? purchaseQuantity : Number(suggestion.suggestedQuantity),
        ...(usePurchaseUnit ? { unit: suggestion.purchaseUnit } : {}),
        // Omitted cost lets the server derive it from the unrounded product cost.
        ...(usePurchaseUnit && Number.isFinite(purchaseUnitCost) && purchaseUnitCost >= 0
            ? { cost: purchaseUnitCost }
            : {}),
    };
}

function formatSuggestionQuantity(suggestion: AutoPurchaseSuggestionLine) {
    const purchaseQuantity = Number(suggestion.purchaseQuantity);
    if (Number.isFinite(purchaseQuantity) && purchaseQuantity > 0 && suggestion.purchaseUnit) {
        return `${formatNumber(purchaseQuantity)} ${suggestion.purchaseUnit}`;
    }
    return `${formatNumber(suggestion.suggestedQuantity)}${suggestion.unit ? ` ${suggestion.unit}` : ''}`;
}


interface CategoryRow {
    id: number;
    name: string;
    description?: string;
    sortOrder?: number;
    active: boolean;
    showInMenu?: boolean;
    showInInventory?: boolean;
    _count?: {
        products?: number;
        menuItems?: number;
    };
}

type ProductInventory = Product & {
    currentAverageCost?: number;
    lastPurchaseCost?: number;
    totalStock?: number;
};

/** 409 COUNT_SHEET_OPEN: the warehouse has an open blind count sheet. */
function countSheetOpenMessage(error: unknown): string | null {
    const code = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
    return code === 'COUNT_SHEET_OPEN'
        ? 'Hay un conteo abierto en esta bodega; apruébalo o recházalo primero'
        : null;
}

function apiErrorMessage(error: unknown): string {
    return getApiErrorMessage(error);
}

function inventoryCostQuality(product: ProductInventory): ProductCostResolution {
    return product.costQuality ?? resolveEffectiveUnitCost(
        product.currentAverageCost,
        product.cost,
        {
            averageCostKnown: product.averageCostKnown,
            referenceCostKnown: product.referenceCostKnown
        }
    );
}

// Per-base-unit costs (per g/ml) are often below one cent; money formatting
// to 2 decimals would show C$ 0.00. Show up to 6 decimals only when needed.
function formatUnitCost(value: number, currencySettings: CurrencySettings): string {
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 1) {
        return formatCurrency(value, currencySettings);
    }
    const symbol = getCurrencySymbol(currencySettings);
    return `${symbol} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false })}`;
}

function formatInventoryCost(product: ProductInventory, currencySettings: CurrencySettings): string {
    const quality = inventoryCostQuality(product);
    return quality.known ? formatUnitCost(quality.value, currencySettings) : 'N/D';
}

function formatLastPurchaseCost(product: ProductInventory, currencySettings: CurrencySettings): string {
    const value = Number(product.lastPurchaseCost);
    const known = product.lastPurchaseCostKnown === true || value > 0;
    return known && Number.isFinite(value) && value >= 0
        ? formatUnitCost(value, currencySettings)
        : 'Sin compras';
}

const STORAGE_TYPE_OPTIONS: { value: '' | 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE'; label: string; icon: typeof Package }[] = [
    { value: '', label: 'Sin clasificar', icon: Package },
    { value: 'PERISHABLE', label: 'Perecedero', icon: AlertTriangle },
    { value: 'FROZEN', label: 'Congelado', icon: Layers },
    { value: 'NON_PERISHABLE', label: 'No Perecedero', icon: ShoppingBag }
];

const PRODUCT_TYPE_OPTIONS: { value: Product['type']; label: string; description: string }[] = [
    { value: 'INGREDIENT', label: 'Ingrediente', description: 'Uso interno' },
    { value: 'PRODUCT_FOR_SALE', label: 'Venta', description: 'Venta directa' },
    { value: 'BOTH', label: 'Ambos', description: 'Uso y venta' },
    { value: 'INTERMEDIATE', label: 'Intermedio', description: 'Semielaborado' },
    { value: 'PACKAGING', label: 'Empaque', description: 'Material' },
];

const PRODUCT_TYPE_LABELS: Record<Product['type'], string> = {
    INGREDIENT: 'Ingrediente / insumo',
    PRODUCT_FOR_SALE: 'Producto de venta',
    BOTH: 'Insumo y producto de venta',
    INTERMEDIATE: 'Producto intermedio',
    PACKAGING: 'Empaque'
};

export default function Inventory() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { toasts, removeToast, success: showSuccess, error: showError, warning: showWarning } = useToast();

    /** Backend: POST/PUT /products — SUPERADMIN | ADMIN */
    const canMutateProduct = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    /** Backend: DELETE /products — SUPERADMIN only */
    const canDeleteProduct = hasAnyRole(user, ['SUPERADMIN']);
    /** Backend: POST /inventory-movements — SUPERADMIN | ADMIN | CAJERO | BODEGA */
    const canAdjustStock = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    /** Backend: POST /advanced/auto-po/create — SUPERADMIN | ADMIN */
    const canCreateAutoPO = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);
    const [products, setProducts] = useState<Product[]>([]);
    const [lowStock, setLowStock] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const TABLE_PAGE_SIZE = 25;
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [viewingProduct, setViewingProduct] = useState<ProductInventory | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'stock' | 'finanzas'>('general');
    const [saving, setSaving] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    const [storageFilter, setStorageFilter] = useState<string>('all');
    const [autoPurchaseSuggestions, setAutoPurchaseSuggestions] = useState<AutoPurchaseSuggestion[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [showAutoPurchaseSidebar, setShowAutoPurchaseSidebar] = useState(false);
    const [creatingAutoPurchaseOrder, setCreatingAutoPurchaseOrder] = useState(false);
    const [selectedSuggestionKeys, setSelectedSuggestionKeys] = useState<Record<string, boolean>>({});
    const [autoPurchaseForm, setAutoPurchaseForm] = useState({
        branchId: '',
        supplierId: ''
    });

    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        categoryId: '',
        unit: '',
        cost: '',
        price: '',
        minStock: '10',
        type: 'INGREDIENT' as 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH' | 'INTERMEDIATE' | 'PACKAGING',
        storageType: '' as '' | 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE',
        observation: ''
    });

    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [adjusting, setAdjusting] = useState(false);
    const adjustmentAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
    const [adjustmentData, setAdjustmentData] = useState({
        productId: 0,
        productName: '',
        warehouseId: '',
        // COUNT = physical count: quantity is the counted stock, the server
        // posts the difference against the current balance.
        type: 'OUT' as 'IN' | 'OUT' | 'ADJUSTMENT' | 'COUNT',
        quantity: '',
        reason: '',
        unit: ''
    });
    const [adjustmentUnits, setAdjustmentUnits] = useState<ProductAllowedUnit[]>([]);

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStockInput[]>([]);
    const [allUnits, setAllUnits] = useState<UnitOfMeasure[]>([]);
    const { symbol } = useCurrency();
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [loadIssues, setLoadIssues] = useState<Record<string, string>>({});

    const setLoadIssue = useCallback((area: string, error?: unknown) => {
        setLoadIssues((current) => {
            if (error == null) {
                if (!(area in current)) return current;
                const next = { ...current };
                delete next[area];
                return next;
            }
            return { ...current, [area]: apiErrorMessage(error) };
        });
    }, []);

    // Excel import state
    const [showImportSidebar, setShowImportSidebar] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importSearch, setImportSearch] = useState('');
    const [importShowErrorsOnly, setImportShowErrorsOnly] = useState(false);
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const [importValidation, setImportValidation] = useState<{
        items: Array<{
            rowNumber: number; sku: string; name: string; category: string; unit: string;
            isUpdate: boolean; existingProductId: number | null; categoryId: number | null;
            errors: string[]; isValid: boolean;
            minStock?: number | null; cost?: number | null; price?: number | null;
            type?: string; storageType?: string;
        }>;
        summary: { valid: number; invalid: number; totalRows: number; newProducts: number; updates: number };
    } | null>(null);
    const [importLoading, setImportLoading] = useState(false);

    const loadUnitsCatalog = useCallback(async (): Promise<UnitOfMeasure[]> => {
        try {
            const res = await unitsAPI.getAll();
            const units: UnitOfMeasure[] = res.data.data || [];
            setAllUnits(units);
            setLoadIssue('Unidades');
            return units;
        } catch (error) {
            console.error('Error loading units:', error);
            setLoadIssue('Unidades', error);
            return [];
        }
    }, [setLoadIssue]);

    const loadOperationalData = useCallback(async () => {
        const [branchesResult, suppliersResult] = await Promise.allSettled([
            branchesAPI.getAll(),
            suppliersAPI.getAll({ active: true })
        ]);
        if (branchesResult.status === 'fulfilled') {
            setBranches(branchesResult.value.data.data || []);
            setLoadIssue('Sucursales');
        } else {
            console.error('Error loading branches:', branchesResult.reason);
            setLoadIssue('Sucursales', branchesResult.reason);
        }
        if (suppliersResult.status === 'fulfilled') {
            setSuppliers(suppliersResult.value.data.data || []);
            setLoadIssue('Proveedores');
        } else {
            console.error('Error loading suppliers:', suppliersResult.reason);
            setLoadIssue('Proveedores', suppliersResult.reason);
        }
    }, [setLoadIssue]);

    const loadCategories = useCallback(async () => {
        try {
            const res = await categoriesAPI.getAll();
            setCategories(res.data.data);
            setLoadIssue('Categorias');
        } catch (error) {
            console.error('Error loading categories:', error);
            setLoadIssue('Categorias', error);
        }
    }, [setLoadIssue]);

    const loadWarehouses = useCallback(async () => {
        try {
            const { warehousesAPI } = await import('../services/api');
            const res = await warehousesAPI.getAll();
            setWarehouses(res.data.data);
            const list = (res.data.data || []) as Warehouse[];
            const stocks = await Promise.allSettled(list.map((w) => warehousesAPI.getStock(w.id)));
            const failedStock = list.filter((_, idx) => stocks[idx].status !== 'fulfilled');
            setWarehouseStocks(list.flatMap((w, i) => {
                const r = stocks[i];
                if (r.status !== 'fulfilled') return [];
                const rows = ((r.value.data.data || []) as { productId: number; quantity: number | string }[])
                    .map((row) => ({ productId: row.productId, quantity: row.quantity }));
                return [{ warehouseId: w.id, warehouseName: w.name, rows }];
            }));
            if (failedStock.length > 0) {
                setLoadIssue('Existencias por almacén', `No se pudieron cargar: ${failedStock.map((w) => w.name).join(', ')}`);
            } else {
                setLoadIssue('Existencias por almacén');
            }
            setLoadIssue('Almacenes');
        } catch (error) {
            console.error('Error loading warehouses:', error);
            setLoadIssue('Almacenes', error);
        }
    }, [setLoadIssue]);

    const loadInventory = useCallback(async () => {
        const results = await Promise.allSettled([
            productsAPI.getAll({ active: true, limit: 500 }),
            productsAPI.getLowStock(),
            autoPurchaseOrdersAPI.getSuggestions()
        ]);

        const [productsRes, lowStockRes, suggestionsRes] = results;

        if (productsRes.status === 'fulfilled') {
            setProducts(productsRes.value.data.data || []);
            setLoadIssue('Productos');
        } else {
            console.error('Error loading products:', productsRes.reason);
            setLoadIssue('Productos', productsRes.reason);
        }
        if (lowStockRes.status === 'fulfilled') {
            setLowStock(lowStockRes.value.data.data || []);
            setLoadIssue('Stock bajo');
        } else {
            setLoadIssue('Stock bajo', lowStockRes.reason);
        }
        if (suggestionsRes.status === 'fulfilled') {
            setAutoPurchaseSuggestions(suggestionsRes.value.data.data?.suggestions || []);
            setLoadIssue('Sugerencias de compra');
        } else {
            setLoadIssue('Sugerencias de compra', suggestionsRes.reason);
        }

        setLoading(false);
    }, [setLoadIssue]);

    const handleOpenSidebar = async (product?: Product) => {
        await loadUnitsCatalog();
        if (product) {
            setEditingProduct(product);
            setFormData({
                name: product.name,
                sku: product.sku || '',
                categoryId: product.categoryId?.toString() || '',
                unit: product.unit,
                cost: product.cost.toString(),
                price: product.price?.toString() || '',
                minStock: product.minStock.toString(),
                type: product.type,
                storageType: product.storageType || '',
                observation: product.observation || ''
            });
        } else {
            setEditingProduct(null);
            setFormData({
                name: '',
                sku: '',
                categoryId: '',
                unit: '',
                cost: '',
                price: '',
                minStock: '10',
                type: 'INGREDIENT',
                storageType: '',
                observation: ''
            });
        }
        setActiveTab('general');
        setIsSidebarOpen(true);
    };

    useEffect(() => {
        void loadInventory();
        void loadWarehouses();
        void loadCategories();
        void loadOperationalData();
        void loadUnitsCatalog();
        settingsAPI.getAll()
            .then((res) => {
                setSettings(res.data.data || {});
                setLoadIssue('Configuracion');
            })
            .catch((err) => {
                console.error('Error loading settings:', err);
                setLoadIssue('Configuracion', err);
            });
    }, [loadCategories, loadInventory, loadOperationalData, loadUnitsCatalog, loadWarehouses, setLoadIssue]);

    const handleViewProduct = (product: Product) => {
        setViewingProduct(product as ProductInventory);
    };

    const handleEditFromDetail = () => {
        if (!viewingProduct || !canMutateProduct) return;
        const product = viewingProduct;
        setViewingProduct(null);
        void handleOpenSidebar(product);
    };

    const loadProductUnits = useCallback(async (productId: number) => {
        const res = await unitsAPI.getProductUnits(productId);
        const units: ProductAllowedUnit[] = res.data.data || [];
        if (units.length === 0) {
            throw new Error('El producto no tiene una unidad base utilizable');
        }
        setAdjustmentUnits(units);
        const defaultUnit = units.find(u => u.isDefault) || units.find(u => u.isBase) || units[0];
        return defaultUnit.abbreviation;
    }, []);

    const handleOpenAdjustment = async (product: Product) => {
        try {
            const storedWarehouseId = localStorage.getItem('inventory_adjustment_warehouse_id');
            const defaultUnitAbbr = await loadProductUnits(product.id);
            setAdjustmentData({
                productId: product.id,
                productName: product.name,
                warehouseId: storedWarehouseId || warehouses[0]?.id?.toString() || '',
                type: 'OUT',
                quantity: '',
                reason: '',
                unit: defaultUnitAbbr
            });
            adjustmentAttemptRef.current = null;
            setIsAdjustmentModalOpen(true);
        } catch (error: unknown) {
            setAdjustmentUnits([]);
            showError('No se puede ajustar el inventario: ' + apiErrorMessage(error));
        }
    };

    const handleAdjustmentSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canAdjustStock) return;

        if (warehouses.length === 0) {
            showWarning('No hay almacenes disponibles para realizar el ajuste.');
            return;
        }

        if (!adjustmentData.warehouseId) {
            showWarning('Selecciona el almacén donde se aplicará el ajuste.');
            return;
        }

        const isCount = adjustmentData.type === 'COUNT';
        const enteredQuantity = parseFloat(adjustmentData.quantity);
        if (!Number.isFinite(enteredQuantity) || (isCount ? enteredQuantity < 0 : enteredQuantity <= 0)) {
            showWarning(isCount ? 'Indica la cantidad contada (0 o más).' : 'Indica una cantidad mayor a 0.');
            return;
        }
        const common = {
            warehouseId: Number(adjustmentData.warehouseId),
            productId: adjustmentData.productId,
            reason: adjustmentData.reason,
            unit: adjustmentData.unit || undefined
        };
        const countPayload = { ...common, countedQuantity: enteredQuantity };
        const movementPayload = {
            ...common,
            type: adjustmentData.type as 'IN' | 'OUT' | 'ADJUSTMENT',
            quantity: enteredQuantity
        };
        const fingerprint = JSON.stringify(isCount ? countPayload : movementPayload);
        if (adjustmentAttemptRef.current?.fingerprint !== fingerprint) {
            adjustmentAttemptRef.current = { fingerprint, key: newIdempotencyKey() };
        }

        setAdjusting(true);
        try {
            if (isCount) {
                const response = await inventoryMovementsAPI.count(countPayload, adjustmentAttemptRef.current.key);
                const result = response.data?.data as { adjusted?: boolean; delta?: number } | undefined;
                // Up to 6 decimals without float noise or trailing zeros (e.g. 0.3, not 0.30000000000000004).
                const delta = Number(Number(result?.delta ?? 0).toFixed(6));
                showSuccess(result?.adjusted
                    ? `Conteo aplicado (diferencia ${delta > 0 ? '+' : ''}${delta} en unidad base)`
                    : 'Conteo registrado: la existencia ya coincidía');
            } else {
                await inventoryMovementsAPI.create(movementPayload, adjustmentAttemptRef.current.key);
                showSuccess('Ajuste realizado correctamente');
            }
            localStorage.setItem('inventory_adjustment_warehouse_id', adjustmentData.warehouseId);
            adjustmentAttemptRef.current = null;
            setIsAdjustmentModalOpen(false);
            loadInventory();
        } catch (error: unknown) {
            showError(countSheetOpenMessage(error) ?? 'Error: ' + apiErrorMessage(error));
        } finally {
            setAdjusting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutateProduct) return;

        if (!formData.name?.trim()) {
            showWarning('El nombre del producto es obligatorio');
            setActiveTab('general');
            return;
        }

        if (!formData.unit) {
            showWarning('Selecciona una unidad de referencia. Crea unidades en Unidades de Medida si el catálogo está vacío.');
            setActiveTab('general');
            return;
        }

        const referenceCost = Number(formData.cost);
        if (!formData.cost?.trim() || !Number.isFinite(referenceCost) || referenceCost < 0) {
            showWarning('Indica un costo de referencia válido mayor o igual a cero');
            setActiveTab('finanzas');
            return;
        }

        setSaving(true);
        try {
            const trimmedSku = formData.sku.trim();
            const data: Record<string, unknown> = {
                ...formData,
                sku: trimmedSku ? trimmedSku : undefined,
                categoryId: formData.categoryId ? parseInt(formData.categoryId, 10) : null,
                cost: referenceCost,
                // Sale price only applies to sellable products (Producto de Venta / Ambos).
                price: (formData.type === 'PRODUCT_FOR_SALE' || formData.type === 'BOTH') && formData.price
                    ? parseFloat(formData.price)
                    : null,
                // minStock is expressed in the product's base unit; allow decimals
                // (e.g. 0.5 kg) instead of truncating to an integer.
                minStock: parseFloat(formData.minStock) || 0,
                storageType: formData.storageType || null,
                observation: formData.observation?.trim() || null,
                active: true
            };

            let savedProductId = editingProduct?.id || 0;
            let createdProduct: Product | null = null;

            if (editingProduct) {
                const updateRes = await productsAPI.update(editingProduct.id, data);
                if (updateRes.data?._offline) {
                    showWarning('Sin conexión: los cambios se sincronizarán al restablecer la red.');
                    setIsSidebarOpen(false);
                    return;
                }
                showSuccess('Producto actualizado correctamente');
            } else {
                const createRes = await productsAPI.create(data);
                if (createRes.data?._offline) {
                    showWarning('Sin conexión: el producto se guardará cuando vuelva la conexión.');
                    setIsSidebarOpen(false);
                    return;
                }
                createdProduct = (createRes.data?.data as Product) || null;
                savedProductId = Number(createdProduct?.id || 0);
                showSuccess('Producto creado correctamente');
                setFilter('all');
                setSelectedCategory('all');
                setStorageFilter('all');
                setSearchQuery('');
            }

            if (savedProductId) {
                try {
                    await unitsAPI.autoConfigureProduct(savedProductId);
                } catch (error) {
                    showWarning(getApiErrorMessage(
                        error,
                        'Producto guardado, pero no se pudo autoconfigurar su unidad (revise Conversiones antes de comprar o consumir inventario)'
                    ));
                }
            }

            if (createdProduct?.id) {
                setProducts((prev) => {
                    if (prev.some((p) => p.id === createdProduct!.id)) return prev;
                    return [...prev, createdProduct!].sort((a, b) => a.name.localeCompare(b.name, 'es'));
                });
            }

            setIsSidebarOpen(false);
            await loadInventory();
        } catch (error: unknown) {
            showError('Error: ' + apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteProduct) return;
        if (!(await confirm('¿Eliminar este producto?', { title: 'Confirmar acción' }))) return;

        try {
            await productsAPI.delete(id);
            showSuccess('Producto eliminado correctamente');
            loadInventory();
        } catch (error: unknown) {
            showError('Error: ' + apiErrorMessage(error));
        }
    };

    const getSuggestionKey = (suggestion: AutoPurchaseSuggestion) => `${suggestion.productId}-${suggestion.warehouseId}`;

    const selectedSuggestions = useMemo(
        () => autoPurchaseSuggestions.filter((suggestion) => selectedSuggestionKeys[getSuggestionKey(suggestion)]),
        [autoPurchaseSuggestions, selectedSuggestionKeys]
    );

    const handleToggleSuggestion = (suggestion: AutoPurchaseSuggestion) => {
        const key = getSuggestionKey(suggestion);
        setSelectedSuggestionKeys((prev) => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const handleSelectUrgentSuggestions = () => {
        const urgentSuggestions = autoPurchaseSuggestions.filter((suggestion) => suggestion.priority === 'URGENT');
        setSelectedSuggestionKeys((prev) => {
            const next = { ...prev };
            urgentSuggestions.forEach((suggestion) => {
                next[getSuggestionKey(suggestion)] = true;
            });
            return next;
        });
    };

    const closeImportSidebar = () => {
        setShowImportSidebar(false);
        setImportSearch('');
        setImportShowErrorsOnly(false);
    };

    const filteredImportItems = useMemo(() => {
        if (!importValidation) return [];
        const query = importSearch.trim().toLowerCase();
        return importValidation.items.filter((item) => {
            if (importShowErrorsOnly && item.isValid) return false;
            if (!query) return true;
            return (
                item.sku.toLowerCase().includes(query) ||
                item.name.toLowerCase().includes(query)
            );
        });
    }, [importValidation, importSearch, importShowErrorsOnly]);

    const handleCreateAutoPurchaseOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canCreateAutoPO) return;

        if (selectedSuggestions.length === 0) {
            showWarning('Selecciona al menos una sugerencia para crear la orden.');
            return;
        }

        if (!autoPurchaseForm.branchId || !autoPurchaseForm.supplierId) {
            showWarning('Selecciona sucursal y proveedor para generar el borrador.');
            return;
        }

        try {
            setCreatingAutoPurchaseOrder(true);
            const response = await autoPurchaseOrdersAPI.createFromSuggestions({
                branchId: Number(autoPurchaseForm.branchId),
                supplierId: Number(autoPurchaseForm.supplierId),
                items: selectedSuggestions.map(toAutoPurchaseLine)
            });

            showSuccess('Borrador de orden de compra creado correctamente.');
            setShowAutoPurchaseSidebar(false);
            setSelectedSuggestionKeys({});
            setAutoPurchaseForm({ branchId: '', supplierId: '' });
            await loadInventory();
            navigate(`/purchase-orders/${response.data.data.id}`);
        } catch (error: unknown) {
            let msg: string | undefined;
            if (typeof error === 'object' && error !== null && 'response' in error) {
                const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
                if (typeof m === 'string') msg = m;
            }
            showError(msg || 'No se pudo crear el borrador de compra.');
        } finally {
            setCreatingAutoPurchaseOrder(false);
        }
    };

    const handleDownloadTemplate = async () => {
        try {
            const res = await productsAPI.getImportTemplate();
            const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Plantilla_Productos.xlsx';
            a.click();
            URL.revokeObjectURL(url);
            showSuccess('Plantilla descargada');
        } catch (error) {
            showError(getApiErrorMessage(error, 'Error al descargar la plantilla'));
        }
    };

    const handlePrintInventory = () => {
        const html = buildInventoryCountSheetHtml(filteredProducts as ProductInventory[], categories, lowStock);
        const win = window.open('', '_blank');
        if (win) {
            win.document.write(html);
            win.document.close();
            win.print();
        }
    };

    const handleImportValidate = async () => {
        if (!importFile) return;
        setImportLoading(true);
        try {
            await categoriesAPI.ensureDefaults();
            const res = await productsAPI.validateImport(importFile);
            setImportValidation(res.data.data);
            if (res.data.data.summary.invalid > 0) {
                showWarning(`${res.data.data.summary.invalid} filas con errores`);
            } else {
                showSuccess(`${res.data.data.summary.valid} productos listos para importar`);
            }
        } catch (error) {
            showError(getApiErrorMessage(error, 'Error al validar el archivo'));
        } finally {
            setImportLoading(false);
        }
    };

    const handleImportConfirm = async () => {
        if (!importValidation) return;
        const validItems = importValidation.items.filter(i => i.isValid);
        if (validItems.length === 0) {
            showError('No hay productos válidos para importar');
            return;
        }
        setImportLoading(true);
        try {
            const res = await productsAPI.confirmImport(validItems);
            showSuccess(res.data.message);
            closeImportSidebar();
            setImportFile(null);
            setImportValidation(null);
            loadInventory();
        } catch (error) {
            showError(getApiErrorMessage(error, 'Error al confirmar la importación'));
        } finally {
            setImportLoading(false);
        }
    };

    const filteredProducts = useMemo(() => {
        const list = products.filter(p => {
            const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchSearch) return false;

            const matchType = filter === 'all' || (filter === 'low' ? lowStock.some(lp => lp.id === p.id) : p.type === filter);
            const matchCategory = selectedCategory === 'all' || p.categoryId?.toString() === selectedCategory;
            const matchStorage = storageFilter === 'all' || p.storageType === storageFilter;
            if (!matchStorage) return false;

            return matchType && matchCategory;
        });

        // Show products with the lowest stock first; tie-break alphabetically.
        return list.sort((a, b) => {
            const stockA = Number((a as ProductInventory).totalStock ?? 0);
            const stockB = Number((b as ProductInventory).totalStock ?? 0);
            if (stockA !== stockB) return stockA - stockB;
            return a.name.localeCompare(b.name, 'es');
        });
    }, [products, lowStock, filter, searchQuery, selectedCategory, storageFilter]);


    const isLowStockProduct = (id: number) => lowStock.some((p) => p.id === id);
    const productsFailed = 'Productos' in loadIssues;
    const warehouseBreakdown = useMemo(
        () => buildWarehouseBreakdown(warehouseStocks, products as ProductInventory[]),
        [warehouseStocks, products],
    );

    const categoryFilterOptions = [
        { value: 'all', label: 'Todas las categorías' },
        ...categories.filter(c => isCategoryVisibleInInventory(c) && (c._count?.products ?? 0) > 0).map(cat => ({ value: cat.id.toString(), label: cat.name }))
    ];
    const storageFilterOptions = [
        { value: 'all', label: 'Todo almacenamiento' },
        { value: 'PERISHABLE', label: 'Perecedero' },
        { value: 'FROZEN', label: 'Congelado' },
        { value: 'NON_PERISHABLE', label: 'No perecedero' }
    ];
    const hasFilters = filter !== 'all' || selectedCategory !== 'all' || storageFilter !== 'all' || searchQuery.trim() !== '';

    return (
        <PageContent>
            <PageHeader
                title="Inventario"
                description="Existencias valorizadas por bodega, costo promedio ponderado."
                actions={canMutateProduct ? (
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()}>
                        Nuevo producto
                    </Button>
                ) : undefined}
            />

            {Object.keys(loadIssues).length > 0 && (
                <div className={s.loadError} role="alert">
                    <div>
                        <strong>Inventario cargado parcialmente.</strong>
                        <span>Los datos faltantes no se mostraran como cero ni como listas vacias.</span>
                        <ul>
                            {Object.entries(loadIssues).map(([area, message]) => (
                                <li key={area}><strong>{area}:</strong> {message}</li>
                            ))}
                        </ul>
                    </div>
                    <Button
                        onClick={() => {
                            void loadInventory();
                            void loadWarehouses();
                            void loadCategories();
                            void loadOperationalData();
                            void loadUnitsCatalog();
                            settingsAPI.getAll()
                                .then((res) => { setSettings(res.data.data || {}); setLoadIssue('Configuracion'); })
                                .catch((error) => setLoadIssue('Configuracion', error));
                        }}
                    >
                        Reintentar cargas
                    </Button>
                </div>
            )}

            <Tabs
                ariaLabel="Filtrar por tipo"
                active={filter}
                onChange={(id) => setFilter(id as typeof filter)}
                tabs={[
                    { id: 'all', label: 'Todos', badge: productsFailed ? undefined : (products.length >= 500 ? '500+' : products.length) },
                    { id: 'INGREDIENT', label: 'Ingredientes', badge: productsFailed ? undefined : products.filter((p) => p.type === 'INGREDIENT').length },
                    { id: 'PRODUCT_FOR_SALE', label: 'Productos', badge: productsFailed ? undefined : products.filter((p) => p.type === 'PRODUCT_FOR_SALE').length },
                    { id: 'INTERMEDIATE', label: 'Intermedios', badge: productsFailed ? undefined : products.filter((p) => p.type === 'INTERMEDIATE').length },
                    { id: 'PACKAGING', label: 'Empaques', badge: productsFailed ? undefined : products.filter((p) => p.type === 'PACKAGING').length },
                    {
                        id: 'low',
                        label: 'Stock bajo',
                        badge: productsFailed || 'Stock bajo' in loadIssues ? undefined : products.filter((p) => isLowStockProduct(p.id)).length,
                    },
                ]}
            />

            <TableToolbar
                actions={(
                    <>
                        <Button icon={Printer} onClick={handlePrintInventory}>Imprimir</Button>
                        {canMutateProduct && (
                            <Button icon={Download} onClick={handleDownloadTemplate}>Plantilla Excel</Button>
                        )}
                        {canMutateProduct && (
                            <Button icon={Upload} onClick={() => { setShowImportSidebar(true); setImportFile(null); setImportValidation(null); }}>
                                Importar Excel
                            </Button>
                        )}
                        {canCreateAutoPO && (
                            <Button
                                icon={FileText}
                                onClick={() => setShowAutoPurchaseSidebar(true)}
                                disabled={autoPurchaseSuggestions.length === 0}
                            >
                                Crear OC sugerida
                            </Button>
                        )}
                    </>
                )}
            >
                <Input
                    type="search"
                    aria-label="Buscar producto"
                    placeholder="Buscar por código o producto"
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                />
                <AppSelect
                    aria-label="Filtrar por categoría"
                    isClearable={false}
                    options={categoryFilterOptions}
                    value={selectedCategory}
                    onChange={(v) => setSelectedCategory(v || 'all')}
                />
                <AppSelect
                    aria-label="Filtrar por almacenamiento"
                    isClearable={false}
                    isSearchable={false}
                    options={storageFilterOptions}
                    value={storageFilter}
                    onChange={(v) => setStorageFilter(v || 'all')}
                />
            </TableToolbar>

            <DataTable<ProductInventory>
                ariaLabel="Inventario de productos"
                rows={filteredProducts as ProductInventory[]}
                rowKey={(product) => product.id}
                loading={loading}
                defaultPageSize={TABLE_PAGE_SIZE}
                pageSizeOptions={[10, 25, 50, 100]}
                resetKey={`${filter}|${searchQuery}|${selectedCategory}|${storageFilter}`}
                rowTone={(product) => (isLowStockProduct(product.id) ? 'warning' : undefined)}
                onRowClick={(product) => handleViewProduct(product)}
                footerLabel="Total (sin productos N/D)"
                empty={(
                    <EmptyState
                        icon={Package}
                        title={hasFilters ? 'Sin resultados' : 'No hay productos registrados'}
                        description={hasFilters ? 'Ajusta o limpia los filtros.' : undefined}
                        action={hasFilters ? (
                            <Button onClick={() => { setFilter('all'); setSelectedCategory('all'); setStorageFilter('all'); setSearchQuery(''); }}>Limpiar filtros</Button>
                        ) : canMutateProduct ? (
                            <Button variant="primary" onClick={() => handleOpenSidebar()}>Crear primer producto</Button>
                        ) : undefined}
                    />
                )}
                columns={[
                    { key: 'sku', header: 'Código', render: (product) => product.sku || '—' },
                    { key: 'name', header: 'Producto', type: 'text', render: (product) => (
                        <span className={s.cellStack}>
                            <span>{product.name}</span>
                            {(() => {
                                const where = warehouseBreakdown.labelByProduct.get(product.id);
                                return where && !/^[-—]$/.test(where.trim()) ? <span className={s.cellSub}>{where}</span> : null;
                            })()}
                        </span>
                    ) },
                    { key: 'category', header: 'Categoría', render: (product) => categories.find((c) => c.id === product.categoryId)?.name || '—' },
                    { key: 'stock', header: 'Existencia', type: 'qty', accessor: (product) => product.totalStock ?? 0, render: (product) => `${formatNumber(product.totalStock ?? 0)} ${product.baseUnit?.abbreviation || product.unit || ''}`.trim() },
                    { key: 'cost', header: 'Costo (C$)', type: 'money', accessor: (product) => inventoryCostQuality(product).value, render: (product) => (inventoryCostQuality(product).known ? formatNumber(inventoryCostQuality(product).value) : 'N/D') },
                    { key: 'value', header: 'Valor (C$)', type: 'money', total: true, accessor: (product) => (inventoryCostQuality(product).known ? Number(product.totalStock ?? 0) * inventoryCostQuality(product).value : null), render: (product) => (inventoryCostQuality(product).known ? formatNumber(Number(product.totalStock ?? 0) * inventoryCostQuality(product).value) : 'N/D') },
                    { key: 'status', header: 'Estado', type: 'status', render: (product) => (
                        <Badge tone={isLowStockProduct(product.id) ? 'warning' : 'success'} dot>
                            {isLowStockProduct(product.id) ? 'Stock bajo' : 'OK'}
                        </Badge>
                    ) },
                    { key: 'actions', header: 'Acciones', width: '244px', type: 'actions', render: (product) => (
                        <div className={catalog.rowActions}>
                            <IconButton size="sm" icon={Eye} tooltip="Ver detalle" label={`Ver detalle de ${product.name}`} onClick={() => handleViewProduct(product)} />
                            {canMutateProduct && <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${product.name}`} onClick={() => handleOpenSidebar(product)} />}
                            <IconButton size="sm" icon={FileText} tooltip="Kardex" label={`Ver kardex de ${product.name}`} onClick={() => navigate(`/kardex?productId=${product.id}`)} />
                            {canAdjustStock && <IconButton size="sm" icon={Activity} tooltip="Ajustar stock" label={`Ajustar stock de ${product.name}`} onClick={() => handleOpenAdjustment(product)} />}
                            {canMutateProduct && <IconButton size="sm" icon={Layers} tooltip="Conversiones" label={`Conversiones de ${product.name}`} onClick={() => navigate(`/inventory/${product.id}/units`)} />}
                            {canDeleteProduct && <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar ${product.name}`} onClick={() => handleDelete(product.id)} />}
                        </div>
                    ) },
                ] as Column<ProductInventory>[]}
            />

            <FullScreenModal
                isOpen={Boolean(viewingProduct)}
                onClose={() => setViewingProduct(null)}
                title="Detalle del Producto"
                footerStart={viewingProduct ? ({ requestClose }) => (
                    <Button variant="ghost" onClick={requestClose}>Cerrar</Button>
                ) : undefined}
                footer={viewingProduct ? (
                    <>
                        <Button icon={FileText} onClick={() => navigate(`/kardex?productId=${viewingProduct.id}`)}>
                            Ver Kardex
                        </Button>
                        {canMutateProduct && (
                            <Button variant="primary" icon={Pencil} onClick={handleEditFromDetail}>
                                Editar Producto
                            </Button>
                        )}
                    </>
                ) : undefined}
            >
                {viewingProduct && (() => {
                    const isLow = lowStock.some(product => product.id === viewingProduct.id);
                    const stock = Number(viewingProduct.totalStock ?? 0);
                    const minStock = Number(viewingProduct.minStock);
                    const unit = viewingProduct.baseUnit?.abbreviation || viewingProduct.unit;
                    const storageLabel = STORAGE_TYPE_OPTIONS.find(option => option.value === viewingProduct.storageType)?.label || 'Sin clasificar';
                    const category = categories.find(item => item.id === viewingProduct.categoryId)?.name || 'Sin categoría';
                    const costQuality = inventoryCostQuality(viewingProduct);
                    const hasTransactionalCost = costQuality.source === 'AVERAGE';
                    const stockLevel = minStock > 0 ? Math.max(0, Math.min(100, (stock / minStock) * 100)) : 100;

                    return (
                        <div className={s.detail} data-testid="inventory-product-detail">
                            <div className={s.detailHead}>
                                <div className={s.detailIdentity}>
                                    <p className={s.eyebrow}>Ficha de inventario</p>
                                    <h3 className={s.detailTitle}>{viewingProduct.name}</h3>
                                    <div className={s.badges}>
                                        {viewingProduct.sku && <Badge>SKU {viewingProduct.sku}</Badge>}
                                        <Badge tone={viewingProduct.active ? 'success' : 'neutral'}>
                                            {viewingProduct.active ? 'Activo' : 'Inactivo'}
                                        </Badge>
                                        <Badge tone={isLow ? 'warning' : 'success'} dot>
                                            {isLow ? 'Requiere reposición' : 'Stock saludable'}
                                        </Badge>
                                    </div>
                                </div>
                                <div className={s.stockSummary}>
                                    <span className={s.factLabel}>Existencia actual</span>
                                    <strong className={`${s.stockValue} ${isLow ? s.warn : ''}`.trim()}>
                                        {formatNumber(stock)} <small>{unit}</small>
                                    </strong>
                                    <div className={s.stockTrack} aria-hidden="true">
                                        <span className={isLow ? s.warnFill : undefined} style={{ width: `${stockLevel}%` }} />
                                    </div>
                                    <small className={s.cellSub}>Mínimo configurado: {formatNumber(minStock)} {unit}</small>
                                </div>
                            </div>

                            <FormSection title="Perfil del producto">
                                <dl className={s.facts}>
                                    <div><dt>Tipo</dt><dd>{PRODUCT_TYPE_LABELS[viewingProduct.type]}</dd></div>
                                    <div><dt>Categoría</dt><dd>{category}</dd></div>
                                    <div><dt>Unidad de referencia</dt><dd>{unit}</dd></div>
                                    <div><dt>Almacenamiento</dt><dd>{storageLabel}</dd></div>
                                </dl>
                            </FormSection>

                            <FormSection title="Costos y precio">
                                <dl className={s.facts}>
                                    <div>
                                        <dt>Costo efectivo para recetas</dt>
                                        <dd className={s.numeric}>{costQuality.known ? formatUnitCost(costQuality.value, settings) : 'N/D'}</dd>
                                        <dd className={s.cellSub}>
                                            {costQuality.source === 'AVERAGE'
                                                ? 'Promedio ponderado'
                                                : costQuality.source === 'REFERENCE' ? 'Costo de referencia' : 'Costo no confirmado'}
                                        </dd>
                                    </div>
                                    <div><dt>Referencia</dt><dd className={s.numeric}>{viewingProduct.referenceCostKnown || Number(viewingProduct.cost) > 0 ? formatUnitCost(Number(viewingProduct.cost), settings) : 'N/D'}</dd></div>
                                    <div><dt>Última compra</dt><dd className={s.numeric}>{formatLastPurchaseCost(viewingProduct, settings)}</dd></div>
                                    <div><dt>Precio de venta</dt><dd className={s.numeric}>{viewingProduct.price != null ? formatCurrency(Number(viewingProduct.price), settings) : 'No aplica'}</dd></div>
                                </dl>
                                <p className={costQuality.known ? s.note : `${s.note} ${s.warn}`}>
                                    {!costQuality.known
                                        ? 'El producto no tiene un costo confirmado. Las salidas se bloquearan hasta corregir esta anomalia.'
                                        : hasTransactionalCost
                                        ? 'El costo efectivo proviene del promedio ponderado de las compras recibidas.'
                                        : 'Mientras no existan compras recibidas, las recetas utilizan el costo de referencia.'}
                                </p>
                            </FormSection>

                            <p className={s.note}>
                                <Activity size={16} aria-hidden="true" />
                                <span>
                                    <strong>Alcance de existencias.</strong>{' '}
                                    Las cantidades corresponden solamente a las sucursales y almacenes permitidos para tu usuario.
                                </span>
                            </p>

                            {viewingProduct.observation && (
                                <FormSection title="Observaciones">
                                    <p className={s.observation}>{viewingProduct.observation}</p>
                                </FormSection>
                            )}
                        </div>
                    );
                })()}
            </FullScreenModal>

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingProduct ? 'Editar producto' : 'Nuevo producto'}
                breadcrumb={['Inventario', 'Productos']}
                subtitle={editingProduct?.sku || undefined}
                tabs={[
                    { id: 'general', label: 'General' },
                    { id: 'stock', label: 'Stock' },
                    { id: 'finanzas', label: 'Finanzas' },
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as typeof activeTab)}
                aside={editingProduct ? (
                    <div className={catalog.summary} aria-label="Costeo transaccional">
                        <h3>Costeo transaccional</h3>
                        <div className={catalog.summaryRow}><span>Costo efectivo para recetas</span><strong>{formatInventoryCost(editingProduct as ProductInventory, settings)}</strong></div>
                        <div className={catalog.summaryRow}><span>Última compra</span><strong>{formatLastPurchaseCost(editingProduct as ProductInventory, settings)}</strong></div>
                        <p className={catalog.muted}>
                            El promedio ponderado y la última compra se actualizan únicamente al recibir compras. El costo de referencia no modifica esos valores.
                        </p>
                    </div>
                ) : undefined}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="inventory-product-form" variant="primary" loading={saving}>
                            {editingProduct ? 'Guardar cambios' : 'Crear producto'}
                        </Button>
                    </>
                )}
            >
                <form id="inventory-product-form" onSubmit={handleSubmit} className={catalog.stack}>
                    {activeTab === 'general' && (
                        <>
                            <FormSection step={1} title="Información general" description="Nombre, tipo y clasificación del producto.">
                                <FormGrid>
                                    <Field label="Nombre del producto" htmlFor="inventory-product-name" required>
                                        <Input
                                            id="inventory-product-name"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            placeholder="Ej: Tomate, Pizza Margherita"
                                        />
                                    </Field>
                                    <Field label="Tipo de producto" htmlFor="inventory-product-type" required>
                                        <AppSelect<Product['type']>
                                            inputId="inventory-product-type"
                                            isClearable={false}
                                            isSearchable={false}
                                            options={PRODUCT_TYPE_OPTIONS}
                                            value={formData.type}
                                            onChange={(type) => type && setFormData({ ...formData, type, categoryId: type === 'INGREDIENT' ? '' : formData.categoryId })}
                                        />
                                    </Field>
                                    <Field
                                        label="Categoría del producto"
                                        htmlFor="inventory-product-category"
                                        hint={formData.type === 'INGREDIENT' ? 'No aplica para ingredientes.' : undefined}
                                    >
                                        <AppSelect
                                            inputId="inventory-product-category"
                                            options={categories.filter(c => isCategoryVisibleInInventory(c)).map(c => ({ value: c.id.toString(), label: c.name }))}
                                            value={formData.categoryId || null}
                                            onChange={(v) => setFormData({ ...formData, categoryId: v ?? '' })}
                                            placeholder={formData.type === 'INGREDIENT' ? 'N/A' : 'Seleccionar categoría...'}
                                            isDisabled={formData.type === 'INGREDIENT'}
                                            isClearable
                                        />
                                    </Field>
                                    <Field label="Tipo de almacenamiento" htmlFor="inventory-storage-type">
                                        <AppSelect<string>
                                            inputId="inventory-storage-type"
                                            isClearable={false}
                                            isSearchable={false}
                                            options={STORAGE_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                            value={formData.storageType}
                                            onChange={(v) => setFormData({ ...formData, storageType: (v ?? '') as typeof formData.storageType })}
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <FormSection step={2} title="Identificación y unidad">
                                <FormGrid>
                                    <Field label="SKU / Código" htmlFor="inventory-product-sku" hint={editingProduct ? undefined : 'Déjalo vacío para autogenerar.'}>
                                        <Input
                                            id="inventory-product-sku"
                                            value={formData.sku}
                                            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                            placeholder={editingProduct ? 'Ej: ING-000001' : 'Dejar vacío para autogenerar'}
                                        />
                                    </Field>
                                    <Field
                                        label="Unidad de referencia"
                                        htmlFor="inventory-product-unit"
                                        required
                                        hint={editingProduct
                                            ? 'La unidad base y sus factores se administran desde Conversiones para proteger el historial físico.'
                                            : allUnits.length === 0 ? 'No hay unidades activas.' : undefined}
                                    >
                                        <AppSelect
                                            inputId="inventory-product-unit"
                                            options={allUnits.map((unit) => ({ value: unit.abbreviation, label: `${unit.name} (${unit.abbreviation})` }))}
                                            value={formData.unit || null}
                                            onChange={(v) => { if (v) setFormData({ ...formData, unit: v }); }}
                                            placeholder={allUnits.length === 0 ? 'Sin unidades' : 'Seleccionar...'}
                                            isDisabled={allUnits.length === 0 || !!editingProduct}
                                        />
                                    </Field>
                                </FormGrid>
                                {allUnits.length === 0 && (
                                    <div>
                                        <Button variant="ghost" onClick={() => navigate('/units-of-measure')}>Gestionar unidades de medida</Button>
                                    </div>
                                )}
                                <Field label="Observación" htmlFor="inventory-observation">
                                    <Textarea
                                        id="inventory-observation"
                                        rows={3}
                                        value={formData.observation}
                                        onChange={(e) => setFormData({ ...formData, observation: e.target.value })}
                                        placeholder="Notas internas sobre el producto (opcional)..."
                                    />
                                </Field>
                            </FormSection>
                        </>
                    )}

                    {activeTab === 'stock' && (
                        <FormSection step={1} title="Gestión de existencias">
                            <FormGrid>
                                <Field
                                    label={`Stock mínimo (alerta)${formData.unit ? ` — en ${formData.unit}` : ''}`}
                                    htmlFor="inventory-min-stock"
                                    required
                                    hint={`Se mostrará una alerta cuando el stock sea inferior a este valor. La cantidad está expresada en la unidad base del producto${formData.unit ? ` (${formData.unit})` : ''}.`}
                                >
                                    <Input
                                        id="inventory-min-stock"
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        className="ui-input--number"
                                        suffix={formData.unit || undefined}
                                        value={formData.minStock}
                                        onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                                        required
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>
                    )}

                    {activeTab === 'finanzas' && (() => {
                        const isSellable = formData.type === 'PRODUCT_FOR_SALE' || formData.type === 'BOTH';
                        return (
                            <FormSection step={1} title="Información financiera">
                                <FormGrid>
                                    <Field
                                        label={`Costo de referencia${formData.unit ? ` por ${formData.unit}` : ''}`}
                                        htmlFor="inventory-reference-cost"
                                        required
                                        hint={editingProduct && Number((editingProduct as ProductInventory).currentAverageCost || 0) > 0
                                            ? 'Valor alternativo para estimaciones; el promedio transaccional vigente tiene prioridad.'
                                            : 'Se usa para recetas y estimaciones mientras no exista un costo promedio transaccional.'}
                                    >
                                        <Input
                                            id="inventory-reference-cost"
                                            type="number"
                                            step="any"
                                            min="0"
                                            className="ui-input--number"
                                            prefix={symbol}
                                            value={formData.cost}
                                            onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                            required
                                        />
                                    </Field>
                                    <Field
                                        label="Precio de venta"
                                        htmlFor="inventory-sale-price"
                                        hint={isSellable
                                            ? 'Importe cobrado al cliente; no se utiliza para costear recetas ni inventario.'
                                            : 'El precio de venta solo aplica a productos de tipo Producto de venta o Ambos.'}
                                    >
                                        <Input
                                            id="inventory-sale-price"
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            className="ui-input--number"
                                            prefix={symbol}
                                            value={isSellable ? formData.price : ''}
                                            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                            placeholder={isSellable ? 'Opcional' : 'No aplica'}
                                            disabled={!isSellable}
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>
                        );
                    })()}
                </form>
            </FullScreenModal>

            {/* Adjustment Modal */}
            <FullScreenModal
                isOpen={isAdjustmentModalOpen}
                onClose={() => setIsAdjustmentModalOpen(false)}
                title="Ajuste de inventario"
                subtitle={adjustmentData.productName || undefined}
                breadcrumb={['Inventario', 'Productos']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="inventory-adjustment-form" variant="primary" loading={adjusting}>
                            Confirmar ajuste
                        </Button>
                    </>
                )}
            >
                <form id="inventory-adjustment-form" onSubmit={handleAdjustmentSubmit} className={catalog.stack}>
                    <FormSection step={1} title={`Ajuste para: ${adjustmentData.productName}`} description="Almacén, tipo de movimiento y cantidad.">
                        <FormGrid>
                            <Field label="Almacén" htmlFor="inventory-adjustment-warehouse">
                                <AppSelect
                                    inputId="inventory-adjustment-warehouse"
                                    options={warehouses.map(warehouse => ({ value: warehouse.id.toString(), label: warehouse.name }))}
                                    value={adjustmentData.warehouseId || null}
                                    onChange={(v) => setAdjustmentData({ ...adjustmentData, warehouseId: v || '' })}
                                    placeholder="Seleccionar almacén..."
                                />
                            </Field>
                            <Field label="Tipo de movimiento" htmlFor="inventory-adjustment-type">
                                <AppSelect<typeof adjustmentData.type>
                                    inputId="inventory-adjustment-type"
                                    isClearable={false}
                                    isSearchable={false}
                                    options={[
                                        { value: 'OUT', label: 'Salida (Desperdicio/Uso)' },
                                        { value: 'ADJUSTMENT', label: 'Entrada (Corrección de conteo)' },
                                        { value: 'IN', label: 'Entrada Directa' },
                                        { value: 'COUNT', label: 'Conteo físico (cantidad contada)' }
                                    ]}
                                    value={adjustmentData.type}
                                    onChange={(v) => v && setAdjustmentData({ ...adjustmentData, type: v })}
                                />
                            </Field>
                            <Field label={adjustmentData.type === 'COUNT' ? 'Cantidad contada' : 'Cantidad'} htmlFor="inventory-adjustment-quantity" required>
                                <Input
                                    id="inventory-adjustment-quantity"
                                    type="number"
                                    step="0.001"
                                    min={adjustmentData.type === 'COUNT' ? 0 : undefined}
                                    className="ui-input--number"
                                    value={adjustmentData.quantity}
                                    onChange={(e) => setAdjustmentData({ ...adjustmentData, quantity: e.target.value })}
                                    required
                                    placeholder="0.00"
                                />
                            </Field>
                            <Field label="Unidad" htmlFor="inventory-adjustment-unit">
                                <AppSelect
                                    inputId="inventory-adjustment-unit"
                                    options={adjustmentUnits.length > 0
                                        ? adjustmentUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))
                                        : [{ value: '', label: 'Sin unidades' }]}
                                    value={adjustmentData.unit || null}
                                    onChange={(v) => setAdjustmentData({ ...adjustmentData, unit: v || '' })}
                                    placeholder="Unidad..."
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Motivo / notas" htmlFor="inventory-adjustment-reason" required>
                            <Textarea
                                id="inventory-adjustment-reason"
                                rows={3}
                                value={adjustmentData.reason}
                                onChange={(e) => setAdjustmentData({ ...adjustmentData, reason: e.target.value })}
                                placeholder="Ej: Producto caducado, corrección de inventario..."
                                required
                            />
                        </Field>
                    </FormSection>
                </form>
            </FullScreenModal>

            <FullScreenModal
                isOpen={showAutoPurchaseSidebar}
                onClose={() => setShowAutoPurchaseSidebar(false)}
                title="Crear orden de compra sugerida"
                breadcrumb={['Inventario', 'Reposición']}
                subtitle={`${selectedSuggestions.length} seleccionados de ${autoPurchaseSuggestions.length} sugerencias`}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button
                            type="submit"
                            form="inventory-auto-po-form"
                            variant="primary"
                            loading={creatingAutoPurchaseOrder}
                            disabled={selectedSuggestions.length === 0}
                        >
                            Crear borrador
                        </Button>
                    </>
                )}
            >
                <form id="inventory-auto-po-form" onSubmit={handleCreateAutoPurchaseOrder} className={catalog.stack}>
                    <FormSection step={1} title="Configurar borrador">
                        <FormGrid>
                            <Field label="Sucursal" htmlFor="inventory-auto-po-branch">
                                <AppSelect
                                    inputId="inventory-auto-po-branch"
                                    options={branches.map((branch) => ({ value: branch.id.toString(), label: branch.name }))}
                                    value={autoPurchaseForm.branchId || null}
                                    onChange={(v) => setAutoPurchaseForm((prev) => ({ ...prev, branchId: v || '' }))}
                                    placeholder="Seleccionar sucursal..."
                                />
                            </Field>
                            <Field label="Proveedor" htmlFor="inventory-auto-po-supplier">
                                <AppSelect
                                    inputId="inventory-auto-po-supplier"
                                    options={suppliers.map((supplier) => ({ value: supplier.id.toString(), label: supplier.name }))}
                                    value={autoPurchaseForm.supplierId || null}
                                    onChange={(v) => setAutoPurchaseForm((prev) => ({ ...prev, supplierId: v || '' }))}
                                    placeholder="Seleccionar proveedor..."
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                    <FormSection step={2} title="Sugerencias de reposición" description="Marca los productos que entran en el borrador.">
                        <DataTable<AutoPurchaseSuggestion>
                            ariaLabel="Sugerencias de reposición"
                            rows={autoPurchaseSuggestions}
                            rowKey={getSuggestionKey}
                            rowTone={(sg) => (sg.priority === 'URGENT' ? 'danger' : undefined)}
                            empty="No hay productos con stock bajo para sugerir compra."
                            toolbar={(
                                <TableToolbar actions={(
                                    <>
                                        <Button variant="ghost" onClick={handleSelectUrgentSuggestions}>Seleccionar urgentes</Button>
                                        <Button variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>Limpiar</Button>
                                    </>
                                )} />
                            )}
                            columns={[
                                {
                                    key: 'select', header: '', width: '3rem',
                                    render: (sg) => (
                                        <Checkbox
                                            aria-label={`Seleccionar ${sg.productName?.trim() || `Producto #${sg.productId}`}`}
                                            checked={Boolean(selectedSuggestionKeys[getSuggestionKey(sg)])}
                                            onChange={() => handleToggleSuggestion(sg)}
                                            label=""
                                        />
                                    ),
                                },
                                { key: 'product', header: 'Producto', render: (sg) => sg.productName?.trim() || `Producto #${sg.productId}` },
                                { key: 'warehouse', header: 'Bodega', hideBelow: 'md', render: (sg) => sg.warehouseName || 'Sin bodega' },
                                {
                                    key: 'priority', header: 'Prioridad', type: 'status',
                                    render: (sg) => <Badge tone={sg.priority === 'URGENT' ? 'danger' : 'neutral'}>{sg.priority === 'URGENT' ? 'Urgente' : 'Normal'}</Badge>,
                                },
                                { key: 'current', header: 'Actual', type: 'qty', hideBelow: 'md', accessor: (sg) => sg.currentStock || 0 },
                                { key: 'min', header: 'Mín', type: 'qty', hideBelow: 'lg', accessor: (sg) => sg.minStock || 0 },
                                { key: 'suggested', header: 'Sugerido', type: 'qty', render: (sg) => formatSuggestionQuantity(sg) },
                                { key: 'cost', header: 'Estimado', type: 'money', render: (sg) => formatCurrency(Number(sg.estimatedCost || 0), settings) },
                            ] as Column<AutoPurchaseSuggestion>[]}
                        />
                    </FormSection>
                </form>
            </FullScreenModal>

            {/* Import Excel */}
            <FullScreenModal
                isOpen={showImportSidebar}
                onClose={closeImportSidebar}
                title="Importar productos desde Excel"
                breadcrumb={['Inventario', 'Productos']}
                subtitle="Los SKU existentes se actualizan; los nuevos se crean. Usa la plantilla para el formato correcto."
                footerStart={<Button variant="ghost" icon={Download} onClick={handleDownloadTemplate}>Descargar plantilla</Button>}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        {importValidation ? (
                            <Button
                                variant="primary"
                                onClick={handleImportConfirm}
                                loading={importLoading}
                                disabled={importValidation.summary.valid === 0}
                            >
                                {`Confirmar importación (${importValidation.summary.valid})`}
                            </Button>
                        ) : (
                            <Button variant="primary" onClick={handleImportValidate} loading={importLoading} disabled={!importFile}>
                                Validar archivo
                            </Button>
                        )}
                    </>
                )}
            >
                <div className={catalog.stack}>
                    <FormSection step={1} title="Archivo" description="Sube un archivo .xlsx o .xls con tus productos.">
                        <input
                            id="inventory-import-file"
                            ref={importFileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            className={s.hiddenFile}
                            onChange={(e) => {
                                setImportFile(e.target.files?.[0] || null);
                                setImportValidation(null);
                                setImportSearch('');
                                setImportShowErrorsOnly(false);
                            }}
                        />
                        <div className={`${s.fileZone}${importFile ? ` ${s.fileZoneReady}` : ''}`}>
                            <FileSpreadsheet size={28} aria-hidden="true" />
                            <strong>{importFile ? importFile.name : 'Elige un archivo Excel'}</strong>
                            <span className={catalog.muted}>
                                {importFile
                                    ? `${formatNumber(importFile.size / 1024, 1)} KB · .xlsx / .xls`
                                    : 'Formatos aceptados: .xlsx, .xls'}
                            </span>
                            <Button icon={Upload} onClick={() => importFileInputRef.current?.click()}>
                                {importFile ? 'Cambiar archivo' : 'Elegir archivo'}
                            </Button>
                        </div>
                    </FormSection>

                    {importValidation && (
                        <FormSection step={2} title="Validación" description="Revisa las filas antes de confirmar.">
                            <p className={s.importSummary} role="status">
                                <Badge tone="success" dot>{`${formatNumber(importValidation.summary.valid, 0)} válidos`}</Badge>
                                <span>{`De ${formatNumber(importValidation.summary.totalRows, 0)} filas · ${formatNumber(importValidation.summary.newProducts, 0)} nuevos, el resto actualiza productos existentes`}</span>
                                {importValidation.summary.invalid > 0 ? (
                                    <>
                                        <Badge tone="danger" dot>{`${formatNumber(importValidation.summary.invalid, 0)} con errores`}</Badge>
                                        <span>No se importan; corrige el archivo y vuelve a validar</span>
                                    </>
                                ) : (
                                    <span>Todas las filas se pueden importar</span>
                                )}
                            </p>
                            <DataTable
                                ariaLabel="Vista previa de importación"
                                rows={filteredImportItems}
                                rowKey={(item) => `${item.rowNumber}-${item.sku}`}
                                defaultPageSize={25}
                                pageSizeOptions={[25, 50, 100]}
                                resetKey={`${importSearch}|${importShowErrorsOnly}`}
                                rowTone={(item) => (item.isValid ? undefined : 'danger')}
                                empty="No hay filas que coincidan con el filtro."
                                toolbar={(
                                    <TableToolbar>
                                        <Input
                                            type="search"
                                            aria-label="Buscar fila"
                                            placeholder="Buscar por SKU o nombre"
                                            prefix={<Search size={14} aria-hidden="true" />}
                                            value={importSearch}
                                            onChange={(e) => setImportSearch(e.target.value)}
                                        />
                                        {importValidation.summary.invalid > 0 && (
                                            <Checkbox
                                                label="Solo errores"
                                                checked={importShowErrorsOnly}
                                                onChange={(e) => setImportShowErrorsOnly(e.target.checked)}
                                            />
                                        )}
                                    </TableToolbar>
                                )}
                                columns={[
                                    { key: 'rowNumber', header: '#', type: 'number', decimals: 0 },
                                    { key: 'sku', header: 'SKU' },
                                    { key: 'name', header: 'Nombre' },
                                    { key: 'action', header: 'Acción', type: 'status', render: (item) => (
                                        <Badge tone={item.isUpdate ? 'neutral' : 'success'}>{item.isUpdate ? 'Actualizar' : 'Nuevo'}</Badge>
                                    ) },
                                    { key: 'status', header: 'Estado', type: 'status', render: (item) => (
                                        item.isValid
                                            ? <Badge tone="success">OK</Badge>
                                            : <Tooltip label={item.errors.join(', ')}><span tabIndex={0}><Badge tone="danger">{item.errors[0]}</Badge></span></Tooltip>
                                    ) },
                                ] as Column<(typeof filteredImportItems)[number]>[]}
                            />
                        </FormSection>
                    )}
                </div>
            </FullScreenModal>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </PageContent>
    );
}
