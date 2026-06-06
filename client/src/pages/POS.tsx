import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { tablesAPI, menuAPI, ordersAPI, settingsAPI, cashShiftsAPI, promotionsAPI, categoriesAPI, menuBrandsAPI } from '../services/api';
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
import POSProductCard from '../components/POSProductCard';
import { LoadingOverlay } from '../components/LoadingSpinner';
import { Send, CreditCard, Printer, X, Search, Grid3x3, AlertTriangle, ChevronLeft } from 'lucide-react';
import type { MenuItem, Order, Table } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import './POS.css';

interface OfflineResponse {
    _offline?: boolean;
    [key: string]: unknown;
}

interface CartItem {
    menuItemId: number;
    menuItem: MenuItem;
    quantity: number;
    price: number;
    notes: string;
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
    taxRate?: string;
    currency_symbol?: string;
    enablePromotions?: string;
    [key: string]: string | undefined;
}

interface ShiftInfo {
    cashRegister?: { name: string };
    startDate: string;
}

interface ShiftStatus {
    hasActiveShift: boolean;
    shift: ShiftInfo | null;
    requiresClose: boolean;
    message: string | null;
}

export default function POS() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { symbol: currencySymbol } = useCurrency();
    const { confirm } = useConfirmDialog();
    const { success, error: showError, warning, info } = useAppToast();
    const canManageShift = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CAJERO']);
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
    const [showTableModal, setShowTableModal] = useState(false);
    const [settings, setSettings] = useState<POSSettings>({});
    const [discount, setDiscount] = useState<number>(0);
    const [discountAmountOverride, setDiscountAmountOverride] = useState<number | null>(null);
    const [appliedPromotionCode, setAppliedPromotionCode] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearch = useDebounce(searchQuery, 250);
    const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showKeypad, setShowKeypad] = useState(false);
    const [selectedItemForKeypad, setSelectedItemForKeypad] = useState<MenuItem | null>(null);
    const [shiftStatus, setShiftStatus] = useState<ShiftStatus | null>(null);
    const [showShiftWarning, setShowShiftWarning] = useState(false);
    const waiterAccentColor = getUserAccentColor(activeTableOrder?.user || user);

    // Scope the local menu cache by company + branch so different tenants/branches
    // don't read each other's cached menu from a shared localStorage key.
    const menuCacheKey = useMemo(
        () => `pos_menu_cache_${user?.companyId ?? 'anon'}_${user?.branchId ?? 'all'}`,
        [user?.companyId, user?.branchId]
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
        setSelectedTable(null);
        setCurrentOrderId(null);
        setActiveTableOrder(null);
    }, [clearDraftCart]);

    const loadData = useCallback(async () => {
        setLoadError(null);
        try {
            const cached = localStorage.getItem(menuCacheKey);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < 5 * 60 * 1000) {
                    setMenuItems(data);
                }
            }

            const [tablesRes, menuRes, settingsRes, categoriesRes, brandsRes] = await Promise.all([
                tablesAPI.getAll(),
                menuAPI.getAll({ active: true }),
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
            setCategories(categoriesRes.data.data);
            setBrands(brandsRes.data.data || []);
        } catch {
            const message = 'No se pudieron cargar los datos del POS (mesas, menú o configuración). Revisa tu conexión e inténtalo de nuevo.';
            setLoadError(message);
            showError(message);
        } finally {
            setLoading(false);
        }
    }, [menuCacheKey]);

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
    }, []);

    // Show table modal on first load if no table selected
    useEffect(() => {
        if (!loading && !selectedTable && tables.length > 0) {
            setShowTableModal(true);
        }
    }, [loading, selectedTable, tables]);

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
    }, [loadData]);

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
            return;
        }

        try {
            const response = await ordersAPI.getActive();
            const tableOrder = (response.data.data as Order[]).find(order => order.table?.id === table.id) || null;

            setCurrentOrderId(tableOrder?.id ?? null);
            setActiveTableOrder(tableOrder);
            setCustomerName(tableOrder?.customerName || '');

            if (tableOrder) {
                info(`Mesa ${table.number}: retomaste la orden #${tableOrder.id} (${tableOrder.status}).`);
            }
        } catch {
            setCurrentOrderId(null);
            setActiveTableOrder(null);
        }
    }, []);

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
    }, [cart.length, clearDraftCart, loadActiveOrderForTable, selectedTable?.id]);

    const addToCart = useCallback((item: MenuItem, quantity: number = 1) => {
        setCart(prevCart => {
            const existing = prevCart.find(c => c.menuItemId === item.id);
            if (existing) {
                return prevCart.map(c =>
                    c.menuItemId === item.id ? { ...c, quantity: c.quantity + quantity } : c
                );
            } else {
                return [...prevCart, {
                    menuItemId: item.id,
                    menuItem: item,
                    quantity,
                    price: item.price,
                    notes: ''
                }];
            }
        });
    }, []);

    const handleItemClick = useCallback((item: MenuItem) => {
        addToCart(item, 1);
    }, [addToCart]);

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
            addToCart(selectedItemForKeypad, quantity);
        }
        setShowKeypad(false);
        setSelectedItemForKeypad(null);
    };

    const updateQuantity = (menuItemId: number, delta: number) => {
        setCart(cart.map(item => {
            if (item.menuItemId === menuItemId) {
                const newQuantity = item.quantity + delta;
                return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
            }
            return item;
        }).filter(item => item.quantity > 0));
    };

    const removeFromCart = (menuItemId: number) => {
        setCart(cart.filter(item => item.menuItemId !== menuItemId));
    };

    const buildOrderPayload = useCallback(() => ({
        tableId: selectedTable?.id,
        customerName: customerName || undefined,
        items: cart.map(item => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
            price: item.price,
            notes: item.notes || ''
        }))
    }), [selectedTable, customerName, cart]);

    const syncOrderContext = useCallback(async (orderId: number) => {
        if (!offlineManager.getStatus()) {
            return null;
        }

        const response = await ordersAPI.getById(orderId);
        const refreshedOrder = response.data.data as Order;
        setActiveTableOrder(refreshedOrder);
        setCurrentOrderId(refreshedOrder.id);
        setCustomerName(refreshedOrder.customerName || '');
        return refreshedOrder;
    }, []);

    const persistCartToOrder = useCallback(async () => {
        if (cart.length === 0) {
            return {
                orderId: currentOrderId,
                offlineQueued: false
            };
        }

        if (currentOrderId) {
            let offlineQueued = false;

            for (const item of cart) {
                const response = await ordersAPI.addItem(currentOrderId, {
                    menuItemId: item.menuItemId,
                    quantity: item.quantity,
                    notes: item.notes || ''
                }, {
                    operationType: 'ADD_ORDER_ITEM'
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
                offlineQueued
            };
        }

        const createResponse = await ordersAPI.create(buildOrderPayload(), {
            operationType: 'CREATE_ORDER',
            entityTempId: `order-${Date.now()}`
        });

        if ((createResponse.data as OfflineResponse)._offline) {
            return {
                orderId: null,
                offlineQueued: true
            };
        }

        const createdOrder = createResponse.data.data as Order;
        setCurrentOrderId(createdOrder.id);
        setActiveTableOrder(createdOrder);
        clearDraftCart(createdOrder.customerName || '');

        return {
            orderId: createdOrder.id,
            offlineQueued: false
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
            const { orderId } = await persistCartToOrder();

            if (!orderId) {
                warning('La orden quedó pendiente, pero no puede enviarse a cocina hasta existir en el servidor.');
                return;
            }

            const response = await ordersAPI.sendToKitchen(orderId, {
                operationType: 'SEND_TO_KITCHEN'
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

    const handlePayment = async () => {
        if (!canPay) {
            warning('Tu rol no puede registrar pagos. Pide apoyo a un cajero o administrador.');
            return;
        }

        if (cart.length === 0 && !currentOrderId) {
            warning('El carrito está vacío');
            return;
        }

        if (!shiftStatus?.hasActiveShift) {
            if (canManageShift) {
                setShowShiftWarning(true);
            } else {
                warning('No hay turno de caja activo. Solicita al cajero que abra un turno para procesar pagos.');
            }
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

            const refreshedOrder = await syncOrderContext(orderId);

            // Persist pricing snapshot on the server before opening payment modal.
            if (refreshedOrder && (cart.length > 0 || requestedDiscountPercent > 0 || requestedDiscountOverride !== null || requestedPromotionCode)) {
                const refreshedSubtotal = (refreshedOrder.items || []).reduce(
                    (sum, item) => sum + Number(item.subtotal || 0),
                    0
                );
                const computedDiscount = Math.min(
                    Math.max(0, requestedDiscountOverride ?? (refreshedSubtotal * (requestedDiscountPercent / 100))),
                    refreshedSubtotal
                );
                const taxRate = parseFloat(settings.taxRate || '0');
                const computedTax = Math.max(0, (refreshedSubtotal - computedDiscount) * (taxRate / 100));

                const pricingResponse = await ordersAPI.updatePricing(orderId, {
                    discount: Number(computedDiscount.toFixed(2)),
                    discountCode: requestedPromotionCode || null,
                    tax: Number(computedTax.toFixed(2)),
                    tipAmount: 0
                });
                setActiveTableOrder(pricingResponse.data.data as Order);
            }

            setCurrentOrderId(orderId);
            setShowPaymentModal(true);
        } catch {
            showError('No se pudo preparar la orden para cobrarla.');
            return;
        } finally {
            setProcessingPayment(false);
        }
    };
    handlePaymentRef.current = handlePayment;
    handleSendToKitchenRef.current = handleSendToKitchen;

    const handlePaymentComplete = async (paymentData?: { offlineQueued?: boolean }) => {
        try {
            if (!currentOrderId) {
                throw new Error('No se encontró una orden lista para cobrar');
            }

            setShowPaymentModal(false);

            // An offline-queued payment is NOT confirmed. Never clear the table or
            // close the order as if paid — keep it open until the sync confirms it.
            if (paymentData?.offlineQueued) {
                warning('Pago pendiente de sincronización. La orden permanece ABIERTA y se marcará como pagada al confirmarse la conexión.');
                return;
            }

            clearTableContext();
            success('Pago procesado exitosamente');

            await loadData();
        } catch {
            showError('Error al procesar el pago.');
        }
    };

    const handleMarkDelivered = useCallback(async () => {
        if (!activeTableOrder) {
            return;
        }

        try {
            await ordersAPI.updateStatus(activeTableOrder.id, 'DELIVERED');
            await syncOrderContext(activeTableOrder.id);
            await loadData();
            success(`Orden #${activeTableOrder.id} marcada como entregada.`);
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            showError(axiosErr.response?.data?.message || 'No se pudo marcar la orden como entregada.');
        }
    }, [activeTableOrder, loadData, syncOrderContext]);

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

        try {
            await ordersAPI.cancel(activeTableOrder.id, reason);
            await loadData();
            clearTableContext();
            success(`Orden #${activeTableOrder.id} cancelada correctamente.`);
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            showError(axiosErr.response?.data?.message || 'No se pudo cancelar la orden.');
        }
    }, [activeTableOrder, canCancelActive, clearTableContext, confirm, loadData]);
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
    const taxAmount = (subtotal - discountAmount) * (parseFloat(settings.taxRate || '0') / 100);
    const total = subtotal - discountAmount + taxAmount;
    const activeOrderTotal = Number(activeTableOrder?.total || 0);
    const displayTotal = cart.length > 0 ? total : activeOrderTotal;
    const canProcessPayment = canPay && (cart.length > 0 || Boolean(currentOrderId));

    return (
        <div className="pos-container-new">
            {/* Header */}
            <div className="pos-header-new">
                <div className="header-left">
                    {selectedTable ? (
                        <div className="table-badge-new">
                            <Grid3x3 size={18} />
                            <span>Mesa {selectedTable.number}</span>
                            <button onClick={() => setShowTableModal(true)} className="change-table-btn">
                                Cambiar
                            </button>
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
                        title={canPay ? 'Pagar (Ctrl+P)' : 'Tu rol no puede registrar pagos'}
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
                    {categories.filter(c => c.active && c.showInMenu !== false && c.name !== 'Catering').map(cat => (
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
                        <div style={{
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
                                        {activeTableOrder.status === 'READY' && (
                                            <button className="header-action-btn secondary" onClick={handleMarkDelivered}>
                                                Entregar
                                            </button>
                                        )}
                                        {canCancelActive && !activeTableOrder.payments?.length && activeTableOrder.status !== 'PAID' && activeTableOrder.status !== 'CANCELLED' && (
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
                    <OrderCart
                        cart={cart}
                        discount={discount}
                        taxRate={parseFloat(settings.taxRate || '0')}
                        onUpdateQuantity={updateQuantity}
                        onRemoveItem={removeFromCart}
                        onDiscountChange={(value) => {
                            setDiscount(value);
                            setDiscountAmountOverride(null);
                            setAppliedPromotionCode(null);
                        }}
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
                    onSelectTable={handleSelectTable}
                    onClose={() => setShowTableModal(false)}
                />
            )}

            {showPaymentModal && (
                <PaymentModal
                    isOpen={showPaymentModal}
                    onClose={() => setShowPaymentModal(false)}
                    orderId={currentOrderId}
                    orderTotal={currentOrderId ? activeOrderTotal : total}
                    order={activeTableOrder}
                    onPaymentSuccess={handlePaymentComplete}
                    currencySymbol={currencySymbol}
                />
            )}

            {showKeypad && (
                <NumericKeypad
                    onConfirm={handleKeypadConfirm}
                    onClose={() => setShowKeypad(false)}
                    initialValue={1}
                />
            )}

            {/* Cash Shift Warning Modal */}
            {showShiftWarning && shiftStatus && (
                <div className="pos-shift-warning-overlay">
                    <div className="pos-shift-warning-modal">
                        <div className="shift-warning-icon">
                            <AlertTriangle size={48} />
                        </div>
                        <h2 className="shift-warning-title">
                            {shiftStatus.requiresClose ? 'Turno de Caja Pendiente' : 'Sin Turno de Caja'}
                        </h2>
                        <p className="shift-warning-message">
                            {canManageShift
                                ? shiftStatus.message
                                : 'No hay un turno de caja activo. Solicita al cajero o administrador que abra un turno para procesar pagos.'}
                        </p>
                        {shiftStatus.requiresClose && shiftStatus.shift && (
                            <div className="shift-warning-details">
                                <p><strong>Caja:</strong> {shiftStatus.shift.cashRegister?.name}</p>
                                <p><strong>Abierto:</strong> {new Date(shiftStatus.shift.startDate).toLocaleString('es-NI')}</p>
                            </div>
                        )}
                        <div className="shift-warning-actions">
                            {canManageShift ? (
                                <button
                                    className="shift-warning-btn primary"
                                    onClick={() => navigate('/cash-registers')}
                                >
                                    {shiftStatus.requiresClose ? 'Ir a Cerrar Turno' : 'Ir a Abrir Turno'}
                                </button>
                            ) : (
                                <button
                                    className="shift-warning-btn primary"
                                    onClick={() => setShowShiftWarning(false)}
                                >
                                    Entendido
                                </button>
                            )}
                        </div>
                        <p className="shift-warning-note">
                            {canManageShift
                                ? 'Aviso: Debe tener un turno activo válido para efectuar ventas.'
                                : canSendToKitchen
                                    ? 'Aviso: Puedes crear órdenes y enviarlas a cocina. Los cobros los registra cajería y requieren turno activo.'
                                    : 'Aviso: Los cobros los registra cajería y requieren turno de caja activo.'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

