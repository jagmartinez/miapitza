import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Eye, Calendar, User, CreditCard, RotateCcw } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import { ordersAPI, invoicesAPI, settingsAPI, paymentsAPI } from '../services/api';
import type { Order, Payment } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canReversePayment } from '../utils/authz';
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

function errorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object') {
        const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (message) return message;
    }
    return fallback;
}

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
};

function dateRangeForFilter(filter: string): { invoicedStartDate?: string; invoicedEndDate?: string } {
    const today = todayStr();
    switch (filter) {
        case 'today':
            return { invoicedStartDate: today, invoicedEndDate: today };
        case 'week': {
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return { invoicedStartDate: formatLocalDateInput(weekAgo), invoicedEndDate: today };
        }
        case 'month':
            return { invoicedStartDate: monthStartStr(), invoicedEndDate: today };
        default:
            return {};
    }
}

export default function InvoiceHistory() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError, warning: showWarning } = useAppToast();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dateFilter, setDateFilter] = useState('month');
    const [searchTerm, setSearchTerm] = useState('');
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [page, setPage] = useState(1);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [reversalPaymentId, setReversalPaymentId] = useState<number | null>(null);
    const [reversalReason, setReversalReason] = useState('');
    const [reversingPaymentId, setReversingPaymentId] = useState<number | null>(null);
    const mayReversePayments = canReversePayment(user);

    const loadSettings = useCallback(async () => {
        try {
            const res = await settingsAPI.getAll();
            setSettings(res.data.data);
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }, []);

    const loadInvoices = useCallback(async (showLoader = true) => {
        try {
            if (showLoader) setLoading(true);
            setError(null);
            const range = dateRangeForFilter(dateFilter);
            const response = await ordersAPI.getAll({
                invoicedOnly: true,
                limit: 200,
                ...range,
            });

            const rows = Array.isArray(response.data?.data) ? response.data.data : [];
            const invoiceData = rows
                .filter((order: Order) => Boolean(order.invoiceNumber))
                .map((order: Order) => ({
                    id: order.id,
                    invoiceNumber: order.invoiceNumber!,
                    date: order.invoicedAt || order.createdAt,
                    customerName: order.customerName,
                    waiterName: order.user?.name || 'N/A',
                    total: Number(order.total) || 0,
                    paymentMethod: order.payments?.find(payment => payment.status !== 'REVERSED')?.paymentMethod?.name
                        || order.payments?.[0]?.paymentMethod?.name
                        || 'N/A',
                    status: order.financialStatus,
                }));

            setInvoices(invoiceData);
        } catch (err) {
            console.error('Error loading invoices:', err);
            setError('No se pudieron cargar las facturas. Intente de nuevo.');
            setInvoices([]);
        } finally {
            if (showLoader) setLoading(false);
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
            await loadInvoices(false);
        } catch (err) {
            console.error('Error downloading invoice PDF:', err);
            setError('No se pudo descargar el PDF de la factura.');
        }
    };

    const openPaymentHistory = async (invoice: Invoice) => {
        setSelectedInvoice(invoice);
        setPayments([]);
        setReversalPaymentId(null);
        setReversalReason('');
        setPaymentsLoading(true);
        try {
            const response = await paymentsAPI.getByOrderId(invoice.id);
            setPayments(Array.isArray(response.data?.data) ? response.data.data : []);
        } catch (err) {
            showError(errorMessage(err, 'No se pudo consultar el historial de pagos.'));
        } finally {
            setPaymentsLoading(false);
        }
    };

    const closePaymentHistory = () => {
        if (reversingPaymentId !== null) return;
        setSelectedInvoice(null);
        setPayments([]);
        setReversalPaymentId(null);
        setReversalReason('');
    };

    const beginReversal = (paymentId: number) => {
        setReversalPaymentId(paymentId);
        setReversalReason('');
    };

    const reversePayment = async (payment: Payment) => {
        if (!selectedInvoice || !mayReversePayments || payment.status === 'REVERSED') return;

        const reason = reversalReason.trim();
        if (!reason) {
            showWarning('El motivo del reverso es obligatorio.');
            return;
        }

        const accepted = await confirm(
            `¿Revertir el pago #${payment.id} por ${formatCurrency(Number(payment.amount), settings)}? La factura ${selectedInvoice.invoiceNumber} se conservará emitida.`,
            {
                title: 'Confirmar reverso de pago',
                confirmText: 'Revertir pago',
                variant: 'danger',
            },
        );
        if (!accepted) return;

        setReversingPaymentId(payment.id);
        try {
            await paymentsAPI.reverse(payment.id, reason);
            const [paymentsResponse] = await Promise.all([
                paymentsAPI.getByOrderId(selectedInvoice.id),
                loadInvoices(false),
            ]);
            setPayments(Array.isArray(paymentsResponse.data?.data) ? paymentsResponse.data.data : []);
            setReversalPaymentId(null);
            setReversalReason('');
            showSuccess('Pago revertido correctamente. La factura emitida fue preservada.');
        } catch (err) {
            showError(errorMessage(err, 'No se pudo revertir el pago.'));
        } finally {
            setReversingPaymentId(null);
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
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => void openPaymentHistory(invoice)}
                                                >
                                                    <CreditCard size={16} />
                                                    Pagos
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

            <Modal
                isOpen={selectedInvoice !== null}
                onClose={closePaymentHistory}
                title={`Pagos de ${selectedInvoice?.invoiceNumber || ''}`}
                size="lg"
                closeOnBackdrop={reversingPaymentId === null}
                closeOnEscape={reversingPaymentId === null}
                description="Historial financiero inmutable de la orden. Los pagos revertidos permanecen visibles para auditoría."
                footer={(
                    <Button variant="ghost" onClick={closePaymentHistory} disabled={reversingPaymentId !== null}>
                        Cerrar
                    </Button>
                )}
            >
                {paymentsLoading ? (
                    <LoadingSpinner size="md" text="Cargando pagos..." />
                ) : payments.length === 0 ? (
                    <EmptyState
                        icon={<CreditCard size={48} />}
                        title="Sin pagos registrados"
                        description="Esta factura no tiene movimientos de pago disponibles."
                    />
                ) : (
                    <div className="invoice-payments-list">
                        {payments.map(payment => {
                            const reversed = payment.status === 'REVERSED';
                            const editingReversal = reversalPaymentId === payment.id;
                            const paymentDate = payment.createdAt ? new Date(payment.createdAt) : null;
                            const reversedDate = payment.reversedAt ? new Date(payment.reversedAt) : null;

                            return (
                                <article className="invoice-payment-card" key={payment.id}>
                                    <div className="invoice-payment-card-header">
                                        <strong>Pago #{payment.id}</strong>
                                        <span className={`invoice-payment-status ${reversed ? 'is-reversed' : 'is-active'}`}>
                                            {reversed ? 'Revertido' : 'Activo'}
                                        </span>
                                    </div>
                                    <dl className="invoice-payment-details">
                                        <div>
                                            <dt>Método</dt>
                                            <dd>{payment.paymentMethod?.name || 'No disponible'}</dd>
                                        </div>
                                        <div>
                                            <dt>Monto</dt>
                                            <dd className="invoice-payment-amount">{formatCurrency(Number(payment.amount), settings)}</dd>
                                        </div>
                                        <div>
                                            <dt>Pagador</dt>
                                            <dd>{payment.payerName || 'No indicado'}</dd>
                                        </div>
                                        <div>
                                            <dt>Referencia</dt>
                                            <dd>{payment.reference || 'Sin referencia'}</dd>
                                        </div>
                                        <div>
                                            <dt>Fecha</dt>
                                            <dd>
                                                {paymentDate && !Number.isNaN(paymentDate.getTime())
                                                    ? paymentDate.toLocaleString('es-NI')
                                                    : 'No disponible'}
                                            </dd>
                                        </div>
                                    </dl>

                                    {reversed && (
                                        <div className="invoice-payment-reversal-audit">
                                            <strong>Motivo:</strong> {payment.reversalReason || 'No disponible'}
                                            {reversedDate && !Number.isNaN(reversedDate.getTime()) && (
                                                <span>Revertido el {reversedDate.toLocaleString('es-NI')}</span>
                                            )}
                                        </div>
                                    )}

                                    {!reversed && mayReversePayments && !editingReversal && (
                                        <div className="invoice-payment-actions">
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => beginReversal(payment.id)}
                                                disabled={reversingPaymentId !== null}
                                            >
                                                <RotateCcw size={15} />
                                                Revertir pago
                                            </Button>
                                        </div>
                                    )}

                                    {!reversed && mayReversePayments && editingReversal && (
                                        <div className="invoice-payment-reversal-form">
                                            <label htmlFor={`payment-reversal-reason-${payment.id}`}>
                                                Motivo del reverso <span aria-hidden="true">*</span>
                                            </label>
                                            <textarea
                                                id={`payment-reversal-reason-${payment.id}`}
                                                value={reversalReason}
                                                onChange={event => setReversalReason(event.target.value)}
                                                placeholder="Ej.: cobro duplicado o medio de pago incorrecto"
                                                maxLength={500}
                                                rows={3}
                                                disabled={reversingPaymentId !== null}
                                                autoFocus
                                            />
                                            <div className="invoice-payment-reversal-buttons">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setReversalPaymentId(null);
                                                        setReversalReason('');
                                                    }}
                                                    disabled={reversingPaymentId !== null}
                                                >
                                                    Cancelar
                                                </Button>
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    onClick={() => void reversePayment(payment)}
                                                    disabled={!reversalReason.trim() || reversingPaymentId !== null}
                                                >
                                                    <RotateCcw size={15} />
                                                    {reversingPaymentId === payment.id ? 'Revirtiendo...' : 'Continuar'}
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                )}
            </Modal>
        </div>
    );
}
