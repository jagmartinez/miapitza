import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Select from '../components/Select';
import { autoPurchaseOrdersAPI, branchesAPI, productsAPI, inventoryMovementsAPI, categoriesAPI, stockAlertsAPI, suppliersAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
// import Input from '../components/Input';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import {
    AlertTriangle, Package, Plus, Edit2, Trash2,
    Activity, ShoppingBag, Layers, Truck, DollarSign, FileText
} from 'lucide-react';
import type { AutoPurchaseSuggestion, Branch, Product, StockAlertItem, Supplier, Warehouse } from '../types';
import type { SingleValue } from 'react-select';
import './Inventory.css';

interface CategoryRow {
    id: number;
    name: string;
    description?: string;
    sortOrder?: number;
    active: boolean;
}

interface StockAlertSummaryState {
    totalAlerts?: number;
    criticalAlerts?: number;
    warningAlerts?: number;
}

type ProductInventory = Product & {
    currentAverageCost?: number;
    lastPurchaseCost?: number;
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
    const { toasts, removeToast, success: showSuccess, error: showError, warning: showWarning } = useToast();

    /** Backend: POST/PUT /products — SUPERADMIN | ADMIN */
    const canMutateProduct = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);
    /** Backend: DELETE /products — SUPERADMIN only */
    const canDeleteProduct = hasAnyRole(user, ['SUPERADMIN']);
    /** Backend: POST /inventory-movements — SUPERADMIN | ADMIN | CAJERO | BODEGA */
    const canAdjustStock = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CAJERO', 'BODEGA']);
    /** Backend: POST /advanced/auto-po/create — SUPERADMIN | ADMIN */
    const canCreateAutoPO = hasAnyRole(user, ['SUPERADMIN', 'ADMIN']);
    const [products, setProducts] = useState<Product[]>([]);
    const [lowStock, setLowStock] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | null>(null);
    const [activeTab, setActiveTab] = useState<'general' | 'stock' | 'finanzas'>('general');
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
        unit: 'kg',
        cost: '',
        price: '',
        minStock: '10',
        type: 'INGREDIENT' as 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH',
        storageType: '' as '' | 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE'
    });

    const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
    const [adjustmentData, setAdjustmentData] = useState({
        productId: 0,
        productName: '',
        warehouseId: '',
        type: 'OUT' as 'IN' | 'OUT' | 'ADJUSTMENT',
        quantity: '',
        reason: ''
    });

    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

    useEffect(() => {
        loadInventory();
        loadWarehouses();
        loadCategories();
        loadOperationalData();
    }, []);

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
        try {
            const [productsRes, lowStockRes, alertsRes, alertSummaryRes, suggestionsRes] = await Promise.all([
                productsAPI.getAll({ active: true }),
                productsAPI.getLowStock(),
                stockAlertsAPI.getAll(),
                stockAlertsAPI.getSummary(),
                autoPurchaseOrdersAPI.getSuggestions()
            ]);
            setProducts(productsRes.data.data);
            setLowStock(lowStockRes.data.data);
            setStockAlerts(alertsRes.data.data || []);
            setStockAlertSummary(alertSummaryRes.data.data || null);
            setAutoPurchaseSuggestions(suggestionsRes.data.data?.suggestions || []);
        } catch (error) {
            console.error('Error loading inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleOpenSidebar = (product?: Product) => {
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
                storageType: product.storageType || ''
            });
        } else {
            setEditingProduct(null);
            setFormData({
                name: '',
                sku: '',
                categoryId: '',
                unit: 'kg',
                cost: '',
                price: '',
                minStock: '10',
                type: 'INGREDIENT',
                storageType: ''
            });
        }
        setActiveTab('general');
        setIsSidebarOpen(true);
    };

    const handleOpenAdjustment = (product: Product) => {
        const storedWarehouseId = localStorage.getItem('inventory_adjustment_warehouse_id');
        setAdjustmentData({
            productId: product.id,
            productName: product.name,
            warehouseId: storedWarehouseId || warehouses[0]?.id?.toString() || '',
            type: 'OUT',
            quantity: '',
            reason: ''
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
                reason: adjustmentData.reason
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

        try {
            const data: Record<string, unknown> = {
                ...formData,
                categoryId: formData.categoryId ? parseInt(formData.categoryId, 10) : null,
                cost: parseFloat(formData.cost),
                price: formData.price ? parseFloat(formData.price) : null,
                minStock: parseInt(formData.minStock, 10),
                storageType: formData.storageType || null,
                active: true
            };

            if (editingProduct) {
                await productsAPI.update(editingProduct.id, data);
                showSuccess('Producto actualizado correctamente');
            } else {
                await productsAPI.create(data);
                showSuccess('Producto creado correctamente');
            }

            setIsSidebarOpen(false);
            loadInventory();
        } catch (error: unknown) {
            showError('Error: ' + apiErrorMessage(error));
        }
    };

    const handleDelete = async (id: number) => {
        if (!canDeleteProduct) return;
        if (!confirm('¿Eliminar este producto?')) return;

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

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const matchSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                p.sku?.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchSearch) return false;

            const matchType = filter === 'all' || (filter === 'low' ? lowStock.some(lp => lp.id === p.id) : p.type === filter);
            const matchCategory = selectedCategory === 'all' || p.categoryId?.toString() === selectedCategory;
            const matchStorage = storageFilter === 'all' || p.storageType === storageFilter;
            if (!matchStorage) return false;

            return matchType && matchCategory;
        });
    }, [products, lowStock, filter, searchQuery, selectedCategory, storageFilter]);


    // Type helpers
    const getTypeClass = (type: string, isLow: boolean) => {
        if (isLow) return 'low-stock';
        switch (type) {
            case 'INGREDIENT': return 'ingredient';
            case 'PRODUCT_FOR_SALE': return 'product';
            case 'BOTH': return 'both';
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
                <div style={{ display: 'flex', gap: '8px' }}>
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
                    {canMutateProduct && (
                        <Button onClick={() => handleOpenSidebar()}>
                            <Plus size={20} />
                            Nuevo Producto
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
                            <div className="detail-item"><span>{stockAlertSummary?.criticalAlerts || 0} crÃ­ticas</span></div>
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
                        <div className="product-name-new">ReposiciÃ³n sugerida</div>
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
                                ...categories.filter(c => c.active).map(cat => ({ value: cat.id.toString(), label: cat.name }))
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
                                        <span>{product.unit}</span>
                                    </div>
                                </div>

                                <div className="product-pricing-new">
                                    <div className="pricing-item">
                                        <span className="pricing-label">Costo Prom.</span>
                                        <span className="pricing-value">${Number((product as ProductInventory).currentAverageCost ?? product.cost).toFixed(2)}</span>
                                    </div>
                                    <div className="pricing-item">
                                        <span className="pricing-label">Precio</span>
                                        <span className="pricing-value price">
                                            {product.price ? `$${Number(product.price).toFixed(2)}` : '-'}
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
                    <div className="modal-tabs">
                        <div
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Package size={18} />
                            <span>General</span>
                        </div>
                        <div
                            className={`modal-tab ${activeTab === 'stock' ? 'active' : ''}`}
                            onClick={() => setActiveTab('stock')}
                        >
                            <Truck size={18} />
                            <span>Stock</span>
                        </div>
                        <div
                            className={`modal-tab ${activeTab === 'finanzas' ? 'active' : ''}`}
                            onClick={() => setActiveTab('finanzas')}
                        >
                            <DollarSign size={18} />
                            <span>Finanzas</span>
                        </div>
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
                                        <label className="modal-input-label">Nombre del Producto</label>
                                        <input
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            placeholder="Ej: Tomate, Pizza Margherita"
                                        />
                                    </div>

                                    <div className={`modal-input-group ${formData.type === 'INGREDIENT' ? 'disabled-group' : ''}`}>
                                        <label className="modal-input-label">Categoría del Producto {formData.type === 'INGREDIENT' && <span className="label-note">(No aplica para ingredientes)</span>}</label>
                                        <Select
                                            variant="modal"
                                            options={categories.filter(c => c.active).map(c => ({ value: c.id.toString(), label: c.name }))}
                                            value={categories.filter(c => c.active).map(c => ({ value: c.id.toString(), label: c.name })).find(opt => opt.value === formData.categoryId) || null}
                                            onChange={(option: StrOption) => setFormData({ ...formData, categoryId: option ? option.value : '' })}
                                            placeholder={formData.type === 'INGREDIENT' ? 'N/A' : 'Seleccionar categoría...'}
                                            isClearable
                                            isDisabled={formData.type === 'INGREDIENT'}
                                        />
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Tipo de Producto</label>
                                        <div className="type-selector-grid">
                                            <div
                                                className={`type-option ${formData.type === 'INGREDIENT' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'INGREDIENT', categoryId: '' })}
                                            >
                                                <Package size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Ingrediente</span>
                                                    <span className="type-desc">Uso interno</span>
                                                </div>
                                            </div>
                                            <div
                                                className={`type-option ${formData.type === 'PRODUCT_FOR_SALE' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'PRODUCT_FOR_SALE' })}
                                            >
                                                <ShoppingBag size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Venta</span>
                                                    <span className="type-desc">Directo</span>
                                                </div>
                                            </div>
                                            <div
                                                className={`type-option ${formData.type === 'BOTH' ? 'active' : ''}`}
                                                onClick={() => setFormData({ ...formData, type: 'BOTH' })}
                                            >
                                                <Layers size={20} />
                                                <div className="type-info">
                                                    <span className="type-name">Ambos</span>
                                                    <span className="type-desc">Uso y Venta</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Tipo de Almacenamiento</label>
                                        <div className="type-selector-grid">
                                            {STORAGE_TYPE_OPTIONS.map((opt) => (
                                                <div key={opt.value || 'none'}
                                                    className={`type-option ${formData.storageType === opt.value ? 'active' : ''}`}
                                                    onClick={() => setFormData({ ...formData, storageType: opt.value })}
                                                >
                                                    <opt.icon size={18} />
                                                    <div className="type-info">
                                                        <span className="type-name">{opt.label}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">SKU / Código</label>
                                            <input
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.sku}
                                                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                                placeholder="Ej: A001"
                                            />
                                        </div>
                                        <Select
                                            variant="modal"
                                            label="Unidad de Medida"
                                            options={[
                                                { value: 'kg', label: 'Kilogramo (kg)' },
                                                { value: 'g', label: 'Gramo (g)' },
                                                { value: 'l', label: 'Litro (l)' },
                                                { value: 'ml', label: 'Mililitro (ml)' },
                                                { value: 'unidad', label: 'Unidad' },
                                                { value: 'paquete', label: 'Paquete' }
                                            ]}
                                            value={{
                                                value: formData.unit,
                                                label: {
                                                    'kg': 'Kilogramo (kg)',
                                                    'g': 'Gramo (g)',
                                                    'l': 'Litro (l)',
                                                    'ml': 'Mililitro (ml)',
                                                    'unidad': 'Unidad',
                                                    'paquete': 'Paquete'
                                                }[formData.unit] || formData.unit
                                            }}
                                            onChange={(option: StrOption) => option && setFormData({ ...formData, unit: option.value })}
                                            isSearchable={false}
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
                                        <label className="modal-input-label">Stock Mínimo (Alerta)</label>
                                        <input
                                            type="number"
                                            className="modal-standard-input"
                                            value={formData.minStock}
                                            onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                                            required
                                        />
                                        <small style={{ color: 'var(--color-neutral-500)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                                            Se mostrará una alerta cuando el stock sea inferior a este valor.
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
                                                    <div style={{ fontSize: '11px', color: 'var(--color-neutral-500)', marginBottom: '4px' }}>Costo Promedio</div>
                                                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-neutral-800)' }}>
                                                        ${Number((editingProduct as ProductInventory).currentAverageCost ?? editingProduct.cost).toFixed(2)}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: '11px', color: 'var(--color-neutral-500)', marginBottom: '4px' }}>Última Compra</div>
                                                    <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-neutral-800)' }}>
                                                        ${Number((editingProduct as ProductInventory).lastPurchaseCost ?? editingProduct.cost).toFixed(2)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {!editingProduct && (
                                        <div className="modal-form-row">
                                            <div className="modal-input-group">
                                                <label className="modal-input-label">Costo Inicial ($)</label>
                                                <div style={{ position: 'relative' }}>
                                                    <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)', fontWeight: 600 }}>$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="modal-standard-input"
                                                        style={{ paddingLeft: '28px' }}
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

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Precio de Venta ($)</label>
                                        <div style={{ position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)', fontWeight: 600 }}>$</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="modal-standard-input"
                                                style={{ paddingLeft: '28px' }}
                                                value={formData.price}
                                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                placeholder="Opcional"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary">
                                {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
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

                                <div className="modal-input-group">
                                    <label className="modal-input-label">Cantidad</label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        className="modal-standard-input"
                                        value={adjustmentData.quantity}
                                        onChange={(e) => setAdjustmentData({ ...adjustmentData, quantity: e.target.value })}
                                        required
                                        placeholder="0.00"
                                    />
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label">Motivo / Notas</label>
                                    <textarea
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
                                    <h3>Sugerencias de reposiciÃ³n</h3>
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

                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ color: 'var(--color-neutral-600)', fontSize: '0.9rem' }}>
                                        {selectedSuggestions.length} seleccionados de {autoPurchaseSuggestions.length} sugerencias
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <Button type="button" variant="ghost" onClick={handleSelectUrgentSuggestions}>
                                            Seleccionar urgentes
                                        </Button>
                                        <Button type="button" variant="ghost" onClick={() => setSelectedSuggestionKeys({})}>
                                            Limpiar
                                        </Button>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
                                    {autoPurchaseSuggestions.map((suggestion) => {
                                        const key = getSuggestionKey(suggestion);
                                        const checked = Boolean(selectedSuggestionKeys[key]);
                                        return (
                                            <label
                                                key={key}
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'auto 1fr auto',
                                                    gap: '12px',
                                                    alignItems: 'center',
                                                    padding: '12px',
                                                    borderRadius: '12px',
                                                    border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--color-neutral-200)'}`,
                                                    background: checked ? 'var(--color-primary-soft, rgba(37, 99, 235, 0.08))' : 'var(--color-neutral-50)',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => handleToggleSuggestion(suggestion)}
                                                />
                                                <div>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <strong>{suggestion.productName}</strong>
                                                        <span className="sku-tag">{suggestion.warehouseName}</span>
                                                        <span
                                                            className="sku-tag"
                                                            style={{
                                                                background: suggestion.priority === 'URGENT' ? '#FEF2F2' : '#EFF6FF',
                                                                color: suggestion.priority === 'URGENT' ? '#DC2626' : '#1D4ED8'
                                                            }}
                                                        >
                                                            {suggestion.priority === 'URGENT' ? 'Urgente' : 'Normal'}
                                                        </span>
                                                    </div>
                                                    <div style={{ marginTop: '6px', fontSize: '0.82rem', color: 'var(--color-neutral-600)' }}>
                                                        Stock actual: {Number(suggestion.currentStock || 0).toFixed(2)} | Min: {Number(suggestion.minStock || 0).toFixed(2)} | Sugerido: {Number(suggestion.suggestedQuantity).toFixed(2)}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontWeight: 700 }}>
                                                        ${Number(suggestion.estimatedCost || 0).toFixed(2)}
                                                    </div>
                                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-neutral-500)' }}>
                                                        estimado
                                                    </div>
                                                </div>
                                            </label>
                                        );
                                    })}
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

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div >
    );
}
