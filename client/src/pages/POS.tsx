import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { tablesAPI, menuAPI, ordersAPI, settingsAPI, cashShiftsAPI, promotionsAPI, categoriesAPI } from '../services/api';
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
import TableSelectionModal from '../components/TableSelectionModal';
import OrderCart from '../components/OrderCart';
import PaymentModal from '../components/PaymentModal';
import NumericKeypad from '../components/NumericKeypad';
import Notification from '../components/Notification';
import POSProductCard from '../components/POSProductCard';
import { Send, CreditCard, Printer, X, Search, Grid3x3, AlertTriangle, ChevronLeft } from 'lucide-react';
import type { MenuItem, Order, Table } from '../types';
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
    const canManageShift = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'CAJERO']);
    const canSendToKitchen = canSendOrderToKitchen(user);
    const canCancelActive = canCancelOrder(user);
    const canPay = canCreatePayment(user);
    const [tables, setTables] = useState<Table[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [showMobileCart, setShowMobileCart] = useState(false);
    const [loading, setLoading] = useState(true);
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
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'info' | 'warning' | 'error' } | null>(null);
    const [shiftStatus, setShiftStatus] = useState<ShiftStatus | null>(null);
    const [showShiftWarning, setShowShiftWarning] = useState(false);
    const waiterAccentColor = getUserAccentColor(activeTableOrder?.user || user);

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
        try {
            const cached = localStorage.getItem('pos_menu_cache');
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < 5 * 60 * 1000) {
                    setMenuItems(data);
                }
            }

            const [tablesRes, menuRes, settingsRes, categoriesRes] = await Promise.all([
                tablesAPI.getAll(),
                menuAPI.getAll({ active: true }),
                settingsAPI.getAll(),
                categoriesAPI.getAll()
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
        } catch {
            // Failed to load POS data
        } finally {
            setLoading(false);
        }
    }, []);

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
            // Failed to check shift status
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

            if (selectedTable && message.type === WS_EVENTS.ORDER_READY) {
                const readyTableNumber = String(message.payload?.tableNumber || '');
                if (readyTableNumber && readyTableNumber === String(selectedTable.number)) {
                    setNotification({
                        message: `Mesa ${selectedTable.number}: la orden ya está lista para entregar.`,
                        type: 'success'
                    });
                }
            }

            if (selectedTable && message.type === WS_EVENTS.ORDER_IN_PREPARATION) {
                const preparingTableNumber = String(message.payload?.tableNumber || '');
                if (preparingTableNumber && preparingTableNumber === String(selectedTable.number)) {
                    setNotification({
                        message: `Mesa ${selectedTable.number}: cocina ya inició la preparación.`,
                        type: 'info'
                    });
                }
            }
        });

        return unsubscribe;
    }, [loadData, selectedTable]);

    // Cache products in localStorage
    useEffect(() => {
        if (menuItems.length > 0) {
            localStorage.setItem('pos_menu_cache', JSON.stringify({
                data: menuItems,
                timestamp: Date.now()
            }));
        }
    }, [menuItems]);

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
                if (confirm('Â¿Limpiar carrito?')) {
                    clearDraftCart(activeTableOrder?.customerName || '');
                }
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [activeTableOrder?.customerName, canSendToKitchen, cart, clearDraftCart, currentOrderId, selectedTable]);

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
                setNotification({
                    message: `Mesa ${table.number}: retomaste la orden #${tableOrder.id} (${tableOrder.status}).`,
                    type: 'info'
                });
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
            const confirmChange = window.confirm('Hay productos pendientes en el carrito actual. Si cambias de mesa se limpiará este borrador. ¿Deseas continuar?');
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
            setNotification({
                message: 'Tu rol no puede enviar órdenes a cocina. Pide apoyo a un mesero o administrador.',
                type: 'warning'
            });
            return;
        }

        if (!selectedTable) {
            alert('Por favor selecciona una mesa');
            return;
        }

        if (cart.length === 0) {
            alert('El carrito está vacío');
            return;
        }

        try {
            const { orderId } = await persistCartToOrder();

            if (!orderId) {
                setNotification({
                    message: 'La orden quedó pendiente, pero no puede enviarse a cocina hasta existir en el servidor.',
                    type: 'warning'
                });
                return;
            }

            const response = await ordersAPI.sendToKitchen(orderId, {
                operationType: 'SEND_TO_KITCHEN'
            });
            const queuedOffline = Boolean((response.data as OfflineResponse)._offline);

            setNotification({
                message: queuedOffline
                    ? 'La orden quedó pendiente de sincronización para enviarse a cocina.'
                    : 'Orden enviada a cocina exitosamente',
                type: queuedOffline ? 'info' : 'success'
            });

            if (!queuedOffline) {
                await syncOrderContext(orderId);
                await loadData();
            }
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            alert(axiosErr.response?.data?.message || 'Error al enviar la orden');
        }
    };

    const handlePrint = () => {
        window.print();
    };

    const handlePayment = async () => {
        if (!canPay) {
            setNotification({
                message: 'Tu rol no puede registrar pagos. Pide apoyo a un cajero o administrador.',
                type: 'warning'
            });
            return;
        }

        if (cart.length === 0 && !currentOrderId) {
            alert('El carrito está vacío');
            return;
        }

        if (!shiftStatus?.hasActiveShift) {
            if (canManageShift) {
                setShowShiftWarning(true);
            } else {
                setNotification({ message: 'No hay turno de caja activo. Solicita al cajero que abra un turno para procesar pagos.', type: 'warning' });
            }
            return;
        }

        try {
            const requestedDiscountPercent = discount;
            const requestedDiscountOverride = discountAmountOverride;
            const requestedPromotionCode = appliedPromotionCode;
            const { orderId, offlineQueued } = await persistCartToOrder();

            if (!orderId) {
                setNotification({
                    message: 'La orden quedó pendiente, pero el cobro está bloqueado hasta que exista en el servidor.',
                    type: 'warning'
                });
                return;
            }

            if (offlineQueued) {
                setNotification({
                    message: 'Hay productos pendientes de sincronizar en esta orden. Espera conexión antes de cobrarla.',
                    type: 'warning'
                });
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
            setNotification({
                message: 'No se pudo preparar la orden para cobrarla.',
                type: 'error'
            });
            return;
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
            clearTableContext();

            setNotification({
                message: paymentData?.offlineQueued
                    ? 'Pago pendiente de sincronización. La venta quedó marcada como pendiente.'
                    : 'Pago procesado exitosamente',
                type: paymentData?.offlineQueued ? 'info' : 'success'
            });

            if (!paymentData?.offlineQueued) {
                await loadData();
            }
        } catch {
            alert('Error al procesar el pago');
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
            setNotification({
                message: `Orden #${activeTableOrder.id} marcada como entregada.`,
                type: 'success'
            });
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            setNotification({
                message: axiosErr.response?.data?.message || 'No se pudo marcar la orden como entregada.',
                type: 'error'
            });
        }
    }, [activeTableOrder, loadData, syncOrderContext]);

    const handleCancelActiveOrder = useCallback(async () => {
        if (!activeTableOrder) {
            return;
        }

        if (!canCancelActive) {
            setNotification({
                message: 'Tu rol no puede cancelar órdenes. Pide apoyo a un mesero o administrador.',
                type: 'warning'
            });
            return;
        }

        const reason = window.prompt('Motivo de cancelación (opcional):') || undefined;

        try {
            await ordersAPI.cancel(activeTableOrder.id, reason);
            await loadData();
            clearTableContext();
            setNotification({
                message: `Orden #${activeTableOrder.id} cancelada correctamente.`,
                type: 'success'
            });
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            setNotification({
                message: axiosErr.response?.data?.message || 'No se pudo cancelar la orden.',
                type: 'error'
            });
        }
    }, [activeTableOrder, canCancelActive, clearTableContext, loadData]);
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
                setNotification({
                    message: result.message || 'Promoción aplicada',
                    type: 'success'
                });
            } else {
                setNotification({
                    message: result?.message || 'Promoción inválida',
                    type: 'error'
                });
            }
        } catch (error: unknown) {
            const axiosErr = error as { response?: { data?: { message?: string } } };
            setNotification({
                message: axiosErr.response?.data?.message || 'Error al validar promoción',
                type: 'error'
            });
        }
    };

    const filteredMenuItems = useMemo(() =>
        menuItems.filter(item => {
            const matchesSearch = item.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
                item.category?.name.toLowerCase().includes(debouncedSearch.toLowerCase());
            const matchesCategory = selectedCategory ? item.categoryId === Number(selectedCategory) : true;
            return matchesSearch && matchesCategory;
        }),
        [menuItems, debouncedSearch, selectedCategory]
    );

    if (loading) {
        return <div className="pos-loading">Cargando...</div>;
    }

    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
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
                        disabled={!canProcessPayment}
                        title={canPay ? 'Pagar (Ctrl+P)' : 'Tu rol no puede registrar pagos'}
                    >
                        <CreditCard size={18} />
                        <span>Pagar</span>
                    </button>
                    <button
                        className="header-action-btn secondary"
                        onClick={handleSendToKitchen}
                        disabled={!canSendToKitchen || cart.length === 0 || !selectedTable}
                        title={canSendToKitchen ? 'Enviar a Cocina (Ctrl+K)' : 'Tu rol no puede enviar a cocina'}
                    >
                        <Send size={18} />
                        <span>Cocina</span>
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
                    {categories.filter(c => c.active && c.name !== 'Catering').map(cat => (
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
                    <div className="products-grid-new">
                        {filteredMenuItems.map(item => (
                            <POSProductCard
                                key={item.id}
                                item={item}
                                onClick={handleItemClick}
                                onContextMenu={handleItemRightClick}
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
                        <div className="mobile-cart-header" style={{ marginBottom: '1rem' }}>
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
                                Volver al MenÃº
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
                                    {settings.currency_symbol || '$'}{activeOrderTotal.toFixed(2)}
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
                        currencySymbol={settings.currency_symbol || '$'}
                    />
                    {showMobileCart && (
                        <div style={{ marginTop: '1rem' }}>
                            <button
                                className="header-action-btn primary"
                                style={{ width: '100%', justifyContent: 'center' }}
                                onClick={() => {
                                    handlePayment();
                                    setShowMobileCart(false);
                                }}
                                disabled={!canProcessPayment}
                            >
                                <CreditCard size={18} />
                                Pagar ${displayTotal.toFixed(2)}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Mobile Cart Summary Bar */}
            <div className="mobile-cart-summary">
                <div className="cart-total-preview">
                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Total:</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', marginLeft: '0.5rem' }}>${displayTotal.toFixed(2)}</span>
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
                    currencySymbol={settings.currency_symbol || '$'}
                />
            )}

            {showKeypad && (
                <NumericKeypad
                    onConfirm={handleKeypadConfirm}
                    onClose={() => setShowKeypad(false)}
                    initialValue={1}
                />
            )}

            {notification && (
                <Notification
                    message={notification.message}
                    type={notification.type}
                    onClose={() => setNotification(null)}
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
                                    Continuar sin turno
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

