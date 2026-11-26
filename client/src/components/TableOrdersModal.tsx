import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
    Clock, FileText, ShoppingCart, Receipt,
    CreditCard, Scissors, ArrowRightLeft, Merge, ChefHat,
    Users, CircleDollarSign, Link2, Unlink, Loader2, Pencil, Undo2, AlertTriangle,
} from 'lucide-react';
import type { ActiveTableConsolidation, Order, OrderItem, Table } from '../types';
import { AppSelect, Badge, Button, DataTable, EmptyState, Field, FullScreenModal, Textarea, formatNumber, type Column, type Tone } from '@/ui';
import { getUserAccentColor } from '../utils/authz';
import { isVoidableOrderLine, isVoidedOrderLine, orderLineVoidBlocker } from '../utils/orderLineVoid';
import { getOrderStatusLabel } from '../utils/orderStatus';
import { useCurrency } from '../hooks/useCurrency';
import { useConfirmDialog } from '../context/ConfirmContext';
import styles from './TableOrdersModal.module.css';

const STATUS_TONE: Record<Order['status'], Tone> = {
    OPEN: 'primary',
    SENT_TO_KITCHEN: 'warning',
    IN_PREPARATION: 'warning',
    READY: 'success',
    DELIVERED: 'neutral',
    CANCELLED: 'neutral',
};
const statusTone = (status: Order['status']): Tone => STATUS_TONE[status] ?? 'neutral';

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
    const anyBusy = busyOrderId !== null && busyOrderId !== undefined;

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

    const buildItemColumns = (order: Order): Column<OrderItem>[] => {
        const columns: Column<OrderItem>[] = [
            {
                key: 'quantity',
                header: 'Cant.',
                width: '0.5fr',
                render: (item) => (isVoidedOrderLine(item) ? `${item.voidedQuantity}x` : `${item.quantity}x`),
            },
            {
                key: 'name',
                header: 'Producto',
                width: '2fr',
                render: (item) => isVoidedOrderLine(item) ? (
                    <span className={styles.itemName} title={item.voidReason || undefined}>
                        <span className={styles.voidedName}>{item.menuItem?.name || 'Item'}</span>
                        <small className={styles.voidBadge}>Anulado{item.voidReason ? ` · ${item.voidReason}` : ''}</small>
                    </span>
                ) : (
                    <span className={styles.itemName}>
                        {item.menuItem?.name || 'Item'}
                        <small className={styles.kitchen} data-status={item.status}>
                            <ChefHat size={12} aria-hidden="true" /> {itemStatusLabel(item.status)}
                        </small>
                    </span>
                ),
            },
            {
                key: 'subtotal',
                header: 'Subtotal',
                type: 'money',
                width: '1fr',
                render: (item) => formatMoney(isVoidedOrderLine(item) ? 0 : Number(item.subtotal)),
            },
        ];
        if (canVoidLines && onVoidLine) {
            columns.push({
                key: 'void',
                header: 'Acción',
                width: '0.7fr',
                render: (item) => (!isVoidedOrderLine(item) && isVoidableOrderLine(item) && !orderLineVoidBlocker(order) ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className={styles.touch}
                        onClick={() => onVoidLine(order, item.id)}
                        title="Anular línea y registrar merma"
                    >
                        Anular
                    </Button>
                ) : null),
            });
        }
        return columns;
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
                <Button type="submit" variant="danger" className={styles.touch} icon={busy ? Loader2 : Undo2} disabled={busy || value.trim().length < 3}>
                    {busy ? 'Revirtiendo…' : 'Confirmar reverso'}
                </Button>
            </div>
        </form>
    );

    return (
        <FullScreenModal
            isOpen={isOpen}
            onClose={onClose}
            title={`Mesa ${tableNumber}`}
            subtitle={table.location || 'Salón principal'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" className={styles.touch} onClick={requestClose}>Cerrar</Button>
                    {canShowInvoiceAction && invoiceCandidates.length > 1 && (
                        <div className={styles.invoiceSelector}>
                            <AppSelect<number>
                                inputId="invoice-order-selector"
                                aria-label="Orden a facturar"
                                placeholder="Selecciona una orden a facturar"
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
                    {canShowInvoiceAction && (
                        <Button
                            variant="primary"
                            className={styles.touch}
                            icon={busyOrderId ? Loader2 : Receipt}
                            disabled={!invoiceTarget || anyBusy}
                            onClick={() => invoiceTarget && onIssueInvoice(invoiceTarget)}
                        >
                            {busyOrderId
                                ? 'Preparando…'
                                : invoiceTarget?.preInvoicedAt
                                    ? 'Reimprimir prefactura'
                                    : 'Emitir Factura'}
                        </Button>
                    )}
                    {canAddProducts && (
                        <Button
                            variant="primary"
                            className={styles.touch}
                            icon={loading ? Loader2 : ShoppingCart}
                            disabled={loading}
                            onClick={() => onOpenPOS(table)}
                        >
                            {loading ? 'Cargando…' : 'Agregar productos'}
                        </Button>
                    )}
                </>
            )}
        >
            <div className={styles.workspace}>
                <dl className={styles.summary} aria-label="Resumen de la mesa">
                    <div><dt><Users size={14} aria-hidden="true" /> Capacidad</dt><dd>{formatNumber(table.capacity, 0)} sillas = {formatNumber(table.capacity, 0)} comensales</dd></div>
                    <div><dt><FileText size={14} aria-hidden="true" /> Órdenes activas</dt><dd>{formatNumber(orders.length, 0)}</dd></div>
                    <div><dt><CircleDollarSign size={14} aria-hidden="true" /> Consumo activo</dt><dd className={styles.total}>{formatMoney(totalAmount)}</dd></div>
                </dl>

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
                        <Loader2 className={styles.spin} size={18} aria-hidden="true" />
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
                            <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
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

                {(canTransfer || canStartFinancialConsolidation || canGroup) && (
                    <div className={styles.commands} role="group" aria-label="Gestionar ubicación de la mesa">
                        {canTransfer && (
                            <Button variant="secondary" className={styles.touch} icon={ArrowRightLeft} onClick={() => onTransfer(table)}>
                                Cambiar mesa
                            </Button>
                        )}
                        {canStartFinancialConsolidation && (
                            <Button variant="secondary" className={styles.touch} icon={Merge} onClick={() => onConsolidate(table)}>
                                Consolidar
                            </Button>
                        )}
                        {canGroup && !table.activeTableGroup && ['AVAILABLE', 'OCCUPIED'].includes(table.status) && (
                            <Button variant="secondary" className={styles.touch} icon={Link2} onClick={() => onGroup(table)}>
                                Unir mesas
                            </Button>
                        )}
                        {canGroup && table.activeTableGroup && (
                            <>
                                <Button variant="secondary" className={styles.touch} icon={Pencil} onClick={() => onEditGroup(table)}>
                                    Editar grupo
                                </Button>
                                <Button variant="secondary" className={styles.touch} icon={Unlink} onClick={() => onUngroup(table)}>
                                    Separar todas
                                </Button>
                            </>
                        )}
                    </div>
                )}

                <div className={styles.workspace} aria-busy={loading}>
                    {loading ? (
                        <div className={styles.loadingState} role="status">
                            <Loader2 className={styles.spin} size={36} aria-hidden="true" />
                            <p>Cargando pedido…</p>
                            <small>Validando la cuenta activa antes de continuar</small>
                        </div>
                    ) : orders.length === 0 ? (
                        <EmptyState icon={FileText} title="No hay órdenes activas" description="Esta mesa no tiene órdenes pendientes" />
                    ) : (
                        orders.map((order) => (
                            <section key={order.id} className={styles.order} aria-label={`Orden ${order.id}`}>
                                <header className={styles.orderHeader}>
                                    <div className={styles.orderTitle}>
                                        <strong>Orden #{order.id}</strong>
                                        <span className={styles.time}><Clock size={14} aria-hidden="true" /> {formatTime(order.createdAt)}</span>
                                        <span
                                            className={styles.waiter}
                                            style={{ background: `${getUserAccentColor(order.user)}18`, color: getUserAccentColor(order.user) }}
                                        >
                                            {order.user?.name || 'Sin mesero'}
                                        </span>
                                        <small className={styles.time}>{order.items?.length || 0} productos</small>
                                    </div>
                                    <Badge tone={statusTone(order.status)} dot>{getOrderStatusLabel(order.status)}</Badge>
                                </header>

                                <DataTable<OrderItem>
                                    ariaLabel={`Productos de la orden ${order.id}`}
                                    columns={buildItemColumns(order)}
                                    rows={order.items ?? []}
                                    rowKey={(item) => item.id || item.menuItemId}
                                    defaultPageSize={25}
                                    empty={<EmptyState title="Sin productos" />}
                                />

                                <div className={styles.orderFooter}>
                                    <span>Total de la orden</span>
                                    <strong>{formatMoney(Number(order.total))}</strong>
                                </div>
                                <div className={styles.actions}>
                                    {order.invoiceNumber && (
                                        <Badge tone="success"><Receipt size={14} aria-hidden="true" /> {order.invoiceNumber}</Badge>
                                    )}
                                    {order.preInvoicedAt && !order.invoiceNumber && (
                                        <Badge tone="success"><Receipt size={14} aria-hidden="true" /> Prefactura emitida</Badge>
                                    )}
                                    {order.invoiceNumber && canIssueInvoice && (
                                        <Button variant="secondary" className={styles.touch} icon={Receipt} onClick={() => onIssueInvoice(order)}>
                                            Reimprimir factura
                                        </Button>
                                    )}
                                    {order.preInvoicedAt
                                        && !order.invoiceNumber
                                        && order.financialStatus === 'UNPAID'
                                        && canIssueInvoice && (
                                        <Button
                                            variant="secondary"
                                            className={styles.touch}
                                            icon={Undo2}
                                            onClick={() => {
                                                setPreInvoiceReverseOrderId(order.id);
                                                setPreInvoiceReverseReason('');
                                                setPreInvoiceReverseError(null);
                                            }}
                                            disabled={anyBusy}
                                        >
                                            Revertir prefactura
                                        </Button>
                                    )}
                                    {(order.preInvoicedAt || order.invoiceNumber) && order.financialStatus !== 'PAID' && canPay && (
                                        <>
                                            <Button variant="primary" className={styles.touch} icon={CreditCard} onClick={() => onPay(order)}>
                                                Cobrar
                                            </Button>
                                            <Button variant="secondary" className={styles.touch} icon={Scissors} onClick={() => onSplit(order)}>
                                                Dividir por consumo
                                            </Button>
                                        </>
                                    )}
                                </div>
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
            </div>
        </FullScreenModal>
    );
}
