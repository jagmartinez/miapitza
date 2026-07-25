import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SingleValue } from 'react-select';
import { useAuth } from '../hooks/useAuth';
import { tablesAPI, menuAPI, ordersAPI, settingsAPI, cashShiftsAPI, promotionsAPI, categoriesAPI, menuBrandsAPI, warehousesAPI, invoicesAPI } from '../services/api';
import { offlineManager } from '../services/offlineManager';
import { useDebounce } from '../utils/useDebounce';
import { initializeWebSocket, subscribeWebSocket, WS_EVENTS } from '../utils/websocket';
import {
    getUserAccentColor,
    hasAnyRole,
    canSendOrderToKitchen,
    canCancelOrder,
    canCreatePayment
} from '../utils/authz';
import { getOrderStatusLabel } from '../utils/orderStatus';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import TableSelectionModal from '../components/TableSelectionModal';
import OrderCart from '../components/OrderCart';
import PaymentModal from '../components/PaymentModal';
import NumericKeypad from '../components/NumericKeypad';
import Modal from '../components/Modal';
import Button from '../components/Button';
import Select from '../components/Select';
import POSProductCard from '../components/POSProductCard';
import { LoadingOverlay } from '../components/LoadingSpinner';
import { Send, CreditCard, Printer, X, Search, Grid3x3, AlertTriangle, ChevronLeft, Check } from 'lucide-react';
import type { MenuItem, ModifierGroupWithModifiers, ModifierOption, Order, Table, Warehouse } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { hasUsableCashShift } from '../utils/paymentAccess';
import { isCategoryVisibleInMenu } from '../utils/categoryVisibility';
import { DeliveryAttemptGate } from '../utils/deliveryAttempt';
import {
    buildInvoiceReleaseMessage,
    findPosOrderBucketForTable,
    isEligibleForPosOrderBucket,
    PosBucketReleaseTracker,
} from '../utils/posOrderBucket';
import './POS.css';

interface OfflineResponse {
    _offline?: boolean;
    [key: string]: unknown;
}

interface SelectedModifier {
    id: number;
    name: string;
    price: number;
}

type WarehouseOption = { value: number; label: string };

interface CartItem {
    // Stable per-line id: several lines can share the same menuItemId when they
    // carry different modifier selections, so quantity/remove must key off this.
    lineId: string;
    menuItemId: number;
    menuItem: MenuItem;
    quantity: number;
    // Unit price already includes the selected modifiers' extra price.
    price: number;
    notes: string;
    modifiers: SelectedModifier[];
}

interface Category {
    id: number;
    name: string;
    active: boolean;
    showInMenu?: boolean;
}

interface Brand {
    id: number;
    name: string;
    color?: string | null;
    active: boolean;
}

interface POSSettings {
    tax_rate?: string;
    taxRate?: string;
    tipRate?: string;
    tipEnabled?: string;
    currency_symbol?: string;
    enablePromotions?: string;
    [key: string]: string | undefined;
}

function resolveConfiguredTaxRate(settings: POSSettings): number {
    return parseFloat(settings.tax_rate || settings.taxRate || '0');
}

interface FiscalCustomerForm {
    taxId: string;
    taxIdType: string;
    fiscalAddress: string;
    email: string;
    phone: string;
}

interface FiscalCustomerDraft extends FiscalCustomerForm {
    customerName: string;
}

const EMPTY_FISCAL_CUSTOMER: FiscalCustomerForm = {
    taxId: '', taxIdType: '', fiscalAddress: '', email: '', phone: ''
};

const EMPTY_FISCAL_CUSTOMER_DRAFT: FiscalCustomerDraft = {
    customerName: '',
    ...EMPTY_FISCAL_CUSTOMER,
};

interface ShiftInfo {
    cashRegister?: { name: string; branch?: { id: number; name: string } };
    startDate: string;
}

interface ShiftStatus {
    hasActiveShift: boolean;
    shift: ShiftInfo | null;
    requiresClose: boolean;
    message: string | null;
}

interface POSProps {
    initialTableId?: number;
    embedded?: boolean;
    onExit?: () => void;
    onOperationalChange?: () => void | Promise<void>;
}

export default function POS({ initialTableId, embedded = false, onExit, onOperationalChange }: POSProps = {}) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { symbol: currencySymbol } = useCurrency();
    const { confirm } = useConfirmDialog();
    const { success, error: showError, warning, info } = useAppToast();
    const canManageShift = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CAJERO']);
    const canManageWarehouse = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA', 'CHEF']);
    const canSendToKitchen = canSendOrderToKitchen(user);
    const canCancelActive = canCancelOrder(user);
    const canPay = canCreatePayment(user);
    const [tables, setTables] = useState<Table[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [selectedBrand, setSelectedBrand] = useState<number | null>(null);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [showMobileCart, setShowMobileCart] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [sendingToKitchen, setSendingToKitchen] = useState(false);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);
    const [activeTableOrder, setActiveTableOrder] = useState<Order | null>(null);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
    const posBucketReleaseTrackerRef = useRef(new PosBucketReleaseTracker());
    const [showTableModal, setShowTableModal] = useState(false);
    const [settings, setSettings] = useState<POSSettings>({});
    const [discount, setDiscount] = useState<number>(0);
    const [discountAmountOverride, setDiscountAmountOverride] = useState<number | null>(null);
    const [appliedPromotionCode, setAppliedPromotionCode] = useState<string | null>(null);
    const [tipApplied, setTipApplied] = useState<boolean>(false);
    const [customerName, setCustomerName] = useState('');
    const [fiscalCustomer, setFiscalCustomer] = useState<FiscalCustomerForm>(EMPTY_FISCAL_CUSTOMER);
    const [showFiscalCustomer, setShowFiscalCustomer] = useState(false);
    const [fiscalCustomerDraft, setFiscalCustomerDraft] = useState<FiscalCustomerDraft>(EMPTY_FISCAL_CUSTOMER_DRAFT);
    const [savingFiscalCustomer, setSavingFiscalCustomer] = useState(false);
    const [fiscalCustomerError, setFiscalCustomerError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearch = useDebounce(searchQuery, 250);
    const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showKeypad, setShowKeypad] = useState(false);
    const [selectedItemForKeypad, setSelectedItemForKeypad] = useState<MenuItem | null>(null);
    const [shiftStatus, setShiftStatus] = useState<ShiftStatus | null>(null);
    const [showShiftWarning, setShowShiftWarning] = useState(false);
    // null = aún sin verificar; false bloquea el cobro proactivamente.
    const [hasWarehouse, setHasWarehouse] = useState<boolean | null>(null);
    const [branchWarehouses, setBranchWarehouses] = useState<Warehouse[]>([]);
    const [warehouseAction, setWarehouseAction] = useState<'CANCEL' | null>(null);
    const [operationalWarehouseId, setOperationalWarehouseId] = useState<number | null>(null);
    const [processingWarehouseAction, setProcessingWarehouseAction] = useState(false);
    const warehouseActionGateRef = useRef(new DeliveryAttemptGate());
    const warehouseOptions = useMemo<WarehouseOption[]>(() => branchWarehouses.map((warehouse) => ({
        value: warehouse.id,
        label: `${warehouse.name} (${warehouse.code})`,
    })), [branchWarehouses]);
    const [pendingCancelReason, setPendingCancelReason] = useState<string | undefined>();
    const waiterAccentColor = getUserAccentColor(activeTableOrder?.user || user);

    // Scope the local menu cache by company + branch so different tenants/branches
    // don't read each other's cached menu from a shared localStorage key.
    const menuCacheKey = useMemo(
        () => `pos_menu_cache_v2_${user?.companyId ?? 'anon'}_${selectedTable?.branchId ?? user?.branchId ?? 'none'}`,
        [selectedTable?.branchId, user?.companyId, user?.branchId]
    );

    // Keep the latest selected table in a ref so the websocket subscription effect
    // can stay mounted once instead of tearing down/re-subscribing on every change.
    const selectedTableRef = useRef<Table | null>(null);
    useEffect(() => {
        selectedTableRef.current = selectedTable;
    }, [selectedTable]);

    const clearDraftCart = useCallback((nextCustomerName: string = '') => {
        setCart([]);
        setDiscount(0);
        setDiscountAmountOverride(null);
        setAppliedPromotionCode(null);
        setCustomerName(nextCustomerName);
    }, []);

    const clearTableContext = useCallback(() => {
        clearDraftCart();
        setFiscalCustomer(EMPTY_FISCAL_CUSTOMER);
        setSelectedTable(null);
        setCurrentOrderId(null);
        setActiveTableOrder(null);
    }, [clearDraftCart]);

    const loadData = useCallback(async (notifyOnError = true): Promise<boolean> => {
        setLoadError(null);
        try {
            const effectiveBranchId = selectedTable?.branchId ?? user?.branchId;
            const cached = localStorage.getItem(menuCacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < 5 * 60 * 1000) {
                    setMenuItems(data);
                }
            }

            const [tablesRes, menuRes, settingsRes, categoriesRes, brandsRes] = await Promise.all([
                tablesAPI.getAll(),
                effectiveBranchId
                    ? menuAPI.getAll({ active: true, effectivePricing: true, branchId: effectiveBranchId })
                    : Promise.resolve({ data: { data: [] } }),
                settingsAPI.getAll(),
                categoriesAPI.getAll(),
                menuBrandsAPI.getAll()
            ]);
            setTables(tablesRes.data.data);
            setSelectedTable(prevTable =>
                prevTable
                    ? tablesRes.data.data.find((table: Table) => table.id === prevTable.id) || prevTable
                    : prevTable
            );
            setMenuItems(menuRes.data.data);
            setSettings(settingsRes.data.data);
            setTipApplied(settingsRes.data.data.tipEnabled === 'true');
            setCategories(categoriesRes.data.data);
            setBrands(brandsRes.data.data || []);
            return true;
        } catch {
            const message = 'No se pudieron cargar los datos del POS (mesas, menú o configuración). Revisa tu conexión e inténtalo de nuevo.';
            setLoadError(message);
            if (notifyOnError) {
                showError(message);
            }
            return false;
        } finally {
            setLoading(false);
        }
    }, [menuCacheKey, selectedTable?.branchId, showError, user?.branchId]);

    // Check if user has an active shift
    const checkShiftStatus = useCallback(async () => {
        try {
            const res = await cashShiftsAPI.getActiveStatus();
            const status = res.data.data as ShiftStatus;
            setShiftStatus(status);

            // Show warning if no shift or requires close
            if (!status.hasActiveShift || status.requiresClose) {
                setShowShiftWarning(true);
            }
        } catch {
            warning('No se pudo verificar el estado del turno de caja. Los cobros podrían no estar disponibles.');
        }
    }, [warning]);

    // Proactively detect whether the active branch has at least one warehouse.
    // Mirrors the backend payment guard so the cashier is warned BEFORE trying to
    // charge instead of only seeing the abort error at checkout.
    const checkBranchWarehouse = useCallback(async () => {
        const branchId = selectedTable?.branchId ?? user?.branchId;
        if (!branchId) {
            // Sin sucursal asignada (p. ej. SUPERADMIN global): no bloqueamos aquí;
            // el guard del backend sigue protegiendo el descargue de inventario.
            setHasWarehouse(true);
            setBranchWarehouses([]);
            return;
        }
        try {
            const res = await warehousesAPI.getAll({ branchId });
            const list = ((res.data?.data || []) as Warehouse[]).filter(
                (warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === branchId
            );
            setBranchWarehouses(list);
            setHasWarehouse(list.length > 0);
        } catch {
            // Ante un fallo de consulta no bloqueamos proactivamente; el cobro lo
            // seguirá validando el backend.
            setHasWarehouse(true);
            setBranchWarehouses([]);
        }
    }, [selectedTable?.branchId, user?.branchId]);

    useEffect(() => {
        checkBranchWarehouse();
    }, [checkBranchWarehouse]);

    // Show table modal on first load only in the standalone POS. The map-owned
    // workspace receives a table explicitly and must never ask again.
    useEffect(() => {
        if (!initialTableId && !loading && !selectedTable && tables.length > 0) {
            setShowTableModal(true);
        }
    }, [initialTableId, loading, selectedTable, tables]);

    useEffect(() => {
        initializeWebSocket();
        const unsubscribe = subscribeWebSocket((message) => {
            if (!message?.type) {
                return;
            }

            if (
                message.type === WS_EVENTS.TABLE_STATUS_CHANGED ||
                message.type === WS_EVENTS.ORDER_READY ||
                message.type === WS_EVENTS.ORDER_IN_PREPARATION ||
                message.type === WS_EVENTS.ORDER_UPDATE
            ) {
                loadData();
            }

            const activeTable = selectedTableRef.current;

            if (activeTable && message.type === WS_EVENTS.ORDER_READY) {
                const readyTableNumber = String(message.payload?.tableNumber || '');
                if (readyTableNumber && readyTableNumber === String(activeTable.number)) {
                    success(`Mesa ${activeTable.number}: la orden ya está lista para entregar.`);
                }
            }

            if (activeTable && message.type === WS_EVENTS.ORDER_IN_PREPARATION) {
                const preparingTableNumber = String(message.payload?.tableNumber || '');
                if (preparingTableNumber && preparingTableNumber === String(activeTable.number)) {
                    info(`Mesa ${activeTable.number}: cocina ya inició la preparación.`);
                }
            }
        });

        return unsubscribe;
    }, [info, loadData, success]);

    // Cache products in localStorage
    useEffect(() => {
        if (menuItems.length > 0) {
            localStorage.setItem(menuCacheKey, JSON.stringify({
                data: menuItems,
                timestamp: Date.now()
            }));
        }
    }, [menuCacheKey, menuItems]);

    // Refs to avoid stale closures in keyboard handler
    const handlePaymentRef = useRef<() => Promise<void> | void>(() => {});
    const handleSendToKitchenRef = useRef<() => Promise<void> | void>(() => {});

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            const eventTarget = e.target instanceof HTMLElement ? e.target : null;
            if (eventTarget?.closest('[role="dialog"], [role="alertdialog"]')) return;

            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                if (cart.length > 0 || currentOrderId) handlePaymentRef.current();
            }
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                if (canSendToKitchen && cart.length > 0 && selectedTable) handleSendToKitchenRef.current();
            }
            if (e.key === 'Escape' && cart.length > 0) {
                void (async () => {
                    if (await confirm('¿Limpiar carrito?', { title: 'Confirmar acción' })) {
                        clearDraftCart(activeTableOrder?.customerName || '');
                    }
                })();
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [activeTableOrder?.customerName, canSendToKitchen, cart, clearDraftCart, confirm, currentOrderId, selectedTable]);

    useEffect(() => {
        checkShiftStatus();
        loadData();
    }, [checkShiftStatus, loadData]);

    const loadActiveOrderForTable = useCallback(async (table: Table) => {
        if (!offlineManager.getStatus()) {
            setCurrentOrderId(null);
            setActiveTableOrder(null);
            setCustomerName('');
            setFiscalCustomer(EMPTY_FISCAL_CUSTOMER);
            return;
        }

        try {
            const response = await ordersAPI.getActive();
            const tableOrder = findPosOrderBucketForTable(response.data.data as Order[], table.id);

            setCurrentOrderId(tableOrder?.id ?? null);
            setActiveTableOrder(tableOrder);
            setCustomerName(tableOrder?.customerName || '');
            setFiscalCustomer(tableOrder ? {
                taxId: tableOrder.customerTaxId || '',
                taxIdType: tableOrder.customerTaxIdType || '',
                fiscalAddress: tableOrder.customerFiscalAddress || '',
                email: tableOrder.customerEmail || '',
                phone: tableOrder.customerPhone || ''
            } : EMPTY_FISCAL_CUSTOMER);

            if (tableOrder) {
                info(`Mesa ${table.number}: retomaste la orden #${tableOrder.id} (${tableOrder.status}).`);
            }
        } catch {
            setCurrentOrderId(null);
            setActiveTableOrder(null);
        }
    }, [info]);

    const handleSelectTable = useCallback(async (table: Table) => {
        if (selectedTable?.id === table.id) {
            setShowTableModal(false);
            return;
        }

        if (cart.length > 0) {
            const confirmChange = await confirm('Hay productos pendientes en el carrito actual. Si cambias de mesa se limpiará este borrador. ¿Deseas continuar?', { title: 'Confirmar acción' });
            if (!confirmChange) {
                return;
            }
        }

        clearDraftCart();
        setSelectedTable(table);
        setShowTableModal(false);
        await loadActiveOrderForTable(table);
    }, [cart.length, clearDraftCart, confirm, loadActiveOrderForTable, selectedTable?.id]);

    const initialTableAppliedRef = useRef<number | null>(null);
    useEffect(() => {
        if (!initialTableId || loading || initialTableAppliedRef.current === initialTableId) return;
        const table = tables.find((candidate) => candidate.id === initialTableId);
        if (!table) return;
        initialTableAppliedRef.current = initialTableId;
        void handleSelectTable(table);
    }, [handleSelectTable, initialTableId, loading, tables]);

    // Selector de modificadores: producto en edición + sus grupos cargados.
    const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
    const [modifierGroups, setModifierGroups] = useState<ModifierGroupWithModifiers[]>([]);
    const [loadingModifiers, setLoadingModifiers] = useState(false);

    const addToCart = useCallback((item: MenuItem, quantity: number = 1, modifiers: SelectedModifier[] = []) => {
        const modifiersExtra = modifiers.reduce((sum, mod) => sum + Number(mod.price), 0);
        const unitPrice = Number(item.price) + modifiersExtra;

        setCart(prevCart => {
            // Lines without modifiers can merge; lines with modifiers stay separate
            // so each distinct selection keeps its own price and OrderItemModifier set.
            if (modifiers.length === 0) {
                const existing = prevCart.find(c => c.menuItemId === item.id && c.modifiers.length === 0);
                if (existing) {
                    return prevCart.map(c =>
                        c.lineId === existing.lineId ? { ...c, quantity: c.quantity + quantity } : c
                    );
                }
            }

            return [...prevCart, {
                lineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                menuItemId: item.id,
                menuItem: item,
                quantity,
                price: unitPrice,
                notes: '',
                modifiers
            }];
        });
    }, []);

    const openModifierSelector = useCallback(async (item: MenuItem) => {
        setModifierItem(item);
        setModifierGroups([]);
        setLoadingModifiers(true);
        try {
            const res = await menuAPI.getById(item.id);
            const groups = (res.data.data?.modifierGroups || []) as ModifierGroupWithModifiers[];
            setModifierGroups(groups);
        } catch {
            showError('No se pudieron cargar los modificadores de este producto.');
            setModifierItem(null);
        } finally {
            setLoadingModifiers(false);
        }
    }, [showError]);

    const handleItemClick = useCallback((item: MenuItem) => {
        // Open the modifier selector only when the product actually has groups;
        // otherwise keep the existing one-tap add behavior.
        if ((item._count?.modifierGroups ?? 0) > 0) {
            void openModifierSelector(item);
            return;
        }
        addToCart(item, 1);
    }, [addToCart, openModifierSelector]);

    const handleModifierConfirm = useCallback((selected: SelectedModifier[]) => {
        if (modifierItem) {
            addToCart(modifierItem, 1, selected);
        }
        setModifierItem(null);
        setModifierGroups([]);
    }, [addToCart, modifierItem]);

    const handleItemRightClick = useCallback((e: React.MouseEvent, item: MenuItem) => {
        e.preventDefault();
        setSelectedItemForKeypad(item);
        setShowKeypad(true);
    }, []);

    const handleQuantityEdit = useCallback((item: MenuItem) => {
        setSelectedItemForKeypad(item);
        setShowKeypad(true);
    }, []);

    const handleKeypadConfirm = (quantity: number) => {
        if (selectedItemForKeypad) {
            // Right-click / quantity keypad keeps the quick path (no modifiers).
            addToCart(selectedItemForKeypad, quantity);
        }
        setShowKeypad(false);
        setSelectedItemForKeypad(null);
    };

    const updateQuantity = (lineId: string, delta: number) => {
        setCart(cart.map(item => {
            if (item.lineId === lineId) {
                const newQuantity = item.quantity + delta;
                return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
            }
            return item;
        }).filter(item => item.quantity > 0));
    };

    const removeFromCart = (lineId: string) => {
        setCart(cart.filter(item => item.lineId !== lineId));
    };

    const buildOrderPayload = useCallback(() => ({
        tableId: selectedTable?.id,
        branchId: selectedTable?.branchId,
        customerName: customerName || undefined,
        customerTaxId: fiscalCustomer.taxId || undefined,
        customerTaxIdType: fiscalCustomer.taxIdType || undefined,
        customerFiscalAddress: fiscalCustomer.fiscalAddress || undefined,
        customerEmail: fiscalCustomer.email || undefined,
        customerPhone: fiscalCustomer.phone || undefined,
        items: cart.map(item => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            price: item.price,
            notes: item.notes || '',
            modifierIds: item.modifiers.map(mod => mod.id)
        }))
    }), [selectedTable, customerName, fiscalCustomer, cart]);

    const syncOrderContext = useCallback(async (orderId: number) => {
        if (!offlineManager.getStatus()) {
            return null;
        }

        const response = await ordersAPI.getById(orderId);
        const refreshedOrder = response.data.data as Order;
        if (!isEligibleForPosOrderBucket(refreshedOrder)) {
            posBucketReleaseTrackerRef.current.releaseAfterConfirmedInvoice(
                refreshedOrder.id,
                refreshedOrder.invoiceNumber || `fiscal-order-${refreshedOrder.id}`,
                clearTableContext,
            );
            return refreshedOrder;
        }
        setActiveTableOrder(refreshedOrder);
        setCurrentOrderId(refreshedOrder.id);
        setCustomerName(refreshedOrder.customerName || '');
        setFiscalCustomer({
            taxId: refreshedOrder.customerTaxId || '',
            taxIdType: refreshedOrder.customerTaxIdType || '',
            fiscalAddress: refreshedOrder.customerFiscalAddress || '',
            email: refreshedOrder.customerEmail || '',
            phone: refreshedOrder.customerPhone || ''
        });
        return refreshedOrder;
    }, [clearTableContext]);

    const persistCartToOrder = useCallback(async () => {
        if (cart.length === 0) {
            return {
                orderId: currentOrderId,
                offlineQueued: false,
                dependencyKey: null,
            };
        }

        if (currentOrderId) {
            let offlineQueued = false;
            const operationGroupKey = `order-${currentOrderId}-kitchen-${typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

            for (const item of cart) {
                const response = await ordersAPI.addItem(currentOrderId, {
                    menuItemId: item.menuItemId,
                    quantity: item.quantity,
                    notes: item.notes || '',
                    modifierIds: item.modifiers.map(mod => mod.id)
                }, {
                    operationType: 'ADD_ORDER_ITEM',
                    entityTempId: operationGroupKey,
                });

                if ((response.data as OfflineResponse)._offline) {
                    offlineQueued = true;
                }
            }

            if (!offlineQueued) {
                const refreshedOrder = await syncOrderContext(currentOrderId);
                clearDraftCart(refreshedOrder?.customerName || activeTableOrder?.customerName || '');
            } else {
                clearDraftCart(activeTableOrder?.customerName || '');
            }

            return {
                orderId: currentOrderId,
                offlineQueued,
                dependencyKey: offlineQueued ? operationGroupKey : null,
            };
        }

        const createResponse = await ordersAPI.create(buildOrderPayload(), {
            operationType: 'CREATE_ORDER',
            entityTempId: `order-${Date.now()}`
        });

        if ((createResponse.data as OfflineResponse)._offline) {
            return {
                orderId: null,
                offlineQueued: true,
                dependencyKey: null,
            };
        }

        const createdOrder = createResponse.data.data as Order;
        setCurrentOrderId(createdOrder.id);
        setActiveTableOrder(createdOrder);
        clearDraftCart(createdOrder.customerName || '');

        return {
            orderId: createdOrder.id,
            offlineQueued: false,
            dependencyKey: null,
        };
    }, [activeTableOrder?.customerName, buildOrderPayload, cart, clearDraftCart, currentOrderId, syncOrderContext]);

    const handleSendToKitchen = async () => {
        if (!canSendToKitchen) {
            warning('Tu rol no puede enviar órdenes a cocina. Pide apoyo a un mesero o administrador.');
            return;
        }

        if (!selectedTable) {
            warning('Por favor selecciona una mesa');
            return;
        }

        if (cart.length === 0) {
            warning('El carrito está vacío');
            return;
        }

        setSendingToKitchen(true);
        try {
            const requestedDiscountPercent = discount;
            const requestedDiscountOverride = discountAmountOverride;
            const requestedPromotionCode = appliedPromotionCode;
            const requestedTipApplied = tipApplied;
            const { orderId, offlineQueued, dependencyKey } = await persistCartToOrder();

            if (!orderId) {
                warning('La orden quedó pendiente, pero no puede enviarse a cocina hasta existir en el servidor.');
                return;
            }

            const hasExplicitPricing = requestedDiscountPercent > 0
                || requestedDiscountOverride !== null
                || Boolean(requestedPromotionCode)
                || requestedTipApplied;
            if (offlineQueued && hasExplicitPricing) {
                setDiscount(requestedDiscountPercent);
                setDiscountAmountOverride(requestedDiscountOverride);
                setAppliedPromotionCode(requestedPromotionCode);
                setTipApplied(requestedTipApplied);
                warning('La promoción o propina no puede confirmarse sin conexión. La orden no se enviará a cocina hasta sincronizar el precio.');
                return;
            }

            if (!offlineQueued && hasExplicitPricing) {
                const refreshedOrder = await syncOrderContext(orderId);
                if (!refreshedOrder) throw new Error('No se pudo confirmar el total de la orden');
                const refreshedSubtotal = (refreshedOrder.items || []).reduce(
                    (sum, item) => sum + Number(item.subtotal || 0),
                    0
                );
                const computedDiscount = Math.min(
                    Math.max(0, requestedDiscountOverride ?? (refreshedSubtotal * (requestedDiscountPercent / 100))),
                    refreshedSubtotal
                );
                const taxRate = resolveConfiguredTaxRate(settings);
                const computedTax = Math.max(0, (refreshedSubtotal - computedDiscount) * (taxRate / 100));
                const computedTipRate = parseFloat(settings.tipRate || '0');
                const computedTip = requestedTipApplied
                    ? Math.max(0, (refreshedSubtotal - computedDiscount) * (computedTipRate / 100))
                    : 0;
                const pricingResponse = await ordersAPI.updatePricing(orderId, {
                    discount: Number(computedDiscount.toFixed(2)),
                    discountCode: requestedPromotionCode || null,
                    tax: Number(computedTax.toFixed(2)),
                    tipAmount: Number(computedTip.toFixed(2))
                });
                setActiveTableOrder(pricingResponse.data.data as Order);
            }

            const response = await ordersAPI.sendToKitchen(orderId, {
                operationType: 'SEND_TO_KITCHEN',
                dependencyKey,
                forceQueue: Boolean(dependencyKey),
            });
            const queuedOffline = Boolean((response.data as OfflineResponse)._offline);

            if (queuedOffline) {
                info('La orden quedó pendiente de sincronización para enviarse a cocina.');
            } else {
                success('Orden enviada a cocina exitosamente');
            }

            if (!queuedOffline) {
                await syncOrderContext(orderId);
                await loadData();
            }
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            showError(axiosErr.response?.data?.message || 'Error al enviar la orden');
        } finally {
            setSendingToKitchen(false);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const openFiscalCustomerModal = useCallback(() => {
        setFiscalCustomerDraft({
            customerName,
            ...fiscalCustomer,
        });
        setFiscalCustomerError(null);
        setShowFiscalCustomer(true);
    }, [customerName, fiscalCustomer]);

    const closeFiscalCustomerModal = useCallback(() => {
        if (savingFiscalCustomer) return;
        setFiscalCustomerError(null);
        setShowFiscalCustomer(false);
    }, [savingFiscalCustomer]);

    const saveFiscalCustomer = async () => {
        const normalized: FiscalCustomerDraft = {
            customerName: fiscalCustomerDraft.customerName.trim(),
            taxId: fiscalCustomerDraft.taxId.trim(),
            taxIdType: fiscalCustomerDraft.taxIdType.trim(),
            fiscalAddress: fiscalCustomerDraft.fiscalAddress.trim(),
            email: fiscalCustomerDraft.email.trim(),
            phone: fiscalCustomerDraft.phone.trim(),
        };
        const hasTaxIdentity = Boolean(normalized.taxId || normalized.taxIdType);

        if (hasTaxIdentity && (!normalized.customerName || !normalized.taxId || !normalized.taxIdType)) {
            setFiscalCustomerError('Nombre, identificación tributaria y tipo de identificación deben registrarse juntos.');
            return;
        }
        if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
            setFiscalCustomerError('El correo fiscal del cliente no es válido.');
            return;
        }

        setSavingFiscalCustomer(true);
        setFiscalCustomerError(null);
        try {
            if (currentOrderId) {
                const response = await ordersAPI.updateFiscalCustomer(currentOrderId, {
                    customerName: normalized.customerName,
                    customerTaxId: normalized.taxId,
                    customerTaxIdType: normalized.taxIdType,
                    customerFiscalAddress: normalized.fiscalAddress,
                    customerEmail: normalized.email,
                    customerPhone: normalized.phone,
                });
                const persistedOrder = response.data.data as Order;
                setActiveTableOrder((current) => (
                    current?.id === currentOrderId
                        ? { ...current, ...persistedOrder }
                        : current
                ));
            }

            setCustomerName(normalized.customerName);
            setFiscalCustomer({
                taxId: normalized.taxId,
                taxIdType: normalized.taxIdType,
                fiscalAddress: normalized.fiscalAddress,
                email: normalized.email,
                phone: normalized.phone,
            });
            setShowFiscalCustomer(false);
            success(currentOrderId
                ? 'Datos fiscales guardados en la orden.'
                : 'Datos fiscales guardados para este pedido.');
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message
                || (error instanceof Error ? error.message : 'No se pudieron guardar los datos fiscales.');
            setFiscalCustomerError(message);
            showError(message);
        } finally {
            setSavingFiscalCustomer(false);
        }
    };

    const handlePayment = async () => {
        if (!canPay) {
            warning('Tu rol no puede registrar pagos. Pide apoyo a un cajero o administrador.');
            return;
        }

        if (cart.length === 0 && !currentOrderId) {
            warning('El carrito está vacío');
            return;
        }

        setProcessingPayment(true);
        try {
            const requestedDiscountPercent = discount;
            const requestedDiscountOverride = discountAmountOverride;
            const requestedPromotionCode = appliedPromotionCode;
            const { orderId, offlineQueued } = await persistCartToOrder();

            if (!orderId) {
                warning('La orden quedó pendiente, pero el cobro está bloqueado hasta que exista en el servidor.');
                return;
            }

            if (offlineQueued) {
                warning('Hay productos pendientes de sincronizar en esta orden. Espera conexión antes de cobrarla.');
                return;
            }

            let paymentSnapshot = await syncOrderContext(orderId);
            if (!paymentSnapshot) {
                throw new Error('No se pudo confirmar la orden antes de facturarla.');
            }

            // Persist pricing snapshot on the server before opening payment modal.
            if (cart.length > 0 || requestedDiscountPercent > 0 || requestedDiscountOverride !== null || requestedPromotionCode) {
                const refreshedSubtotal = (paymentSnapshot.items || []).reduce(
                    (sum, item) => sum + Number(item.subtotal || 0),
                    0
                );
                const computedDiscount = Math.min(
                    Math.max(0, requestedDiscountOverride ?? (refreshedSubtotal * (requestedDiscountPercent / 100))),
                    refreshedSubtotal
                );
                const taxRate = resolveConfiguredTaxRate(settings);
                const computedTax = Math.max(0, (refreshedSubtotal - computedDiscount) * (taxRate / 100));
                const computedTipRate = parseFloat(settings.tipRate || '0');
                const computedTip = tipApplied ? Math.max(0, (refreshedSubtotal - computedDiscount) * (computedTipRate / 100)) : 0;

                const pricingResponse = await ordersAPI.updatePricing(orderId, {
                    discount: Number(computedDiscount.toFixed(2)),
                    discountCode: requestedPromotionCode || null,
                    tax: Number(computedTax.toFixed(2)),
                    tipAmount: Number(computedTip.toFixed(2))
                });
                paymentSnapshot = pricingResponse.data.data as Order;
                setActiveTableOrder(paymentSnapshot);
            }

            if (!paymentSnapshot.invoiceNumber) {
                await ordersAPI.updateFiscalCustomer(orderId, {
                    customerName,
                    customerTaxId: fiscalCustomer.taxId,
                    customerTaxIdType: fiscalCustomer.taxIdType,
                    customerFiscalAddress: fiscalCustomer.fiscalAddress,
                    customerEmail: fiscalCustomer.email,
                    customerPhone: fiscalCustomer.phone
                });
            }

            // Emit the fiscal document before opening collection. The backend
            // enforces the same invariant, so bypassing this UI cannot pay an
            // unbilled order.
            const invoiceResponse = await invoicesAPI.issue(orderId);
            const invoiceNumber = invoiceResponse.data?.data?.invoiceNumber;
            if (!invoiceNumber) {
                throw new Error('La factura no pudo emitirse antes del cobro');
            }

            const invoicedPaymentOrder: Order = {
                ...paymentSnapshot,
                invoiceNumber,
                invoicedAt: invoiceResponse.data?.data?.issuedAt || paymentSnapshot.invoicedAt,
                invoiceFiscalStatus: 'ISSUED',
            };
            setPaymentOrder(invoicedPaymentOrder);
            setShowPaymentModal(true);
            posBucketReleaseTrackerRef.current.releaseAfterConfirmedInvoice(
                orderId,
                invoiceNumber,
                clearTableContext,
            );
            const tableNumber = paymentSnapshot.table?.number ?? selectedTable?.number;
            success(buildInvoiceReleaseMessage({
                invoiceNumber,
                orderId,
                tableNumber,
                financialStatus: paymentSnapshot.financialStatus,
            }));

            const tableViewRefreshed = await loadData(false);
            if (!tableViewRefreshed) {
                warning('La factura fue emitida y la mesa liberada, pero la vista de mesas no pudo actualizarse. Recarga la página.');
            }
            try {
                await onOperationalChange?.();
            } catch {
                warning('La factura fue emitida y la mesa liberada, pero el mapa operativo no pudo actualizarse. Recarga la página.');
            }
        } catch (error: unknown) {
            const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
            showError(message || (error instanceof Error ? error.message : 'No se pudo preparar la orden para cobrarla.'));
            return;
        } finally {
            setProcessingPayment(false);
        }
    };
    handlePaymentRef.current = handlePayment;
    handleSendToKitchenRef.current = handleSendToKitchen;

    const handlePaymentComplete = async (paymentData?: { offlineQueued?: boolean }) => {
        try {
            if (!paymentOrder) {
                throw new Error('No se encontró una orden lista para cobrar');
            }

            // El bucket POS ya fue liberado al emitir la factura. Un pago en cola
            // no se presenta como confirmado y conserva su propio contexto de cobro.
            if (paymentData?.offlineQueued) {
                warning('Pago pendiente de sincronización. La factura ya fue emitida; el cobro se marcará como pagado al confirmarse la conexión.');
                return;
            }

            setShowPaymentModal(false);
            setPaymentOrder(null);
            success('Pago procesado exitosamente');

            await loadData();
            await onOperationalChange?.();
            if (embedded) onExit?.();
        } catch {
            showError('Error al procesar el pago.');
        }
    };

    const handleCancelActiveOrder = useCallback(async () => {
        if (!activeTableOrder) {
            return;
        }

        if (!canCancelActive) {
            warning('Tu rol no puede cancelar órdenes. Pide apoyo a un mesero o administrador.');
            return;
        }

        if (!(await confirm('¿Cancelar la orden activa de esta mesa?', { variant: 'warning', confirmText: 'Sí, cancelar' }))) {
            return;
        }

        const reason = window.prompt('Motivo de cancelación (opcional):') || undefined;
        const requiresWasteWarehouse = activeTableOrder.status !== 'OPEN';
        if (requiresWasteWarehouse) {
            setPendingCancelReason(reason);
            setOperationalWarehouseId(branchWarehouses.length === 1 ? branchWarehouses[0].id : null);
            setWarehouseAction('CANCEL');
            return;
        }

        try {
            await ordersAPI.cancel(activeTableOrder.id, reason);
            await loadData();
            clearTableContext();
            success(`Orden #${activeTableOrder.id} cancelada correctamente.`);
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            showError(axiosErr.response?.data?.message || 'No se pudo cancelar la orden.');
        }
    }, [activeTableOrder, branchWarehouses, canCancelActive, clearTableContext, confirm, loadData, showError, success, warning]);

    const handleWarehouseAction = useCallback(async () => {
        if (!activeTableOrder || !warehouseAction || !operationalWarehouseId) {
            warning('Selecciona una bodega de la sucursal.');
            return;
        }

        const orderId = activeTableOrder.id;
        const warehouseId = operationalWarehouseId;
        const cancelReason = pendingCancelReason;
        await warehouseActionGateRef.current.execute({
            request: async () => {
                await ordersAPI.cancel(orderId, cancelReason, warehouseId);
            },
            onSuccess: async () => {
                const refreshed = await loadData(false);
                clearTableContext();
                success(`Orden #${orderId} cancelada correctamente.`);
                setWarehouseAction(null);
                setOperationalWarehouseId(null);
                setPendingCancelReason(undefined);
                if (!refreshed) {
                    throw new Error('La operación se aplicó, pero el POS no pudo actualizarse.');
                }
            },
            onError: (message) => showError(message),
            onSuccessError: (error) => {
                console.error('Warehouse operation completed but POS refresh failed:', error);
                showError('La orden fue cancelada, pero el POS no pudo actualizarse. Recarga la página.');
            },
            onPendingChange: setProcessingWarehouseAction,
            fallbackMessage: 'No se pudo cancelar la orden ni registrar la merma.',
        });
    }, [activeTableOrder, clearTableContext, loadData, operationalWarehouseId, pendingCancelReason, showError, success, warehouseAction, warning]);
    const handleApplyPromotion = async (code: string) => {
        try {
            const res = await promotionsAPI.validate(code, subtotal);
            const result = res.data.data;
            if (res.data.success && result) {
                const discountAmount = Number(result.discount || 0);
                const discountAsPercent = subtotal > 0
                    ? Math.min(100, Math.max(0, (discountAmount / subtotal) * 100))
                    : 0;
                setDiscount(discountAsPercent);
                setDiscountAmountOverride(discountAmount);
                setAppliedPromotionCode(code.toUpperCase());
                success(result.message || 'Promoción aplicada');
            } else {
                showError(result?.message || 'Promoción inválida');
            }
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            showError(axiosErr.response?.data?.message || 'Error al validar promoción');
        }
    };

    const filteredMenuItems = useMemo(() =>
        menuItems.filter(item => {
            // Brand switcher: show the selected brand's items plus shared ("común") items.
            const matchesBrand = selectedBrand === null
                || item.brandId === selectedBrand
                || item.brandId === null
                || item.brandId === undefined;
            if (!matchesBrand) return false;
            const matchesSearch = item.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
                item.category?.name.toLowerCase().includes(debouncedSearch.toLowerCase());
            const matchesCategory = selectedCategory ? item.categoryId === Number(selectedCategory) : true;
            return matchesSearch && matchesCategory;
        }),
        [menuItems, debouncedSearch, selectedCategory, selectedBrand]
    );

    if (loading) {
        return <LoadingOverlay text="Cargando POS..." />;
    }

    if (loadError) {
        return (
            <div className="pos-load-error">
                <AlertTriangle size={48} />
                <h2>No se pudo cargar el POS</h2>
                <p>{loadError}</p>
                <button
                    type="button"
                    className="header-action-btn primary"
                    onClick={() => {
                        setLoading(true);
                        void loadData().finally(() => setLoading(false));
                    }}
                >
                    Reintentar
                </button>
            </div>
        );
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cartItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
    const showMobileActions = cartItemCount > 0 || Boolean(currentOrderId);
    const discountAmount = Math.min(
        Math.max(0, discountAmountOverride ?? (subtotal * (discount / 100))),
        subtotal
    );
    const taxAmount = (subtotal - discountAmount) * (resolveConfiguredTaxRate(settings) / 100);
    const tipRate = parseFloat(settings.tipRate || '0');
    const tipAmount = tipApplied ? (subtotal - discountAmount) * (tipRate / 100) : 0;
    const total = subtotal - discountAmount + taxAmount + tipAmount;
    const activeOrderTotal = Number(activeTableOrder?.total || 0);
    const displayTotal = cart.length > 0 ? total : activeOrderTotal;
    const branchHasNoWarehouse = hasWarehouse === false;
    const canProcessPayment = canPay && (cart.length > 0 || Boolean(currentOrderId));

    return (
        <div className={`pos-container-new ${embedded ? 'pos-embedded' : ''}`}>
            {/* Header */}
            <div className="pos-header-new">
                <div className="header-left">
                    {embedded && (
                        <button
                            type="button"
                            className="pos-back-to-map"
                            onClick={() => {
                                void onOperationalChange?.();
                                onExit?.();
                            }}
                        >
                            <ChevronLeft size={18} /> Plano
                        </button>
                    )}
                    {selectedTable ? (
                        <div className="table-badge-new">
                            <Grid3x3 size={18} />
                            <span>Mesa {selectedTable.number}</span>
                            {!embedded && (
                                <button onClick={() => setShowTableModal(true)} className="change-table-btn">
                                    Cambiar
                                </button>
                            )}
                        </div>
                    ) : (
                        <button onClick={() => setShowTableModal(true)} className="select-table-btn">
                            <Grid3x3 size={18} />
                            Seleccionar Mesa
                        </button>
                    )}
                </div>

                <div className="header-center">
                    <div className="search-bar-new">
                        <Search size={18} />
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Buscar producto... (Ctrl+F)"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="clear-search-btn">
                                <X size={16} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="header-right">
                    <button
                        className="header-action-btn primary"
                        onClick={handlePayment}
                        disabled={!canProcessPayment || processingPayment}
                        title={!canPay ? 'Tu rol no puede registrar pagos' : 'Pagar (Ctrl+P)'}
                    >
                        <CreditCard size={18} />
                        <span>{processingPayment ? 'Preparando...' : 'Pagar'}</span>
                    </button>
                    <button
                        className="header-action-btn secondary"
                        onClick={handleSendToKitchen}
                        disabled={!canSendToKitchen || cart.length === 0 || !selectedTable || sendingToKitchen}
                        title={canSendToKitchen ? 'Enviar a Cocina (Ctrl+K)' : 'Tu rol no puede enviar a cocina'}
                    >
                        <Send size={18} />
                        <span>{sendingToKitchen ? 'Enviando...' : 'Cocina'}</span>
                    </button>
                    <button
                        className="header-action-btn secondary"
                        onClick={handlePrint}
                        title="Imprimir"
                    >
                        <Printer size={18} />
                    </button>
                </div>
            </div>

            {/* El cobro es financiero y no descarga inventario. La advertencia se
                limita al flujo operativo de entrega, que sí exige una bodega. */}
            {branchHasNoWarehouse && (
                <div className="pos-warehouse-banner" role="alert">
                    <AlertTriangle size={22} className="pos-warehouse-banner-icon" />
                    <div className="pos-warehouse-banner-text">
                        <strong>Entrega de inventario no disponible</strong>
                        <span>
                            Puedes emitir la factura y cobrar, pero no completar la entrega con descarga de
                            inventario hasta configurar un almacén para esta sucursal.
                        </span>
                    </div>
                    {canManageWarehouse && (
                        <button
                            type="button"
                            className="pos-warehouse-banner-btn"
                            onClick={() => navigate('/warehouses')}
                        >
                            Ir a Bodegas
                        </button>
                    )}
                </div>
            )}

            {/* Main Content */}
            <div className="pos-main-new">
                {/* Category Sidebar */}
                <div className="category-sidebar">
                    <button
                        className={`category-item ${selectedCategory === null ? 'active' : ''}`}
                        onClick={() => setSelectedCategory(null)}
                    >
                        <span>Todos</span>
                    </button>
                    {categories.filter(c => isCategoryVisibleInMenu(c) && c.name !== 'Catering').map(cat => (
                        <button
                            key={cat.id}
                            className={`category-item ${selectedCategory === cat.id ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(cat.id)}
                        >
                            <span>{cat.name}</span>
                        </button>
                    ))}
                </div>

                {/* Product Grid */}
                <div className="product-area">
                    {brands.filter(b => b.active).length > 0 && (
                        <div className="pos-brand-switcher">
                            <button
                                className={`pos-brand-tab ${selectedBrand === null ? 'active' : ''}`}
                                onClick={() => setSelectedBrand(null)}
                            >
                                Todas
                            </button>
                            {brands.filter(b => b.active).map(brand => (
                                <button
                                    key={brand.id}
                                    className={`pos-brand-tab ${selectedBrand === brand.id ? 'active' : ''}`}
                                    onClick={() => setSelectedBrand(brand.id)}
                                    style={selectedBrand === brand.id && brand.color
                                        ? { background: brand.color, borderColor: brand.color, color: '#fff' }
                                        : brand.color
                                            ? { borderColor: brand.color }
                                            : undefined}
                                >
                                    <span
                                        className="pos-brand-dot"
                                        style={{ background: brand.color || 'var(--color-primary)' }}
                                    />
                                    {brand.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="products-grid-new">
                        {filteredMenuItems.map(item => (
                            <POSProductCard
                                key={item.id}
                                item={item}
                                onClick={handleItemClick}
                                onContextMenu={handleItemRightClick}
                                onQuantityEdit={handleQuantityEdit}
                                currencySymbol={currencySymbol}
                            />
                        ))}
                        {filteredMenuItems.length === 0 && (
                            <div className="no-products">
                                <p>No se encontraron productos</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Order Cart */}
                <div className={`cart-area ${showMobileCart ? 'mobile-visible' : ''}`}>
                    {showMobileCart && (
                        <div className="mobile-cart-header">
                            <div className="mobile-cart-search">
                                <Search size={16} />
                                <input
                                    type="search"
                                    placeholder="Buscar producto..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <button
                                onClick={() => setShowMobileCart(false)}
                                className="header-action-btn secondary"
                                style={{
                                    width: '100%',
                                    justifyContent: 'center',
                                    border: '1px solid var(--color-primary)',
                                    color: 'var(--color-primary)',
                                    padding: '12px',
                                    gap: '8px'
                                }}
                            >
                                <ChevronLeft size={20} />
                                Volver al Menú
                            </button>
                        </div>
                    )}
                    {selectedTable && activeTableOrder && (
                        <div className="pos-active-order-summary" style={{
                            marginBottom: '1rem',
                            padding: '0.85rem 1rem',
                            borderRadius: '12px',
                            background: 'var(--color-surface-elevated)',
                            border: `1px solid ${waiterAccentColor}55`,
                            boxShadow: `inset 4px 0 0 ${waiterAccentColor}`
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 700 }}>Orden activa #{activeTableOrder.id}</div>
                                        <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                            padding: '0.2rem 0.55rem',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            fontWeight: 700,
                                            background: `${waiterAccentColor}18`,
                                            color: waiterAccentColor
                                        }}>
                                            {activeTableOrder.user?.name || 'Sin mesero'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                                        Estado: {getOrderStatusLabel(activeTableOrder.status)} · {activeTableOrder.items?.length || 0} items
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
                                        {canCancelActive && activeTableOrder.financialStatus === 'UNPAID' && !activeTableOrder.payments?.length && activeTableOrder.status !== 'CANCELLED' && (
                                            <button
                                                className="header-action-btn secondary"
                                                onClick={handleCancelActiveOrder}
                                                style={{ borderColor: 'var(--color-error, #ef4444)', color: 'var(--color-error, #ef4444)' }}
                                            >
                                                Cancelar
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div style={{ fontWeight: 700 }}>
                                    {currencySymbol}{activeOrderTotal.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    )}
                    <button
                        type="button"
                        className="header-action-btn secondary"
                        onClick={openFiscalCustomerModal}
                        aria-haspopup="dialog"
                        aria-expanded={showFiscalCustomer}
                        style={{ width: '100%', justifyContent: 'center', marginBottom: '0.75rem' }}
                    >
                        Datos fiscales del cliente
                        {fiscalCustomer.taxId ? ` · ${fiscalCustomer.taxIdType || 'ID'} ${fiscalCustomer.taxId}` : ' · Consumidor final'}
                    </button>
                    <OrderCart
                        cart={cart}
                        discount={discount}
                        taxRate={resolveConfiguredTaxRate(settings)}
                        tipRate={tipRate}
                        tipEnabled={tipApplied}
                        onUpdateQuantity={updateQuantity}
                        onRemoveItem={removeFromCart}
                        onDiscountChange={(value) => {
                            setDiscount(value);
                            setDiscountAmountOverride(null);
                            setAppliedPromotionCode(null);
                        }}
                        onTipToggle={settings.tipEnabled === 'true' ? (enabled) => setTipApplied(enabled) : undefined}
                        enablePromotions={settings.enablePromotions === 'true'}
                        onApplyPromotion={handleApplyPromotion}
                        currencySymbol={currencySymbol}
                    />
                    {showMobileCart && showMobileActions && (
                        <div className="pos-mobile-actions in-cart-panel">
                            <button
                                type="button"
                                className="pos-mobile-action-btn secondary"
                                onClick={handleSendToKitchen}
                                disabled={!canSendToKitchen || cart.length === 0 || !selectedTable || sendingToKitchen}
                            >
                                <Send size={20} />
                                <span>{sendingToKitchen ? 'Enviando...' : 'Enviar'}</span>
                            </button>
                            <button
                                type="button"
                                className="pos-mobile-action-btn primary"
                                onClick={handlePayment}
                                disabled={!canProcessPayment || processingPayment}
                            >
                                <CreditCard size={20} />
                                <span>{processingPayment ? 'Preparando...' : 'Cobrar'}</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {showMobileActions && !showMobileCart && (
                <div className="pos-mobile-actions">
                    <button
                        type="button"
                        className="pos-mobile-action-btn secondary"
                        onClick={handleSendToKitchen}
                        disabled={!canSendToKitchen || cart.length === 0 || !selectedTable || sendingToKitchen}
                    >
                        <Send size={20} />
                        <span>{sendingToKitchen ? 'Enviando...' : 'Enviar'}</span>
                    </button>
                    <button
                        type="button"
                        className="pos-mobile-action-btn primary"
                        onClick={handlePayment}
                        disabled={!canProcessPayment || processingPayment}
                    >
                        <CreditCard size={20} />
                        <span>{processingPayment ? 'Preparando...' : 'Cobrar'}</span>
                    </button>
                </div>
            )}

            {/* Mobile Cart Summary Bar */}
            <div className="mobile-cart-summary">
                <div className="cart-total-preview">
                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Total:</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', marginLeft: '0.5rem' }}>{currencySymbol}{displayTotal.toFixed(2)}</span>
                </div>
                <button className="mobile-cart-btn" onClick={() => setShowMobileCart(true)}>
                    <span>Ver Orden ({cart.reduce((acc, item) => acc + item.quantity, 0) || activeTableOrder?.items?.length || 0})</span>
                </button>
            </div>

            {/* Modals */}
            {showTableModal && (
                <TableSelectionModal
                    tables={tables}
                    excludeTableId={selectedTable?.id}
                    onSelectTable={handleSelectTable}
                    onClose={() => setShowTableModal(false)}
                />
            )}

            {showPaymentModal && (
                <PaymentModal
                    isOpen={showPaymentModal}
                    onClose={() => {
                        setShowPaymentModal(false);
                        setPaymentOrder(null);
                    }}
                    orderId={paymentOrder?.id ?? null}
                    orderTotal={Number(paymentOrder?.total ?? 0)}
                    order={paymentOrder}
                    onPaymentSuccess={handlePaymentComplete}
                    currencySymbol={currencySymbol}
                    hasUsableCashShift={hasUsableCashShift(shiftStatus, paymentOrder?.branchId)}
                />
            )}

            {showFiscalCustomer && (
                <Modal
                    isOpen
                    onClose={closeFiscalCustomerModal}
                    title="Datos fiscales del cliente"
                    overlayClassName="pos-fiscal-modal-overlay"
                    size="lg"
                    closeOnBackdrop={!savingFiscalCustomer}
                    closeOnEscape={!savingFiscalCustomer}
                    description="Déjalos vacíos para consumidor final. Si registras identificación tributaria, nombre, tipo e identificación son obligatorios y quedarán congelados al emitir."
                    footer={activeTableOrder?.invoiceNumber
                        ? <Button type="button" onClick={closeFiscalCustomerModal}>Cerrar</Button>
                        : (
                            <>
                                <Button type="button" variant="ghost" onClick={closeFiscalCustomerModal} disabled={savingFiscalCustomer}>
                                    Cancelar
                                </Button>
                                <Button type="button" onClick={() => void saveFiscalCustomer()} disabled={savingFiscalCustomer}>
                                    {savingFiscalCustomer ? 'Guardando...' : 'Guardar'}
                                </Button>
                            </>
                        )}
                >
                        <div className="pos-fiscal-grid">
                            <label htmlFor="pos-fiscal-customer-name">
                                Nombre o razón social
                                <input id="pos-fiscal-customer-name" className="input" value={fiscalCustomerDraft.customerName} maxLength={191} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, customerName: event.target.value }))} placeholder="Consumidor final" />
                            </label>
                            <label htmlFor="pos-fiscal-tax-id-type">
                                Tipo de identificación
                                <input id="pos-fiscal-tax-id-type" className="input" value={fiscalCustomerDraft.taxIdType} maxLength={50} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, taxIdType: event.target.value }))} placeholder="RUC, NIT u otro configurado" />
                            </label>
                            <label htmlFor="pos-fiscal-tax-id">
                                Identificación tributaria
                                <input id="pos-fiscal-tax-id" className="input" value={fiscalCustomerDraft.taxId} maxLength={100} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, taxId: event.target.value }))} />
                            </label>
                            <label htmlFor="pos-fiscal-phone">
                                Teléfono
                                <input id="pos-fiscal-phone" className="input" value={fiscalCustomerDraft.phone} maxLength={50} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, phone: event.target.value }))} />
                            </label>
                            <label className="pos-fiscal-span-full" htmlFor="pos-fiscal-address">
                                Dirección fiscal
                                <textarea id="pos-fiscal-address" className="input" rows={2} value={fiscalCustomerDraft.fiscalAddress} maxLength={1000} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, fiscalAddress: event.target.value }))} />
                            </label>
                            <label className="pos-fiscal-span-full" htmlFor="pos-fiscal-email">
                                Correo
                                <input id="pos-fiscal-email" className="input" type="email" value={fiscalCustomerDraft.email} maxLength={191} disabled={Boolean(activeTableOrder?.invoiceNumber) || savingFiscalCustomer} onChange={(event) => setFiscalCustomerDraft((current) => ({ ...current, email: event.target.value }))} />
                            </label>
                        </div>
                        {fiscalCustomerError && (
                            <p className="pos-fiscal-error" role="alert">{fiscalCustomerError}</p>
                        )}
                        {activeTableOrder?.invoiceNumber && (
                            <p className="shift-warning-note">La factura ya fue emitida; estos datos son de solo lectura.</p>
                        )}
                </Modal>
            )}

            {showKeypad && (
                <NumericKeypad
                    onConfirm={handleKeypadConfirm}
                    onClose={() => setShowKeypad(false)}
                    initialValue={1}
                />
            )}

            {warehouseAction && (
                <Modal
                    isOpen
                    onClose={() => {
                        if (processingWarehouseAction) return;
                        setWarehouseAction(null);
                        setOperationalWarehouseId(null);
                        setPendingCancelReason(undefined);
                    }}
                    title="Bodega para registrar merma"
                    size="sm"
                    description="La orden ya fue enviada a cocina. Selecciona la bodega donde se registrará el desperdicio."
                    footer={(
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={processingWarehouseAction}
                                onClick={() => {
                                    setWarehouseAction(null);
                                    setOperationalWarehouseId(null);
                                    setPendingCancelReason(undefined);
                                }}
                            >
                                Volver
                            </Button>
                            <Button
                                type="button"
                                disabled={!operationalWarehouseId || processingWarehouseAction}
                                onClick={() => void handleWarehouseAction()}
                            >
                                {processingWarehouseAction ? 'Procesando…' : 'Confirmar'}
                            </Button>
                        </>
                    )}
                >
                        <div className="pos-dialog-icon warning" aria-hidden="true"><AlertTriangle size={28} /></div>
                        <Select<WarehouseOption>
                            variant="modal"
                            label="Bodega operativa"
                            placeholder="Seleccionar bodega…"
                            options={warehouseOptions}
                            value={warehouseOptions.find((option) => option.value === operationalWarehouseId) ?? null}
                            onChange={(option: SingleValue<WarehouseOption>) => setOperationalWarehouseId(option?.value ?? null)}
                            isSearchable={warehouseOptions.length > 6}
                        />
                        {branchWarehouses.length === 0 && (
                            <p className="shift-warning-note">No hay una bodega tipo sucursal configurada para completar esta operación.</p>
                        )}
                </Modal>
            )}

            {modifierItem && (
                <ModifierSelectorModal
                    item={modifierItem}
                    groups={modifierGroups}
                    loading={loadingModifiers}
                    currencySymbol={currencySymbol}
                    onClose={() => {
                        setModifierItem(null);
                        setModifierGroups([]);
                    }}
                    onConfirm={handleModifierConfirm}
                />
            )}

            {/* Cash Shift Warning Modal */}
            {showShiftWarning && shiftStatus && (
                <Modal
                    isOpen
                    onClose={() => setShowShiftWarning(false)}
                    title={shiftStatus.requiresClose ? 'Turno de caja pendiente' : 'Sin turno de caja'}
                    size="sm"
                    closeOnBackdrop={false}
                    description={canManageShift
                        ? shiftStatus.message
                        : 'No hay un turno de caja activo. Solicita al cajero o administrador que abra un turno para procesar pagos.'}
                    footer={canManageShift ? (
                        <Button type="button" onClick={() => navigate('/cash-registers')}>
                            {shiftStatus.requiresClose ? 'Ir a cerrar turno' : 'Ir a abrir turno'}
                        </Button>
                    ) : (
                        <Button type="button" onClick={() => setShowShiftWarning(false)}>Entendido</Button>
                    )}
                >
                        <div className="pos-dialog-icon warning" aria-hidden="true"><AlertTriangle size={28} /></div>
                        {shiftStatus.requiresClose && shiftStatus.shift && (
                            <div className="shift-warning-details">
                                <p><strong>Caja:</strong> {shiftStatus.shift.cashRegister?.name}</p>
                                <p><strong>Abierto:</strong> {new Date(shiftStatus.shift.startDate).toLocaleString('es-NI')}</p>
                            </div>
                        )}
                        <p className="shift-warning-note">
                            {canManageShift
                                ? 'Aviso: Debe tener un turno activo válido para efectuar ventas.'
                                : canSendToKitchen
                                    ? 'Aviso: Puedes crear órdenes y enviarlas a cocina. Los cobros los registra cajería y requieren turno activo.'
                                    : 'Aviso: Los cobros los registra cajería y requieren turno de caja activo.'}
                        </p>
                </Modal>
            )}
        </div>
    );
}

interface ModifierSelectorModalProps {
    item: MenuItem;
    groups: ModifierGroupWithModifiers[];
    loading: boolean;
    currencySymbol: string;
    onClose: () => void;
    onConfirm: (selected: SelectedModifier[]) => void;
}

function ModifierSelectorModal({
    item,
    groups,
    loading,
    currencySymbol,
    onClose,
    onConfirm
}: ModifierSelectorModalProps) {
    // Selección por grupo (ids de modificadores elegidos).
    const [selected, setSelected] = useState<Record<number, number[]>>({});

    const toggleModifier = (group: ModifierGroupWithModifiers, modifierId: number) => {
        setSelected(prev => {
            const current = prev[group.id] || [];
            const isSelected = current.includes(modifierId);
            const max = group.maxSelect;

            // Single-choice group behaves like a radio (replace selection).
            if (max === 1) {
                if (isSelected) {
                    // Allow clearing only when the group is optional (minSelect === 0).
                    return { ...prev, [group.id]: group.minSelect > 0 ? current : [] };
                }
                return { ...prev, [group.id]: [modifierId] };
            }

            if (isSelected) {
                return { ...prev, [group.id]: current.filter(id => id !== modifierId) };
            }

            // Respect the upper bound for multi-select groups (null = unlimited).
            if (max != null && current.length >= max) {
                return prev;
            }
            return { ...prev, [group.id]: [...current, modifierId] };
        });
    };

    const selectedOptions: SelectedModifier[] = groups.flatMap(group =>
        (selected[group.id] || [])
            .map(id => group.modifiers.find(m => m.id === id))
            .filter((m): m is ModifierOption => Boolean(m))
            .map(m => ({ id: m.id, name: m.name, price: Number(m.price) }))
    );

    const modifiersExtra = selectedOptions.reduce((sum, mod) => sum + mod.price, 0);
    const subtotal = Number(item.price) + modifiersExtra;

    // Every group must satisfy its minSelect before the item can be added.
    const isValid = groups.every(group => (selected[group.id] || []).length >= group.minSelect);

    const groupHint = (group: ModifierGroupWithModifiers): string => {
        const min = group.minSelect;
        const max = group.maxSelect;
        if (min > 0 && max != null) return min === max ? `Elige ${min}` : `Elige ${min}–${max}`;
        if (min > 0) return `Elige al menos ${min}`;
        if (max != null) return `Hasta ${max}`;
        return 'Opcional';
    };

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={item.name}
            size="md"
            description="Personaliza el producto y revisa el subtotal antes de agregarlo."
            footer={(
                <>
                    <div className="pos-modifier-subtotal">
                        <span>Subtotal</span>
                        <strong>{currencySymbol}{subtotal.toFixed(2)}</strong>
                    </div>
                    <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button type="button" onClick={() => onConfirm(selectedOptions)} disabled={loading || !isValid}>Agregar</Button>
                </>
            )}
        >
                <div className="pos-modifier-body">
                    {loading ? (
                        <div className="pos-modifier-empty">Cargando modificadores...</div>
                    ) : groups.length === 0 ? (
                        <div className="pos-modifier-empty">Este producto no tiene modificadores.</div>
                    ) : (
                        groups.map(group => {
                            const groupSelected = selected[group.id] || [];
                            return (
                                <div key={group.id} className="pos-modifier-group">
                                    <div className="pos-modifier-group-head">
                                        <span className="pos-modifier-group-name">{group.name}</span>
                                        <span className={`pos-modifier-group-hint ${group.minSelect > 0 ? 'required' : ''}`}>
                                            {groupHint(group)}
                                        </span>
                                    </div>
                                    <div className="pos-modifier-options">
                                        {group.modifiers.map(mod => {
                                            const checked = groupSelected.includes(mod.id);
                                            return (
                                                <button
                                                    type="button"
                                                    key={mod.id}
                                                    className={`pos-modifier-option ${checked ? 'selected' : ''}`}
                                                    onClick={() => toggleModifier(group, mod.id)}
                                                >
                                                    <span className="pos-modifier-check">
                                                        {checked && <Check size={14} />}
                                                    </span>
                                                    <span className="pos-modifier-option-name">{mod.name}</span>
                                                    {Number(mod.price) > 0 && (
                                                        <span className="pos-modifier-option-price">
                                                            +{currencySymbol}{Number(mod.price).toFixed(2)}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
        </Modal>
    );
}
