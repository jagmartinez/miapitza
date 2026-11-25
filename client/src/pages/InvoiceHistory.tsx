import { useState, useEffect, useCallback } from 'react';
import { FileText, Download, Eye, Calendar, User, CreditCard, RotateCcw } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import Pagination from '../components/Pagination';
import { ordersAPI, invoicesAPI, settingsAPI, paymentsAPI, warehousesAPI } from '../services/api';
import type { Order, Payment, Warehouse } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canReversePayment, canCancelInvoice, canIssueCreditNote } from '../utils/authz';
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
    orderStatus: Order['status'];
    branchId: number;
    fiscalStatus: NonNullable<Order['invoiceFiscalStatus']>;
    creditNoteNumber?: string;
    cancellationReason?: string;
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
    const mayCancelInvoice = canCancelInvoice(user);
    const mayIssueCreditNote = canIssueCreditNote(user);
    const [fiscalInvoice, setFiscalInvoice] = useState<Invoice | null>(null);
    const [fiscalAction, setFiscalAction] = useState<'CANCEL' | 'CREDIT_NOTE' | null>(null);
    const [fiscalReason, setFiscalReason] = useState('');
    const [inventoryAction, setInventoryAction] = useState<'NO_RETURN' | 'RETURN_TO_STOCK'>('NO_RETURN');
    const [creditMode, setCreditMode] = useState<'FULL' | 'PARTIAL'>('FULL');
    const [creditOrderItems, setCreditOrderItems] = useState<Order['items']>([]);
    const [creditQuantities, setCreditQuantities] = useState<Record<number, number>>({});
    const [externalRefundReferences, setExternalRefundReferences] = useState<Record<number, string>>({});
    const [fiscalWarehouses, setFiscalWarehouses] = useState<Warehouse[]>([]);
    const [fiscalWasteWarehouseId, setFiscalWasteWarehouseId] = useState<number | null>(null);
    const [fiscalIdempotencyKey, setFiscalIdempotencyKey] = useState('');
    const [fiscalProcessing, setFiscalProcessing] = useState(false);

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
                    orderStatus: order.status,
                    branchId: order.branchId,
                    fiscalStatus: order.invoiceFiscalStatus || 'ISSUED',
                    creditNoteNumber: order.fiscalCreditNote?.number,
                    cancellationReason: order.fiscalInvoiceCancellation?.reason,
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

    const closeFiscalAction = () => {
        setFiscalInvoice(null);
        setFiscalAction(null);
        setFiscalReason('');
        setInventoryAction('NO_RETURN');
        setCreditMode('FULL');
        setCreditOrderItems([]);
        setCreditQuantities({});
        setExternalRefundReferences({});
        setFiscalWarehouses([]);
        setFiscalWasteWarehouseId(null);
        setFiscalIdempotencyKey('');
        setPayments([]);
    };

    const openFiscalAction = async (invoice: Invoice, action: 'CANCEL' | 'CREDIT_NOTE') => {
        setFiscalInvoice(invoice);
        setFiscalAction(action);
        setFiscalReason('');
        setInventoryAction('NO_RETURN');
        setCreditMode('FULL');
        setCreditOrderItems([]);
        setCreditQuantities({});
        setFiscalWasteWarehouseId(null);
        setFiscalWarehouses([]);
        setExternalRefundReferences({});
        setFiscalIdempotencyKey(globalThis.crypto?.randomUUID?.() || `fiscal-${invoice.id}-${Date.now()}`);
        setPaymentsLoading(true);
        try {
            const [paymentsResponse, orderResponse] = await Promise.all([
                paymentsAPI.getByOrderId(invoice.id),
                action === 'CREDIT_NOTE' ? ordersAPI.getById(invoice.id) : Promise.resolve(null)
            ]);
            const activePayments = (Array.isArray(paymentsResponse.data?.data) ? paymentsResponse.data.data : [])
                .filter((payment: Payment) => payment.status !== 'REVERSED');
            setPayments(activePayments);
            if (action === 'CREDIT_NOTE') {
                const items = (orderResponse?.data?.data?.items || []) as Order['items'];
                setCreditOrderItems(items);
            }
            if (action === 'CANCEL' && invoice.orderStatus !== 'OPEN') {
                const warehousesResponse = await warehousesAPI.getAll();
                const warehouses = (Array.isArray(warehousesResponse.data?.data) ? warehousesResponse.data.data : [])
                    .filter((warehouse: Warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === invoice.branchId);
                setFiscalWarehouses(warehouses);
                if (warehouses.length === 1) setFiscalWasteWarehouseId(warehouses[0].id);
            }
        } catch (err) {
            showError(errorMessage(err, 'No se pudo preparar el contraflujo fiscal.'));
            closeFiscalAction();
        } finally {
            setPaymentsLoading(false);
        }
    };

    const downloadCounterDocument = async (invoice: Invoice, action: 'CANCEL' | 'CREDIT_NOTE') => {
        const response = action === 'CANCEL'
            ? await invoicesAPI.downloadCancellationPdf(invoice.id)
            : await invoicesAPI.downloadCreditNotePdf(invoice.id);
        const name = action === 'CANCEL'
            ? `anulacion-${invoice.invoiceNumber}`
            : (invoice.creditNoteNumber || `nota-credito-${invoice.invoiceNumber}`);
        const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const submitFiscalAction = async () => {
        if (!fiscalInvoice || !fiscalAction || fiscalReason.trim().length < 5 || !fiscalIdempotencyKey) {
            showWarning('Indica un motivo de al menos 5 caracteres.');
            return;
        }
        if (fiscalAction === 'CANCEL' && fiscalInvoice.orderStatus !== 'OPEN' && !fiscalWasteWarehouseId) {
            showWarning('Selecciona la bodega donde se registrará la merma de cocina.');
            return;
        }
        const nonCashPayments = payments.filter((payment) => payment.status !== 'REVERSED' && payment.paymentMethod?.type !== 'CASH');
        const partialLines = creditOrderItems
            .map((item) => ({ orderItemId: item.id, quantity: Math.trunc(creditQuantities[item.id] || 0) }))
            .filter((line) => line.quantity > 0);
        if (fiscalAction === 'CREDIT_NOTE' && creditMode === 'PARTIAL' && partialLines.length === 0) {
            showWarning('Selecciona al menos una cantidad para la nota parcial.');
            return;
        }
        if (fiscalAction === 'CREDIT_NOTE' && nonCashPayments.some((payment) => !externalRefundReferences[payment.id]?.trim())) {
            showWarning('Cada pago no efectivo requiere la referencia real del reembolso externo.');
            return;
        }
        setFiscalProcessing(true);
        try {
            if (fiscalAction === 'CANCEL') {
                await invoicesAPI.cancel(fiscalInvoice.id, {
                    idempotencyKey: fiscalIdempotencyKey,
                    reason: fiscalReason.trim(),
                    ...(fiscalWasteWarehouseId ? { wasteWarehouseId: fiscalWasteWarehouseId } : {})
                });
            } else {
                await invoicesAPI.issueCreditNote(fiscalInvoice.id, {
                    idempotencyKey: fiscalIdempotencyKey,
                    reason: fiscalReason.trim(),
                    inventoryAction,
                    externalRefunds: nonCashPayments.map((payment) => ({
                        paymentId: payment.id,
                        reference: externalRefundReferences[payment.id].trim()
                    })),
                    ...(creditMode === 'PARTIAL' ? { lines: partialLines } : {})
                });
            }
            await downloadCounterDocument(fiscalInvoice, fiscalAction);
            await loadInvoices(false);
            showSuccess(fiscalAction === 'CANCEL' ? 'Factura anulada con trazabilidad.' : 'Nota de crédito emitida y conciliada.');
            closeFiscalAction();
        } catch (err) {
            showError(errorMessage(err, 'No se pudo completar el contraflujo fiscal.'));
        } finally {
            setFiscalProcessing(false);
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
                                    <th>Estado fiscal</th>
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
                                            <span className={`invoice-payment-status ${invoice.fiscalStatus === 'ISSUED' ? 'is-active' : 'is-reversed'}`}>
                                                {invoice.fiscalStatus === 'CREDITED'
                                                    ? `Acreditada · ${invoice.creditNoteNumber || ''}`
                                                    : invoice.fiscalStatus === 'PARTIALLY_CREDITED'
                                                        ? `Acreditada parcialmente · ${invoice.creditNoteNumber || ''}`
                                                    : invoice.fiscalStatus === 'CANCELLED'
                                                        ? 'Anulada'
                                                        : 'Emitida'}
                                            </span>
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
                                                {invoice.fiscalStatus === 'ISSUED' && invoice.status === 'UNPAID'
                                                    && invoice.orderStatus !== 'DELIVERED' && mayCancelInvoice && (
                                                    <Button variant="danger" size="sm" onClick={() => void openFiscalAction(invoice, 'CANCEL')}>
                                                        <RotateCcw size={15} /> Anular factura
                                                    </Button>
                                                )}
                                                {['ISSUED', 'PARTIALLY_CREDITED'].includes(invoice.fiscalStatus)
                                                    && ['PAID', 'PARTIAL'].includes(invoice.status)
                                                    && invoice.orderStatus === 'DELIVERED' && mayIssueCreditNote && (
                                                    <Button variant="danger" size="sm" onClick={() => void openFiscalAction(invoice, 'CREDIT_NOTE')}>
                                                        <RotateCcw size={15} /> {invoice.fiscalStatus === 'PARTIALLY_CREDITED' ? 'Otra nota' : 'Nota de crédito'}
                                                    </Button>
                                                )}
                                                {['PARTIALLY_CREDITED', 'CREDITED'].includes(invoice.fiscalStatus) && (
                                                    <Button variant="secondary" size="sm" onClick={() => void downloadCounterDocument(invoice, 'CREDIT_NOTE')}>
                                                        <Download size={15} /> Nota de crédito
                                                    </Button>
                                                )}
                                                {invoice.fiscalStatus === 'CANCELLED' && (
                                                    <Button variant="secondary" size="sm" onClick={() => void downloadCounterDocument(invoice, 'CANCEL')}>
                                                        <Download size={15} /> Constancia
                                                    </Button>
                                                )}
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

            <Modal
                isOpen={fiscalInvoice !== null && fiscalAction !== null}
                onClose={closeFiscalAction}
                title={fiscalAction === 'CANCEL'
                    ? `Anular factura ${fiscalInvoice?.invoiceNumber || ''}`
                    : `Emitir nota de crédito para ${fiscalInvoice?.invoiceNumber || ''}`}
                size="lg"
                closeOnBackdrop={!fiscalProcessing}
                closeOnEscape={!fiscalProcessing}
                description={fiscalAction === 'CANCEL'
                    ? 'Solo aplica antes de pago y entrega. El número original se conserva como anulado.'
                    : 'Solo aplica a una venta pagada y entregada. Revierte pagos y registra por separado el hecho físico.'}
                footer={(
                    <>
                        <Button variant="ghost" onClick={closeFiscalAction} disabled={fiscalProcessing}>Volver</Button>
                        <Button variant="danger" onClick={() => void submitFiscalAction()} disabled={fiscalProcessing || paymentsLoading}>
                            {fiscalProcessing ? 'Procesando…' : fiscalAction === 'CANCEL' ? 'Confirmar anulación' : 'Emitir nota de crédito'}
                        </Button>
                    </>
                )}
            >
                {paymentsLoading ? (
                    <LoadingSpinner size="md" text="Validando contraflujo..." />
                ) : (
                    <div className="invoice-payment-reversal-form">
                        <label htmlFor="fiscal-action-reason">Motivo obligatorio</label>
                        <textarea
                            id="fiscal-action-reason"
                            value={fiscalReason}
                            onChange={(event) => setFiscalReason(event.target.value)}
                            minLength={5}
                            maxLength={500}
                            rows={3}
                            disabled={fiscalProcessing}
                            placeholder="Describe el hecho que origina el documento fiscal"
                        />

                        {fiscalAction === 'CANCEL' && fiscalInvoice?.orderStatus !== 'OPEN' && (
                            <label htmlFor="fiscal-waste-warehouse">
                                Bodega donde se registrará la merma de lo preparado
                                <select
                                    id="fiscal-waste-warehouse"
                                    value={fiscalWasteWarehouseId || ''}
                                    onChange={(event) => setFiscalWasteWarehouseId(event.target.value ? Number(event.target.value) : null)}
                                    disabled={fiscalProcessing}
                                >
                                    <option value="">Seleccionar bodega</option>
                                    {fiscalWarehouses.map((warehouse) => (
                                        <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.code})</option>
                                    ))}
                                </select>
                            </label>
                        )}

                        {fiscalAction === 'CREDIT_NOTE' && (
                            <>
                                <label htmlFor="credit-note-scope">
                                    Alcance de la nota
                                    <select
                                        id="credit-note-scope"
                                        value={creditMode}
                                        onChange={(event) => setCreditMode(event.target.value as 'FULL' | 'PARTIAL')}
                                        disabled={fiscalProcessing}
                                    >
                                        <option value="FULL">Todo el saldo pendiente</option>
                                        <option value="PARTIAL">Cantidades parciales por línea</option>
                                    </select>
                                </label>
                                {creditMode === 'PARTIAL' && (
                                    <div className="invoice-credit-note-lines">
                                        {creditOrderItems.map((item) => (
                                            <label key={item.id} htmlFor={`credit-line-${item.id}`}>
                                                {item.menuItem?.name || `Artículo #${item.id}`} · facturado {item.quantity}
                                                <input
                                                    id={`credit-line-${item.id}`}
                                                    type="number"
                                                    min={0}
                                                    max={item.quantity}
                                                    step={1}
                                                    value={creditQuantities[item.id] || ''}
                                                    onChange={(event) => setCreditQuantities((current) => ({
                                                        ...current,
                                                        [item.id]: Math.max(0, Math.min(item.quantity, Math.trunc(Number(event.target.value) || 0)))
                                                    }))}
                                                    disabled={fiscalProcessing}
                                                />
                                            </label>
                                        ))}
                                        <p className="invoice-payment-reversal-audit">
                                            El servidor valida el acumulado ya acreditado y rechazará cantidades que excedan la factura.
                                        </p>
                                    </div>
                                )}
                                <label htmlFor="credit-note-inventory-action">
                                    Hecho físico de inventario
                                    <select
                                        id="credit-note-inventory-action"
                                        value={inventoryAction}
                                        onChange={(event) => setInventoryAction(event.target.value as 'NO_RETURN' | 'RETURN_TO_STOCK')}
                                        disabled={fiscalProcessing}
                                    >
                                        <option value="NO_RETURN">Producto no retornado: no reponer inventario</option>
                                        <option value="RETURN_TO_STOCK">Producto devuelto: reponer consumo en bodega original</option>
                                    </select>
                                </label>
                                {payments.filter((payment) => payment.paymentMethod?.type !== 'CASH').map((payment) => (
                                    <label key={payment.id} htmlFor={`external-refund-${payment.id}`}>
                                        Referencia de reembolso externo · Pago #{payment.id} ({payment.paymentMethod?.name})
                                        <input
                                            id={`external-refund-${payment.id}`}
                                            value={externalRefundReferences[payment.id] || ''}
                                            maxLength={191}
                                            onChange={(event) => setExternalRefundReferences((current) => ({ ...current, [payment.id]: event.target.value }))}
                                            disabled={fiscalProcessing}
                                            placeholder="Referencia confirmada por banco/procesador"
                                        />
                                    </label>
                                ))}
                                <p className="invoice-payment-reversal-audit">
                                    Los pagos en efectivo exigen un turno de caja abierto y generan un egreso compensatorio. Los pagos no efectivos no se marcarán revertidos sin referencia externa.
                                </p>
                            </>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
