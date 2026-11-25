import {
    Clock, FileText, Printer, ShoppingCart, Receipt,
    CreditCard, Scissors, ArrowRightLeft, Merge, ChefHat,
} from 'lucide-react';
import type { Order, OrderItem, Table } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { Badge, Button, DataTable, EmptyState, FullScreenModal, formatNumber, type Column, type Tone } from '@/ui';
import { getUserAccentColor } from '../utils/authz';
import { getOrderStatusLabel } from '../utils/orderStatus';
import { useCurrency } from '../hooks/useCurrency';
import { useAppToast } from '../context/ToastContext';
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
    busyOrderId?: number | null;
    canIssueInvoice: boolean;
    canPay: boolean;
    canOperatePOS: boolean;
    canTransfer: boolean;
    canConsolidate: boolean;
    onOpenPOS: (table: Table) => void;
    onIssueInvoice: (order: Order) => void;
    onPay: (order: Order) => void;
    onSplit: (order: Order) => void;
    onTransfer: (table: Table) => void;
    onConsolidate: (table: Table) => void;
}

export default function TableOrdersModal({
    isOpen,
    onClose,
    table,
    orders,
    busyOrderId,
    canIssueInvoice,
    canPay,
    canOperatePOS,
    canTransfer,
    canConsolidate,
    onOpenPOS,
    onIssueInvoice,
    onPay,
    onSplit,
    onTransfer,
    onConsolidate
}: TableOrdersModalProps) {
    const { formatMoney, symbol } = useCurrency();
    const { error: showError } = useAppToast();
    if (!isOpen || !table) return null;

    const tableNumber = table.number;

    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
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
                                <span>${e(symbol)}${formatNumber(item.subtotal)}</span>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
                <div class="total">
                    <div class="item">
                        <span>TOTAL:</span>
                        <span>${e(symbol)}${formatNumber(totalAmount)}</span>
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

    const itemColumns: Column<OrderItem>[] = [
        { key: 'quantity', header: 'Cant.', type: 'number', width: '0.5fr', decimals: 0 },
        {
            key: 'name',
            header: 'Producto',
            width: '2fr',
            render: (item) => (
                <span className={styles.itemName}>
                    {item.menuItem?.name || 'Item'}
                    <small className={styles.kitchen} data-status={item.status}>
                        <ChefHat size={12} aria-hidden="true" /> {itemStatusLabel(item.status)}
                    </small>
                </span>
            ),
        },
        { key: 'subtotal', header: 'Subtotal', type: 'money', width: '1fr', render: (item) => formatMoney(Number(item.subtotal)) },
    ];

    return (
        <FullScreenModal
            isOpen={isOpen}
            onClose={onClose}
            title={`Mesa ${tableNumber}`}
            subtitle={table.location || 'Salón principal'}
            footer={({ requestClose }) => (
                <>
                    <Button variant="ghost" className={styles.touch} onClick={requestClose}>Cerrar</Button>
                    {orders.length > 0 && (
                        <Button variant="secondary" className={styles.touch} icon={Printer} onClick={handlePrintBill}>
                            Imprimir cuenta
                        </Button>
                    )}
                    {canOperatePOS && (
                        <Button variant="primary" className={styles.touch} icon={ShoppingCart} onClick={() => onOpenPOS(table)}>
                            {orders.length > 0 ? 'Continuar pedido' : 'Abrir pedido'}
                        </Button>
                    )}
                </>
            )}
        >
            <div className={styles.workspace}>
                <dl className={styles.summary} aria-label="Resumen de la mesa">
                    <div><dt>Capacidad</dt><dd>{formatNumber(table.capacity, 0)} personas</dd></div>
                    <div><dt>Órdenes activas</dt><dd>{formatNumber(orders.length, 0)}</dd></div>
                    <div><dt>Consumo activo</dt><dd className={styles.total}>{formatMoney(totalAmount)}</dd></div>
                </dl>

                {(canTransfer || canConsolidate) && (
                    <div className={styles.commands} role="group" aria-label="Gestionar ubicación de la mesa">
                        {canTransfer && (
                            <Button variant="secondary" className={styles.touch} icon={ArrowRightLeft} onClick={() => onTransfer(table)}>
                                Cambiar mesa
                            </Button>
                        )}
                        {canConsolidate && (
                            <Button variant="secondary" className={styles.touch} icon={Merge} onClick={() => onConsolidate(table)}>
                                Consolidar
                            </Button>
                        )}
                    </div>
                )}

                {orders.length === 0 ? (
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
                                </div>
                                <Badge tone={statusTone(order.status)} dot>{getOrderStatusLabel(order.status)}</Badge>
                            </header>

                            <DataTable<OrderItem>
                                ariaLabel={`Productos de la orden ${order.id}`}
                                columns={itemColumns}
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
                                {canOperatePOS && !order.invoiceNumber && order.financialStatus === 'UNPAID' && (
                                    <Button variant="secondary" className={`${styles.touch} ${styles.addProducts}`} icon={ShoppingCart} onClick={() => onOpenPOS(table)}>
                                        Agregar productos
                                    </Button>
                                )}
                                {!order.invoiceNumber && canIssueInvoice && (
                                    <Button
                                        variant="primary"
                                        className={styles.touch}
                                        icon={Receipt}
                                        disabled={busyOrderId === order.id}
                                        onClick={() => onIssueInvoice(order)}
                                    >
                                        {busyOrderId === order.id ? 'Emitiendo…' : 'Emitir factura'}
                                    </Button>
                                )}
                                {order.invoiceNumber && (
                                    <Badge tone="success"><Receipt size={14} aria-hidden="true" /> {order.invoiceNumber}</Badge>
                                )}
                                {order.invoiceNumber && order.financialStatus !== 'PAID' && canPay && (
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
                        </section>
                    ))
                )}
            </div>
        </FullScreenModal>
    );
}
