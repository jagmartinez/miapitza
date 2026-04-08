import { useState, useEffect } from 'react';
import { FileText, Download, Eye, Calendar, User } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import { ordersAPI, settingsAPI } from '../services/api';
import type { Order } from '../types';
import type { CurrencySettings } from '../utils/currency';
import './InvoiceHistory.css';

interface Invoice {
    id: number;
    invoiceNumber: string;
    date: string;
    customerName?: string;
    waiterName: string;
    total: number;
    paymentMethod: string;
    status: string;
}

export default function InvoiceHistory() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [dateFilter, setDateFilter] = useState('today');
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState<CurrencySettings>({});

    useEffect(() => {
        loadInvoices();
        loadSettings();
    }, [dateFilter]);

    const loadSettings = async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data);
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    };

    const loadInvoices = async () => {
        try {
            setLoading(true);
            const response = await ordersAPI.getAll({
                status: 'PAID'
            });

            // Transform orders to invoices
            const invoiceData = response.data.data
                .filter((order: Order) => order.status === 'PAID')
                .map((order: Order) => ({
                    id: order.id,
                    invoiceNumber: `FAC-${String(order.id).padStart(6, '0')}`,
                    date: order.createdAt,
                    customerName: order.customerName,
                    waiterName: order.user?.name || 'N/A',
                    total: order.total || 0,
                    paymentMethod: order.payments?.[0]?.paymentMethod?.name || 'N/A',
                    status: order.status
                }));

            setInvoices(invoiceData);
        } catch (error) {
            console.error('Error loading invoices:', error);
        } finally {
            setLoading(false);
        }
    };

    const filterByDate = (invoice: Invoice) => {
        const invoiceDate = new Date(invoice.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        switch (dateFilter) {
            case 'today':
                return invoiceDate >= today;
            case 'week':
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                return invoiceDate >= weekAgo;
            case 'month':
                const monthAgo = new Date(today);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                return invoiceDate >= monthAgo;
            default:
                return true;
        }
    };

    const filteredInvoices = invoices
        .filter(filterByDate)
        .filter(invoice =>
            invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
            invoice.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            invoice.waiterName.toLowerCase().includes(searchTerm.toLowerCase())
        );

    const totalAmount = filteredInvoices.reduce((sum, inv) => sum + inv.total, 0);

    if (loading) {
        return (
            <div className="invoice-history-page">
                <LoadingSpinner size="lg" text="Cargando facturas..." />
            </div>
        );
    }

    return (
        <div className="invoice-history-page">
            <div className="invoice-header">
                <div>
                    <h1><FileText size={32} /> Historial de Facturas</h1>
                    <p className="invoice-subtitle">
                        {filteredInvoices.length} facturas • Total: {settings.currency_symbol || '$'}{totalAmount.toFixed(2)}
                    </p>
                </div>
            </div>

            <div className="invoice-filters">
                <div className="filter-group">
                    <button
                        className={`filter-btn ${dateFilter === 'today' ? 'active' : ''}`}
                        onClick={() => setDateFilter('today')}
                    >
                        Hoy
                    </button>
                    <button
                        className={`filter-btn ${dateFilter === 'week' ? 'active' : ''}`}
                        onClick={() => setDateFilter('week')}
                    >
                        Última Semana
                    </button>
                    <button
                        className={`filter-btn ${dateFilter === 'month' ? 'active' : ''}`}
                        onClick={() => setDateFilter('month')}
                    >
                        Último Mes
                    </button>
                    <button
                        className={`filter-btn ${dateFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setDateFilter('all')}
                    >
                        Todas
                    </button>
                </div>

                <input
                    type="text"
                    className="search-input"
                    placeholder="Buscar por número, cliente o mesero..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {filteredInvoices.length === 0 ? (
                <Card>
                    <EmptyState
                        icon={<FileText size={64} />}
                        title="No hay facturas"
                        description="No se encontraron facturas con los filtros aplicados"
                    />
                </Card>
            ) : (
                <div className="invoices-table-container">
                    <table className="invoices-table">
                        <thead>
                            <tr>
                                <th>Número</th>
                                <th>Fecha</th>
                                <th>Cliente</th>
                                <th>Mesero</th>
                                <th>Método de Pago</th>
                                <th>Total</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredInvoices.map(invoice => (
                                <tr key={invoice.id}>
                                    <td className="invoice-number">{invoice.invoiceNumber}</td>
                                    <td>
                                        <div className="date-cell">
                                            <Calendar size={14} />
                                            {new Date(invoice.date).toLocaleDateString('es-ES')}
                                            <span className="time">
                                                {new Date(invoice.date).toLocaleTimeString('es-ES', {
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                    </td>
                                    <td>{invoice.customerName || 'Cliente General'}</td>
                                    <td>
                                        <div className="waiter-cell">
                                            <User size={14} />
                                            {invoice.waiterName}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`payment-badge payment-${invoice.paymentMethod.toLowerCase()}`}>
                                            {invoice.paymentMethod}
                                        </span>
                                    </td>
                                    <td className="total-cell">
                                        <span style={{ fontSize: '14px', marginRight: '4px' }}>{settings.currency_symbol || '$'}</span>
                                        {invoice.total.toFixed(2)}
                                    </td>
                                    <td>
                                        <div className="action-buttons">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => window.print()}
                                            >
                                                <Eye size={16} />
                                                Ver
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => window.print()}
                                            >
                                                <Download size={16} />
                                                Descargar
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
