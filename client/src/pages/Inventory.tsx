import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoPurchaseOrdersAPI, branchesAPI, productsAPI, inventoryMovementsAPI, categoriesAPI, stockAlertsAPI, suppliersAPI, unitsAPI, settingsAPI } from '../services/api';
// import Input from '../components/Input';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { hasAnyRole } from '../utils/authz';
import {
    AlertTriangle, Package, Plus, Edit2, Trash2,
    Activity, ShoppingBag, Layers, Truck, DollarSign, FileText,
    Upload, Download, FileSpreadsheet, Search, LayoutGrid, List, Printer,
    FlaskConical, Box, Eye
} from 'lucide-react';
import type { AutoPurchaseSuggestion, Branch, Product, ProductAllowedUnit, StockAlertItem, Supplier, UnitOfMeasure, Warehouse } from '../types';
import { formatCurrency, currencyInputPadding, type CurrencySettings } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { isCategoryVisibleInInventory } from '../utils/categoryVisibility';
import { resolveEffectiveUnitCost, type ProductCostResolution } from '../utils/productCost';
import { newIdempotencyKey } from '../utils/idempotency';
import './Inventory.css';
import s from './Inventory.module.css';
import { computeInventoryKpis } from '../utils/inventoryKpis';
import { buildWarehouseBreakdown, type WarehouseStockInput } from '../utils/inventoryWarehouses';
import { buildInventoryCountSheetHtml } from '../utils/inventoryCountSheet';
import { AppSelect, Button, SegmentedControl, Field, FullScreenModal, Badge, DataTable, EmptyState, IconButton, PageHeader, StatCard, formatNumber, formatPercent, type Column } from '@/ui';

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

function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
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

function formatInventoryCost(product: ProductInventory, currencySettings: CurrencySettings): string {
    const quality = inventoryCostQuality(product);
    return quality.known ? formatCurrency(quality.value, currencySettings) : 'N/D';
}

function formatLastPurchaseCost(product: ProductInventory, currencySettings: CurrencySettings): string {
    const value = Number(product.lastPurchaseCost);
    const known = product.lastPurchaseCostKnown === true || value > 0;
    return known && Number.isFinite(value) && value >= 0
        ? formatCurrency(value, currencySettings)
        : 'Sin compras';
}

const STORAGE_TYPE_OPTIONS: { value: '' | 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE'; label: string; icon: typeof Package }[] = [
    { value: '', label: 'Sin clasificar', icon: Package },
    { value: 'PERISHABLE', label: 'Perecedero', icon: AlertTriangle },
    { value: 'FROZEN', label: 'Congelado', icon: Layers },
    { value: 'NON_PERISHABLE', label: 'No Perecedero', icon: ShoppingBag }
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
    const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
        (localStorage.getItem('inventory_view_mode') as 'cards' | 'table') || 'cards'
    );
    const TABLE_PAGE_SIZE = 10;
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
        type: 'OUT' as 'IN' | 'OUT' | 'ADJUSTMENT',
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
    const [stockAlerts, setStockAlerts] = useState<StockAlertItem[]>([]);
    const [stockAlertSummary, setStockAlertSummary] = useState<{ criticalAlerts?: number; warningAlerts?: number } | null>(null);
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
            stockAlertsAPI.getAll(),
            stockAlertsAPI.getSummary(),
            autoPurchaseOrdersAPI.getSuggestions()
        ]);

        const [productsRes, lowStockRes, alertsRes, alertSummaryRes, suggestionsRes] = results;

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
        if (alertsRes.status === 'fulfilled') {
            setStockAlerts(alertsRes.value.data.data || []);
            setLoadIssue('Alertas');
        } else {
            setLoadIssue('Alertas', alertsRes.reason);
        }
        if (alertSummaryRes.status === 'fulfilled') {
            setStockAlertSummary(alertSummaryRes.value.data.data || null);
            setLoadIssue('Resumen de alertas');
        } else {
            setLoadIssue('Resumen de alertas', alertSummaryRes.reason);
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

        const payload = {
                warehouseId: Number(adjustmentData.warehouseId),
                productId: adjustmentData.productId,
                type: adjustmentData.type,
                quantity: parseFloat(adjustmentData.quantity),
                reason: adjustmentData.reason,
                unit: adjustmentData.unit || undefined
        };
        const fingerprint = JSON.stringify(payload);
        if (adjustmentAttemptRef.current?.fingerprint !== fingerprint) {
            adjustmentAttemptRef.current = { fingerprint, key: newIdempotencyKey() };
        }

        setAdjusting(true);
        try {
            await inventoryMovementsAPI.create(payload, adjustmentAttemptRef.current.key);
            localStorage.setItem('inventory_adjustment_warehouse_id', adjustmentData.warehouseId);
            showSuccess('Ajuste realizado correctamente');
            adjustmentAttemptRef.current = null;
            setIsAdjustmentModalOpen(false);
            loadInventory();
        } catch (error: unknown) {
            showError('Error: ' + apiErrorMessage(error));
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
                } catch {
                    showWarning(
                        'Producto guardado, pero no se pudo autoconfigurar su unidad. Revise Conversiones antes de comprar o consumir inventario.'
                    );
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
                items: selectedSuggestions.map((suggestion) => ({
                    productId: suggestion.productId,
                    quantity: Number(suggestion.suggestedQuantity),
                    cost: suggestion.suggestedQuantity > 0
                        ? Number(((suggestion.estimatedCost || 0) / suggestion.suggestedQuantity).toFixed(2))
                        : 0
                }))
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
        } catch {
            showError('Error al descargar la plantilla');
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
        } catch {
            showError('Error al validar el archivo');
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
        } catch {
            showError('Error al confirmar la importación');
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
    const kpis = useMemo(() => computeInventoryKpis(products as ProductInventory[]), [products]);
    const warehouseBreakdown = useMemo(
        () => buildWarehouseBreakdown(warehouseStocks, products as ProductInventory[]),
        [warehouseStocks, products],
    );
    const warehouseValueContext = warehouseBreakdown.valueByWarehouse.length > 0
        ? warehouseBreakdown.valueByWarehouse.slice(0, 3).map((w) => `${w.name}: ${formatNumber(w.value)}`).join(' · ')
        : 'Sin existencias valorizadas por almacén';
    const productsTruncated = products.length >= 500;
    const productsFailed = 'Productos' in loadIssues;
    const unknownCostCount = Math.max(kpis.unknownCostCount, warehouseBreakdown.unknownCostCount);
    const unknownCostNote = unknownCostCount > 0
        ? `${unknownCostCount} ${unknownCostCount === 1 ? 'producto sin costo excluido' : 'productos sin costo excluidos'}`
        : '';
    const alertContext = (() => {
        const critical = Number(stockAlertSummary?.criticalAlerts ?? 0);
        const warning = Number(stockAlertSummary?.warningAlerts ?? 0);
        if (critical + warning === 0) return '';
        const byWarehouse = new Map<string, number>();
        for (const a of stockAlerts) {
            if (a.priority === 'URGENT' || Number(a.currentStock) === 0) {
                byWarehouse.set(a.warehouseName, (byWarehouse.get(a.warehouseName) ?? 0) + 1);
            }
        }
        const top = [...byWarehouse.entries()].sort((a, b) => b[1] - a[1])[0];
        return `${critical} ${critical === 1 ? 'alerta crítica' : 'alertas críticas'}${top ? ` (más en ${top[0]})` : ''}, ${warning} ${warning === 1 ? 'preventiva' : 'preventivas'}`;
    })();

    // Type helpers
    const getTypeClass = (type: string, isLow: boolean) => {
        if (isLow) return 'low-stock';
        switch (type) {
            case 'INGREDIENT': return 'ingredient';
            case 'PRODUCT_FOR_SALE': return 'product';
            case 'BOTH': return 'both';
            case 'INTERMEDIATE': return 'intermediate';
            case 'PACKAGING': return 'packaging';
            default: return 'ingredient';
        }
    };


    if (loading) {
        return <div className="inventory-loading">Cargando inventario...</div>;
    }

    return (
        <div className="inventory-page">
            <PageHeader
                title="Gestión de Inventario"
                actions={(
                    <>
                    <div className="inventory-view-toggle">
                        <button
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                            onClick={() => { setViewMode('cards'); localStorage.setItem('inventory_view_mode', 'cards'); }}
                            title="Vista de tarjetas"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => { setViewMode('table'); localStorage.setItem('inventory_view_mode', 'table'); }}
                            title="Vista de tabla"
                        >
                            <List size={18} />
                        </button>
                    </div>
                    <Button variant="secondary" onClick={handlePrintInventory} title="Imprimir inventario">
                        <Printer size={18} />
                        Imprimir
                    </Button>
                    {canMutateProduct && (
                        <Button variant="secondary" onClick={handleDownloadTemplate}>
                            <Download size={18} />
                            Plantilla Excel
                        </Button>
                    )}
                    {canMutateProduct && (
                        <Button variant="secondary" onClick={() => { setShowImportSidebar(true); setImportFile(null); setImportValidation(null); }}>
                            <Upload size={18} />
                            Importar Excel
                        </Button>
                    )}
                    {canCreateAutoPO && (
                        <Button
                            variant="secondary"
                            onClick={() => setShowAutoPurchaseSidebar(true)}
                            disabled={autoPurchaseSuggestions.length === 0}
                        >
                            <FileText size={18} />
                            Crear OC sugerida
                        </Button>
                    )}
                    {/* Acceso a "Unidades de Medida" se gestiona desde su propia vista (sidebar/menú). */}
                    {canMutateProduct && (
                        <Button variant="primary" onClick={() => handleOpenSidebar()} title="Nuevo producto" aria-label="Nuevo producto">
                            <Plus size={20} />
                        </Button>
                    )}
                    </>
                )}
            />

            {Object.keys(loadIssues).length > 0 && (
                <div className="inventory-load-error" role="alert">
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
                        variant="secondary"
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

            <div className="inventory-kpi-grid" style={{ display: 'grid', gap: 'var(--ui-space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: 'var(--ui-space-4)' }}>
                {productsFailed ? (
                    <>
                        <StatCard label="Valor del inventario (C$)" value="No disponible" tone="neutral" context="No se pudieron cargar los productos" />
                        <StatCard label="Reposición requerida (C$)" value="No disponible" tone="neutral" context={[alertContext, 'No se pudieron cargar los productos'].filter(Boolean).join(' · ')} />
                        <StatCard label="Concentración del capital" value="No disponible" tone="neutral" context="No se pudieron cargar los productos" />
                    </>
                ) : (
                    <>
                        <StatCard
                            label="Valor del inventario (C$)"
                            value={formatNumber(kpis.totalValue)}
                            context={[warehouseValueContext, unknownCostNote].filter(Boolean).join(' · ') + (productsTruncated ? ' (primeros 500 productos)' : '')}
                        />
                        <StatCard
                            label="Reposición requerida (C$)"
                            value={formatNumber(kpis.replenishmentCost)}
                            tone={kpis.belowMinCount > 0 ? 'warning' : 'success'}
                            context={[
                                kpis.belowMinCount > 0
                                    ? `${kpis.belowMinCount} bajo mínimo, ${kpis.outOfStockCount} agotados${kpis.outOfStockNames.length > 0 ? ` (${kpis.outOfStockNames.join(', ')}${kpis.outOfStockCount > kpis.outOfStockNames.length ? '…' : ''})` : ''}`
                                    : 'Ningún producto bajo el mínimo',
                                alertContext,
                                unknownCostNote,
                            ].filter(Boolean).join(' · ') + (productsTruncated ? ' · primeros 500 productos' : '')}
                            action={canCreateAutoPO && autoPurchaseSuggestions.length > 0
                                ? { label: 'Generar orden de compra sugerida', onClick: () => setShowAutoPurchaseSidebar(true) }
                                : undefined}
                        />
                        <StatCard
                            label="Concentración del capital"
                            value={formatPercent(kpis.concentrationPct, 1)}
                            context={[kpis.topNames.length > 0 ? `En: ${kpis.topNames.join(', ')}` : 'Sin existencias valorizadas', unknownCostNote].filter(Boolean).join(' · ')}
                        />
                    </>
                )}
            </div>

            {/* Filters Row - Reservations Style Alignment */}
            <div className="inventory-filters-row">
                <div className="inventory-status-filters">
                    <SegmentedControl
                        ariaLabel="Filtrar por tipo"
                        value={filter}
                        onChange={setFilter}
                        options={[
                            { value: 'all', label: 'Todos' },
                            { value: 'INGREDIENT', label: 'Ingredientes' },
                            { value: 'PRODUCT_FOR_SALE', label: 'Productos' },
                            { value: 'INTERMEDIATE', label: 'Intermedios' },
                            { value: 'PACKAGING', label: 'Empaques' },
                            { value: 'low', label: 'Stock bajo' },
                        ]}
                    />

                    <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 8px' }} />

                    <div className="inventory-category-select-wrapper">
                        <AppSelect options={[
                                { value: 'all', label: 'Todas las Categorías' },
                                ...categories.filter(c => isCategoryVisibleInInventory(c) && (c._count?.products ?? 0) > 0).map(cat => ({ value: cat.id.toString(), label: cat.name }))
                            ]} value={(selectedCategory === 'all' ? { value: 'all', label: 'Todas las Categorías' } : { value: selectedCategory, label: categories.find(c => c.id.toString() === selectedCategory)?.name || 'Categoría' })?.value ?? null} onChange={(__v) => { const option = ([
                                { value: 'all', label: 'Todas las Categorías' },
                                ...categories.filter(c => isCategoryVisibleInInventory(c) && (c._count?.products ?? 0) > 0).map(cat => ({ value: cat.id.toString(), label: cat.name }))
                            ]).find((o) => o.value === __v) ?? null; return setSelectedCategory(option?.value || 'all'); }} placeholder="Filtrar por categoría..." />
                    </div>

                    <div className="inventory-category-select-wrapper">
                        <AppSelect options={[
                                { value: 'all', label: 'Almacenamiento' },
                                { value: 'PERISHABLE', label: 'Perecedero' },
                                { value: 'FROZEN', label: 'Congelado' },
                                { value: 'NON_PERISHABLE', label: 'No Perecedero' }
                            ]} value={storageFilter ?? null} onChange={(__v) => { const option = ([
                                { value: 'all', label: 'Almacenamiento' },
                                { value: 'PERISHABLE', label: 'Perecedero' },
                                { value: 'FROZEN', label: 'Congelado' },
                                { value: 'NON_PERISHABLE', label: 'No Perecedero' }
                            ]).find((o) => o.value === __v) ?? null; return setStorageFilter(option?.value || 'all'); }} placeholder="Almacenamiento..." />
                    </div>
                </div>

                <div className="filter-right-section">

                    <input
                        type="text"
                        placeholder="Buscar por nombre o SKU..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="search-input inventory-search"
                    />
                </div>
            </div>

            {/* Products Grid - Tables Style */}
            {viewMode === 'cards' && (
            <div className="inventory-grid-new">
                {filteredProducts.map(product => {
                    const isLow = lowStock.some(p => p.id === product.id);

                    return (
                        <div key={product.id} className={`inventory-card-new ${getTypeClass(product.type, isLow)}`}>

                            {/* Card Body */}
                            <div className="inventory-card-body-new">
                                <div className="product-name-new">{product.name}</div>

                                <div className="product-details-new">
                                    {product.sku && (
                                        <div className="detail-item">
                                            <span className="sku-tag">{product.sku}</span>
                                        </div>
                                    )}
                                    {product.storageType && (
                                        <div className="detail-item">
                                            <span className="sku-tag" style={{
                                                background: product.storageType === 'PERISHABLE' ? '#FEF2F2' : product.storageType === 'FROZEN' ? '#EFF6FF' : '#F0FDF4',
                                                color: product.storageType === 'PERISHABLE' ? '#DC2626' : product.storageType === 'FROZEN' ? '#2563EB' : '#16A34A',
                                                border: `1px solid ${product.storageType === 'PERISHABLE' ? '#FECACA' : product.storageType === 'FROZEN' ? '#BFDBFE' : '#BBF7D0'}`
                                            }}>
                                                {{ 'PERISHABLE': 'Perecedero', 'FROZEN': 'Congelado', 'NON_PERISHABLE': 'No Perecedero' }[product.storageType]}
                                            </span>
                                        </div>
                                    )}
                                    <div className="detail-item">
                                        <span>{product.baseUnit?.abbreviation || product.unit}</span>
                                    </div>
                                </div>

                                <div className="product-pricing-new">
                                    <div className="pricing-item">
                                        <span className="pricing-label">Costo unit.</span>
                                        <span className="pricing-value">{formatInventoryCost(product as ProductInventory, settings)}</span>
                                    </div>
                                    <div className="pricing-item">
                                        <span className="pricing-label">Precio</span>
                                        <span className="pricing-value price">
                                            {product.price ? formatCurrency(Number(product.price), settings) : '-'}
                                        </span>
                                    </div>
                                    <div className="pricing-item">
                                        <span className="pricing-label">Mín</span>
                                        <span className="pricing-value">{product.minStock}</span>
                                    </div>
                                </div>

                                {/* Low Stock Warning */}
                                {isLow && (
                                    <div className="low-stock-badge-new">
                                        <AlertTriangle size={14} />
                                        Stock Mínimo Alcanzado
                                    </div>
                                )}
                            </div>

                            {/* Actions Bar - Tables Style */}
                            <div className="inventory-card-actions-new">
                                <button
                                    className="action-btn-new view"
                                    onClick={() => handleViewProduct(product)}
                                    title="Ver detalle"
                                >
                                    <Eye size={20} />
                                    <span>Ver</span>
                                </button>
                                <button
                                    className="action-btn-new kardex"
                                    onClick={() => navigate(`/kardex?productId=${product.id}`)}
                                    title="Ver Kardex"
                                >
                                    <FileText size={20} />
                                    <span>Kardex</span>
                                </button>
                                {canAdjustStock && (
                                    <button
                                        className="action-btn-new adjust"
                                        onClick={() => handleOpenAdjustment(product)}
                                        title="Ajustar Stock"
                                    >
                                        <Activity size={20} />
                                        <span>Ajustar</span>
                                    </button>
                                )}
                                {canMutateProduct && (
                                    <button
                                        className="action-btn-new adjust"
                                        onClick={() => navigate(`/inventory/${product.id}/units`)}
                                        title="Conversiones de unidades"
                                    >
                                        <Layers size={20} />
                                        <span>Conversiones</span>
                                    </button>
                                )}
                                {canMutateProduct && (
                                    <button
                                        className="action-btn-new edit"
                                        onClick={() => handleOpenSidebar(product)}
                                        title="Editar"
                                    >
                                        <Edit2 size={20} />
                                        <span>Editar</span>
                                    </button>
                                )}
                                {canDeleteProduct && (
                                    <button
                                        className="action-btn-new delete"
                                        onClick={() => handleDelete(product.id)}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            )}

            {/* Table View */}
            {viewMode === 'table' && filteredProducts.length > 0 && (
                <DataTable<ProductInventory>
                    ariaLabel="Inventario de productos"
                    rows={filteredProducts as ProductInventory[]}
                    rowKey={(product) => product.id}
                    defaultPageSize={TABLE_PAGE_SIZE}
                    pageSizeOptions={[10, 25, 50, 100]}
                    resetKey={`${filter}|${searchQuery}|${selectedCategory}|${storageFilter}`}
                    rowTone={(product) => (isLowStockProduct(product.id) ? 'warning' : undefined)}
                    footerLabel="Total (sin productos N/D)"
                    columns={[
                        { key: 'sku', header: 'Código', width: 'minmax(5.5rem,.8fr)', render: (product) => product.sku || '-' },
                        { key: 'name', header: 'Producto', width: '2.4fr', render: (product) => product.name },
                        { key: 'category', header: 'Categoría', width: '1.2fr', render: (product) => categories.find((c) => c.id === product.categoryId)?.name || '-' },
                        { key: 'warehouse', header: 'Bodega', width: '1.1fr', render: (product) => warehouseBreakdown.labelByProduct.get(product.id) ?? '-' },
                        { key: 'stock', header: 'Existencia', width: '1fr', type: 'qty', accessor: (product) => product.totalStock ?? 0 },
                        { key: 'unit', header: 'Unidad', width: '.6fr', render: (product) => product.baseUnit?.abbreviation || product.unit },
                        { key: 'cost', header: 'Costo (C$)', width: '1fr', type: 'money', accessor: (product) => inventoryCostQuality(product).value, render: (product) => (inventoryCostQuality(product).known ? formatNumber(inventoryCostQuality(product).value) : 'N/D') },
                        { key: 'value', header: 'Valor (C$)', width: '1.2fr', type: 'money', total: true, accessor: (product) => (inventoryCostQuality(product).known ? Number(product.totalStock ?? 0) * inventoryCostQuality(product).value : null), render: (product) => (inventoryCostQuality(product).known ? formatNumber(Number(product.totalStock ?? 0) * inventoryCostQuality(product).value) : 'N/D') },
                        { key: 'status', header: 'Estado', width: '1fr', type: 'status', render: (product) => (
                            <Badge tone={isLowStockProduct(product.id) ? 'warning' : 'success'} dot>
                                {isLowStockProduct(product.id) ? 'Stock bajo' : 'OK'}
                            </Badge>
                        ) },
                        { key: 'actions', header: 'Acciones', width: '48px', type: 'actions', render: (product) => (
                            <div className="table-actions">
                                <IconButton icon={Eye} label={`Ver detalle de ${product.name}`} onClick={() => handleViewProduct(product)} />
                                <IconButton icon={FileText} label={`Ver kardex de ${product.name}`} onClick={() => navigate(`/kardex?productId=${product.id}`)} />
                                {canAdjustStock && <IconButton icon={Activity} label={`Ajustar stock de ${product.name}`} onClick={() => handleOpenAdjustment(product)} />}
                                {canMutateProduct && <IconButton icon={Layers} label={`Conversiones de ${product.name}`} onClick={() => navigate(`/inventory/${product.id}/units`)} />}
                                {canMutateProduct && <IconButton icon={Edit2} label={`Editar ${product.name}`} onClick={() => handleOpenSidebar(product)} />}
                                {canDeleteProduct && <IconButton icon={Trash2} label={`Eliminar ${product.name}`} onClick={() => handleDelete(product.id)} />}
                            </div>
                        ) },
                    ] as Column<ProductInventory>[]}
                />
            )}

            {
                filteredProducts.length === 0 && (
                    <div className="no-products-message">
                        <Package size={48} />
                        <p>No hay productos {filter !== 'all' ? 'con este filtro' : 'registrados'}</p>
                        {filter !== 'all' ? (
                            <Button variant="primary" onClick={() => setFilter('all')}>Ver todos</Button>
                        ) : canMutateProduct ? (
                            <Button variant="primary" onClick={() => handleOpenSidebar()}>Crear primer producto</Button>
                        ) : null}
                    </div>
                )
            }

            {/* Product Form Sidebar */}
            <FullScreenModal
                isOpen={Boolean(viewingProduct)}
                onClose={() => setViewingProduct(null)}
                title="Detalle del Producto"
                footer={viewingProduct ? (
                    <div className="inventory-detail-footer">
                        <Button type="button" variant="ghost" onClick={() => setViewingProduct(null)}>
                            Cerrar
                        </Button>
                        <div className="inventory-detail-footer-actions">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => navigate(`/kardex?productId=${viewingProduct.id}`)}
                            >
                                <FileText size={16} />
                                Ver Kardex
                            </Button>
                            {canMutateProduct && (
                                <Button type="button" variant="primary" onClick={handleEditFromDetail}>
                                    <Edit2 size={16} />
                                    Editar Producto
                                </Button>
                            )}
                        </div>
                    </div>
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
                        <div className="inventory-detail" data-testid="inventory-product-detail">
                            <div className="inventory-detail-hero">
                                <div className="inventory-detail-hero-main">
                                    <div className="inventory-detail-icon" aria-hidden="true">
                                        <Package size={28} />
                                    </div>
                                    <div className="inventory-detail-identity">
                                        <span className="inventory-detail-eyebrow">Ficha de inventario</span>
                                        <h3>{viewingProduct.name}</h3>
                                        <div className="inventory-detail-meta">
                                            {viewingProduct.sku && <span className="inventory-detail-badge sku">SKU {viewingProduct.sku}</span>}
                                            <div className="inventory-detail-status-row">
                                                <span className={`inventory-detail-badge ${viewingProduct.active ? 'active' : 'inactive'}`}>
                                                    {viewingProduct.active ? 'Activo' : 'Inactivo'}
                                                </span>
                                                <span className={`inventory-detail-badge ${isLow ? 'warning' : 'ok'}`}>
                                                    {isLow ? 'Requiere reposición' : 'Stock saludable'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="inventory-detail-stock-summary">
                                    <span>Existencia actual</span>
                                    <strong className={isLow ? 'warning' : ''}>
                                        {stock.toLocaleString('es-NI', { maximumFractionDigits: 3 })}
                                        <small>{unit}</small>
                                    </strong>
                                    <div className="inventory-detail-stock-track" aria-hidden="true">
                                        <span className={isLow ? 'warning' : ''} style={{ width: `${stockLevel}%` }} />
                                    </div>
                                    <small>Mínimo configurado: {minStock.toLocaleString('es-NI', { maximumFractionDigits: 3 })} {unit}</small>
                                </div>
                            </div>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header">
                                    <Box size={18} />
                                    <h3>Perfil del producto</h3>
                                </div>
                                <div className="inventory-detail-profile-grid">
                                    <div className="inventory-detail-profile-item">
                                        <Layers size={18} aria-hidden="true" />
                                        <div><span>Tipo</span><strong>{PRODUCT_TYPE_LABELS[viewingProduct.type]}</strong></div>
                                    </div>
                                    <div className="inventory-detail-profile-item">
                                        <ShoppingBag size={18} aria-hidden="true" />
                                        <div><span>Categoría</span><strong>{category}</strong></div>
                                    </div>
                                    <div className="inventory-detail-profile-item">
                                        <FlaskConical size={18} aria-hidden="true" />
                                        <div><span>Unidad de referencia</span><strong>{unit}</strong></div>
                                    </div>
                                    <div className="inventory-detail-profile-item">
                                        <Truck size={18} aria-hidden="true" />
                                        <div><span>Almacenamiento</span><strong>{storageLabel}</strong></div>
                                    </div>
                                </div>
                            </section>

                            <section className="inventory-detail-section">
                                <div className="modal-section-header">
                                    <DollarSign size={18} />
                                    <h3>Costos y precio</h3>
                                </div>
                                <div className="inventory-detail-finance">
                                    <div className="inventory-detail-effective-cost">
                                        <div>
                                            <span>Costo efectivo para recetas</span>
                                            <strong>{costQuality.known ? formatCurrency(costQuality.value, settings) : 'N/D'}</strong>
                                        </div>
                                        <span className="inventory-detail-cost-source">
                                            {costQuality.source === 'AVERAGE'
                                                ? 'Promedio ponderado'
                                                : costQuality.source === 'REFERENCE' ? 'Costo de referencia' : 'Costo no confirmado'}
                                        </span>
                                    </div>
                                    <dl className="inventory-detail-finance-breakdown">
                                        <div><dt>Referencia</dt><dd>{viewingProduct.referenceCostKnown || Number(viewingProduct.cost) > 0 ? formatCurrency(Number(viewingProduct.cost), settings) : 'N/D'}</dd></div>
                                        <div><dt>Última compra</dt><dd>{formatLastPurchaseCost(viewingProduct, settings)}</dd></div>
                                        <div><dt>Precio de venta</dt><dd>{viewingProduct.price != null ? formatCurrency(Number(viewingProduct.price), settings) : 'No aplica'}</dd></div>
                                    </dl>
                                    <p className="inventory-detail-finance-note">
                                        {!costQuality.known
                                            ? 'El producto no tiene un costo confirmado. Las salidas se bloquearan hasta corregir esta anomalia.'
                                            : hasTransactionalCost
                                            ? 'El costo efectivo proviene del promedio ponderado de las compras recibidas.'
                                            : 'Mientras no existan compras recibidas, las recetas utilizan el costo de referencia.'}
                                    </p>
                                </div>
                            </section>

                            <section className="inventory-detail-section inventory-detail-operational-note">
                                <Activity size={18} aria-hidden="true" />
                                <div>
                                    <strong>Alcance de existencias</strong>
                                    <p>Las cantidades corresponden solamente a las sucursales y almacenes permitidos para tu usuario.</p>
                                </div>
                            </section>

                            {viewingProduct.observation && (
                                <section className="inventory-detail-section">
                                    <div className="modal-section-header">
                                        <FileText size={18} />
                                        <h3>Observaciones</h3>
                                    </div>
                                    <p className="inventory-detail-observation">{viewingProduct.observation}</p>
                                </section>
                            )}
                        </div>
                    );
                })()}
            </FullScreenModal>

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
            >
                <div className="premium-modal-content product-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs" role="tablist" aria-label="Secciones del producto">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'general'}
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Package size={18} />
                            <span>General</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'stock'}
                            className={`modal-tab ${activeTab === 'stock' ? 'active' : ''}`}
                            onClick={() => setActiveTab('stock')}
                        >
                            <Truck size={18} />
                            <span>Stock</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'finanzas'}
                            className={`modal-tab ${activeTab === 'finanzas' ? 'active' : ''}`}
                            onClick={() => setActiveTab('finanzas')}
                        >
                            <DollarSign size={18} />
                            <span>Finanzas</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeTab === 'general' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Package size={18} />
                                        <h3>Información General</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="inventory-product-name">Nombre del Producto</label>
                                        <input
                                            id="inventory-product-name"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            placeholder="Ej: Tomate, Pizza Margherita"
                                        />
                                    </div>

                                    <div className={formData.type === 'INGREDIENT' ? 'disabled-group' : ''}>
                                        <Field label={formData.type === 'INGREDIENT' ? 'Categoría del Producto (No aplica para ingredientes)' : 'Categoría del Producto'} htmlFor="inventory-product-category">
<AppSelect inputId="inventory-product-category" options={categories.filter(c => isCategoryVisibleInInventory(c)).map(c => ({ value: c.id.toString(), label: c.name }))} value={(formData.categoryId
                                                    ? categories
                                                        .filter(c => isCategoryVisibleInInventory(c))
                                                        .map(c => ({ value: c.id.toString(), label: c.name }))
                                                        .find(opt => opt.value === formData.categoryId) || null
                                                    : null)?.value ?? null} onChange={(__v) => { const option = (categories.filter(c => isCategoryVisibleInInventory(c)).map(c => ({ value: c.id.toString(), label: c.name }))).find((o) => o.value === __v) ?? null; return setFormData({ ...formData, categoryId: option ? option.value : '' }); }} placeholder={formData.type === 'INGREDIENT' ? 'N/A' : 'Seleccionar categoría...'} isDisabled={formData.type === 'INGREDIENT'} isClearable />
</Field>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="inventory-product-type-label">Tipo de Producto</label>
                                        <div className="type-selector-grid" role="group" aria-labelledby="inventory-product-type-label">
                                            <button
                                                type="button"
                                                className={`type-option ${formData.type === 'INGREDIENT' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'INGREDIENT', categoryId: '' })}
                                                aria-pressed={formData.type === 'INGREDIENT'}
                                            >
                                                <Package size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Ingrediente</span>
                                                    <span className="type-desc">Uso interno</span>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                className={`type-option ${formData.type === 'PRODUCT_FOR_SALE' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'PRODUCT_FOR_SALE' })}
                                                aria-pressed={formData.type === 'PRODUCT_FOR_SALE'}
                                            >
                                                <ShoppingBag size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Venta</span>
                                                    <span className="type-desc">Directo</span>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                className={`type-option ${formData.type === 'BOTH' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'BOTH' })}
                                                aria-pressed={formData.type === 'BOTH'}
                                            >
                                                <Layers size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Ambos</span>
                                                    <span className="type-desc">Uso y Venta</span>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                className={`type-option ${formData.type === 'INTERMEDIATE' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'INTERMEDIATE' })}
                                                aria-pressed={formData.type === 'INTERMEDIATE'}
                                            >
                                                <FlaskConical size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Intermedio</span>
                                                    <span className="type-desc">Semielaborado</span>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                className={`type-option ${formData.type === 'PACKAGING' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'PACKAGING' })}
                                                aria-pressed={formData.type === 'PACKAGING'}
                                            >
                                                <Box size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Empaque</span>
                                                    <span className="type-desc">Material</span>
                                                </div>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" id="inventory-storage-type-label">Tipo de Almacenamiento</label>
                                        <div className="type-selector-grid type-selector-grid--storage" role="group" aria-labelledby="inventory-storage-type-label">
                                            {STORAGE_TYPE_OPTIONS.map((opt) => (
                                                <button type="button" key={opt.value || 'none'}
                                                    className={`type-option ${formData.storageType === opt.value ? 'active' : ''}`}
                                                    onClick={() => setFormData({ ...formData, storageType: opt.value })}
                                                    aria-pressed={formData.storageType === opt.value}
                                                >
                                                    <opt.icon size={18} />
                                                    <div className="type-info">
                                                        <span className="type-name">{opt.label}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="inventory-product-sku">
                                                SKU / Código
                                                {!editingProduct && (
                                                    <span className="label-note"> </span>
                                                )}
                                            </label>
                                            <input
                                                id="inventory-product-sku"
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.sku}
                                                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                                placeholder={editingProduct ? 'Ej: ING-000001' : 'Dejar vacío para autogenerar'}
                                            />
                                        </div>
                                        <Field label="Unidad de referencia" htmlFor="sel-1578">
<AppSelect inputId="sel-1578" options={allUnits.map((unit) => ({
                                                value: unit.abbreviation,
                                                label: `${unit.name} (${unit.abbreviation})`
                                            }))} value={(formData.unit
                                                ? {
                                                    value: formData.unit,
                                                    label: allUnits.find((unit) => unit.abbreviation === formData.unit)
                                                        ? `${allUnits.find((unit) => unit.abbreviation === formData.unit)!.name} (${formData.unit})`
                                                        : formData.unit
                                                }
                                                : null)?.value ?? null} onChange={(__v) => { const option = (allUnits.map((unit) => ({
                                                value: unit.abbreviation,
                                                label: `${unit.name} (${unit.abbreviation})`
                                            }))).find((o) => o.value === __v) ?? null; 
                                                if (!option) return;
                                                setFormData({ ...formData, unit: option.value });
                                            }} placeholder={allUnits.length === 0 ? 'Sin unidades' : 'Seleccionar...'} isDisabled={allUnits.length === 0 || !!editingProduct} />
</Field>
                                        {editingProduct && (
                                            <p className="modal-input-hint">
                                                La unidad base y sus factores se administran desde Conversiones para proteger el historial físico.
                                            </p>
                                        )}
                                        {allUnits.length === 0 && (
                                            <p className="modal-input-hint">
                                                No hay unidades activas.{' '}
                                                <button
                                                    type="button"
                                                    className="units-inline-link"
                                                    onClick={() => navigate('/units-of-measure')}
                                                >
                                                    Gestionar unidades de medida
                                                </button>
                                            </p>
                                        )}
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="inventory-observation">Observación</label>
                                        <textarea
                                            id="inventory-observation"
                                            className="modal-textarea inventory-observation-input"
                                            value={formData.observation}
                                            onChange={(e) => setFormData({ ...formData, observation: e.target.value })}
                                            placeholder="Notas internas sobre el producto (opcional)..."
                                        />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'stock' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <Truck size={18} />
                                        <h3>Gestión de Existencias</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="inventory-min-stock">
                                            Stock Mínimo (Alerta){formData.unit ? ` — en ${formData.unit}` : ''}
                                        </label>
                                        <input
                                            id="inventory-min-stock"
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            className="modal-standard-input"
                                            value={formData.minStock}
                                            onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                                            required
                                        />
                                        <small style={{ color: 'var(--color-neutral-500)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                                            Se mostrará una alerta cuando el stock sea inferior a este valor. La cantidad
                                            está expresada en la <strong>unidad base</strong> del producto{formData.unit ? ` (${formData.unit})` : ''}.
                                        </small>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'finanzas' && (
                                <div className="modal-content-group">
                                    <div className="modal-section-header">
                                        <DollarSign size={18} />
                                        <h3>Información Financiera</h3>
                                    </div>

                                    {editingProduct && (
                                        <div className="inventory-cost-summary">
                                            <div className="inventory-cost-summary-title">
                                                💡 Costeo transaccional activo
                                            </div>
                                            <div className="inventory-cost-summary-copy">
                                                El <strong>promedio ponderado</strong> y la <strong>última compra</strong> se actualizan únicamente al recibir compras. El costo de referencia no modifica esos valores.
                                            </div>
                                            <div className="inventory-cost-summary-metrics">
                                                <div className="inventory-cost-metric">
                                                    <span>Costo efectivo para recetas</span>
                                                    <strong>
                                                        {formatInventoryCost(editingProduct as ProductInventory, settings)}
                                                    </strong>
                                                </div>
                                                <div className="inventory-cost-metric">
                                                    <span>Última compra</span>
                                                    <strong>
                                                        {formatLastPurchaseCost(editingProduct as ProductInventory, settings)}
                                                    </strong>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="inventory-finance-fields">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="inventory-reference-cost">
                                                Costo de referencia{formData.unit ? ` por ${formData.unit}` : ''}
                                            </label>
                                            <div className="price-input-wrapper">
                                                <span className="price-currency-icon">{symbol}</span>
                                                <input
                                                    id="inventory-reference-cost"
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    className="modal-standard-input"
                                                    style={{ paddingLeft: currencyInputPadding(symbol) }}
                                                    value={formData.cost}
                                                    onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                                    required
                                                />
                                            </div>
                                            <small className="inventory-finance-helper">
                                                {editingProduct && Number((editingProduct as ProductInventory).currentAverageCost || 0) > 0
                                                    ? 'Valor alternativo para estimaciones; el promedio transaccional vigente tiene prioridad.'
                                                    : 'Se usa para recetas y estimaciones mientras no exista un costo promedio transaccional.'}
                                            </small>
                                        </div>

                                        {(() => {
                                            const isSellable = formData.type === 'PRODUCT_FOR_SALE' || formData.type === 'BOTH';
                                            return (
                                            <div className="modal-input-group">
                                                <label className="modal-input-label" htmlFor="inventory-sale-price">Precio de Venta</label>
                                                <div className="price-input-wrapper">
                                                    <span className="price-currency-icon">{symbol}</span>
                                                    <input
                                                        id="inventory-sale-price"
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        className="modal-standard-input"
                                                        style={{ paddingLeft: currencyInputPadding(symbol) }}
                                                        value={isSellable ? formData.price : ''}
                                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                        placeholder={isSellable ? 'Opcional' : 'No aplica'}
                                                        disabled={!isSellable}
                                                    />
                                                </div>
                                                {!isSellable && (
                                                    <small className="inventory-finance-helper">
                                                        El precio de venta solo aplica a productos de tipo <strong>Producto de Venta</strong> o <strong>Ambos</strong>.
                                                    </small>
                                                )}
                                                {isSellable && (
                                                    <small className="inventory-finance-helper">
                                                        Importe cobrado al cliente; no se utiliza para costear recetas ni inventario.
                                                    </small>
                                                )}
                                            </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary" disabled={saving}>
                                {saving ? 'Guardando...' : editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                            </Button>
                        </div>
                    </form>
                </div>
            </FullScreenModal>

            {/* Adjustment Modal Sidebar */}
            <FullScreenModal
                isOpen={isAdjustmentModalOpen}
                onClose={() => setIsAdjustmentModalOpen(false)}
                title="Ajuste de Inventario"
            >
                <div className="premium-modal-content product-modal-content">
                    <form onSubmit={handleAdjustmentSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-content-group">
                                <div className="modal-section-header">
                                    <Activity size={18} />
                                    <h3>Ajuste para: {adjustmentData.productName}</h3>
                                </div>

                                <Field label="Almacén" htmlFor="sel-1780">
<AppSelect inputId="sel-1780" options={warehouses.map(warehouse => ({
                                        value: warehouse.id.toString(),
                                        label: warehouse.name
                                    }))} value={(adjustmentData.warehouseId
                                        ? {
                                            value: adjustmentData.warehouseId,
                                            label: warehouses.find(warehouse => warehouse.id.toString() === adjustmentData.warehouseId)?.name || 'Seleccionar almacén...'
                                        }
                                        : null)?.value ?? null} onChange={(__v) => { const option = (warehouses.map(warehouse => ({
                                        value: warehouse.id.toString(),
                                        label: warehouse.name
                                    }))).find((o) => o.value === __v) ?? null; return setAdjustmentData({ ...adjustmentData, warehouseId: option?.value || '' }); }} placeholder="Seleccionar almacén..." />
</Field>

                                <Field label="Tipo de Movimiento" htmlFor="sel-1798">
<AppSelect inputId="sel-1798" options={[
                                        { value: 'OUT', label: 'Salida (Desperdicio/Uso)' },
                                        { value: 'ADJUSTMENT', label: 'Entrada (Corrección de conteo)' },
                                        { value: 'IN', label: 'Entrada Directa' }
                                    ]} value={({
                                        value: adjustmentData.type,
                                        label: {
                                            'OUT': 'Salida (Desperdicio/Uso)',
                                            'ADJUSTMENT': 'Entrada (Corrección de conteo)',
                                            'IN': 'Entrada Directa'
                                        }[adjustmentData.type]
                                    })?.value ?? null} onChange={(__v) => { const option = ([
                                        { value: 'OUT', label: 'Salida (Desperdicio/Uso)' },
                                        { value: 'ADJUSTMENT', label: 'Entrada (Corrección de conteo)' },
                                        { value: 'IN', label: 'Entrada Directa' }
                                    ]).find((o) => o.value === __v) ?? null; return option && setAdjustmentData({ ...adjustmentData, type: option.value as typeof adjustmentData.type }); }} />
</Field>

                                <div className="modal-form-row">
                                    <div className="modal-input-group" style={{ flex: 2 }}>
                                        <label className="modal-input-label" htmlFor="inventory-adjustment-quantity">Cantidad</label>
                                        <input
                                            id="inventory-adjustment-quantity"
                                            type="number"
                                            step="0.001"
                                            className="modal-standard-input"
                                            value={adjustmentData.quantity}
                                            onChange={(e) => setAdjustmentData({ ...adjustmentData, quantity: e.target.value })}
                                            required
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <Field label="Unidad" htmlFor="sel-1834">
<AppSelect inputId="sel-1834" options={adjustmentUnits.length > 0
                                                ? adjustmentUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))
                                                : [{ value: '', label: 'Sin unidades' }]} value={(adjustmentData.unit
                                                ? {
                                                    value: adjustmentData.unit,
                                                    label: adjustmentUnits.find(u => u.abbreviation === adjustmentData.unit)
                                                        ? `${adjustmentUnits.find(u => u.abbreviation === adjustmentData.unit)!.name} (${adjustmentData.unit})`
                                                        : adjustmentData.unit
                                                }
                                                : null)?.value ?? null} onChange={(__v) => { const option = (adjustmentUnits.length > 0
                                                ? adjustmentUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))
                                                : [{ value: '', label: 'Sin unidades' }]).find((o) => o.value === __v) ?? null; return setAdjustmentData({ ...adjustmentData, unit: option?.value || '' }); }} placeholder="Unidad..." />
</Field>
                                    </div>
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="inventory-adjustment-reason">Motivo / Notas</label>
                                    <textarea
                                        id="inventory-adjustment-reason"
                                        className="modal-textarea"
                                        rows={3}
                                        value={adjustmentData.reason}
                                        onChange={(e) => setAdjustmentData({ ...adjustmentData, reason: e.target.value })}
                                        placeholder="Ej: Producto caducado, corrección de inventario..."
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsAdjustmentModalOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary" disabled={adjusting}>
                                {adjusting ? 'Aplicando...' : 'Confirmar Ajuste'}
                            </Button>
                        </div>
                    </form>
                </div>
            </FullScreenModal>

            <FullScreenModal
                isOpen={showAutoPurchaseSidebar}
                onClose={() => setShowAutoPurchaseSidebar(false)}
                title="Crear Orden de Compra Sugerida"
            >
                <div className="premium-modal-content product-modal-content">
                    <form onSubmit={handleCreateAutoPurchaseOrder} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-content-group">
                                <div className="modal-section-header">
                                    <FileText size={18} />
                                    <h3>Sugerencias de reposición</h3>
                                </div>

                                <div className="modal-form-row">
                                    <Field label="Sucursal" htmlFor="sel-1898">
<AppSelect inputId="sel-1898" options={branches.map((branch) => ({
                                            value: branch.id.toString(),
                                            label: branch.name
                                        }))} value={(autoPurchaseForm.branchId
                                            ? {
                                                value: autoPurchaseForm.branchId,
                                                label: branches.find((branch) => branch.id.toString() === autoPurchaseForm.branchId)?.name || 'Seleccionar sucursal'
                                            }
                                            : null)?.value ?? null} onChange={(__v) => { const option = (branches.map((branch) => ({
                                            value: branch.id.toString(),
                                            label: branch.name
                                        }))).find((o) => o.value === __v) ?? null; return setAutoPurchaseForm((prev) => ({ ...prev, branchId: option?.value || '' })); }} placeholder="Seleccionar sucursal..." />
</Field>

                                    <Field label="Proveedor" htmlFor="sel-1916">
<AppSelect inputId="sel-1916" options={suppliers.map((supplier) => ({
                                            value: supplier.id.toString(),
                                            label: supplier.name
                                        }))} value={(autoPurchaseForm.supplierId
                                            ? {
                                                value: autoPurchaseForm.supplierId,
                                                label: suppliers.find((supplier) => supplier.id.toString() === autoPurchaseForm.supplierId)?.name || 'Seleccionar proveedor'
                                            }
                                            : null)?.value ?? null} onChange={(__v) => { const option = (suppliers.map((supplier) => ({
                                            value: supplier.id.toString(),
                                            label: supplier.name
                                        }))).find((o) => o.value === __v) ?? null; return setAutoPurchaseForm((prev) => ({ ...prev, supplierId: option?.value || '' })); }} placeholder="Seleccionar proveedor..." />
</Field>
                                </div>

                                <div className={s.poSuggestionToolbar}>
                                    <span className={s.poSuggestionCount}>
                                        {selectedSuggestions.length} seleccionados de {autoPurchaseSuggestions.length} sugerencias
                                    </span>
                                    <div className={s.poSuggestionToolbarActions}>
                                        <Button type="button" variant="ghost" onClick={handleSelectUrgentSuggestions}>
                                            Seleccionar urgentes
                                        </Button>
                                        <Button type="button" variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>
                                            Limpiar
                                        </Button>
                                    </div>
                                </div>

                                <div className={s.poSuggestionList}>
                                    {autoPurchaseSuggestions.length === 0 ? (
                                        <div className={s.poSuggestionEmpty}>
                                            No hay productos con stock bajo para sugerir compra.
                                        </div>
                                    ) : (
                                        autoPurchaseSuggestions.map((suggestion) => {
                                            const key = getSuggestionKey(suggestion);
                                            const checked = Boolean(selectedSuggestionKeys[key]);
                                            const isUrgent = suggestion.priority === 'URGENT';
                                            const displayName = suggestion.productName?.trim() || `Producto #${suggestion.productId}`;
                                            return (
                                                <label
                                                    key={key}
                                                    className={`${s.poSuggestionCard}${checked ? ` ${s.isSelected}` : ''}${isUrgent ? ` ${s.isUrgent}` : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className={s.poSuggestionCheckbox}
                                                        checked={checked}
                                                        onChange={() => handleToggleSuggestion(suggestion)}
                                                    />
                                                    <div className={s.poSuggestionBody}>
                                                        <div className={s.poSuggestionHeader}>
                                                            <span className={s.poSuggestionName}>{displayName}</span>
                                                            <span className={`po-priority-badge${isUrgent ? ' po-priority-badge--urgent' : ' po-priority-badge--normal'}`}>
                                                                {isUrgent ? 'Urgente' : 'Normal'}
                                                            </span>
                                                        </div>
                                                        <div className={s.poSuggestionTags}>
                                                            <span className="sku-tag">{suggestion.warehouseName}</span>
                                                        </div>
                                                        <div className={s.poSuggestionMetrics}>
                                                            <span><strong>Actual:</strong> {formatNumber(suggestion.currentStock || 0)}</span>
                                                            <span><strong>Mín:</strong> {formatNumber(suggestion.minStock || 0)}</span>
                                                            <span><strong>Sugerido:</strong> {formatNumber(suggestion.suggestedQuantity)}</span>
                                                        </div>
                                                    </div>
                                                    <div className={s.poSuggestionCost}>
                                                        <span className={s.poSuggestionCostValue}>
                                                            {formatCurrency(Number(suggestion.estimatedCost || 0), settings)}
                                                        </span>
                                                        <span className={s.poSuggestionCostLabel}>estimado</span>
                                                    </div>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setShowAutoPurchaseSidebar(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary" disabled={creatingAutoPurchaseOrder || selectedSuggestions.length === 0}>
                                {creatingAutoPurchaseOrder ? 'Creando...' : 'Crear borrador'}
                            </Button>
                        </div>
                    </form>
                </div>
            </FullScreenModal>

            {/* Import Excel Sidebar */}
            <FullScreenModal isOpen={showImportSidebar} onClose={closeImportSidebar} title="Importar Productos desde Excel">
                <div className="premium-modal-content product-import-modal">
                    <div className="modal-tab-content">
                        <div className="import-steps" aria-label="Pasos de importación">
                            <div className={`import-step${importFile ? ' is-done' : ' is-active'}`}>
                                <span className="import-step-num">1</span>
                                <span>Archivo</span>
                            </div>
                            <div className={`import-step${importValidation ? ' is-done' : importFile ? ' is-active' : ''}`}>
                                <span className="import-step-num">2</span>
                                <span>Validar</span>
                            </div>
                            <div className={`import-step${importValidation ? ' is-active' : ''}`}>
                                <span className="import-step-num">3</span>
                                <span>Confirmar</span>
                            </div>
                        </div>

                        <div className="import-info-banner">
                            <p>
                                Sube un archivo <strong>.xlsx</strong> con tus productos. Los SKU existentes se actualizan; los nuevos se crean.
                                Usa la plantilla para el formato correcto.
                            </p>
                        </div>

                        <div className="import-upload-section">
                            <label className="modal-input-label" htmlFor="inventory-import-file">Archivo Excel</label>
                            <input
                                id="inventory-import-file"
                                ref={importFileInputRef}
                                type="file"
                                accept=".xlsx,.xls"
                                className="import-file-input-hidden"
                                onChange={(e) => {
                                    setImportFile(e.target.files?.[0] || null);
                                    setImportValidation(null);
                                    setImportSearch('');
                                    setImportShowErrorsOnly(false);
                                }}
                            />
                            <button
                                type="button"
                                className={`import-file-zone${importFile ? ' has-file' : ''}`}
                                onClick={() => importFileInputRef.current?.click()}
                            >
                                <FileSpreadsheet size={28} className="import-file-zone-icon" />
                                <span className="import-file-zone-title">
                                    {importFile ? importFile.name : 'Haz clic para elegir un archivo Excel'}
                                </span>
                                <span className="import-file-zone-hint">
                                    {importFile
                                        ? `${(importFile.size / 1024).toFixed(1)} KB · .xlsx / .xls`
                                        : 'Formatos aceptados: .xlsx, .xls'}
                                </span>
                            </button>
                        </div>

                        <div className="import-actions-row">
                            <Button type="button" variant="secondary" onClick={handleDownloadTemplate}>
                                <Download size={16} /> Descargar plantilla
                            </Button>
                            <Button
                                type="button"
                                variant="primary"
                                onClick={handleImportValidate}
                                disabled={!importFile || importLoading}
                            >
                                {importLoading ? 'Validando...' : 'Validar archivo'}
                            </Button>
                        </div>

                        {importValidation && (
                            <>
                                <div className="import-summary-grid">
                                    <div className="import-summary-card">
                                        <div className="import-summary-value">{importValidation.summary.totalRows}</div>
                                        <div className="import-summary-label">Total filas</div>
                                    </div>
                                    <div className="import-summary-card import-summary-success">
                                        <div className="import-summary-value">{importValidation.summary.valid}</div>
                                        <div className="import-summary-label">Válidos</div>
                                    </div>
                                    <div className={`import-summary-card${importValidation.summary.invalid > 0 ? ' import-summary-error' : ''}`}>
                                        <div className="import-summary-value">{importValidation.summary.invalid}</div>
                                        <div className="import-summary-label">Con errores</div>
                                    </div>
                                    <div className="import-summary-card import-summary-new">
                                        <div className="import-summary-value">{importValidation.summary.newProducts}</div>
                                        <div className="import-summary-label">Nuevos</div>
                                    </div>
                                </div>

                                <div className="import-table-toolbar">
                                    <div className="import-search-wrap">
                                        <Search size={16} aria-hidden />
                                        <input
                                            type="search"
                                            className="import-search-input"
                                            placeholder="Buscar por SKU o nombre..."
                                            value={importSearch}
                                            onChange={(e) => setImportSearch(e.target.value)}
                                        />
                                    </div>
                                    {importValidation.summary.invalid > 0 && (
                                        <label className="import-errors-toggle">
                                            <input
                                                type="checkbox"
                                                checked={importShowErrorsOnly}
                                                onChange={(e) => setImportShowErrorsOnly(e.target.checked)}
                                            />
                                            Solo errores
                                        </label>
                                    )}
                                    <span className="import-table-count">
                                        {filteredImportItems.length} de {importValidation.items.length} filas
                                    </span>
                                </div>

                                <DataTable
                                    ariaLabel="Vista previa de importación"
                                    rows={filteredImportItems}
                                    rowKey={(item) => `${item.rowNumber}-${item.sku}`}
                                    defaultPageSize={25}
                                    pageSizeOptions={[25, 50, 100]}
                                    rowTone={(item) => (item.isValid ? undefined : 'danger')}
                                    empty={<EmptyState title="No hay filas que coincidan con el filtro." />}
                                    columns={[
                                        { key: 'rowNumber', header: '#', type: 'number', decimals: 0 },
                                        { key: 'sku', header: 'SKU' },
                                        { key: 'name', header: 'Nombre' },
                                        { key: 'action', header: 'Acción', render: (item) => (
                                            <Badge tone={item.isUpdate ? 'neutral' : 'success'}>{item.isUpdate ? 'Actualizar' : 'Nuevo'}</Badge>
                                        ) },
                                        { key: 'status', header: 'Estado', type: 'status', render: (item) => (
                                            item.isValid
                                                ? <Badge tone="success">✓ OK</Badge>
                                                : <span title={item.errors.join(', ')}><Badge tone="danger">✗ {item.errors[0]}</Badge></span>
                                        ) },
                                    ] as Column<(typeof filteredImportItems)[number]>[]}
                                />
                            </>
                        )}
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="ghost" onClick={closeImportSidebar}>
                            Cancelar
                        </Button>
                        {importValidation && (
                            <Button
                                type="button"
                                variant="primary"
                                onClick={handleImportConfirm}
                                disabled={importValidation.summary.valid === 0 || importLoading}
                            >
                                {importLoading ? 'Importando...' : `Confirmar importación (${importValidation.summary.valid})`}
                            </Button>
                        )}
                    </div>
                </div>
            </FullScreenModal>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div >
    );
}
