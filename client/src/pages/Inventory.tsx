import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Select from '../components/Select';
import { autoPurchaseOrdersAPI, branchesAPI, productsAPI, inventoryMovementsAPI, categoriesAPI, stockAlertsAPI, suppliersAPI, unitsAPI, settingsAPI } from '../services/api';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import Sidebar from '../components/Sidebar';
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
    FlaskConical, Box
} from 'lucide-react';
import type { AutoPurchaseSuggestion, Branch, Product, ProductAllowedUnit, StockAlertItem, Supplier, UnitOfMeasure, Warehouse } from '../types';
import type { SingleValue } from 'react-select';
import { formatCurrency, currencyInputPadding, type CurrencySettings } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { isCategoryVisibleInInventory } from '../utils/categoryVisibility';
import { effectiveUnitCost } from '../utils/productCost';
import './Inventory.css';

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

interface StockAlertSummaryState {
    totalAlerts?: number;
    criticalAlerts?: number;
    warningAlerts?: number;
}

type ProductInventory = Product & {
    currentAverageCost?: number;
    lastPurchaseCost?: number;
    totalStock?: number;
};

type StrOption = SingleValue<{ value: string; label: string }>;
function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

const STORAGE_TYPE_OPTIONS: { value: '' | 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE'; label: string; icon: typeof Package }[] = [
    { value: '', label: 'Sin clasificar', icon: Package },
    { value: 'PERISHABLE', label: 'Perecedero', icon: AlertTriangle },
    { value: 'FROZEN', label: 'Congelado', icon: Layers },
    { value: 'NON_PERISHABLE', label: 'No Perecedero', icon: ShoppingBag }
];

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
    const canAdjustStock = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CAJERO', 'BODEGA']);
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
    const [tablePage, setTablePage] = useState(1);
    const TABLE_PAGE_SIZE = 10;
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'stock' | 'finanzas'>('general');
    const [saving, setSaving] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');

    const [storageFilter, setStorageFilter] = useState<string>('all');
    const [stockAlerts, setStockAlerts] = useState<StockAlertItem[]>([]);
    const [stockAlertSummary, setStockAlertSummary] = useState<StockAlertSummaryState | null>(null);
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
    const [allUnits, setAllUnits] = useState<UnitOfMeasure[]>([]);
    const { symbol } = useCurrency();
    const [settings, setSettings] = useState<CurrencySettings>({});

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

    useEffect(() => {
        loadInventory();
        loadWarehouses();
        loadCategories();
        loadOperationalData();
        loadUnitsCatalog();
        settingsAPI.getAll()
            .then((res) => setSettings(res.data.data || {}))
            .catch((err) => console.error('Error loading settings:', err));
    }, []);

    const loadUnitsCatalog = async (): Promise<UnitOfMeasure[]> => {
        try {
            const res = await unitsAPI.getAll();
            const units: UnitOfMeasure[] = res.data.data || [];
            setAllUnits(units);
            return units;
        } catch (error) {
            console.error('Error loading units:', error);
            return [];
        }
    };

    const loadOperationalData = async () => {
        try {
            const [branchesRes, suppliersRes] = await Promise.all([
                branchesAPI.getAll(),
                suppliersAPI.getAll({ active: true })
            ]);
            setBranches(branchesRes.data.data || []);
            setSuppliers(suppliersRes.data.data || []);
        } catch (error) {
            console.error('Error loading operational data:', error);
        }
    };

    const loadCategories = async () => {
        try {
            const res = await categoriesAPI.getAll();
            setCategories(res.data.data);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    };

    const loadWarehouses = async () => {
        try {
            const { warehousesAPI } = await import('../services/api');
            const res = await warehousesAPI.getAll();
            setWarehouses(res.data.data);
        } catch (error) {
            console.error('Error loading warehouses:', error);
        }
    };

    const loadInventory = async () => {
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
        } else {
            console.error('Error loading products:', productsRes.reason);
        }
        if (lowStockRes.status === 'fulfilled') {
            setLowStock(lowStockRes.value.data.data || []);
        }
        if (alertsRes.status === 'fulfilled') {
            setStockAlerts(alertsRes.value.data.data || []);
        }
        if (alertSummaryRes.status === 'fulfilled') {
            setStockAlertSummary(alertSummaryRes.value.data.data || null);
        }
        if (suggestionsRes.status === 'fulfilled') {
            setAutoPurchaseSuggestions(suggestionsRes.value.data.data?.suggestions || []);
        }

        setLoading(false);
    };

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

    const loadProductUnits = useCallback(async (productId: number) => {
        const product = products.find(p => p.id === productId);
        try {
            const res = await unitsAPI.getProductUnits(productId);
            const units: ProductAllowedUnit[] = res.data.data || [];
            if (units.length > 0) {
                setAdjustmentUnits(units);
                const defaultUnit = units.find(u => u.isDefault) || units.find(u => u.isBase) || units[0];
                return defaultUnit?.abbreviation || product?.unit || '';
            } else {
                const baseUnit = product?.unit || 'unidad';
                setAdjustmentUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
                return baseUnit;
            }
        } catch {
            const baseUnit = product?.unit || 'unidad';
            setAdjustmentUnits([{ unitId: 0, abbreviation: baseUnit, name: baseUnit, conversionFactor: 1, isBase: true, isDefault: true }] as ProductAllowedUnit[]);
            return baseUnit;
        }
    }, [products]);

    const handleOpenAdjustment = async (product: Product) => {
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
        setIsAdjustmentModalOpen(true);
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

        try {
            await inventoryMovementsAPI.create({
                warehouseId: Number(adjustmentData.warehouseId),
                productId: adjustmentData.productId,
                type: adjustmentData.type,
                quantity: parseFloat(adjustmentData.quantity),
                reason: adjustmentData.reason,
                unit: adjustmentData.unit || undefined
            });
            localStorage.setItem('inventory_adjustment_warehouse_id', adjustmentData.warehouseId);
            showSuccess('Ajuste realizado correctamente');
            setIsAdjustmentModalOpen(false);
            loadInventory();
        } catch (error: unknown) {
            showError('Error: ' + apiErrorMessage(error));
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

        if (!formData.cost?.trim() || Number.isNaN(parseFloat(formData.cost))) {
            showWarning('Indica un costo válido');
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
                cost: parseFloat(formData.cost),
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
                    // Sin unidades en catálogo o sin mapeo legacy; configurar en vista de conversiones
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
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-NI', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });

        const lowStockCount = filteredProducts.filter(p => lowStock.some(lp => lp.id === p.id)).length;

        const rowsByCategory = new Map<string, typeof filteredProducts>();
        for (const p of filteredProducts) {
            const cat = categories.find(c => c.id === p.categoryId)?.name || 'Sin categoría';
            if (!rowsByCategory.has(cat)) rowsByCategory.set(cat, []);
            rowsByCategory.get(cat)!.push(p);
        }

        const sortedCategories = [...rowsByCategory.keys()].sort((a, b) => a.localeCompare(b, 'es'));

        const bodyRows = sortedCategories.map(cat => {
            const items = rowsByCategory.get(cat)!;
            const categoryHeader = `<tr class="category-row"><td colspan="8">${cat} (${items.length})</td></tr>`;
            const itemRows = items.map(p => {
                const stock = Number((p as ProductInventory).totalStock ?? 0);
                const min = Number(p.minStock ?? 0);
                const isLow = stock <= min;
                const unit = p.baseUnit?.abbreviation || p.unit;
                return `<tr class="${isLow ? 'low-row' : ''}">
                    <td>${p.name}</td>
                    <td>${p.sku || '—'}</td>
                    <td>${unit}</td>
                    <td class="num">${stock.toLocaleString('es-NI', { maximumFractionDigits: 2 })}</td>
                    <td class="num">${min.toLocaleString('es-NI', { maximumFractionDigits: 2 })}</td>
                    <td class="count-col"></td>
                    <td class="obs-col"></td>
                    <td class="status-col">${isLow ? '⚠ Bajo' : 'OK'}</td>
                </tr>`;
            }).join('');
            return categoryHeader + itemRows;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Inventario Físico</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 0; color: #1a1a1a; }
  .page { padding: 24px 28px; max-width: 1100px; margin: 0 auto; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px; }
  .report-header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .report-header .subtitle { margin: 4px 0 0; color: #64748b; font-size: 12px; }
  .report-meta { text-align: right; font-size: 11px; color: #475569; line-height: 1.6; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; }
  .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #f8fafc; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
  .stat-value { font-size: 20px; font-weight: 700; margin-top: 4px; color: #0f172a; }
  .stat.warn .stat-value { color: #b45309; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: middle; }
  th { background: #1e293b; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .category-row td { background: #e2e8f0; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-color: #94a3b8; }
  tr:nth-child(even):not(.category-row) { background: #f8fafc; }
  .low-row { background: #fef3c7 !important; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .count-col { min-width: 80px; }
  .obs-col { min-width: 120px; }
  .status-col { text-align: center; font-size: 10px; font-weight: 600; white-space: nowrap; }
  .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-block { border-top: 1px solid #334155; padding-top: 8px; text-align: center; color: #64748b; font-size: 10px; }
  .footer-note { margin-top: 24px; font-size: 9px; color: #94a3b8; text-align: center; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 12px 16px; }
    @page { margin: 12mm; }
  }
</style></head><body>
<div class="page">
  <div class="report-header">
    <div>
      <h1>Reporte de Inventario F\u00edsico</h1>
      <p class="subtitle">Conteo y verificaci\u00f3n de existencias</p>
    </div>
    <div class="report-meta">
      <div><strong>Fecha:</strong> ${dateStr}</div>
      <div><strong>Hora:</strong> ${timeStr}</div>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total productos</div><div class="stat-value">${filteredProducts.length}</div></div>
    <div class="stat"><div class="stat-label">Categor\u00edas</div><div class="stat-value">${sortedCategories.length}</div></div>
    <div class="stat warn"><div class="stat-label">Stock bajo</div><div class="stat-value">${lowStockCount}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Producto</th><th>SKU</th><th>Unidad</th>
      <th>Stock sistema</th><th>Stock m\u00edn.</th>
      <th class="count-col">Conteo f\u00edsico</th><th class="obs-col">Observaciones</th><th>Estado</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="signatures">
    <div class="sig-block">Realizado por</div>
    <div class="sig-block">Supervisado por</div>
  </div>
  <div class="footer-note">Documento generado desde el sistema de gesti\u00f3n — ${dateStr} ${timeStr}</div>
</div>
</body></html>`;

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

    // Reset to first page whenever the filtered result set changes.
    useEffect(() => {
        setTablePage(1);
    }, [filter, searchQuery, selectedCategory, storageFilter, viewMode]);

    const tableTotalPages = Math.max(1, Math.ceil(filteredProducts.length / TABLE_PAGE_SIZE));
    const pagedProducts = useMemo(
        () => filteredProducts.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE),
        [filteredProducts, tablePage]
    );


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
            {/* Modern Header - Tables Style */}
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <h1><Package size={32} /> Gestión de Inventario</h1>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
                        <Button onClick={() => handleOpenSidebar()} title="Nuevo producto" aria-label="Nuevo producto">
                            <Plus size={20} />
                        </Button>
                    )}
                </div>
            </div>

            <div className="inventory-grid-new" style={{ marginBottom: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Alertas de stock</div>
                        <div className="product-details-new">
                            <div className="detail-item"><AlertTriangle size={14} /><span>{stockAlertSummary?.totalAlerts || 0} alertas activas</span></div>
                            <div className="detail-item"><span>{stockAlertSummary?.criticalAlerts || 0} críticas</span></div>
                            <div className="detail-item"><span>{stockAlertSummary?.warningAlerts || 0} preventivas</span></div>
                        </div>
                    </div>
                </div>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Urgentes sin stock</div>
                        <div className="product-details-new">
                            {stockAlerts.filter((alert) => Number(alert.currentStock) === 0).slice(0, 3).map((alert) => (
                                <div key={`${alert.productId}-${alert.warehouseId}`} className="detail-item">
                                    <span>{alert.productName}</span>
                                    <span>{alert.warehouseName}</span>
                                </div>
                            ))}
                            {stockAlerts.filter((alert) => Number(alert.currentStock) === 0).length === 0 && (
                                <div className="detail-item"><span>No hay productos agotados</span></div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="inventory-card-new">
                    <div className="inventory-card-body-new">
                        <div className="product-name-new">Reposición sugerida</div>
                        <div className="product-details-new">
                            {autoPurchaseSuggestions.slice(0, 3).map((suggestion) => (
                                <div key={`${suggestion.productId}-${suggestion.warehouseId}`} className="detail-item">
                                    <span>{suggestion.productName}</span>
                                    <span>{suggestion.suggestedQuantity}</span>
                                </div>
                            ))}
                            {autoPurchaseSuggestions.length === 0 && (
                                <div className="detail-item"><span>Sin sugerencias de compra</span></div>
                            )}
                            {autoPurchaseSuggestions.length > 0 && canCreateAutoPO && (
                                <div className="detail-item" style={{ marginTop: '8px' }}>
                                    <button
                                        type="button"
                                        onClick={() => setShowAutoPurchaseSidebar(true)}
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            color: 'var(--color-primary)',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            padding: 0
                                        }}
                                    >
                                        Revisar sugerencias y crear borrador
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters Row - Reservations Style Alignment */}
            <div className="inventory-filters-row">
                <div className="inventory-status-filters">
                    <button
                        className={`inventory-status-btn ${filter === 'all' ? 'active' : ''}`}
                        onClick={() => setFilter('all')}
                    >
                        Todos
                    </button>
                    <button
                        className={`inventory-status-btn ingredient ${filter === 'INGREDIENT' ? 'active' : ''}`}
                        onClick={() => setFilter('INGREDIENT')}
                    >
                        Ingredientes
                    </button>
                    <button
                        className={`inventory-status-btn product ${filter === 'PRODUCT_FOR_SALE' ? 'active' : ''}`}
                        onClick={() => setFilter('PRODUCT_FOR_SALE')}
                    >
                        Productos
                    </button>
                    <button
                        className={`inventory-status-btn intermediate ${filter === 'INTERMEDIATE' ? 'active' : ''}`}
                        onClick={() => setFilter('INTERMEDIATE')}
                    >
                        Intermedios
                    </button>
                    <button
                        className={`inventory-status-btn packaging ${filter === 'PACKAGING' ? 'active' : ''}`}
                        onClick={() => setFilter('PACKAGING')}
                    >
                        Empaques
                    </button>
                    <button
                        className={`inventory-status-btn low ${filter === 'low' ? 'active' : ''}`}
                        onClick={() => setFilter('low')}
                    >
                        Stock Bajo
                    </button>

                    <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 8px' }} />

                    <div className="inventory-category-select-wrapper">
                        <Select
                            variant="modal"
                            options={[
                                { value: 'all', label: 'Todas las Categorías' },
                                ...categories.filter(c => isCategoryVisibleInInventory(c) && (c._count?.products ?? 0) > 0).map(cat => ({ value: cat.id.toString(), label: cat.name }))
                            ]}
                            value={selectedCategory === 'all' ? { value: 'all', label: 'Todas las Categorías' } : { value: selectedCategory, label: categories.find(c => c.id.toString() === selectedCategory)?.name || 'Categoría' }}
                            onChange={(option: StrOption) => setSelectedCategory(option?.value || 'all')}
                            placeholder="Filtrar por categoría..."
                            className="category-select-filter"
                        />
                    </div>

                    <div className="inventory-category-select-wrapper">
                        <Select
                            variant="modal"
                            options={[
                                { value: 'all', label: 'Almacenamiento' },
                                { value: 'PERISHABLE', label: 'Perecedero' },
                                { value: 'FROZEN', label: 'Congelado' },
                                { value: 'NON_PERISHABLE', label: 'No Perecedero' }
                            ]}
                            value={{ value: storageFilter, label: storageFilter === 'all' ? 'Almacenamiento' : { 'PERISHABLE': 'Perecedero', 'FROZEN': 'Congelado', 'NON_PERISHABLE': 'No Perecedero' }[storageFilter] || storageFilter }}
                            onChange={(option: StrOption) => setStorageFilter(option?.value || 'all')}
                            placeholder="Almacenamiento..."
                            className="category-select-filter"
                        />
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
                                        <span className="pricing-value">{formatCurrency(effectiveUnitCost((product as ProductInventory).currentAverageCost, product.cost), settings)}</span>
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
                <div className="inventory-table-wrapper">
                    <table className="inventory-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Categoría</th>
                                <th>Unidad</th>
                                <th className="text-right">Stock Actual</th>
                                <th className="text-right">Mín.</th>
                                <th className="text-right">Costo unit.</th>
                                <th className="text-right">Precio</th>
                                <th>Estado</th>
                                <th className="text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pagedProducts.map(product => {
                                const isLow = lowStock.some(p => p.id === product.id);
                                const stock = Number((product as ProductInventory).totalStock ?? 0);
                                return (
                                    <tr key={product.id} className={isLow ? 'row-low-stock' : ''}>
                                        <td className="cell-name">
                                            <span className="cell-name-title">{product.name}</span>
                                            {product.sku && <span className="cell-name-sku">{product.sku}</span>}
                                        </td>
                                        <td>{categories.find(c => c.id === product.categoryId)?.name || '-'}</td>
                                        <td>{product.baseUnit?.abbreviation || product.unit}</td>
                                        <td className="text-right">{stock.toLocaleString('es-NI', { maximumFractionDigits: 2 })}</td>
                                        <td className="text-right">{product.minStock}</td>
                                        <td className="text-right">{formatCurrency(effectiveUnitCost((product as ProductInventory).currentAverageCost, product.cost), settings)}</td>
                                        <td className="text-right">{product.price ? formatCurrency(Number(product.price), settings) : '-'}</td>
                                        <td>
                                            {isLow
                                                ? <span className="status-pill status-warning">Stock bajo</span>
                                                : <span className="status-pill status-ok">OK</span>}
                                        </td>
                                        <td className="text-right">
                                            <div className="table-actions">
                                                <button className="table-action-btn" onClick={() => navigate(`/kardex?productId=${product.id}`)} title="Ver Kardex">
                                                    <FileText size={16} />
                                                </button>
                                                {canAdjustStock && (
                                                    <button className="table-action-btn" onClick={() => handleOpenAdjustment(product)} title="Ajustar Stock">
                                                        <Activity size={16} />
                                                    </button>
                                                )}
                                                {canMutateProduct && (
                                                    <button className="table-action-btn" onClick={() => navigate(`/inventory/${product.id}/units`)} title="Conversiones">
                                                        <Layers size={16} />
                                                    </button>
                                                )}
                                                {canMutateProduct && (
                                                    <button className="table-action-btn" onClick={() => handleOpenSidebar(product)} title="Editar">
                                                        <Edit2 size={16} />
                                                    </button>
                                                )}
                                                {canDeleteProduct && (
                                                    <button className="table-action-btn danger" onClick={() => handleDelete(product.id)} title="Eliminar">
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <Pagination
                        page={tablePage}
                        totalPages={tableTotalPages}
                        totalItems={filteredProducts.length}
                        pageSize={TABLE_PAGE_SIZE}
                        onPageChange={setTablePage}
                    />
                </div>
            )}

            {
                filteredProducts.length === 0 && (
                    <div className="no-products-message">
                        <Package size={48} />
                        <p>No hay productos {filter !== 'all' ? 'con este filtro' : 'registrados'}</p>
                        {filter !== 'all' ? (
                            <Button onClick={() => setFilter('all')}>Ver todos</Button>
                        ) : canMutateProduct ? (
                            <Button onClick={() => handleOpenSidebar()}>Crear primer producto</Button>
                        ) : null}
                    </div>
                )
            }

            {/* Product Form Sidebar */}
            <Sidebar
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
                                <div className="modal-section animate-slide-in">
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
                                        <Select
                                            variant="modal"
                                            inputId="inventory-product-category"
                                            label={
                                                <>
                                                    Categoría del Producto
                                                    {formData.type === 'INGREDIENT' && (
                                                        <span className="label-note"> (No aplica para ingredientes)</span>
                                                    )}
                                                </>
                                            }
                                            options={categories.filter(c => isCategoryVisibleInInventory(c)).map(c => ({ value: c.id.toString(), label: c.name }))}
                                            value={
                                                formData.categoryId
                                                    ? categories
                                                        .filter(c => isCategoryVisibleInInventory(c))
                                                        .map(c => ({ value: c.id.toString(), label: c.name }))
                                                        .find(opt => opt.value === formData.categoryId) || null
                                                    : null
                                            }
                                            onChange={(option: StrOption) => setFormData({ ...formData, categoryId: option ? option.value : '' })}
                                            placeholder={formData.type === 'INGREDIENT' ? 'N/A' : 'Seleccionar categoría...'}
                                            isClearable
                                            isDisabled={formData.type === 'INGREDIENT'}
                                            isSearchable
                                        />
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
                                        <Select
                                            variant="modal"
                                            label="Unidad de referencia"
                                            options={allUnits.map((unit) => ({
                                                value: unit.abbreviation,
                                                label: `${unit.name} (${unit.abbreviation})`
                                            }))}
                                            value={formData.unit
                                                ? {
                                                    value: formData.unit,
                                                    label: allUnits.find((unit) => unit.abbreviation === formData.unit)
                                                        ? `${allUnits.find((unit) => unit.abbreviation === formData.unit)!.name} (${formData.unit})`
                                                        : formData.unit
                                                }
                                                : null}
                                            onChange={(option: StrOption) => {
                                                if (!option) return;
                                                setFormData({ ...formData, unit: option.value });
                                            }}
                                            placeholder={allUnits.length === 0 ? 'Sin unidades' : 'Seleccionar...'}
                                            isDisabled={allUnits.length === 0}
                                            isSearchable
                                        />
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
                                <div className="modal-section animate-slide-in">
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
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <DollarSign size={18} />
                                        <h3>Información Financiera</h3>
                                    </div>

                                    {editingProduct && (
                                        <div style={{
                                            padding: '12px',
                                            backgroundColor: 'var(--color-info-50)',
                                            border: '1px solid var(--color-info-200)',
                                            borderRadius: '8px',
                                            marginBottom: '16px'
                                        }}>
                                            <div style={{ fontSize: '13px', color: 'var(--color-info-700)', marginBottom: '8px', fontWeight: 600 }}>
                                                💡 Costeo Automático Activo
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--color-info-600)', lineHeight: '1.5' }}>
                                                El costo se calcula automáticamente usando <strong>Promedio Ponderado</strong> al recibir órdenes de compra.
                                            </div>
                                            <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                                <div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-neutral-500)', marginBottom: '4px' }}>Costo unitario</div>
                                                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-neutral-800)' }}>
                                                        {formatCurrency(effectiveUnitCost((editingProduct as ProductInventory).currentAverageCost, editingProduct.cost), settings)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-neutral-500)', marginBottom: '4px' }}>Última Compra</div>
                                                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-neutral-800)' }}>
                                                        {formatCurrency(Number((editingProduct as ProductInventory).lastPurchaseCost ?? editingProduct.cost), settings)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!editingProduct && (
                                        <div className="modal-form-row">
                                            <div className="modal-input-group">
                                                <label className="modal-input-label" htmlFor="inventory-initial-cost">Costo Inicial</label>
                                                <div className="price-input-wrapper">
                                                    <span className="price-currency-icon">{symbol}</span>
                                                    <input
                                                        id="inventory-initial-cost"
                                                        type="number"
                                                        step="0.01"
                                                        className="modal-standard-input"
                                                        style={{ paddingLeft: currencyInputPadding(symbol) }}
                                                        value={formData.cost}
                                                        onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                                                        required
                                                    />
                                                </div>
                                                <small style={{ color: 'var(--color-neutral-500)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                                                    Este costo se actualizará automáticamente con las compras.
                                                </small>
                                            </div>
                                        </div>
                                    )}

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
                                                        className="modal-standard-input"
                                                        style={{ paddingLeft: currencyInputPadding(symbol) }}
                                                        value={isSellable ? formData.price : ''}
                                                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                        placeholder={isSellable ? 'Opcional' : 'No aplica'}
                                                        disabled={!isSellable}
                                                    />
                                                </div>
                                                {!isSellable && (
                                                    <small style={{ color: 'var(--color-neutral-500)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                                                        El precio de venta solo aplica a productos de tipo <strong>Producto de Venta</strong> o <strong>Ambos</strong>.
                                                    </small>
                                                )}
                                            </div>
                                        );
                                    })()}
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
            </Sidebar>

            {/* Adjustment Modal Sidebar */}
            <Sidebar
                isOpen={isAdjustmentModalOpen}
                onClose={() => setIsAdjustmentModalOpen(false)}
                title="Ajuste de Inventario"
            >
                <div className="premium-modal-content product-modal-content">
                    <form onSubmit={handleAdjustmentSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Activity size={18} />
                                    <h3>Ajuste para: {adjustmentData.productName}</h3>
                                </div>

                                <Select
                                    variant="modal"
                                    label="Almacén"
                                    options={warehouses.map(warehouse => ({
                                        value: warehouse.id.toString(),
                                        label: warehouse.name
                                    }))}
                                    value={adjustmentData.warehouseId
                                        ? {
                                            value: adjustmentData.warehouseId,
                                            label: warehouses.find(warehouse => warehouse.id.toString() === adjustmentData.warehouseId)?.name || 'Seleccionar almacén...'
                                        }
                                        : null}
                                    onChange={(option: StrOption) => setAdjustmentData({ ...adjustmentData, warehouseId: option?.value || '' })}
                                    placeholder="Seleccionar almacén..."
                                    isSearchable={false}
                                />

                                <Select
                                    variant="modal"
                                    label="Tipo de Movimiento"
                                    options={[
                                        { value: 'OUT', label: 'Salida (Desperdicio/Uso)' },
                                        { value: 'ADJUSTMENT', label: 'Entrada (Corrección/Compra)' },
                                        { value: 'IN', label: 'Entrada Directa' }
                                    ]}
                                    value={{
                                        value: adjustmentData.type,
                                        label: {
                                            'OUT': 'Salida (Desperdicio/Uso)',
                                            'ADJUSTMENT': 'Entrada (Corrección/Compra)',
                                            'IN': 'Entrada Directa'
                                        }[adjustmentData.type]
                                    }}
                                    onChange={(option: SingleValue<{ value: 'OUT' | 'ADJUSTMENT' | 'IN'; label: string }>) =>
                                        option && setAdjustmentData({ ...adjustmentData, type: option.value })}
                                    isSearchable={false}
                                />

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
                                        <Select
                                            variant="modal"
                                            label="Unidad"
                                            options={adjustmentUnits.length > 0
                                                ? adjustmentUnits.map(u => ({ value: u.abbreviation, label: `${u.name} (${u.abbreviation})` }))
                                                : [{ value: '', label: 'Sin unidades' }]
                                            }
                                            value={adjustmentData.unit
                                                ? {
                                                    value: adjustmentData.unit,
                                                    label: adjustmentUnits.find(u => u.abbreviation === adjustmentData.unit)
                                                        ? `${adjustmentUnits.find(u => u.abbreviation === adjustmentData.unit)!.name} (${adjustmentData.unit})`
                                                        : adjustmentData.unit
                                                }
                                                : null}
                                            onChange={(option: StrOption) => setAdjustmentData({ ...adjustmentData, unit: option?.value || '' })}
                                            placeholder="Unidad..."
                                            isSearchable={false}
                                        />
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
                            <Button type="submit" variant="primary">
                                Confirmar Ajuste
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>

            <Sidebar
                isOpen={showAutoPurchaseSidebar}
                onClose={() => setShowAutoPurchaseSidebar(false)}
                title="Crear Orden de Compra Sugerida"
                width="wide"
            >
                <div className="premium-modal-content product-modal-content">
                    <form onSubmit={handleCreateAutoPurchaseOrder} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <FileText size={18} />
                                    <h3>Sugerencias de reposición</h3>
                                </div>

                                <div className="modal-form-row">
                                    <Select
                                        variant="modal"
                                        label="Sucursal"
                                        options={branches.map((branch) => ({
                                            value: branch.id.toString(),
                                            label: branch.name
                                        }))}
                                        value={autoPurchaseForm.branchId
                                            ? {
                                                value: autoPurchaseForm.branchId,
                                                label: branches.find((branch) => branch.id.toString() === autoPurchaseForm.branchId)?.name || 'Seleccionar sucursal'
                                            }
                                            : null}
                                        onChange={(option: StrOption) => setAutoPurchaseForm((prev) => ({ ...prev, branchId: option?.value || '' }))}
                                        placeholder="Seleccionar sucursal..."
                                        isSearchable={false}
                                    />

                                    <Select
                                        variant="modal"
                                        label="Proveedor"
                                        options={suppliers.map((supplier) => ({
                                            value: supplier.id.toString(),
                                            label: supplier.name
                                        }))}
                                        value={autoPurchaseForm.supplierId
                                            ? {
                                                value: autoPurchaseForm.supplierId,
                                                label: suppliers.find((supplier) => supplier.id.toString() === autoPurchaseForm.supplierId)?.name || 'Seleccionar proveedor'
                                            }
                                            : null}
                                        onChange={(option: StrOption) => setAutoPurchaseForm((prev) => ({ ...prev, supplierId: option?.value || '' }))}
                                        placeholder="Seleccionar proveedor..."
                                    />
                                </div>

                                <div className="po-suggestion-toolbar">
                                    <span className="po-suggestion-count">
                                        {selectedSuggestions.length} seleccionados de {autoPurchaseSuggestions.length} sugerencias
                                    </span>
                                    <div className="po-suggestion-toolbar-actions">
                                        <Button type="button" variant="ghost" onClick={handleSelectUrgentSuggestions}>
                                            Seleccionar urgentes
                                        </Button>
                                        <Button type="button" variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>
                                            Limpiar
                                        </Button>
                                    </div>
                                </div>

                                <div className="po-suggestion-list">
                                    {autoPurchaseSuggestions.length === 0 ? (
                                        <div className="po-suggestion-empty">
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
                                                    className={`po-suggestion-card${checked ? ' is-selected' : ''}${isUrgent ? ' is-urgent' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="po-suggestion-checkbox"
                                                        checked={checked}
                                                        onChange={() => handleToggleSuggestion(suggestion)}
                                                    />
                                                    <div className="po-suggestion-body">
                                                        <div className="po-suggestion-header">
                                                            <span className="po-suggestion-name">{displayName}</span>
                                                            <span className={`po-priority-badge${isUrgent ? ' po-priority-badge--urgent' : ' po-priority-badge--normal'}`}>
                                                                {isUrgent ? 'Urgente' : 'Normal'}
                                                            </span>
                                                        </div>
                                                        <div className="po-suggestion-tags">
                                                            <span className="sku-tag">{suggestion.warehouseName}</span>
                                                        </div>
                                                        <div className="po-suggestion-metrics">
                                                            <span><strong>Actual:</strong> {Number(suggestion.currentStock || 0).toFixed(2)}</span>
                                                            <span><strong>Mín:</strong> {Number(suggestion.minStock || 0).toFixed(2)}</span>
                                                            <span><strong>Sugerido:</strong> {Number(suggestion.suggestedQuantity).toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                    <div className="po-suggestion-cost">
                                                        <span className="po-suggestion-cost-value">
                                                            {formatCurrency(Number(suggestion.estimatedCost || 0), settings)}
                                                        </span>
                                                        <span className="po-suggestion-cost-label">estimado</span>
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
            </Sidebar>

            {/* Import Excel Sidebar */}
            <Sidebar isOpen={showImportSidebar} onClose={closeImportSidebar} title="Importar Productos desde Excel" width="wide">
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

                                <div className="import-table-wrap">
                                    <table className="price-history-table import-preview-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>SKU</th>
                                                <th>Nombre</th>
                                                <th>Acción</th>
                                                <th>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredImportItems.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="import-table-empty">
                                                        No hay filas que coincidan con el filtro.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredImportItems.map((item) => (
                                                    <tr key={`${item.rowNumber}-${item.sku}`} className={item.isValid ? '' : 'import-row-error'}>
                                                        <td>{item.rowNumber}</td>
                                                        <td className="import-cell-sku">{item.sku}</td>
                                                        <td>{item.name}</td>
                                                        <td>
                                                            <span className={`report-status-badge ${item.isUpdate ? 'status-default' : 'status-ok'}`}>
                                                                {item.isUpdate ? 'Actualizar' : 'Nuevo'}
                                                            </span>
                                                        </td>
                                                        <td>
                                                            {item.isValid ? (
                                                                <span className="report-status-badge status-ok">✓ OK</span>
                                                            ) : (
                                                                <span className="report-status-badge status-critical" title={item.errors.join(', ')}>
                                                                    ✗ {item.errors[0]}
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
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
            </Sidebar>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div >
    );
}
