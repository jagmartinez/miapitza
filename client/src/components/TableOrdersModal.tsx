import { useRef } from 'react';
import {
    X, Clock, FileText, Printer, ShoppingCart, Receipt,
    CreditCard, Scissors, ArrowRightLeft, Merge, ChefHat
} from 'lucide-react';
import type { Order, OrderItem, Table } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { getUserAccentColor } from '../utils/authz';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { useCurrency } from '../hooks/useCurrency';
import './TableOrdersModal.css';

interface TableOrdersModalProps {
    isOpen: boolean;
    onClose: () => void;
    table: Table | null;
    orders: Order[];
    busyOrderId?: number | null;
    canIssueInvoice: boolean;
    canPay: boolean;
    canOperatePOS: boolean;
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
    onOpenPOS,
    onIssueInvoice,
    onPay,
    onSplit,
    onTransfer,
    onConsolidate
}: TableOrdersModalProps) {
    const { formatMoney, symbol } = useCurrency();
    const containerRef = useRef<HTMLDivElement>(null);
    const { titleId } = useDialogA11y(isOpen, onClose, containerRef);
    if (!isOpen || !table) return null;

    const tableNumber = table.number;

    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
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

    const handlePrintBill = () => {
        // ... (print logic remains the same)
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

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

    return (
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
                {/* Header */}
                <div className="orders-modal-header">
                    <div className="header-title">
                        <h2 id={titleId}>Mesa {tableNumber}</h2>
                        <span className="header-subtitle">
                            {table.location || 'Salón principal'} · {table.capacity} personas
                        </span>
                    </div>
                    <button type="button" className="close-btn-orders" onClick={onClose} aria-label="Cerrar">
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>

                <div className="table-command-strip" aria-label="Acciones operativas de la mesa">
                    {canOperatePOS && <button type="button" className="table-command-primary" onClick={() => onOpenPOS(table)}>
                        <ShoppingCart size={19} />
                        <span>{orders.length > 0 ? 'Continuar pedido' : 'Abrir pedido'}</span>
                    </button>}
                    <button type="button" onClick={() => onTransfer(table)}>
                        <ArrowRightLeft size={18} /><span>Cambiar mesa</span>
                    </button>
                    <button type="button" onClick={() => onConsolidate(table)}>
                        <Merge size={18} /><span>Consolidar</span>
                    </button>
                </div>

                <div className="orders-section-heading">
                    <FileText size={18} />
                    <strong>Órdenes activas</strong>
                    <span>{orders.length}</span>
                </div>

                {/* Content */}
                <div className="modal-tab-content-orders">
                    <div className="orders-list animate-slide-in">
                            {orders.length === 0 ? (
                                <div className="no-orders-message">
                                    <FileText size={48} />
                                    <p>No hay órdenes activas</p>
                                    <small>Esta mesa no tiene órdenes pendientes</small>
                                </div>
                            ) : (
                                orders.map(order => (
                                    <div key={order.id} className="order-card-modal">
                                        <div className="order-card-header">
                                            <div className="order-id-time">
                                                <span className="order-id-badge">#{order.id}</span>
                                                <div className="order-time">
                                                    <Clock size={14} />
                                                    <span>{formatTime(order.createdAt)}</span>
                                                </div>
                                            </div>
                                            <span className={`order-status-badge ${getStatusColor(order.status)}`}>
                                                {getStatusText(order.status)}
                                            </span>
                                        </div>
                                        <div style={{ marginBottom: '0.75rem' }}>
                                            <span
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.35rem',
                                                    padding: '0.2rem 0.55rem',
                                                    borderRadius: '999px',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    background: `${getUserAccentColor(order.user)}18`,
                                                    color: getUserAccentColor(order.user)
                                                }}
                                            >
                                                {order.user?.name || 'Sin mesero'}
                                            </span>
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
                                            <span className="order-total-label">Total:</span>
                                            <span className="order-total-amount">{formatMoney(Number(order.total))}</span>
                                        </div>
                                        <div className="table-order-actions">
                                            {canOperatePOS && !order.invoiceNumber && order.financialStatus === 'UNPAID' && (
                                                <button type="button" onClick={() => onOpenPOS(table)}>
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
                                    </div>
                                ))
                            )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="orders-modal-footer">
                    <button className="btn-modal-secondary" onClick={onClose}>
                        Cerrar
                    </button>
                    {canOperatePOS && <button className="btn-modal-primary" onClick={() => onOpenPOS(table)}>
                        <ShoppingCart size={18} />
                        {orders.length > 0 ? 'Continuar pedido' : 'Crear pedido'}
                    </button>}
                    {orders.length > 0 && (
                        <button className="btn-modal-secondary" onClick={handlePrintBill}>
                            <Printer size={18} />
                            Imprimir Cuenta
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
