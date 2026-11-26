import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { Download, CreditCard, RotateCcw } from 'lucide-react';
import {
    AppSelect, Badge, Button, DataTable, Field, FormGrid, FormSection, FullScreenModal, Input, NumberInput,
    PageContent, PageHeader, SegmentedControl, TableToolbar, Textarea, formatMoney,
    type Column,
} from '@/ui';
import { ordersAPI, invoicesAPI, settingsAPI, paymentsAPI, warehousesAPI } from '../services/api';
import type { Order, Payment, Warehouse } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { canReversePayment, canCancelInvoice, canIssueCreditNote } from '../utils/authz';
import type { CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import styles from './compras.module.css';
import { readServerPagination } from '../utils/serverPagination';
import { useDebounce } from '../utils/useDebounce';

const PAGE_SIZE = 20;

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
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError, warning: showWarning } = useAppToast();
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dateFilter, setDateFilter] = useState('month');
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm.trim(), 350);
    const [pageAmount, setPageAmount] = useState(0);
    const [aggregateAmount, setAggregateAmount] = useState<number | null>(null);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const symbol = settings.currency_symbol || 'C$';
    const [page, setPage] = useState(1);
    const [totalInvoices, setTotalInvoices] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
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
            notifyError(err, 'No se pudo cargar la configuración; los montos usan el formato predeterminado', { type: 'warning' });
        }
    }, []);

    // Full-page loader only until the first response: later searches/page changes
    // refresh in place so the search box keeps focus while the user types.
    const hasLoadedInvoicesRef = useRef(false);
    const loadInvoicesRequestRef = useRef(0);
    const loadInvoices = useCallback(async (requestLoader = true) => {
        const requestId = ++loadInvoicesRequestRef.current;
        const showLoader = requestLoader && !hasLoadedInvoicesRef.current;
        try {
            if (showLoader) setLoading(true);
            setError(null);
            const range = dateRangeForFilter(dateFilter);
            // Server-side pagination + search: totals come from the server so the
            // header reflects the whole filtered set, not just the visible page.
            const response = await invoicesAPI.list({
                page,
                limit: PAGE_SIZE,
                ...(debouncedSearch ? { search: debouncedSearch } : {}),
                ...range,
            });

            // A late response for an older search/page must not overwrite newer results.
            if (requestId !== loadInvoicesRequestRef.current) return;
            hasLoadedInvoicesRef.current = true;
            const rows = Array.isArray(response.data?.data) ? response.data.data : [];
            const pagination = readServerPagination(response.data, rows.length, PAGE_SIZE, page);
            setTotalInvoices(pagination.total);
            setTotalPages(pagination.totalPages);
            if (page > pagination.totalPages) setPage(pagination.totalPages);
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
            const totals = response.data?.totals as { pageTotal?: number; aggregateNetTotal?: number; aggregateTotal?: number } | undefined;
            setPageAmount(Number(totals?.pageTotal ?? invoiceData.reduce((sum: number, inv: Invoice) => sum + inv.total, 0)) || 0);
            const aggregate = totals?.aggregateNetTotal ?? totals?.aggregateTotal;
            setAggregateAmount(aggregate === undefined ? null : Number(aggregate) || 0);
        } catch (err) {
            if (requestId !== loadInvoicesRequestRef.current) return;
            console.error('Error loading invoices:', err);
            setError(getApiErrorMessage(err, 'No se pudieron cargar las facturas'));
            setInvoices([]);
            setTotalInvoices(0);
            setTotalPages(1);
            setPageAmount(0);
            setAggregateAmount(null);
        } finally {
            if (showLoader && requestId === loadInvoicesRequestRef.current) setLoading(false);
        }
    }, [dateFilter, page, debouncedSearch]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        void loadInvoices();
    }, [loadInvoices]);

    useEffect(() => {
        setPage(1);
    }, [dateFilter, debouncedSearch]);

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
            setError(getApiErrorMessage(err, 'No se pudo descargar el PDF de la factura.'));
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
            `¿Revertir el pago #${payment.id} por ${formatMoney(Number(payment.amount), symbol)}? La factura ${selectedInvoice.invoiceNumber} se conservará emitida.`,
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

    // Search (invoice number / customer / NIT) runs server-side across all pages.
    const filteredInvoices = invoices;

    const fiscalLabel = (invoice: Invoice) => (
        invoice.fiscalStatus === 'CREDITED'
            ? `Acreditada · ${invoice.creditNoteNumber || ''}`
            : invoice.fiscalStatus === 'PARTIALLY_CREDITED'
                ? `Acreditada parcialmente · ${invoice.creditNoteNumber || ''}`
                : invoice.fiscalStatus === 'CANCELLED'
                    ? 'Anulada'
                    : 'Emitida'
    );

    const columns: Column<Invoice>[] = [
        { key: 'invoiceNumber', header: 'Número', width: '1.2fr' },
        {
            key: 'date', header: 'Fecha', width: '1.3fr',
            render: (invoice) => {
                const d = new Date(invoice.date);
                return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
            },
        },
        { key: 'customer', header: 'Cliente', width: '1.4fr', hideBelow: 'md', render: (invoice) => invoice.customerName || 'Cliente General' },
        { key: 'waiterName', header: 'Mesero', width: '1.2fr', hideBelow: 'lg' },
        { key: 'paymentMethod', header: 'Método de Pago', width: '1.1fr', hideBelow: 'lg', render: (invoice) => <Badge>{invoice.paymentMethod}</Badge> },
        { key: 'total', header: `Total (${symbol})`, width: '1fr', type: 'money' },
        {
            key: 'fiscalStatus', header: 'Estado fiscal', width: '1.4fr',
            render: (invoice) => (
                <Badge tone={invoice.fiscalStatus === 'ISSUED' ? 'success' : invoice.fiscalStatus === 'CANCELLED' ? 'neutral' : 'warning'} dot>
                    {fiscalLabel(invoice)}
                </Badge>
            ),
        },
        {
            key: 'actions', header: 'Acciones', width: '3fr', type: 'actions',
            render: (invoice) => (
                <span className={styles.rowActions}>
                    <Button size="sm" icon={Download} onClick={() => void downloadPdf(invoice.id, invoice.invoiceNumber)}>
                        PDF
                    </Button>
                    <Button variant="ghost" size="sm" icon={CreditCard} onClick={() => void openPaymentHistory(invoice)}>
                        Pagos
                    </Button>
                    {invoice.fiscalStatus === 'ISSUED' && invoice.status === 'UNPAID'
                        && invoice.orderStatus !== 'DELIVERED' && mayCancelInvoice && (
                        <Button variant="danger" size="sm" icon={RotateCcw} onClick={() => void openFiscalAction(invoice, 'CANCEL')}>
                            Anular factura
                        </Button>
                    )}
                    {['ISSUED', 'PARTIALLY_CREDITED'].includes(invoice.fiscalStatus)
                        && ['PAID', 'PARTIAL'].includes(invoice.status)
                        && invoice.orderStatus === 'DELIVERED' && mayIssueCreditNote && (
                        <Button variant="danger" size="sm" icon={RotateCcw} onClick={() => void openFiscalAction(invoice, 'CREDIT_NOTE')}>
                            {invoice.fiscalStatus === 'PARTIALLY_CREDITED' ? 'Otra nota' : 'Nota de crédito'}
                        </Button>
                    )}
                    {['PARTIALLY_CREDITED', 'CREDITED'].includes(invoice.fiscalStatus) && (
                        <Button size="sm" icon={Download} onClick={() => void downloadCounterDocument(invoice, 'CREDIT_NOTE')}>
                            Nota de crédito
                        </Button>
                    )}
                    {invoice.fiscalStatus === 'CANCELLED' && (
                        <Button size="sm" icon={Download} onClick={() => void downloadCounterDocument(invoice, 'CANCEL')}>
                            Constancia
                        </Button>
                    )}
                </span>
            ),
        },
    ];

    const DATE_FILTERS = [
        { value: 'today', label: 'Hoy' },
        { value: 'week', label: 'Última Semana' },
        { value: 'month', label: 'Este Mes' },
        { value: 'all', label: 'Todas' },
    ];

    const nonCashFiscalPayments = payments.filter((payment) => payment.paymentMethod?.type !== 'CASH');
    const fiscalDirty = fiscalReason.trim() !== '' || Object.values(externalRefundReferences).some((v) => v.trim() !== '')
        || Object.values(creditQuantities).some((v) => v > 0);

    return (
        <PageContent>
            <PageHeader
                title="Historial de Facturas"
                description={loading || error
                    ? undefined
                    : (
                        <>
                            {totalInvoices} facturas
                            {aggregateAmount !== null && (
                                <> • Total del período: <span className={styles.nowrap}>{formatMoney(aggregateAmount, symbol)}</span></>
                            )}
                            {(aggregateAmount === null || totalPages > 1) && (
                                <> • Total en esta página: <span className={styles.nowrap}>{formatMoney(pageAmount, symbol)}</span></>
                            )}
                        </>
                    )}
            />

            {error && (
                <div className={styles.alert} role="alert">
                    <span className={styles.inline}>
                        {error}
                        <Button size="sm" onClick={() => void loadInvoices()}>Reintentar</Button>
                    </span>
                </div>
            )}

            <DataTable
                ariaLabel="Facturas"
                columns={columns}
                rows={filteredInvoices}
                rowKey={(invoice) => invoice.id}
                loading={loading}
                resetKey={`${dateFilter}|${debouncedSearch}`}
                pagination={{ mode: 'server', page, pageSize: PAGE_SIZE, total: totalInvoices, onChange: (nextPage) => setPage(nextPage) }}
                pageSizeOptions={[PAGE_SIZE]}
                empty={error
                    ? 'No disponible: las facturas no se pudieron cargar.'
                    : 'No se encontraron facturas pagadas en el período seleccionado. Prueba ampliar el filtro a «Este Mes» o «Todas».'}
                toolbar={(
                    <TableToolbar>
                        <div className={styles.filters}>
                            <SegmentedControl
                                ariaLabel="Período"
                                options={DATE_FILTERS}
                                value={dateFilter}
                                onChange={setDateFilter}
                            />
                            <div className={`${styles.filterField} ${styles.search}`}>
                                <label htmlFor="invoice-search">Buscar</label>
                                <Input
                                    id="invoice-search"
                                    type="search"
                                    aria-label="Buscar facturas por número, cliente o NIT"
                                    placeholder="Buscar por número, cliente o NIT..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={selectedInvoice !== null}
                onClose={closePaymentHistory}
                title={`Pagos de ${selectedInvoice?.invoiceNumber || ''}`}
                subtitle="Historial financiero inmutable de la orden. Los pagos revertidos permanecen visibles para auditoría."
                footer={(
                    <Button onClick={closePaymentHistory} disabled={reversingPaymentId !== null}>
                        Cerrar
                    </Button>
                )}
            >
                {paymentsLoading ? (
                    <p role="status">Cargando pagos...</p>
                ) : payments.length === 0 ? (
                    <p className={styles.muted}>Sin pagos registrados. Esta factura no tiene movimientos de pago disponibles.</p>
                ) : (
                    <div>
                        {payments.map(payment => {
                            const reversed = payment.status === 'REVERSED';
                            const editingReversal = reversalPaymentId === payment.id;
                            const paymentDate = payment.createdAt ? new Date(payment.createdAt) : null;
                            const reversedDate = payment.reversedAt ? new Date(payment.reversedAt) : null;

                            return (
                                <article className={`${styles.paymentCard} ${reversed ? styles.reversed : ''}`} key={payment.id}>
                                    <div className={styles.summaryRow}>
                                        <strong>Pago #{payment.id}</strong>
                                        <Badge tone={reversed ? 'danger' : 'success'} dot>{reversed ? 'Revertido' : 'Activo'}</Badge>
                                    </div>
                                    <dl className={styles.details}>
                                        <div>
                                            <dt>Método</dt>
                                            <dd>{payment.paymentMethod?.name || 'No disponible'}</dd>
                                        </div>
                                        <div>
                                            <dt>Monto</dt>
                                            <dd className={styles.num}>{formatMoney(Number(payment.amount), symbol)}</dd>
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
                                        <p className={styles.muted}>
                                            <strong>Motivo:</strong> {payment.reversalReason || 'No disponible'}
                                            {reversedDate && !Number.isNaN(reversedDate.getTime()) && (
                                                <span> · Revertido el {reversedDate.toLocaleString('es-NI')}</span>
                                            )}
                                        </p>
                                    )}

                                    {!reversed && mayReversePayments && !editingReversal && (
                                        <div>
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                icon={RotateCcw}
                                                onClick={() => beginReversal(payment.id)}
                                                disabled={reversingPaymentId !== null}
                                            >
                                                Revertir pago
                                            </Button>
                                        </div>
                                    )}

                                    {!reversed && mayReversePayments && editingReversal && (
                                        <div className={styles.stack}>
                                            <Field label="Motivo del reverso" htmlFor={`payment-reversal-reason-${payment.id}`} required>
                                                <Textarea
                                                    id={`payment-reversal-reason-${payment.id}`}
                                                    value={reversalReason}
                                                    onChange={event => setReversalReason(event.target.value)}
                                                    placeholder="Ej.: cobro duplicado o medio de pago incorrecto"
                                                    maxLength={500}
                                                    disabled={reversingPaymentId !== null}
                                                    autoFocus
                                                />
                                            </Field>
                                            <div className={styles.inline}>
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
                                                    icon={RotateCcw}
                                                    onClick={() => void reversePayment(payment)}
                                                    disabled={!reversalReason.trim() || reversingPaymentId !== null}
                                                >
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
            </FullScreenModal>

            <FullScreenModal
                isOpen={fiscalInvoice !== null && fiscalAction !== null}
                onClose={fiscalProcessing ? () => undefined : closeFiscalAction}
                title={fiscalAction === 'CANCEL'
                    ? `Anular factura ${fiscalInvoice?.invoiceNumber || ''}`
                    : `Emitir nota de crédito para ${fiscalInvoice?.invoiceNumber || ''}`}
                subtitle={fiscalAction === 'CANCEL'
                    ? 'Solo aplica antes de pago y entrega. El número original se conserva como anulado.'
                    : 'Solo aplica a una venta pagada y entregada. Revierte pagos y registra por separado el hecho físico.'}
                dirty={fiscalDirty && !fiscalProcessing}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose} disabled={fiscalProcessing}>Volver</Button>
                        <Button variant="danger" onClick={() => void submitFiscalAction()} loading={fiscalProcessing} disabled={fiscalProcessing || paymentsLoading}>
                            {fiscalProcessing ? 'Procesando…' : fiscalAction === 'CANCEL' ? 'Confirmar anulación' : 'Emitir nota de crédito'}
                        </Button>
                    </>
                )}
            >
                {paymentsLoading ? (
                    <p role="status">Validando contraflujo...</p>
                ) : (
                    <div className={styles.stack}>
                        <FormSection step={1} title="Motivo">
                            <Field label="Motivo obligatorio" htmlFor="fiscal-action-reason" required>
                                <Textarea
                                    id="fiscal-action-reason"
                                    value={fiscalReason}
                                    onChange={(event) => setFiscalReason(event.target.value)}
                                    minLength={5}
                                    maxLength={500}
                                    disabled={fiscalProcessing}
                                    placeholder="Describe el hecho que origina el documento fiscal"
                                />
                            </Field>
                        </FormSection>

                        {fiscalAction === 'CANCEL' && fiscalInvoice?.orderStatus !== 'OPEN' && (
                            <FormSection step={2} title="Merma de cocina">
                                <Field label="Bodega donde se registrará la merma de lo preparado" htmlFor="fiscal-waste-warehouse" required>
                                    <AppSelect<number>
                                        inputId="fiscal-waste-warehouse"
                                        options={fiscalWarehouses.map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                                        value={fiscalWasteWarehouseId}
                                        onChange={(v) => setFiscalWasteWarehouseId(v)}
                                        isDisabled={fiscalProcessing}
                                        placeholder="Seleccionar bodega"
                                    />
                                </Field>
                            </FormSection>
                        )}

                        {fiscalAction === 'CREDIT_NOTE' && (
                            <FormSection step={2} title="Alcance y hecho físico">
                                <FormGrid>
                                    <Field label="Alcance de la nota" htmlFor="credit-note-scope">
                                        <AppSelect<string>
                                            inputId="credit-note-scope"
                                            options={[
                                                { value: 'FULL', label: 'Todo el saldo pendiente' },
                                                { value: 'PARTIAL', label: 'Cantidades parciales por línea' },
                                            ]}
                                            value={creditMode}
                                            onChange={(v) => setCreditMode((v ?? 'FULL') as 'FULL' | 'PARTIAL')}
                                            isDisabled={fiscalProcessing}
                                        />
                                    </Field>
                                    <Field label="Hecho físico de inventario" htmlFor="credit-note-inventory-action">
                                        <AppSelect<string>
                                            inputId="credit-note-inventory-action"
                                            options={[
                                                { value: 'NO_RETURN', label: 'Producto no retornado: no reponer inventario' },
                                                { value: 'RETURN_TO_STOCK', label: 'Producto devuelto: reponer consumo en bodega original' },
                                            ]}
                                            value={inventoryAction}
                                            onChange={(v) => setInventoryAction((v ?? 'NO_RETURN') as 'NO_RETURN' | 'RETURN_TO_STOCK')}
                                            isDisabled={fiscalProcessing}
                                        />
                                    </Field>
                                </FormGrid>
                                {creditMode === 'PARTIAL' && (
                                    <div className={styles.stack}>
                                        <FormGrid>
                                            {creditOrderItems.map((item) => (
                                                <Field
                                                    key={item.id}
                                                    label={`${item.menuItem?.name || `Artículo #${item.id}`} · facturado ${item.quantity}`}
                                                    htmlFor={`credit-line-${item.id}`}
                                                >
                                                    <NumberInput
                                                        id={`credit-line-${item.id}`}
                                                        decimals={0}
                                                        min={0}
                                                        value={creditQuantities[item.id] || null}
                                                        onChange={(v) => setCreditQuantities((current) => ({
                                                            ...current,
                                                            [item.id]: Math.max(0, Math.min(item.quantity, Math.trunc(v || 0)))
                                                        }))}
                                                        disabled={fiscalProcessing}
                                                    />
                                                </Field>
                                            ))}
                                        </FormGrid>
                                        <p className={styles.muted}>
                                            El servidor valida el acumulado ya acreditado y rechazará cantidades que excedan la factura.
                                        </p>
                                    </div>
                                )}
                                {nonCashFiscalPayments.length > 0 && (
                                    <FormGrid>
                                        {nonCashFiscalPayments.map((payment) => (
                                            <Field
                                                key={payment.id}
                                                label={`Referencia de reembolso externo · Pago #${payment.id} (${payment.paymentMethod?.name})`}
                                                htmlFor={`external-refund-${payment.id}`}
                                                required
                                            >
                                                <Input
                                                    id={`external-refund-${payment.id}`}
                                                    value={externalRefundReferences[payment.id] || ''}
                                                    maxLength={191}
                                                    onChange={(event) => setExternalRefundReferences((current) => ({ ...current, [payment.id]: event.target.value }))}
                                                    disabled={fiscalProcessing}
                                                    placeholder="Referencia confirmada por banco/procesador"
                                                />
                                            </Field>
                                        ))}
                                    </FormGrid>
                                )}
                                <p className={styles.muted}>
                                    Los pagos en efectivo exigen un turno de caja abierto y generan un egreso compensatorio. Los pagos no efectivos no se marcarán revertidos sin referencia externa.
                                </p>
                            </FormSection>
                        )}
                    </div>
                )}
            </FullScreenModal>
        </PageContent>
    );
}
