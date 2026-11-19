import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Clock, FileText, ShoppingCart, Receipt,
    CreditCard, Scissors, ArrowRightLeft, Merge, ChefHat,
    Users, CircleDollarSign, Link2, Unlink, Loader2, Pencil, Undo2, AlertTriangle
} from 'lucide-react';
import type { ActiveTableConsolidation, Order, OrderItem, Table } from '../types';
import { getUserAccentColor } from '../utils/authz';
import { isVoidableOrderLine, isVoidedOrderLine, orderLineVoidBlocker } from '../utils/orderLineVoid';
import './KitchenLineVoidModal.css';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useCurrency } from '../hooks/useCurrency';
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
    /** Supervisor grant orders.items.void: offers per-line kitchen void. */
    canVoidLines?: boolean;
    onVoidLine?: (order: Order, itemId: number) => void;
    activeConsolidation?: ActiveTableConsolidation | null;
    loadingConsolidation?: boolean;
    consolidationLookupError?: string | null;
    consolidationReversalError?: string | null;
    reversingConsolidation?: boolean;
    groupTotalCapacity?: number;
    onOpenPOS: (table: Table) => void;
    onIssueInvoice: (order: Order) => void;
    onReversePreInvoice: (order: Order, reason: string) => Promise<boolean>;
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
    canVoidLines = false,
    onVoidLine,
    activeConsolidation,
    loadingConsolidation = false,
    consolidationLookupError,
    consolidationReversalError,
    reversingConsolidation = false,
    groupTotalCapacity,
    onOpenPOS,
    onIssueInvoice,
    onReversePreInvoice,
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
    const { formatMoney } = useCurrency();
    const { confirm } = useConfirmDialog();
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(isOpen, onClose, containerRef);
    const [showReversalForm, setShowReversalForm] = useState(false);
    const [reversalReason, setReversalReason] = useState('');
    const [reversalValidationError, setReversalValidationError] = useState<string | null>(null);
    const [invoiceTargetOrderId, setInvoiceTargetOrderId] = useState<number | null>(null);
    const [preInvoiceReverseOrderId, setPreInvoiceReverseOrderId] = useState<number | null>(null);
    const [preInvoiceReverseReason, setPreInvoiceReverseReason] = useState('');
    const [preInvoiceReverseError, setPreInvoiceReverseError] = useState<string | null>(null);

    useEffect(() => {
        setShowReversalForm(false);
        setReversalReason('');
        setReversalValidationError(null);
        setPreInvoiceReverseOrderId(null);
        setPreInvoiceReverseReason('');
        setPreInvoiceReverseError(null);
    }, [activeConsolidation?.id, isOpen]);

    useEffect(() => {
        const candidates = orders.filter((order) =>
            !order.invoiceNumber && order.financialStatus === 'UNPAID'
        );
        setInvoiceTargetOrderId((current) => {
            if (candidates.length === 1) return candidates[0].id;
            return candidates.some((order) => order.id === current) ? current : null;
        });
    }, [orders]);

    if (!isOpen || !table) return null;

    const tableNumber = table.number;

    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const hasActiveFinancialConsolidation = activeConsolidation?.status === 'ACTIVE';
    const canStartFinancialConsolidation = canConsolidate
        && !loadingConsolidation
        && !consolidationLookupError
        && !hasActiveFinancialConsolidation;
    const invoiceCandidates = orders.filter((order) =>
        !order.invoiceNumber && order.financialStatus === 'UNPAID'
    );
    const invoiceTarget = invoiceCandidates.find((order) => order.id === invoiceTargetOrderId) ?? null;
    const editableOrder = orders.find((order) =>
        !order.invoiceNumber && !order.preInvoicedAt && order.financialStatus === 'UNPAID'
    );
    const canAddProducts = canOperatePOS
        && (orders.length === 0 || (orders.length === 1 && Boolean(editableOrder)));
    const canShowInvoiceAction = canIssueInvoice && invoiceCandidates.length > 0;
    const footerActionCount = Number(canShowInvoiceAction) + Number(canAddProducts);
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

    const submitPreInvoiceReversal = async (event: React.FormEvent, order: Order) => {
        event.preventDefault();
        const reason = preInvoiceReverseReason.trim();
        if (reason.length < 3) {
            setPreInvoiceReverseError('Escribe un motivo de al menos 3 caracteres.');
            return;
        }
        const accepted = await confirm(
            `¿Revertir la prefactura de la orden #${order.id}? Podrás agregar productos y luego emitir una nueva prefactura con el total actualizado.`,
            { title: 'Revertir prefactura' },
        );
        if (!accepted) return;
        setPreInvoiceReverseError(null);
        const reversed = await onReversePreInvoice(order, reason);
        if (reversed) {
            setPreInvoiceReverseOrderId(null);
            setPreInvoiceReverseReason('');
        }
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
                                            {order.items?.map((item) => isVoidedOrderLine(item) ? (
                                                <div key={item.id} className="order-item-line order-line-voided" title={item.voidReason || undefined}>
                                                    <div className="item-quantity-name">
                                                        <span className="item-qty">{item.voidedQuantity}x</span>
                                                        <span className="item-name">
                                                            <span className="order-line-voided-name">{item.menuItem?.name || 'Item'}</span>
                                                            <small className="order-line-void-badge">Anulado{item.voidReason ? ` · ${item.voidReason}` : ''}</small>
                                                        </span>
                                                    </div>
                                                    <span className="item-price">{formatMoney(0)}</span>
                                                </div>
                                            ) : (
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
                                                    {canVoidLines && onVoidLine && isVoidableOrderLine(item) && !orderLineVoidBlocker(order) && (
                                                        <button
                                                            type="button"
                                                            className="order-line-void-btn"
                                                            onClick={() => onVoidLine(order, item.id)}
                                                            title="Anular línea y registrar merma"
                                                        >
                                                            Anular
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <div className="order-card-footer">
                                            <span className="order-total-label">Total de la orden</span>
                                            <span className="order-total-amount">{formatMoney(Number(order.total))}</span>
                                        </div>
                                        <div className="table-order-actions">
                                            {order.invoiceNumber && (
                                                <span className="invoice-issued-badge">
                                                    <Receipt size={15} /> {order.invoiceNumber}
                                                </span>
                                            )}
                                            {order.preInvoicedAt && !order.invoiceNumber && (
                                                <span className="invoice-issued-badge">
                                                    <Receipt size={15} /> Prefactura emitida
                                                </span>
                                            )}
                                            {order.invoiceNumber && canIssueInvoice && (
                                                <button type="button" onClick={() => onIssueInvoice(order)}>
                                                    <Receipt size={16} /> Reimprimir factura
                                                </button>
                                            )}
                                            {order.preInvoicedAt
                                                && !order.invoiceNumber
                                                && order.financialStatus === 'UNPAID'
                                                && canIssueInvoice && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPreInvoiceReverseOrderId(order.id);
                                                        setPreInvoiceReverseReason('');
                                                        setPreInvoiceReverseError(null);
                                                    }}
                                                    disabled={busyOrderId !== null && busyOrderId !== undefined}
                                                >
                                                    <Undo2 size={16} /> Revertir prefactura
                                                </button>
                                            )}
                                            {(order.preInvoicedAt || order.invoiceNumber) && order.financialStatus !== 'PAID' && canPay && (
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
                                        {preInvoiceReverseOrderId === order.id && (
                                            <form
                                                className="table-consolidation-reversal-form preinvoice-reversal-form"
                                                onSubmit={(event) => void submitPreInvoiceReversal(event, order)}
                                            >
                                                <label htmlFor={`preinvoice-reversal-reason-${order.id}`}>
                                                    Motivo obligatorio
                                                </label>
                                                <textarea
                                                    id={`preinvoice-reversal-reason-${order.id}`}
                                                    value={preInvoiceReverseReason}
                                                    onChange={(event) => {
                                                        setPreInvoiceReverseReason(event.target.value);
                                                        if (preInvoiceReverseError) setPreInvoiceReverseError(null);
                                                    }}
                                                    minLength={3}
                                                    maxLength={500}
                                                    rows={3}
                                                    disabled={busyOrderId === order.id}
                                                    placeholder="Ej.: El comensal solicitó un producto adicional"
                                                    required
                                                />
                                                {preInvoiceReverseError && (
                                                    <span className="table-consolidation-reversal-error" role="alert">
                                                        {preInvoiceReverseError}
                                                    </span>
                                                )}
                                                <div className="table-consolidation-reversal-actions">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setPreInvoiceReverseOrderId(null);
                                                            setPreInvoiceReverseReason('');
                                                            setPreInvoiceReverseError(null);
                                                        }}
                                                        disabled={busyOrderId === order.id}
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        type="submit"
                                                        className="danger"
                                                        disabled={busyOrderId === order.id || preInvoiceReverseReason.trim().length < 3}
                                                    >
                                                        {busyOrderId === order.id
                                                            ? <><Loader2 className="button-spinner" size={17} /> Revirtiendo…</>
                                                            : <><Undo2 size={17} /> Confirmar reverso</>}
                                                    </button>
                                                </div>
                                            </form>
                                        )}
                                    </article>
                                ))
                            )}
                    </div>
                </div>

                {footerActionCount > 0 && <div className={`orders-modal-footer ${footerActionCount === 1 ? 'single-action' : ''}`}>
                    {canShowInvoiceAction && invoiceCandidates.length > 1 && (
                        <label className="invoice-order-selector">
                            <span>Orden a facturar</span>
                            <select
                                value={invoiceTargetOrderId ?? ''}
                                onChange={(event) => setInvoiceTargetOrderId(event.target.value ? Number(event.target.value) : null)}
                                disabled={busyOrderId !== null && busyOrderId !== undefined}
                            >
                                <option value="">Selecciona una orden</option>
                                {invoiceCandidates.map((order) => (
                                    <option key={order.id} value={order.id}>
                                        Orden #{order.id} · {formatMoney(Number(order.total))}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    {canShowInvoiceAction && (
                        <button
                            type="button"
                            className="btn-modal-primary issue-invoice-action"
                            disabled={!invoiceTarget || busyOrderId !== null && busyOrderId !== undefined}
                            onClick={() => invoiceTarget && onIssueInvoice(invoiceTarget)}
                        >
                            {busyOrderId ? <Loader2 className="button-spinner" size={18} /> : <Receipt size={18} />}
                            {busyOrderId
                                ? 'Preparando…'
                                : invoiceTarget?.preInvoicedAt
                                    ? 'Reimprimir prefactura'
                                    : 'Emitir Factura'}
                        </button>
                    )}
                    {canAddProducts && (
                        <button
                            type="button"
                            className="btn-modal-primary add-products-action"
                            disabled={loading}
                            onClick={() => onOpenPOS(table)}
                        >
                            {loading ? <Loader2 className="button-spinner" size={18} /> : <ShoppingCart size={18} />}
                            {loading ? 'Cargando…' : 'Agregar productos'}
                        </button>
                    )}
                </div>}
            </div>
        </div>,
        document.body,
    );
}
