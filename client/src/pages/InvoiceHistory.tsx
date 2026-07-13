import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Eye, Calendar, User } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import { ordersAPI, invoicesAPI, settingsAPI } from '../services/api';
import type { Order } from '../types';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
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

const PAGE_SIZE = 20;

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
};

function dateRangeForFilter(filter: string): { startDate?: string; endDate?: string } {
    const today = todayStr();
    switch (filter) {
        case 'today':
            return { startDate: today, endDate: today };
        case 'week': {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return { startDate: formatLocalDateInput(weekAgo), endDate: today };
        }
        case 'month':
            return { startDate: monthStartStr(), endDate: today };
        default:
            return {};
    }
}

export default function InvoiceHistory() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dateFilter, setDateFilter] = useState('month');
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [page, setPage] = useState(1);

    const loadSettings = useCallback(async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data);
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }, []);

    const loadInvoices = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const range = dateRangeForFilter(dateFilter);
            const response = await ordersAPI.getAll({
                status: 'PAID',
                limit: 200,
                ...range,
            });

            const rows = Array.isArray(response.data?.data) ? response.data.data : [];
            const invoiceData = rows
                .filter((order: Order) => order.status === 'PAID')
                .map((order: Order) => ({
                    id: order.id,
                    invoiceNumber: order.invoiceNumber || 'Pendiente de emisión',
                    date: order.closedAt || order.createdAt,
                    customerName: order.customerName,
                    waiterName: order.user?.name || 'N/A',
                    total: Number(order.total) || 0,
                    paymentMethod: order.payments?.[0]?.paymentMethod?.name || 'N/A',
                    status: order.status,
                }));

            setInvoices(invoiceData);
        } catch (err) {
            console.error('Error loading invoices:', err);
            setError('No se pudieron cargar las facturas. Intente de nuevo.');
            setInvoices([]);
        } finally {
            setLoading(false);
        }
    }, [dateFilter]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        void loadInvoices();
    }, [loadInvoices]);

    useEffect(() => {
        setPage(1);
    }, [dateFilter, searchTerm]);

    const downloadPdf = async (orderId: number, invoiceNumber: string) => {
        try {
            const invoice = await invoicesAPI.getData(orderId);
            const officialNumber = (invoice.data.data?.invoiceNumber as string | undefined) || invoiceNumber;
            const res = await invoicesAPI.downloadPdf(orderId);
            const blob = new Blob([res.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${officialNumber}.pdf`;
            link.click();
            URL.revokeObjectURL(url);
            await loadInvoices();
        } catch (err) {
            console.error('Error downloading invoice PDF:', err);
            setError('No se pudo descargar el PDF de la factura.');
        }
    };

    const filteredInvoices = invoices.filter((invoice) => {
        const q = searchTerm.toLowerCase();
        return (
            invoice.invoiceNumber.toLowerCase().includes(q) ||
            invoice.customerName?.toLowerCase().includes(q) ||
            invoice.waiterName.toLowerCase().includes(q)
        );
    });

    const totalAmount = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
    const pagedInvoices = filteredInvoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
                        {filteredInvoices.length} facturas • Total: {formatCurrency(totalAmount, settings)}
                    </p>
                </div>
            </div>

            {error && (
                <div className="invoice-error" role="alert">{error}</div>
            )}

            <div className="invoice-filters-row">
                <div className="invoice-date-filters">
                    <button
                        type="button"
                        className={`invoice-filter-btn ${dateFilter === 'today' ? 'active' : ''}`}
                        onClick={() => setDateFilter('today')}
                    >
                        Hoy
                    </button>
                    <button
                        type="button"
                        className={`invoice-filter-btn ${dateFilter === 'week' ? 'active' : ''}`}
                        onClick={() => setDateFilter('week')}
                    >
                        Última Semana
                    </button>
                    <button
                        type="button"
                        className={`invoice-filter-btn ${dateFilter === 'month' ? 'active' : ''}`}
                        onClick={() => setDateFilter('month')}
                    >
                        Este Mes
                    </button>
                    <button
                        type="button"
                        className={`invoice-filter-btn ${dateFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setDateFilter('all')}
                    >
                        Todas
                    </button>
                </div>

                <input
                    type="text"
                    className="invoice-search-input"
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
                        description="No se encontraron facturas pagadas en el período seleccionado. Prueba ampliar el filtro a «Este Mes» o «Todas»."
                    />
                </Card>
            ) : (
                <div className="data-table-wrapper">
                    <div className="data-table-header">
                        <span>Facturas</span>
                        <span className="data-table-count">{filteredInvoices.length} registros</span>
                    </div>
                    <div className="data-table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Número</th>
                                    <th>Fecha</th>
                                    <th>Cliente</th>
                                    <th>Mesero</th>
                                    <th>Método de Pago</th>
                                    <th className="text-right">Total</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedInvoices.map((invoice) => (
                                    <tr key={invoice.id}>
                                        <td className="invoice-number">{invoice.invoiceNumber}</td>
                                        <td>
                                            <div className="date-cell">
                                                <Calendar size={14} />
                                                {new Date(invoice.date).toLocaleDateString('es-ES')}
                                                <span className="time">
                                                    {new Date(invoice.date).toLocaleTimeString('es-ES', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
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
                                            <span className={`payment-badge payment-${invoice.paymentMethod.toLowerCase().replace(/\s+/g, '-')}`}>
                                                {invoice.paymentMethod}
                                            </span>
                                        </td>
                                        <td className="text-right font-semibold total-cell">
                                            {formatCurrency(invoice.total, settings)}
                                        </td>
                                        <td>
                                            <div className="action-buttons">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => void downloadPdf(invoice.id, invoice.invoiceNumber)}
                                                >
                                                    <Eye size={16} />
                                                    Ver PDF
                                                </Button>
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => void downloadPdf(invoice.id, invoice.invoiceNumber)}
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
                    <Pagination
                        page={page}
                        totalPages={totalPages}
                        totalItems={filteredInvoices.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </div>
    );
}
