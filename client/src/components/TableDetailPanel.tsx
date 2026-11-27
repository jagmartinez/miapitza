import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
    Receipt, Undo2, AlertTriangle, Link2, X, ChefHat,
} from 'lucide-react';
import type { ActiveTableConsolidation, Order, OrderItem, Table } from '../types';
import { AppSelect, Badge, Button, Field, IconButton, Spinner, Textarea, formatNumber, type Tone } from '@/ui';
import { isVoidableOrderLine, isVoidedOrderLine, orderLineVoidBlocker } from '../utils/orderLineVoid';
import { getOrderStatusLabel } from '../utils/orderStatus';
import { tableTileState, type TableTileKey } from '../utils/tableTileState';
import { useCurrency } from '../hooks/useCurrency';
import { useConfirmDialog } from '../context/ConfirmContext';
import styles from './TableDetailPanel.module.css';

const TILE_TONE: Record<TableTileKey, Tone> = {
    AVAILABLE: 'success',
    OCCUPIED: 'primary',
    PENDING_PAYMENT: 'warning',
    RESERVED: 'neutral',
    OUT_OF_SERVICE: 'danger',
};

interface TableDetailPanelProps {
    table: Table | null;
    orders: Order[];
    /** Zona/salón visible de la mesa (área del plano o ubicación). */
    zoneLabel?: string;
    /** Minutos de la orden abierta más antigua de la mesa. */
    openMinutes?: number | null;
    onClose: () => void;
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
    /** Acciones administrativas de la mesa (editar), dentro de "Más". */
    extraActions?: ReactNode;
}

/**
 * Panel lateral "Detalle de mesa" (mockup Mesas): consumo abierto, totales y
 * las acciones de servicio (agregar productos, pre-cuenta, cobrar, dividir, mover, unir, más).
 */
export default function TableDetailPanel({
    table,
    orders,
    zoneLabel,
    openMinutes,
    onClose,
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
    extraActions,
}: TableDetailPanelProps) {
    const { formatMoney } = useCurrency();
    const { confirm } = useConfirmDialog();
    const [showMore, setShowMore] = useState(false);
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
    }, [activeConsolidation?.id, table?.id]);

    useEffect(() => {
        setShowMore(false);
    }, [table?.id]);

    useEffect(() => {
        const candidates = orders.filter((order) =>
            !order.invoiceNumber && order.financialStatus === 'UNPAID'
        );
        setInvoiceTargetOrderId((current) => {
            if (candidates.length === 1) return candidates[0].id;
            return candidates.some((order) => order.id === current) ? current : null;
        });
    }, [orders]);

    if (!table) {
        return (
            <aside className={styles.panel} aria-label="Detalle de mesa">
                <div className={styles.placeholder}>
                    <p>Selecciona una mesa para ver su consumo y operarla.</p>
                </div>
            </aside>
        );
    }

    const state = tableTileState(table);
    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const subtotalAmount = orders.reduce((sum, order) => sum + Number(order.subtotal ?? (order.items ?? []).reduce((s, item) => s + (isVoidedOrderLine(item) ? 0 : Number(item.subtotal || 0)), 0)), 0);
    const discountAmount = orders.reduce((sum, order) => sum + Number(order.discount || 0), 0);
    const taxAmount = orders.reduce((sum, order) => sum + Number(order.tax || 0), 0);
    const tipAmount = orders.reduce((sum, order) => sum + Number(order.tipAmount || 0), 0);
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
        && table.status !== 'OUT_OF_SERVICE'
        && (orders.length === 0 || (orders.length === 1 && Boolean(editableOrder)));
    const anyBusy = busyOrderId !== null && busyOrderId !== undefined;
    const payableOrders = orders.filter((order) => (order.preInvoicedAt || order.invoiceNumber) && order.financialStatus !== 'PAID');
    const payableOrder = payableOrders[0] ?? null;
    const canGroupTable = canGroup && !table.activeTableGroup && ['AVAILABLE', 'OCCUPIED'].includes(table.status);
    const waiterNames = Array.from(new Set(orders.map((order) => order.user?.name).filter(Boolean)));
    const reversibleOrders = orders.filter((order) => order.preInvoicedAt
        && !order.invoiceNumber
        && order.financialStatus === 'UNPAID'
        && canIssueInvoice);
    const reprintOrders = orders.filter((order) => order.invoiceNumber && canIssueInvoice);
    const hasMoreActions = canStartFinancialConsolidation
        || (canGroup && Boolean(table.activeTableGroup))
        || reversibleOrders.length > 0
        || reprintOrders.length > 0
        || payableOrders.length > 1
        || Boolean(extraActions)
        || (canVoidLines && Boolean(onVoidLine) && orders.length > 0);

    const itemStatusLabel = (status: OrderItem['status']) => {
        if (status === 'DONE') return 'Listo';
        if (status === 'IN_PROGRESS') return 'En cocina';
        return 'Pendiente';
    };

    const submitConsolidationReversal = async (event: FormEvent) => {
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

    const submitPreInvoiceReversal = async (event: FormEvent, order: Order) => {
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

    const reasonForm = (
        id: string,
        value: string,
        onValueChange: (next: string) => void,
        error: string | null,
        busy: boolean,
        placeholder: string,
        onCancel: () => void,
        onSubmit: (event: FormEvent) => void,
    ): ReactNode => (
        <form className={styles.reversalForm} onSubmit={onSubmit}>
            <Field label="Motivo obligatorio" htmlFor={id} error={error || undefined}>
                <Textarea
                    id={id}
                    value={value}
                    onChange={(event) => onValueChange(event.target.value)}
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    disabled={busy}
                    placeholder={placeholder}
                    required
                />
            </Field>
            <div className={styles.actions}>
                <Button type="button" variant="secondary" className={styles.touch} disabled={busy} onClick={onCancel}>
                    Cancelar
                </Button>
                <Button type="submit" variant="danger" className={styles.touch} icon={Undo2} loading={busy} disabled={busy || value.trim().length < 3}>
                    {busy ? 'Revirtiendo…' : 'Confirmar reverso'}
                </Button>
            </div>
        </form>
    );

    const meta = [
        zoneLabel || table.location || 'Salón principal',
        `${formatNumber(table.capacity, 0)} ${table.capacity === 1 ? 'persona' : 'personas'}`,
        `Mesero: ${waiterNames.length ? waiterNames.join(', ') : '—'}`,
        openMinutes != null ? `${formatNumber(openMinutes, 0)} min` : 'sin tiempo',
    ].join(' · ');

    return (
        <aside className={styles.panel} aria-label="Detalle de mesa">
            <header className={styles.head}>
                <div className={styles.titleRow}>
                    <h2 className={styles.title}>Mesa {table.number}</h2>
                    <Badge tone={TILE_TONE[state.key]} dot>{state.label}</Badge>
                    <IconButton icon={X} label="Cerrar detalle de mesa" tooltip="Cerrar" onClick={onClose} className={styles.close} />
                </div>
                <span className={styles.meta}>{meta}</span>
            </header>

            {table.activeTableGroup && (
                <section className={styles.banner} aria-label="Grupo físico activo">
                    <Link2 size={19} aria-hidden="true" />
                    <div>
                        <strong>{table.activeTableGroup.primaryTableId === table.id ? 'Mesa principal del grupo' : `Unida a mesa ${table.activeTableGroup.primaryTable.number}`}</strong>
                        <span>{table.activeTableGroup.memberTableIds.length} mesas · {groupTotalCapacity ?? table.capacity} sillas/comensales en total · las cuentas siguen independientes</span>
                    </div>
                </section>
            )}

            {canConsolidate && loadingConsolidation && (
                <section className={styles.banner} role="status" aria-live="polite">
                    <Spinner size={16} label="Verificando consolidación" />
                    <span>Verificando si existe una consolidación activa…</span>
                </section>
            )}

            {canConsolidate && !loadingConsolidation && consolidationLookupError && (
                <section className={`${styles.banner} ${styles.bannerError}`} role="alert">
                    <AlertTriangle size={19} aria-hidden="true" />
                    <div>
                        <strong>No se pudo verificar el historial de consolidación</strong>
                        <span>{consolidationLookupError}</span>
                    </div>
                    <Button variant="secondary" className={styles.touch} onClick={onRetryConsolidationLookup}>
                        Reintentar
                    </Button>
                </section>
            )}

            {canConsolidate && !loadingConsolidation && activeConsolidation?.status === 'ACTIVE' && (
                <section className={styles.banner} aria-label="Consolidación activa" data-block>
                    <div className={styles.bannerHead}>
                        <Undo2 size={20} aria-hidden="true" />
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
                        <div className={styles.inlineError} role="alert">
                            <AlertTriangle size={18} aria-hidden="true" />
                            <div>
                                <strong>El reverso no se completó</strong>
                                <span>{consolidationReversalError}</span>
                                <small>
                                    La consolidación continúa activa. Corrige el bloqueo indicado o vuelve a verificar el estado antes de reintentar.
                                </small>
                            </div>
                            <Button variant="secondary" className={styles.touch} onClick={onRetryConsolidationLookup}>
                                Volver a verificar
                            </Button>
                        </div>
                    )}
                    {!showReversalForm ? (
                        <div className={styles.actions}>
                            <Button variant="secondary" className={styles.touch} icon={Undo2} onClick={() => setShowReversalForm(true)}>
                                Solicitar reverso
                            </Button>
                        </div>
                    ) : reasonForm(
                        `consolidation-reversal-reason-${activeConsolidation.id}`,
                        reversalReason,
                        (next) => {
                            setReversalReason(next);
                            if (reversalValidationError) setReversalValidationError(null);
                        },
                        reversalValidationError,
                        reversingConsolidation,
                        'Ej.: Las cuentas se consolidaron en la mesa equivocada',
                        () => {
                            setShowReversalForm(false);
                            setReversalReason('');
                            setReversalValidationError(null);
                        },
                        (event) => void submitConsolidationReversal(event),
                    )}
                </section>
            )}

            <div className={styles.body} aria-busy={loading} role="region" aria-label="Órdenes activas">
                {loading ? (
                    <div className={styles.loadingState}>
                        <Spinner size={24} label="Cargando pedido" />
                        <p>Cargando pedido…</p>
                    </div>
                ) : orders.length === 0 ? (
                    <p className={styles.empty}>Mesa sin orden abierta.</p>
                ) : (
                    orders.map((order) => (
                        <section key={order.id} className={styles.order} aria-label={`Orden ${order.id}`}>
                            <div className={styles.orderHead}>
                                <strong>Orden #{order.id}</strong>
                                <span>{getOrderStatusLabel(order.status)}</span>
                                {order.invoiceNumber ? (
                                    <Badge tone="success"><Receipt size={12} aria-hidden="true" /> {order.invoiceNumber}</Badge>
                                ) : order.preInvoicedAt ? (
                                    <Badge tone="success"><Receipt size={12} aria-hidden="true" /> Pre-cuenta emitida</Badge>
                                ) : null}
                            </div>
                            <ul className={styles.lines}>
                                {(order.items ?? []).map((item) => {
                                    const voided = isVoidedOrderLine(item);
                                    return (
                                        <li key={item.id || item.menuItemId} className={styles.line}>
                                            <span className={styles.qty}>{voided ? item.voidedQuantity : item.quantity}×</span>
                                            <span className={styles.lineName}>
                                                <span className={voided ? styles.voidedName : undefined}>{item.menuItem?.name || 'Item'}</span>
                                                {voided ? (
                                                    <small className={styles.voidBadge}>Anulado{item.voidReason ? ` · ${item.voidReason}` : ''}</small>
                                                ) : (
                                                    <small className={styles.kitchen} data-status={item.status}>
                                                        <ChefHat size={12} aria-hidden="true" /> {itemStatusLabel(item.status)}
                                                    </small>
                                                )}
                                            </span>
                                            <span className={styles.amount}>{formatMoney(voided ? 0 : Number(item.subtotal))}</span>
                                            {showMore && canVoidLines && onVoidLine && !voided && isVoidableOrderLine(item) && !orderLineVoidBlocker(order) && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className={styles.voidBtn}
                                                    onClick={() => onVoidLine(order, item.id)}
                                                    title="Anular línea y registrar merma"
                                                >
                                                    Anular
                                                </Button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            {preInvoiceReverseOrderId === order.id && reasonForm(
                                `preinvoice-reversal-reason-${order.id}`,
                                preInvoiceReverseReason,
                                (next) => {
                                    setPreInvoiceReverseReason(next);
                                    if (preInvoiceReverseError) setPreInvoiceReverseError(null);
                                },
                                preInvoiceReverseError,
                                busyOrderId === order.id,
                                'Ej.: El comensal solicitó un producto adicional',
                                () => {
                                    setPreInvoiceReverseOrderId(null);
                                    setPreInvoiceReverseReason('');
                                    setPreInvoiceReverseError(null);
                                },
                                (event) => void submitPreInvoiceReversal(event, order),
                            )}
                        </section>
                    ))
                )}
            </div>

            {orders.length > 0 && !loading && (
                <dl className={styles.totals} aria-label="Resumen de la mesa">
                    <div><dt>Subtotal</dt><dd>{formatMoney(subtotalAmount)}</dd></div>
                    {discountAmount > 0 && <div><dt>Descuento</dt><dd>−{formatMoney(discountAmount)}</dd></div>}
                    {taxAmount > 0 && <div><dt>Impuesto</dt><dd>{formatMoney(taxAmount)}</dd></div>}
                    {tipAmount > 0 && <div><dt>Propina</dt><dd>{formatMoney(tipAmount)}</dd></div>}
                    <div className={styles.grandTotal}><dt>Total</dt><dd>{formatMoney(totalAmount)}</dd></div>
                </dl>
            )}

            <div className={styles.spacer} />

            <footer className={styles.foot}>
                {canIssueInvoice && invoiceCandidates.length > 1 && (
                    <div className={styles.invoiceSelector}>
                        <AppSelect<number>
                            inputId="invoice-order-selector"
                            aria-label="Orden a facturar"
                            placeholder="Selecciona una orden para la pre-cuenta"
                            options={invoiceCandidates.map((order) => ({
                                value: order.id,
                                label: `Orden #${order.id} · ${formatMoney(Number(order.total))}`,
                            }))}
                            value={invoiceTargetOrderId}
                            onChange={(value) => setInvoiceTargetOrderId(value ?? null)}
                            isDisabled={anyBusy}
                        />
                    </div>
                )}
                {canOperatePOS && (
                    <Button
                        variant="primary"
                        size="lg"
                        className={styles.mainAction}
                        disabled={loading || !canAddProducts}
                        title={!canAddProducts && !loading ? 'La cuenta ya tiene pre-cuenta: revierte la pre-cuenta para agregar productos.' : undefined}
                        onClick={() => onOpenPOS(table)}
                    >
                        {loading ? 'Cargando…' : orders.length ? 'Agregar productos' : 'Abrir orden'}
                    </Button>
                )}
                <div className={styles.grid} role="group" aria-label="Acciones de la mesa">
                    {canIssueInvoice && (
                        <Button
                            className={styles.touch}
                            disabled={!invoiceTarget || anyBusy}
                            onClick={() => invoiceTarget && onIssueInvoice(invoiceTarget)}
                            title="Emitir la prefactura (pre-cuenta) habilita el cobro"
                        >
                            {busyOrderId ? 'Preparando…' : invoiceTarget?.preInvoicedAt ? 'Reimprimir prefactura' : 'Pre-cuenta'}
                        </Button>
                    )}
                    {canPay && (
                        <Button className={styles.touch} disabled={!payableOrder || anyBusy} onClick={() => payableOrder && onPay(payableOrder)}
                            title={!payableOrder ? 'Primero emite la pre-cuenta' : undefined}>
                            Cobrar
                        </Button>
                    )}
                    {canPay && (
                        <Button className={styles.touch} disabled={!payableOrder || anyBusy} onClick={() => payableOrder && onSplit(payableOrder)}
                            title="Dividir por consumo">
                            Dividir
                        </Button>
                    )}
                    {canTransfer && (
                        <Button className={styles.touch} disabled={orders.length === 0} onClick={() => onTransfer(table)} title="Cambiar mesa">
                            Mover
                        </Button>
                    )}
                    {canGroup && (
                        <Button className={styles.touch} disabled={!canGroupTable} onClick={() => onGroup(table)} title="Unir mesas">
                            Unir
                        </Button>
                    )}
                    {hasMoreActions && (
                        <Button className={styles.touch} aria-expanded={showMore} aria-controls="table-detail-more" onClick={() => setShowMore((value) => !value)}>
                            Más
                        </Button>
                    )}
                </div>
                {showMore && (
                    <div id="table-detail-more" className={styles.more} role="group" aria-label="Más acciones de la mesa">
                        {canStartFinancialConsolidation && (
                            <Button variant="ghost" className={styles.touch} onClick={() => onConsolidate(table)}>Consolidar</Button>
                        )}
                        {canGroup && table.activeTableGroup && (
                            <>
                                <Button variant="ghost" className={styles.touch} onClick={() => onEditGroup(table)}>Editar grupo</Button>
                                <Button variant="ghost" className={styles.touch} onClick={() => onUngroup(table)}>Separar todas</Button>
                            </>
                        )}
                        {reversibleOrders.map((order) => (
                            <Button
                                key={`reverse-${order.id}`}
                                variant="ghost"
                                className={styles.touch}
                                disabled={anyBusy}
                                onClick={() => {
                                    setPreInvoiceReverseOrderId(order.id);
                                    setPreInvoiceReverseReason('');
                                    setPreInvoiceReverseError(null);
                                }}
                            >
                                Revertir prefactura{reversibleOrders.length > 1 ? ` #${order.id}` : ''}
                            </Button>
                        ))}
                        {reprintOrders.map((order) => (
                            <Button key={`reprint-${order.id}`} variant="ghost" className={styles.touch} onClick={() => onIssueInvoice(order)}>
                                Reimprimir factura{reprintOrders.length > 1 ? ` #${order.id}` : ''}
                            </Button>
                        ))}
                        {payableOrders.slice(1).map((order) => (
                            <Button key={`pay-${order.id}`} variant="ghost" className={styles.touch} onClick={() => onPay(order)}>
                                Cobrar orden #{order.id}
                            </Button>
                        ))}
                        {extraActions}
                        {canVoidLines && onVoidLine && orders.length > 0 && (
                            <p className={styles.moreHint}>Usa «Anular» junto a cada producto para anular líneas enviadas a cocina.</p>
                        )}
                    </div>
                )}
            </footer>
        </aside>
    );
}
