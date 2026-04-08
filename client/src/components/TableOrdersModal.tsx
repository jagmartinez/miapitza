import { useState } from 'react';
import { X, Clock, DollarSign, FileText, Printer } from 'lucide-react';
import type { Order, OrderItem } from '../types';
import { escapeHtml } from '../utils/escapeHtml';
import { getUserAccentColor } from '../utils/authz';
import { getOrderStatusClassName, getOrderStatusLabel } from '../utils/orderStatus';
import './TableOrdersModal.css';

interface TableOrdersModalProps {
    isOpen: boolean;
    onClose: () => void;
    tableNumber: string;
    orders: Order[];
}

export default function TableOrdersModal({ isOpen, onClose, tableNumber, orders }: TableOrdersModalProps) {
    // Modal Tab State
    const [activeTab, setActiveTab] = useState<'orders' | 'bill'>('orders');

    if (!isOpen) return null;

    const totalAmount = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const totalItems = orders.reduce((sum, order) => sum + (order.items?.reduce((s, i) => s + Number(i.quantity), 0) || 0), 0);

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
                                <span>$${Number(item.subtotal).toFixed(2)}</span>
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
                <div class="total">
                    <div class="item">
                        <span>TOTAL:</span>
                        <span>$${totalAmount.toFixed(2)}</span>
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
            <div className="orders-modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="orders-modal-header">
                    <div className="header-title">
                        <h2>Mesa {tableNumber}</h2>
                        <span className="header-subtitle">Órdenes Activas</span>
                    </div>
                    <button className="close-btn-orders" onClick={onClose}>
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs Navigation */}
                <div className="modal-tabs">
                    <div
                        className={`modal-tab ${activeTab === 'orders' ? 'active' : ''}`}
                        onClick={() => setActiveTab('orders')}
                    >
                        <FileText size={18} />
                        <span>Órdenes <span className="tab-badge">{orders.length}</span></span>
                    </div>
                    <div
                        className={`modal-tab ${activeTab === 'bill' ? 'active' : ''}`}
                        onClick={() => setActiveTab('bill')}
                    >
                        <DollarSign size={18} />
                        <span>Cuenta</span>
                    </div>
                </div>

                {/* Content */}
                <div className="modal-tab-content-orders">
                    {activeTab === 'orders' ? (
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
                                                        <span className="item-name">{item.menuItem?.name || 'Item'}</span>
                                                    </div>
                                                    <span className="item-price">${Number(item.subtotal).toFixed(2)}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="order-card-footer">
                                            <span className="order-total-label">Total:</span>
                                            <span className="order-total-amount">${Number(order.total).toFixed(2)}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (
                        <div className="bill-summary-pane animate-slide-in">
                            <div className="bill-stat-grid">
                                <div className="bill-stat-card">
                                    <span className="stat-label">Órdenes</span>
                                    <span className="stat-value">{orders.length}</span>
                                </div>
                                <div className="bill-stat-card">
                                    <span className="stat-label">Items Totales</span>
                                    <span className="stat-value">{totalItems}</span>
                                </div>
                                <div className="bill-stat-card primary">
                                    <span className="stat-label">Monto a Pagar</span>
                                    <span className="stat-value">${totalAmount.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="bill-details-section">
                                <h3>Resumen de Consumo</h3>
                                <div className="bill-items-table">
                                    {orders.flatMap(o => o.items || []).reduce((acc: Array<Pick<OrderItem, 'menuItemId' | 'quantity' | 'subtotal' | 'menuItem'>>, item) => {
                                        const existing = acc.find(i => i.menuItemId === item.menuItemId);
                                        if (existing) {
                                            existing.quantity += Number(item.quantity);
                                            existing.subtotal += Number(item.subtotal);
                                        } else {
                                            acc.push({ ...item, quantity: Number(item.quantity), subtotal: Number(item.subtotal) });
                                        }
                                        return acc;
                                    }, []).map((item, idx) => (
                                        <div key={idx} className="bill-item-row">
                                            <span className="b-qty">{item.quantity}x</span>
                                            <span className="b-name">{item.menuItem?.name || 'Item'}</span>
                                            <span className="b-price">${Number(item.subtotal).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="orders-modal-footer">
                    <button className="btn-modal-secondary" onClick={onClose}>
                        Cerrar
                    </button>
                    {orders.length > 0 && (
                        <button className="btn-modal-primary" onClick={handlePrintBill}>
                            <Printer size={18} />
                            Imprimir Cuenta
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
