import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Clock, FileText, Printer, ShoppingCart, Receipt,
    CreditCard, Scissors, ArrowRightLeft, Merge, ChefHat,
    Users, CircleDollarSign, Link2, Unlink, Loader2, Pencil, Undo2, AlertTriangle
} from 'lucide-react';
import type { ActiveTableConsolidation, Order, OrderItem, Table } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { getUserAccentColor } from '../utils/authz';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useCurrency } from '../hooks/useCurrency';
import { useAppToast } from '../context/ToastContext';
import { useConfirmDialog } from '../context/ConfirmContext';
import './TableOrdersModal.css';

interface TableOrdersModalProps {
    isOpen: boolean;
    onClose: () => void;
    table: Table | null;
    orders: Order[];
    loading?: boolean;
    busyOrderId?: number | null;
    canIssueInvoice: boolean;
    canPay: boolean;
    canOperatePOS: boolean;
    canTransfer: boolean;
    canConsolidate: boolean;
    canGroup: boolean;
    activeConsolidation?: ActiveTableConsolidation | null;
    loadingConsolidation?: boolean;
    consolidationLookupError?: string | null;
    consolidationReversalError?: string | null;
    reversingConsolidation?: boolean;
    groupTotalCapacity?: number;
    onOpenPOS: (table: Table) => void;
    onIssueInvoice: (order: Order) => void;
    onPay: (order: Order) => void;
    onSplit: (order: Order) => void;
    onTransfer: (table: Table) => void;
    onConsolidate: (table: Table) => void;
    onGroup: (table: Table) => void;
    onEditGroup: (table: Table) => void;
    onUngroup: (table: Table) => void;
    onRetryConsolidationLookup: () => void;
    onReverseConsolidation: (reason: string) => Promise<boolean>;
}

export default function TableOrdersModal({
    isOpen,
    onClose,
    table,
    orders,
    loading = false,
    busyOrderId,
    canIssueInvoice,
    canPay,
    canOperatePOS,
    canTransfer,
    canConsolidate,
    canGroup,
    activeConsolidation,
    loadingConsolidation = false,
    consolidationLookupError,
    consolidationReversalError,
    reversingConsolidation = false,
    groupTotalCapacity,
    onOpenPOS,
    onIssueInvoice,
    onPay,
    onSplit,
    onTransfer,
    onConsolidate,
    onGroup,
    onEditGroup,
    onUngroup,
    onRetryConsolidationLookup,
    onReverseConsolidation,
}: TableOrdersModalProps) {
    const { formatMoney, symbol } = useCurrency();
    const { error: showError } = useAppToast();
    const { confirm } = useConfirmDialog();
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(isOpen, onClose, containerRef);
    const [showReversalForm, setShowReversalForm] = useState(false);
    const [reversalReason, setReversalReason] = useState('');
    const [reversalValidationError, setReversalValidationError] = useState<string | null>(null);

    useEffect(() => {
        setShowReversalForm(false);
        setReversalReason('');
        setReversalValidationError(null);
    }, [activeConsolidation?.id, isOpen]);

    if (!isOpen || !table) return null;

    const tableNumber = table.number;

    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const hasActiveFinancialConsolidation = activeConsolidation?.status === 'ACTIVE';
    const canStartFinancialConsolidation = canConsolidate
        && !loadingConsolidation
        && !consolidationLookupError
        && !hasActiveFinancialConsolidation;
    const getStatusColor = (status: string) => {
        return getOrderStatusClassName(status as Order['status']);
    };

    const getStatusText = (status: string) => {
        return getOrderStatusLabel(status as Order['status']);
    };

    const formatTime = (date: string) => {
        return new Date(date).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const itemStatusLabel = (status: OrderItem['status']) => {
        if (status === 'DONE') return 'Listo';
        if (status === 'IN_PROGRESS') return 'Preparando';
        return 'Pendiente';
    };

    const submitConsolidationReversal = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeConsolidation || activeConsolidation.status !== 'ACTIVE') return;
        const reason = reversalReason.trim();
        if (reason.length < 3) {
            setReversalValidationError('Escribe un motivo de al menos 3 caracteres.');
            return;
        }

        setReversalValidationError(null);
        const accepted = await confirm(
            `¿Revertir la consolidación #${activeConsolidation.id} y devolver ${activeConsolidation.affectedOrderIds.length} cuentas a ${activeConsolidation.originalTableIds.length} mesas originales? La operación será rechazada si hubo pagos, factura, entrega, cambios en productos u otra ocupación.`,
            { title: 'Confirmar reverso de consolidación' },
        );
        if (!accepted) return;

        const reversed = await onReverseConsolidation(reason);
        if (reversed) {
            setShowReversalForm(false);
            setReversalReason('');
        }
    };

    const handlePrintBill = () => {
        // ... (print logic remains the same)
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showError('No se pudo abrir la impresión. Permite ventanas emergentes e inténtalo de nuevo.');
            return;
        }

        const e = escapeHtml;
        const billHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cuenta - Mesa ${e(tableNumber)}</title>
                <style>
                    body {
                        font-family: 'Courier New', monospace;
                        max-width: 300px;
                        margin: 20px auto;
                        padding: 10px;
                    }
                    h2 { text-align: center; margin: 10px 0; }
                    .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
                    .item { display: flex; justify-content: space-between; margin: 5px 0; }
                    .total { border-top: 2px dashed #000; padding-top: 10px; margin-top: 10px; font-weight: bold; font-size: 1.2em; }
                    .footer { text-align: center; margin-top: 20px; border-top: 2px dashed #000; padding-top: 10px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>CUENTA</h2>
                    <p>Mesa ${e(tableNumber)}</p>
                    <p>${e(new Date().toLocaleString('es-ES'))}</p>
                </div>
                ${orders.map(order => `
                    <div style="margin-bottom: 15px;">
                        <strong>Orden #${e(order.id)}</strong>
                        ${order.items?.map(item => `
                            <div class="item">
                                <span>${e(item.quantity)}x ${e(item.menuItem?.name || 'Item')}</span>
                                <span>${e(symbol)}${Number(item.subtotal).toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
                <div class="total">
                    <div class="item">
                        <span>TOTAL:</span>
                        <span>${e(symbol)}${totalAmount.toFixed(2)}</span>
                    </div>
                </div>
                <div class="footer">
                    <p>¡Gracias por su visita!</p>
                </div>
            </body>
            </html>
        `;

        printWindow.document.write(billHTML);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
    };

    return createPortal(
        <div className="modal-overlay-orders" onClick={onClose}>
            <div
                ref={containerRef}
                className="orders-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="orders-modal-header">
                    <div className="table-detail-title">
                        <div className="header-title">
                            <span className="table-detail-eyebrow">Centro operativo</span>
                            <h2 id={titleId}>Mesa {tableNumber}</h2>
                            <span className="header-subtitle">
                                {table.location || 'Salón principal'}
                            </span>
                        </div>
                    </div>
                    <button type="button" className="close-btn-orders" onClick={onClose} aria-label="Cerrar">
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>

                <section className="table-detail-summary" aria-label="Resumen de la mesa">
                    <div><Users size={17} /><span><small>Capacidad</small><strong>{table.capacity} sillas = {table.capacity} comensales</strong></span></div>
                    <div><FileText size={17} /><span><small>Órdenes activas</small><strong>{orders.length}</strong></span></div>
                    <div className="summary-total"><CircleDollarSign size={17} /><span><small>Consumo activo</small><strong>{formatMoney(totalAmount)}</strong></span></div>
                </section>

                {table.activeTableGroup && (
                    <section className="table-active-group-banner" aria-label="Grupo físico activo">
                        <Link2 size={19} />
                        <div>
                            <strong>{table.activeTableGroup.primaryTableId === table.id ? 'Mesa principal del grupo' : `Unida a mesa ${table.activeTableGroup.primaryTable.number}`}</strong>
                            <span>{table.activeTableGroup.memberTableIds.length} mesas · {groupTotalCapacity ?? table.capacity} sillas/comensales en total · las cuentas siguen independientes</span>
                        </div>
                    </section>
                )}

                {canConsolidate && loadingConsolidation && (
                    <section className="table-consolidation-lookup" role="status" aria-live="polite">
                        <Loader2 className="button-spinner" size={18} />
                        <span>Verificando si existe una consolidación activa…</span>
                    </section>
                )}

                {canConsolidate && !loadingConsolidation && consolidationLookupError && (
                    <section className="table-consolidation-lookup error" role="alert">
                        <AlertTriangle size={19} />
                        <div>
                            <strong>No se pudo verificar el historial de consolidación</strong>
                            <span>{consolidationLookupError}</span>
                        </div>
                        <button type="button" onClick={onRetryConsolidationLookup}>
                            Reintentar
                        </button>
                    </section>
                )}

                {canConsolidate && !loadingConsolidation && activeConsolidation?.status === 'ACTIVE' && (
                    <section className="table-consolidation-reversal" aria-label="Consolidación activa">
                        <div className="table-consolidation-reversal-heading">
                            <Undo2 size={20} />
                            <div>
                                <strong>Consolidación activa #{activeConsolidation.id}</strong>
                                <span>
                                    {activeConsolidation.affectedOrderIds.length} cuentas · {activeConsolidation.originalTableIds.length} mesas originales
                                </span>
                            </div>
                        </div>
                        <p>
                            El servidor volverá a validar versión, pagos, factura, entrega, productos y ocupación antes de restaurar las cuentas.
                            El estado ACTIVE no garantiza que el reverso siga siendo posible.
                        </p>
                        {consolidationReversalError && (
                            <div className="table-consolidation-reversal-blocked" role="alert">
                                <AlertTriangle size={18} aria-hidden="true" />
                                <div>
                                    <strong>El reverso no se completó</strong>
                                    <span>{consolidationReversalError}</span>
                                    <small>
                                        La consolidación continúa activa. Corrige el bloqueo indicado o vuelve a verificar el estado antes de reintentar.
                                    </small>
                                </div>
                                <button type="button" onClick={onRetryConsolidationLookup}>
                                    Volver a verificar
                                </button>
                            </div>
                        )}
                        {!showReversalForm ? (
                            <button
                                type="button"
                                className="table-consolidation-reversal-open"
                                onClick={() => setShowReversalForm(true)}
                            >
                                <Undo2 size={17} /> Solicitar reverso
                            </button>
                        ) : (
                            <form className="table-consolidation-reversal-form" onSubmit={(event) => void submitConsolidationReversal(event)}>
                                <label htmlFor={`consolidation-reversal-reason-${activeConsolidation.id}`}>
                                    Motivo obligatorio
                                </label>
                                <textarea
                                    id={`consolidation-reversal-reason-${activeConsolidation.id}`}
                                    value={reversalReason}
                                    onChange={(event) => {
                                        setReversalReason(event.target.value);
                                        if (reversalValidationError) setReversalValidationError(null);
                                    }}
                                    minLength={3}
                                    maxLength={500}
                                    rows={3}
                                    disabled={reversingConsolidation}
                                    placeholder="Ej.: Las cuentas se consolidaron en la mesa equivocada"
                                    required
                                />
                                {reversalValidationError && (
                                    <span className="table-consolidation-reversal-error" role="alert">
                                        {reversalValidationError}
                                    </span>
                                )}
                                <div className="table-consolidation-reversal-actions">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowReversalForm(false);
                                            setReversalReason('');
                                            setReversalValidationError(null);
                                        }}
                                        disabled={reversingConsolidation}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="danger"
                                        disabled={reversingConsolidation || reversalReason.trim().length < 3}
                                    >
                                        {reversingConsolidation
                                            ? <><Loader2 className="button-spinner" size={17} /> Revirtiendo…</>
                                            : <><Undo2 size={17} /> Confirmar reverso</>}
                                    </button>
                                </div>
                            </form>
                        )}
                    </section>
                )}

                {(canTransfer || canStartFinancialConsolidation || canGroup) && (
                    <div className="table-command-strip" aria-label="Gestionar ubicación de la mesa">
                        {canTransfer && <button type="button" onClick={() => onTransfer(table)}>
                            <ArrowRightLeft size={18} /><span>Cambiar mesa</span>
                        </button>}
                        {canStartFinancialConsolidation && <button type="button" onClick={() => onConsolidate(table)}>
                            <Merge size={18} /><span>Consolidar</span>
                        </button>}
                        {canGroup && !table.activeTableGroup && ['AVAILABLE', 'OCCUPIED'].includes(table.status) && <button type="button" onClick={() => onGroup(table)}>
                            <Link2 size={18} /><span>Unir mesas</span>
                        </button>}
                        {canGroup && table.activeTableGroup && <>
                            <button type="button" onClick={() => onEditGroup(table)}>
                                <Pencil size={18} /><span>Editar grupo</span>
                            </button>
                            <button type="button" onClick={() => onUngroup(table)}>
                                <Unlink size={18} /><span>Separar todas</span>
                            </button>
                        </>}
                    </div>
                )}

                <div className="modal-tab-content-orders">
                    <div className="orders-list animate-slide-in" aria-busy={loading}>
                            {loading ? (
                                <div className="no-orders-message table-orders-loading" role="status">
                                    <Loader2 size={36} />
                                    <p>Cargando pedido…</p>
                                    <small>Validando la cuenta activa antes de continuar</small>
                                </div>
                            ) : orders.length === 0 ? (
                                <div className="no-orders-message">
                                    <FileText size={48} />
                                    <p>No hay órdenes activas</p>
                                    <small>Esta mesa no tiene órdenes pendientes</small>
                                </div>
                            ) : (
                                orders.map(order => (
                                    <article key={order.id} className="order-card-modal">
                                        <div className="order-card-header">
                                            <div className="order-id-time">
                                                <span className="order-id-badge">Orden #{order.id}</span>
                                                <div className="order-time">
                                                    <Clock size={14} />
                                                    <span>{formatTime(order.createdAt)}</span>
                                                </div>
                                            </div>
                                            <span className={`order-status-badge ${getStatusColor(order.status)}`}>
                                                {getStatusText(order.status)}
                                            </span>
                                        </div>
                                        <div className="order-waiter-row">
                                            <span className="order-waiter" style={{ background: `${getUserAccentColor(order.user)}18`, color: getUserAccentColor(order.user) }}>
                                                {order.user?.name || 'Sin mesero'}
                                            </span>
                                            <small>{order.items?.length || 0} productos</small>
                                        </div>

                                        <div className="order-items-list">
                                            {order.items?.map((item) => (
                                                <div key={item.id || item.menuItemId} className="order-item-line">
                                                    <div className="item-quantity-name">
                                                        <span className="item-qty">{item.quantity}x</span>
                                                        <span className="item-name">
                                                            {item.menuItem?.name || 'Item'}
                                                            <small className={`kitchen-line-status status-${item.status.toLowerCase()}`}>
                                                                <ChefHat size={12} /> {itemStatusLabel(item.status)}
                                                            </small>
                                                        </span>
                                                    </div>
                                                    <span className="item-price">{formatMoney(Number(item.subtotal))}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="order-card-footer">
                                            <span className="order-total-label">Total de la orden</span>
                                            <span className="order-total-amount">{formatMoney(Number(order.total))}</span>
                                        </div>
                                        <div className="table-order-actions">
                                            {canOperatePOS && !order.invoiceNumber && order.financialStatus === 'UNPAID' && (
                                                <button type="button" className="table-order-add-products" onClick={() => onOpenPOS(table)}>
                                                    <ShoppingCart size={16} /> Agregar productos
                                                </button>
                                            )}
                                            {!order.invoiceNumber && canIssueInvoice && (
                                                <button
                                                    type="button"
                                                    className="primary"
                                                    disabled={busyOrderId === order.id}
                                                    onClick={() => onIssueInvoice(order)}
                                                >
                                                    <Receipt size={16} />
                                                    {busyOrderId === order.id ? 'Emitiendo…' : 'Emitir factura'}
                                                </button>
                                            )}
                                            {order.invoiceNumber && (
                                                <span className="invoice-issued-badge">
                                                    <Receipt size={15} /> {order.invoiceNumber}
                                                </span>
                                            )}
                                            {order.invoiceNumber && order.financialStatus !== 'PAID' && canPay && (
                                                <>
                                                    <button type="button" className="primary" onClick={() => onPay(order)}>
                                                        <CreditCard size={16} /> Cobrar
                                                    </button>
                                                    <button type="button" onClick={() => onSplit(order)}>
                                                        <Scissors size={16} /> Dividir por consumo
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </article>
                                ))
                            )}
                    </div>
                </div>

                <div className={`orders-modal-footer ${orders.length === 0 ? 'single-action' : ''}`}>
                    <button type="button" className="btn-modal-secondary" onClick={onClose}>
                        Cerrar
                    </button>
                    {orders.length > 0 && (
                        <button type="button" className="btn-modal-secondary print-bill-action" onClick={handlePrintBill}>
                            <Printer size={18} />
                            Imprimir cuenta
                        </button>
                    )}
                    {canOperatePOS && <button type="button" className="btn-modal-primary" disabled={loading} onClick={() => onOpenPOS(table)}>
                        {loading ? <Loader2 className="button-spinner" size={18} /> : <ShoppingCart size={18} />}
                        {loading ? 'Cargando…' : orders.length > 0 ? 'Agregar producto' : 'Menú'}
                    </button>}
                </div>
            </div>
        </div>,
        document.body,
    );
}
