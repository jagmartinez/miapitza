import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
    Calendar, Users, Plus, MapPin, FileText,
    Download,
    Trash2, AlertCircle, DollarSign, ConciergeBell,
    ChevronLeft, ChevronRight, Phone,
    Eye, Undo2, LayoutGrid, Table2, CalendarDays
} from 'lucide-react';
import {
    AppSelect, Badge, Button, Checkbox, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton,
    Input, LoadErrorState, NumberInput, PageContent, PageHeader, SegmentedControl, Skeleton, TableToolbar, Tabs, Textarea,
    formatQty, type Column, type Tone,
} from '@/ui';
import { cateringAPI, menuAPI, paymentsAPI, branchesAPI, settingsAPI, warehousesAPI } from '../services/api';
import { getCateringStatusOptions, isCateringStatusTerminal } from '../utils/cateringStatus';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import type { Branch, MenuItem, PaymentMethod, Warehouse } from '../types';
import type { CurrencySettings } from '../utils/currency';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import { newIdempotencyKey } from '../utils/idempotency';
import { filterMenuItemsByCategory, getMenuCategoryOptions } from '../utils/cateringMenuFilter';
import './CateringMod.css';
import { getApiErrorMessage } from '../utils/apiError';

interface CateringClausesForm {
    manifiestan: string;
    objetoContrato: string;
    duracionServicio: string;
    gastosServicio: string;
    demoraPago: string;
    obligacionesProveedor: string;
    obligacionesCliente: string;
}

interface CateringServiceEntry {
    id?: number;
    cateringServiceId?: number;
    quantity: number;
    unitPrice: number;
    notes?: string;
    service?: { id?: number; name?: string };
}

interface CateringMenuEntry {
    id?: number;
    menuItemId?: number;
    quantity: number;
    unitPrice: number;
    notes?: string;
    menuItem?: { id?: number; name?: string };
}

interface CateringPaymentEntry {
    id?: number;
    date?: string;
    amount: number;
    paymentMethod?: { name?: string };
    methodType?: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
    status?: 'ACTIVE' | 'REVERSED';
    reversedAt?: string | null;
    reversalReason?: string | null;
}

interface CateringInventoryPreviewLine {
    productId: number;
    productName: string;
    unit: string | null;
    warehouseId: number;
    warehouseName: string;
    routed: boolean;
    required: number;
    available: number;
    shortage: number;
}

const FINISH_PREVIEW_COLUMNS: Column<CateringInventoryPreviewLine>[] = [
    { key: 'productName', header: 'Ingrediente', type: 'text' },
    { key: 'warehouseName', header: 'Bodega', type: 'text', render: (line) => `${line.warehouseName}${line.routed ? ' (regla)' : ''}` },
    { key: 'required', header: 'Requerido', type: 'qty', render: (line) => `${formatQty(line.required)} ${line.unit ?? ''}` },
    {
        key: 'available',
        header: 'Disponible',
        type: 'qty',
        render: (line) => `${formatQty(line.available)} ${line.unit ?? ''}${line.shortage > 0 ? ` (faltan ${formatQty(line.shortage)})` : ''}`,
    },
];

interface CateringServiceCatalog {
    id: number;
    name: string;
    internalCost?: number;
    salePrice?: number;
}

type CateringCompanySettings = CurrencySettings & Record<string, string | undefined>;

interface CateringEvent {
    id: number;
    title: string;
    customer: { name: string; phone: string; email?: string; taxId?: string } | null;
    date: string;
    peopleCount: number;
    status: 'QUOTED' | 'RESERVED' | 'PAID' | 'FINISHED' | 'CANCELLED';
    totalAmount: number;
    balance: number;
    fiscalSubtotal?: number | null;
    fiscalTax?: number | null;
    fiscalTaxRatePercent?: number | null;
    location?: string;
    notes?: string;
    subtotal: number;
    tax: number;
    _count?: {
        services: number;
        menuItems: number;
        payments: number;
    };
    services?: CateringServiceEntry[];
    menuItems?: CateringMenuEntry[];
    payments?: CateringPaymentEntry[];
    fiscalInvoice?: { number: string; status: 'ISSUED' | 'CREDITED'; issuedAt: string } | null;
    fiscalCreditNote?: { number: string; status: 'ISSUED'; issuedAt: string; reason: string } | null;
}

type CateringEventDetail = CateringEvent & {
    customerId?: string | number;
    branchId?: number;
    clauses?: CateringClausesForm;
};

type CateringViewMode = 'grid' | 'table' | 'calendar';
interface ItemRow<T> { item: T; index: number }
const STATUS_TONE: Record<CateringEvent['status'], Tone> = {
    QUOTED: 'neutral',
    RESERVED: 'warning',
    PAID: 'success',
    FINISHED: 'primary',
    CANCELLED: 'danger',
};
type CateringTab = 'info' | 'logistics' | 'services' | 'menu' | 'clauses' | 'financial';

interface InventoryAvailabilityAlert {
    productId?: number;
    productName: string;
    required: number;
    available: number;
    deficit: number;
}

function formatAvailabilityAlert(alert: InventoryAvailabilityAlert): string {
    return `${alert.productName}: requiere ${formatQty(alert.required)}, disponible ${formatQty(alert.available)}, déficit ${formatQty(alert.deficit)}`;
}

async function contractDownloadError(error: unknown): Promise<string> {
    const fallback = 'Error al generar el contrato en PDF';
    if (!axios.isAxiosError(error)) {
        return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
    }
    const responseData: unknown = error.response?.data;
    if (responseData instanceof Blob) {
        try {
            const parsed = JSON.parse(await responseData.text()) as { message?: unknown };
            if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
        } catch {
            // An opaque proxy/body failure has no safe domain message to expose.
        }
    } else if (
        responseData
        && typeof responseData === 'object'
        && 'message' in responseData
        && typeof responseData.message === 'string'
        && responseData.message.trim()
    ) {
        return responseData.message.trim();
    }
    return fallback;
}

function contractFilename(contentDisposition: unknown, eventId: number): string {
    const fallback = `contrato-catering-EVT-${String(eventId).padStart(5, '0')}.pdf`;
    if (typeof contentDisposition !== 'string') return fallback;
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
    const candidate = match?.[1]?.trim().replace(/[\\/:*?"<>|]/g, '_');
    return candidate?.toLowerCase().endsWith('.pdf') ? candidate : fallback;
}

export default function Catering() {
    const { formatMoney } = useCurrency();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning, success: showSuccess } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canManageCatering = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [events, setEvents] = useState<CateringEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [eventsError, setEventsError] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [savingEvent, setSavingEvent] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CateringEvent | null>(null);
    const [viewMode, setViewMode] = useState<CateringViewMode>('grid');
    const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week' | 'day'>('month');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [currentWeek, setCurrentWeek] = useState(new Date());
    const [currentDay, setCurrentDay] = useState(new Date());
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<CateringTab>('info');

    // Master data
    const [allServices, setAllServices] = useState<CateringServiceCatalog[]>([]);
    const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>([]);
    const [menuCategoryFilter, setMenuCategoryFilter] = useState('all');
    const [allBranches, setAllBranches] = useState<Branch[]>([]);
    const [allWarehouses, setAllWarehouses] = useState<Warehouse[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [availabilityAlerts, setAvailabilityAlerts] = useState<InventoryAvailabilityAlert[]>([]);
    const [settings, setSettings] = useState<CateringCompanySettings>({});
    const [contractPdfBusyId, setContractPdfBusyId] = useState<number | null>(null);

    const [formData, setFormData] = useState({
        title: '',
        branchId: '',
        customerId: '',
        customerName: '',
        customerPhone: '',
        customerTaxId: '',
        date: '',
        time: '',
        peopleCount: 2,
        location: '',
        notes: '',
        status: 'QUOTED' as CateringEvent['status'],
        services: [] as CateringServiceEntry[],
        menuItems: [] as CateringMenuEntry[],
        clauses: {
            manifiestan: '',
            objetoContrato: '',
            duracionServicio: '',
            gastosServicio: '',
            demoraPago: '',
            obligacionesProveedor: '',
            obligacionesCliente: ''
        }
    });

    const [paymentData, setPaymentData] = useState({
        amount: 0,
        paymentMethodId: ''
    });
    const [addingPayment, setAddingPayment] = useState(false);
    const [reversingPaymentId, setReversingPaymentId] = useState<number | null>(null);
    const paymentIdempotencyKeyRef = useRef(newIdempotencyKey());

    useEffect(() => {
        paymentIdempotencyKeyRef.current = newIdempotencyKey();
    }, [selectedEvent?.id, paymentData.amount, paymentData.paymentMethodId]);
    const [reversalReason, setReversalReason] = useState('');
    const [fiscalCreditReason, setFiscalCreditReason] = useState('');
    const [returnCateringInventory, setReturnCateringInventory] = useState(false);
    const [externalRefundReferences, setExternalRefundReferences] = useState<Record<number, string>>({});
    const [fiscalBusy, setFiscalBusy] = useState(false);
    const invoiceIdempotencyKeyRef = useRef(newIdempotencyKey());
    const creditNoteIdempotencyKeyRef = useRef(newIdempotencyKey());

    useEffect(() => {
        invoiceIdempotencyKeyRef.current = newIdempotencyKey();
        creditNoteIdempotencyKeyRef.current = newIdempotencyKey();
        setFiscalCreditReason('');
        setReturnCateringInventory(false);
        setExternalRefundReferences({});
    }, [selectedEvent?.id]);
    const [finishWarehouseId, setFinishWarehouseId] = useState<number | null>(null);
    const [finishPreview, setFinishPreview] = useState<CateringInventoryPreviewLine[] | null>(null);
    const [finishPreviewError, setFinishPreviewError] = useState<string | null>(null);
    const finishPreviewEventId = selectedEvent?.status === 'PAID' && formData.status === 'FINISHED' ? selectedEvent.id : null;
    useEffect(() => {
        setFinishPreview(null);
        setFinishPreviewError(null);
        if (finishPreviewEventId == null || !finishWarehouseId) return;
        let cancelled = false;
        cateringAPI.getInventoryPreview(finishPreviewEventId, finishWarehouseId)
            .then((response) => {
                if (!cancelled) setFinishPreview((response.data?.data?.lines ?? []) as CateringInventoryPreviewLine[]);
            })
            .catch((error: unknown) => {
                if (!cancelled) setFinishPreviewError(getApiErrorMessage(error, 'No se pudo calcular el origen de los ingredientes'));
            });
        return () => { cancelled = true; };
    }, [finishPreviewEventId, finishWarehouseId]);

    const menuCategoryOptions = useMemo(
        () => [{ value: 'all', label: 'Todas las categorías' }, ...getMenuCategoryOptions(allMenuItems)],
        [allMenuItems]
    );
    const filteredMenuItems = useMemo(
        () => filterMenuItemsByCategory(allMenuItems, menuCategoryFilter),
        [allMenuItems, menuCategoryFilter]
    );

    const handleDownloadContract = useCallback(async (event: CateringEvent) => {
        if (contractPdfBusyId !== null) return;

        setContractPdfBusyId(event.id);
        try {
            const response = await cateringAPI.downloadContract(event.id);
            const contentType = String(response.headers['content-type'] || '').toLowerCase();
            const blob = response.data as Blob;
            if (!contentType.includes('application/pdf') || !(blob instanceof Blob) || blob.size === 0) {
                throw new Error('El servidor no devolvió un PDF válido');
            }
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = contractFilename(response.headers['content-disposition'], event.id);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
            showSuccess('Contrato PDF descargado');
        } catch (error) {
            console.error('Error generating contract PDF:', error);
            const message = await contractDownloadError(error);
            showError(message);
        } finally {
            setContractPdfBusyId(null);
        }
    }, [contractPdfBusyId, showError, showSuccess]);

    const loadEvents = useCallback(async () => {
        try {
            setLoading(true);
            const response = await cateringAPI.getAllEvents();
            setEvents(response.data.data);
            setEventsError(null);
        } catch (error) {
            console.error('Error loading catering events:', error);
            setEventsError('No se pudieron cargar los eventos de catering.');
            showError(getApiErrorMessage(error, 'No se pudieron cargar los eventos de catering'));
        } finally {
            setLoading(false);
        }
    }, [showError]);

    const loadMasterData = useCallback(async () => {
        try {
            const [servicesRes, menuRes, paymentsRes, branchesRes, warehousesRes] = await Promise.all([
                cateringAPI.getAllServices(),
                menuAPI.getAll(),
                paymentsAPI.getPaymentMethods(),
                branchesAPI.getAll(),
                warehousesAPI.getAll()
            ]);
            setAllServices(servicesRes.data.data);
            setAllMenuItems(menuRes.data.data);
            setPaymentMethods((paymentsRes.data.data as PaymentMethod[]).filter((method) => method.active !== false));
            setAllBranches(branchesRes.data.data);
            setAllWarehouses(warehousesRes.data.data);

            const settingsRes = await settingsAPI.getAll();
            setSettings(settingsRes.data.data);
        } catch (error) {
            console.error('Error loading master data:', error);
            showError(getApiErrorMessage(error, 'No se pudieron cargar sucursales, menú o métodos de pago de catering'));
        }
    }, [showError]);

    useEffect(() => {
        loadEvents();
        loadMasterData();
    }, [loadEvents, loadMasterData]);

    const handleOpenSidebar = async (event?: CateringEvent, tab: CateringTab = 'info') => {
        setAvailabilityAlerts([]);
        setFinishWarehouseId(null);
        setMenuCategoryFilter('all');
        if (event) {
            try {
                const response = await cateringAPI.getEventById(event.id);
                const fullEvent = response.data.data as CateringEventDetail;
                setSelectedEvent(fullEvent);
                const eventDate = new Date(fullEvent.date);
                setFormData({
                    title: fullEvent.title,
                    branchId: fullEvent.branchId?.toString() || '',
                    customerId: fullEvent.customerId != null ? String(fullEvent.customerId) : '',
                    customerName: fullEvent.customer?.name || '',
                    customerPhone: fullEvent.customer?.phone || '',
                    customerTaxId: fullEvent.customer?.taxId || '',
                    date: formatLocalDateInput(eventDate),
                    time: eventDate.toTimeString().slice(0, 5),
                    peopleCount: fullEvent.peopleCount,
                    location: fullEvent.location || '',
                    notes: fullEvent.notes || '',
                    status: fullEvent.status,
                    services: fullEvent.services || [],
                    menuItems: fullEvent.menuItems || [],
                    clauses: fullEvent.clauses || {
                        manifiestan: '',
                        objetoContrato: '',
                        duracionServicio: '',
                        gastosServicio: '',
                        demoraPago: '',
                        obligacionesProveedor: '',
                        obligacionesCliente: ''
                    }
                });
            } catch (error) {
                console.error('Error loading event details:', error);
                showError(getApiErrorMessage(error, 'No se pudo cargar el detalle del evento'));
                return;
            }
        } else {
            setSelectedEvent(null);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setFormData({
                title: '',
                branchId: '',
                customerId: '',
                customerName: '',
                customerPhone: '',
                customerTaxId: '',
                date: formatLocalDateInput(tomorrow),
                time: '12:00',
                peopleCount: 10,
                location: '',
                notes: '',
                status: 'QUOTED',
                services: [],
                menuItems: [],
                clauses: {
                    manifiestan: '',
                    objetoContrato: '',
                    duracionServicio: '',
                    gastosServicio: '',
                    demoraPago: '',
                    obligacionesProveedor: '',
                    obligacionesCliente: ''
                }
            });
        }
        setActiveTab(tab);
        setIsSidebarOpen(true);
    };

    const handleSave = async () => {
        if (savingEvent) return;
        if (!canManageCatering) {
            showWarning('No tienes permisos para guardar eventos de catering');
            return;
        }
        if (!formData.title.trim() || !formData.customerName.trim()) {
            showError('El título y el nombre del cliente son obligatorios.');
            setActiveTab('info');
            return;
        }
        if (!formData.branchId || !formData.date || !formData.time || Number(formData.peopleCount) < 1) {
            showError('Selecciona sucursal, fecha, hora y una cantidad válida de personas.');
            setActiveTab('info');
            return;
        }
        try {
            setSavingEvent(true);
            if (selectedEvent?.status === 'PAID' && formData.status === 'FINISHED' && !finishWarehouseId) {
                showError('Selecciona la bodega de la sucursal para descontar el inventario.');
                return;
            }
            const dataToSave = {
                ...formData,
                date: new Date(`${formData.date}T${formData.time}`).toISOString(),
                services: formData.services.map(s => ({
                    cateringServiceId: s.cateringServiceId || s.service?.id,
                    quantity: s.quantity,
                    unitPrice: s.unitPrice
                })).filter(s => typeof s.cateringServiceId === 'number'),
                menuItems: formData.menuItems.map(m => ({
                    menuItemId: m.menuItemId || m.menuItem?.id,
                    quantity: m.quantity,
                    unitPrice: m.unitPrice
                })).filter(m => typeof m.menuItemId === 'number')
            };

            if (selectedEvent) {
                if (selectedEvent.status === 'PAID' && formData.status === 'FINISHED') {
                    const response = await cateringAPI.updateEvent(selectedEvent.id, { status: 'FINISHED', warehouseId: finishWarehouseId });
                    // Same policy as sales: short stock does not block the finish;
                    // the server records the deficit and returns a warning.
                    const inventoryWarning = response.data?.data?.inventoryWarning;
                    if (typeof inventoryWarning === 'string' && inventoryWarning) {
                        showWarning(inventoryWarning);
                    } else {
                        showSuccess('Evento finalizado e inventario descontado.');
                    }
                } else {
                    await cateringAPI.updateEvent(selectedEvent.id, dataToSave);
                }
            } else {
                await cateringAPI.createEvent(dataToSave);
            }
            loadEvents();
            setIsSidebarOpen(false);
        } catch (error) {
            console.error('Error saving event:', error);
            // The server message already carries its own lead ("No se pudo actualizar…").
            showError(getApiErrorMessage(error));
        } finally {
            setSavingEvent(false);
        }
    };

    const checkAvailability = async () => {
        if (!formData.date || !formData.time) {
            showWarning('Selecciona fecha y hora para verificar inventario.');
            return;
        }
        try {
            const date = new Date(`${formData.date}T${formData.time}`).toISOString();
            const response = await cateringAPI.checkAvailability(
                date,
                formData.branchId ? Number(formData.branchId) : undefined
            );
            const rawAlerts = response.data.data?.alerts || [];
            const alerts: InventoryAvailabilityAlert[] = rawAlerts.map((alert: InventoryAvailabilityAlert | string) => {
                if (typeof alert === 'string') {
                    return { productName: alert, required: 0, available: 0, deficit: 0 };
                }
                return {
                    productId: alert.productId,
                    productName: alert.productName || 'Producto',
                    required: Number(alert.required) || 0,
                    available: Number(alert.available) || 0,
                    deficit: Number(alert.deficit) || 0
                };
            });
            setAvailabilityAlerts(alerts);
            if (alerts.length === 0) {
                showSuccess('Inventario suficiente para los eventos de esa fecha.');
            }
        } catch (error) {
            console.error('Error checking availability:', error);
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo verificar la disponibilidad de inventario.');
        }
    };

    const handleAddPayment = async () => {
        if (!canManageCatering) {
            showWarning('No tienes permisos para registrar pagos');
            return;
        }
        if (!selectedEvent || !paymentData.amount || !paymentData.paymentMethodId) return;
        if (Number(paymentData.amount) <= 0 || Number(paymentData.amount) > Number(selectedEvent.balance)) {
            showWarning('El pago debe ser mayor a cero y no puede exceder el saldo pendiente.');
            return;
        }
        setAddingPayment(true);
        let paymentCommitted = false;
        try {
            await cateringAPI.addPayment(selectedEvent.id, {
                amount: Number(paymentData.amount),
                paymentMethodId: Number(paymentData.paymentMethodId)
            }, paymentIdempotencyKeyRef.current);
            paymentCommitted = true;
            paymentIdempotencyKeyRef.current = newIdempotencyKey();
            setPaymentData({ amount: 0, paymentMethodId: '' });
            const response = await cateringAPI.getEventById(selectedEvent.id);
            setSelectedEvent(response.data.data);
            loadEvents();
        } catch (error) {
            console.error('Error adding payment:', error);
            if (paymentCommitted) {
                showWarning('El pago fue registrado, pero no se pudo refrescar el evento. Vuelve a abrirlo para consultar el saldo actualizado.');
                loadEvents();
                return;
            }
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo registrar el pago de catering.');
        } finally {
            setAddingPayment(false);
        }
    };

    const handleReversePayment = async (payment: CateringPaymentEntry) => {
        if (!selectedEvent || !payment.id || payment.status === 'REVERSED') return;
        if (reversalReason.trim().length < 3) {
            showWarning('Indica el motivo del reverso');
            return;
        }
        if (!(await confirm('¿Revertir este pago? El registro original se conservará.', { variant: 'warning', confirmText: 'Sí, revertir' }))) return;
        setReversingPaymentId(payment.id);
        try {
            await cateringAPI.reversePayment(selectedEvent.id, payment.id, reversalReason.trim());
            const response = await cateringAPI.getEventById(selectedEvent.id);
            setSelectedEvent(response.data.data);
            setReversalReason('');
            loadEvents();
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo revertir el pago');
        } finally {
            setReversingPaymentId(null);
        }
    };

    const refreshSelectedCateringEvent = async (eventId: number) => {
        const response = await cateringAPI.getEventById(eventId);
        setSelectedEvent(response.data.data);
        loadEvents();
    };

    const handleIssueFiscalInvoice = async () => {
        if (!selectedEvent || !canManageCatering || fiscalBusy) return;
        if (!(await confirm('¿Emitir la factura fiscal? Los conceptos, impuestos, pagos y datos del cliente quedarán congelados.', { confirmText: 'Emitir factura' }))) return;
        setFiscalBusy(true);
        try {
            await cateringAPI.issueFiscalInvoice(selectedEvent.id, invoiceIdempotencyKeyRef.current);
            await refreshSelectedCateringEvent(selectedEvent.id);
            showSuccess('Factura fiscal de catering emitida');
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo emitir la factura fiscal');
        } finally {
            setFiscalBusy(false);
        }
    };

    const handleIssueFiscalCreditNote = async () => {
        if (!selectedEvent || !canManageCatering || fiscalBusy) return;
        if (fiscalCreditReason.trim().length < 5) {
            showWarning('Indica un motivo fiscal de al menos 5 caracteres');
            return;
        }
        const nonCashPayments = (selectedEvent.payments || []).filter((payment) =>
            payment.status !== 'REVERSED' && payment.methodType && payment.methodType !== 'CASH'
        );
        if (nonCashPayments.some((payment) => !payment.id || !externalRefundReferences[payment.id]?.trim())) {
            showWarning('Registra la referencia de cada reembolso externo');
            return;
        }
        if (!(await confirm('¿Emitir nota de crédito total? Se revertirán todos los pagos y, si se indicó, el inventario consumido.', { variant: 'warning', confirmText: 'Emitir nota de crédito' }))) return;
        setFiscalBusy(true);
        try {
            await cateringAPI.issueFiscalCreditNote(selectedEvent.id, {
                reason: fiscalCreditReason.trim(),
                inventoryAction: returnCateringInventory ? 'RETURN_TO_STOCK' : 'NO_RETURN',
                externalRefunds: nonCashPayments.map((payment) => ({
                    paymentId: payment.id,
                    reference: externalRefundReferences[payment.id!].trim()
                }))
            }, creditNoteIdempotencyKeyRef.current);
            await refreshSelectedCateringEvent(selectedEvent.id);
            showSuccess('Nota de crédito total emitida y contraflujos conciliados');
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo emitir la nota de crédito fiscal');
        } finally {
            setFiscalBusy(false);
        }
    };

    const getStatusText = (status: string) => {
        const statuses: Record<string, string> = {
            'QUOTED': 'Cotizado',
            'RESERVED': 'Reservado',
            'PAID': 'Pagado',
            'FINISHED': 'Finalizado',
            'CANCELLED': 'Cancelado'
        };
        return statuses[status] || status;
    };



    const filteredEvents = events.filter(e => {
        const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
        const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (e.customer?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
        return matchesStatus && matchesSearch;
    });

    const handleDeleteEvent = async (event: CateringEvent) => {
        if (!canManageCatering) return;
        if (!(await confirm('¿Estás seguro de eliminar este evento?', { title: 'Confirmar acción' }))) return;

        try {
            await cateringAPI.deleteEvent(event.id);
            loadEvents();
        } catch (error) {
            console.error('Error deleting event:', error);
            showError(getApiErrorMessage(error, 'No se pudo eliminar el evento de catering'));
        }
    };

    const formatEventDateTime = (value: string) => new Date(value).toLocaleString('es-NI', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    const tableColumns: Column<CateringEvent>[] = [
        {
            key: 'event',
            header: 'Evento',
            type: 'text',
            render: (event) => (
                <div className="catering-cell-stack">
                    <span className="catering-cell-title">{event.title}</span>
                    <span className="catering-cell-sub">
                        {event.customer?.name || 'Sin cliente'}
                        {event.customer?.phone ? ` · ${event.customer.phone}` : ''}
                    </span>
                </div>
            ),
        },
        { key: 'date', header: 'Fecha y hora', type: 'date', render: (event) => formatEventDateTime(event.date) },
        { key: 'people', header: 'Personas', type: 'number', decimals: 0, accessor: (event) => event.peopleCount },
        { key: 'location', header: 'Ubicación', type: 'text', render: (event) => event.location || 'Sin ubicación' },
        { key: 'total', header: 'Total', type: 'money', render: (event) => formatMoney(Number(event.totalAmount || 0)) },
        {
            key: 'status',
            header: 'Estado',
            type: 'status',
            render: (event) => <Badge tone={STATUS_TONE[event.status] ?? 'neutral'} dot>{getStatusText(event.status)}</Badge>,
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            render: (event) => (
                <>
                    <IconButton size="sm" icon={Eye} tooltip="Ver detalle" label={`Ver evento ${event.title}`} onClick={() => void handleOpenSidebar(event, 'info')} />
                    <IconButton size="sm" icon={DollarSign} tooltip="Pagos" label={`Ver pagos de ${event.title}`} onClick={() => void handleOpenSidebar(event, 'financial')} />
                    <IconButton
                        size="sm"
                        icon={Download}
                        tooltip={contractPdfBusyId === event.id ? 'Generando contrato' : 'Descargar contrato'}
                        onClick={() => void handleDownloadContract(event)}
                        disabled={contractPdfBusyId !== null}
                        aria-busy={contractPdfBusyId === event.id}
                        label={contractPdfBusyId === event.id
                            ? `Generando contrato de ${event.title}`
                            : `Descargar contrato de ${event.title}`}
                    />
                    {canManageCatering && (
                        <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar evento ${event.title}`} onClick={() => void handleDeleteEvent(event)} />
                    )}
                </>
            ),
        },
    ];

    const setServiceQuantity = (index: number, quantity: number) => setFormData((current) => ({
        ...current,
        services: current.services.map((entry, i) => (i === index ? { ...entry, quantity } : entry)),
    }));
    const removeService = (index: number) => setFormData((current) => ({
        ...current,
        services: current.services.filter((_, i) => i !== index),
    }));
    const setMenuQuantity = (index: number, quantity: number) => setFormData((current) => ({
        ...current,
        menuItems: current.menuItems.map((entry, i) => (i === index ? { ...entry, quantity } : entry)),
    }));
    const removeMenuItem = (index: number) => setFormData((current) => ({
        ...current,
        menuItems: current.menuItems.filter((_, i) => i !== index),
    }));

    const itemColumns = <T extends CateringServiceEntry | CateringMenuEntry>(
        nameHeader: string,
        nameOf: (item: T) => string,
        onQuantity: (index: number, quantity: number) => void,
        onRemove: (index: number) => void,
        removeLabel: string,
    ): Column<ItemRow<T>>[] => [
        { key: 'name', header: nameHeader, type: 'text', render: ({ item }) => <span className="catering-cell-title">{nameOf(item)}</span> },
        { key: 'price', header: 'Precio', type: 'money', render: ({ item }) => formatMoney(Number(item.unitPrice)) },
        {
            key: 'quantity',
            header: 'Cant.',
            type: 'number',
            width: '120px',
            render: ({ item, index }) => (
                <NumberInput
                    aria-label={`Cantidad de ${nameOf(item)}`}
                    decimals={0}
                    min={1}
                    value={item.quantity}
                    onChange={(v) => onQuantity(index, Math.max(1, Math.trunc(v ?? 1)))}
                />
            ),
        },
        { key: 'subtotal', header: 'Subtotal', type: 'money', render: ({ item }) => formatMoney(Number(item.quantity * item.unitPrice)) },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '72px',
            render: ({ item, index }) => (
                <IconButton size="sm" icon={Trash2} tone="danger" tooltip={removeLabel} label={`${removeLabel}: ${nameOf(item)}`} onClick={() => onRemove(index)} />
            ),
        },
    ];
    const serviceColumns = itemColumns<CateringServiceEntry>('Servicio', (item) => item.service?.name || 'Servicio', setServiceQuantity, removeService, 'Quitar servicio');
    const menuColumns = itemColumns<CateringMenuEntry>('Plato', (item) => item.menuItem?.name || 'Plato', setMenuQuantity, removeMenuItem, 'Quitar plato');

    const paymentColumns: Column<CateringPaymentEntry>[] = [
        { key: 'date', header: 'Fecha', type: 'date', render: (p) => (p.date ? new Date(p.date).toLocaleDateString('es-NI') : '-') },
        { key: 'method', header: 'Método', type: 'text', render: (p) => p.paymentMethod?.name ?? '' },
        { key: 'amount', header: 'Monto', type: 'money', render: (p) => formatMoney(Number(p.amount)) },
        {
            key: 'status',
            header: 'Estado',
            type: 'text',
            render: (p) => (p.status === 'REVERSED'
                ? <Badge tone="neutral">{`Revertido${p.reversalReason ? `: ${p.reversalReason}` : ''}`}</Badge>
                : <Badge tone="success">Activo</Badge>),
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '72px',
            render: (p) => (canManageCatering && p.status !== 'REVERSED' ? (
                <IconButton
                    size="sm"
                    icon={Undo2}
                    tone="danger"
                    tooltip="Revertir"
                    label={`Revertir pago ${p.id ?? ''}`.trim()}
                    disabled={reversingPaymentId !== null}
                    onClick={() => void handleReversePayment(p)}
                />
            ) : null),
        },
    ];

    const calculateTabTotals = () => {
        const servicesTotal = formData.services.reduce((acc, s) => acc + (Number(s.quantity) * Number(s.unitPrice)), 0);
        const menuTotal = formData.menuItems.reduce((acc, m) => acc + (Number(m.quantity) * Number(m.unitPrice)), 0);
        return servicesTotal + menuTotal;
    };

    // Calendar Helpers
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        return { daysInMonth, startingDayOfWeek, year, month };
    };

    const handlePrevPeriod = () => {
        if (calendarViewMode === 'month') {
            setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
        } else if (calendarViewMode === 'week') {
            const newWeek = new Date(currentWeek);
            newWeek.setDate(newWeek.getDate() - 7);
            setCurrentWeek(newWeek);
        } else {
            const newDay = new Date(currentDay);
            newDay.setDate(newDay.getDate() - 1);
            setCurrentDay(newDay);
        }
    };

    const handleNextPeriod = () => {
        if (calendarViewMode === 'month') {
            setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
        } else if (calendarViewMode === 'week') {
            const newWeek = new Date(currentWeek);
            newWeek.setDate(newWeek.getDate() + 7);
            setCurrentWeek(newWeek);
        } else {
            const newDay = new Date(currentDay);
            newDay.setDate(newDay.getDate() + 1);
            setCurrentDay(newDay);
        }
    };

    const handleToday = () => {
        const today = new Date();
        setCurrentMonth(today);
        setCurrentWeek(today);
        setCurrentDay(today);
    };

    const getCalendarTitle = () => {
        if (calendarViewMode === 'month') {
            return currentMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
        } else if (calendarViewMode === 'week') {
            const weekStart = new Date(currentWeek);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return `${weekStart.getDate()} - ${weekEnd.getDate()} ${weekEnd.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`;
        } else {
            return currentDay.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
    };

    const getEventsForDate = (date: Date) => {
        return events.filter(e => {
            const eventDate = new Date(e.date);
            return eventDate.getDate() === date.getDate() &&
                eventDate.getMonth() === date.getMonth() &&
                eventDate.getFullYear() === date.getFullYear();
        });
    };

    const configuredTaxRate = Number(settings.tax_rate ?? settings.taxRate ?? 15);
    const taxRate = Number.isFinite(configuredTaxRate) && configuredTaxRate >= 0 ? configuredTaxRate : 15;

    const paidTotal = selectedEvent?.payments?.filter((p) => p.status !== 'REVERSED').reduce((sum, p) => sum + Number(p.amount), 0) || 0;
    const activeNonCashPayments = (selectedEvent?.payments || []).filter((payment) =>
        payment.status !== 'REVERSED' && payment.methodType && payment.methodType !== 'CASH'
    );

    const renderEventsContent = () => {
        if (viewMode === 'calendar') {
            if (loading) return <Skeleton height={320} />;
            if (eventsError) return <LoadErrorState message={eventsError} onRetry={() => void loadEvents()} />;
            return (
                <section className="catering-calendar" aria-label="Calendario de eventos">
                    <div className="catering-calendar__bar">
                        <div className="catering-calendar__nav">
                            <IconButton icon={ChevronLeft} label="Periodo anterior" onClick={handlePrevPeriod} />
                            <h2 className="catering-calendar__title">{getCalendarTitle()}</h2>
                            <IconButton icon={ChevronRight} label="Periodo siguiente" onClick={handleNextPeriod} />
                        </div>
                        <div className="catering-calendar__tools">
                            <SegmentedControl<'day' | 'week' | 'month'>
                                ariaLabel="Escala del calendario"
                                options={[
                                    { value: 'day', label: 'Día' },
                                    { value: 'week', label: 'Semana' },
                                    { value: 'month', label: 'Mes' },
                                ]}
                                value={calendarViewMode}
                                onChange={setCalendarViewMode}
                            />
                            <Button onClick={handleToday}>Hoy</Button>
                        </div>
                    </div>

                    {calendarViewMode === 'month' && (
                        <div className="catering-calendar__scroll">
                            <div className="catering-month">
                                {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d) => (
                                    <div key={d} className="catering-month__dow">{d}</div>
                                ))}
                                {(() => {
                                    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);
                                    const cells = [];
                                    for (let i = 0; i < startingDayOfWeek; i++) {
                                        cells.push(<div key={`empty-${i}`} className="catering-month__day is-empty" />);
                                    }
                                    for (let day = 1; day <= daysInMonth; day++) {
                                        const date = new Date(year, month, day);
                                        const dayEvents = getEventsForDate(date);
                                        const isToday = new Date().toDateString() === date.toDateString();
                                        cells.push(
                                            <div key={day} className={`catering-month__day ${isToday ? 'is-today' : ''}`}>
                                                <span className="catering-month__number">{day}</span>
                                                {dayEvents.slice(0, 3).map((e) => (
                                                    <button
                                                        type="button"
                                                        key={e.id}
                                                        className={`catering-chip catering-chip--${e.status.toLowerCase()}`}
                                                        onClick={() => void handleOpenSidebar(e)}
                                                        title={`${e.title} - ${e.customer?.name ?? ''}`}
                                                    >
                                                        <span className="catering-chip__time">{new Date(e.date).getHours()}:{new Date(e.date).getMinutes().toString().padStart(2, '0')}</span>
                                                        <span className="catering-chip__name">{e.title}</span>
                                                    </button>
                                                ))}
                                                {dayEvents.length > 3 && <span className="catering-month__more">+{dayEvents.length - 3} más</span>}
                                            </div>
                                        );
                                    }
                                    return cells;
                                })()}
                            </div>
                        </div>
                    )}

                    {calendarViewMode === 'week' && (
                        <div className="catering-calendar__scroll">
                            <div className="catering-week">
                                {(() => {
                                    const days = [];
                                    const startOfWeek = new Date(currentWeek);
                                    startOfWeek.setDate(currentWeek.getDate() - currentWeek.getDay());
                                    for (let i = 0; i < 7; i++) {
                                        const date = new Date(startOfWeek);
                                        date.setDate(startOfWeek.getDate() + i);
                                        const dayEvents = getEventsForDate(date);
                                        const isToday = new Date().toDateString() === date.toDateString();
                                        days.push(
                                            <div key={i} className={`catering-week__day ${isToday ? 'is-today' : ''}`}>
                                                <div className="catering-week__head">
                                                    <span className="catering-week__name">{date.toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                                                    <span className="catering-week__number">{date.getDate()}</span>
                                                </div>
                                                {dayEvents.map((e) => (
                                                    <button
                                                        type="button"
                                                        key={e.id}
                                                        className={`catering-chip catering-chip--${e.status.toLowerCase()}`}
                                                        aria-label={`Ver evento ${e.title}`}
                                                        onClick={() => void handleOpenSidebar(e)}
                                                    >
                                                        <span className="catering-chip__time">{new Date(e.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span className="catering-chip__name">{e.title}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    }
                                    return days;
                                })()}
                            </div>
                        </div>
                    )}

                    {calendarViewMode === 'day' && (
                        <div className="catering-day">
                            {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((hour) => {
                                const dayEvents = getEventsForDate(currentDay).filter((e) => new Date(e.date).getHours() === hour);
                                return (
                                    <div key={hour} className="catering-day__slot">
                                        <span className="catering-day__hour">{hour}:00</span>
                                        <div className="catering-day__events">
                                            {dayEvents.map((e) => (
                                                <button
                                                    type="button"
                                                    key={e.id}
                                                    className={`catering-chip catering-chip--${e.status.toLowerCase()}`}
                                                    aria-label={`Ver evento ${e.title}`}
                                                    onClick={() => void handleOpenSidebar(e)}
                                                >
                                                    <span className="catering-chip__time">{new Date(e.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    <span className="catering-chip__name">{e.title}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            );
        }

        if (viewMode === 'table') {
            return (
                <DataTable<CateringEvent>
                    ariaLabel="Eventos de catering"
                    rows={filteredEvents}
                    rowKey={(event) => event.id}
                    columns={tableColumns}
                    loading={loading}
                    error={eventsError}
                    onRetry={() => void loadEvents()}
                    resetKey={`${filterStatus}-${searchQuery}`}
                    onRowClick={(event) => void handleOpenSidebar(event)}
                    empty={events.length === 0
                        ? <EmptyState icon={FileText} title="Aún no hay eventos de catering" description="Registra la primera cotización para empezar." />
                        : <EmptyState icon={FileText} title="No hay eventos con estos filtros" />}
                />
            );
        }

        if (loading) return <Skeleton height={240} />;
        if (eventsError) return <LoadErrorState message={eventsError} onRetry={() => void loadEvents()} />;
        if (filteredEvents.length === 0) {
            return (
                <EmptyState
                    icon={FileText}
                    title={events.length === 0 ? 'Aún no hay eventos de catering' : 'No hay eventos con estos filtros'}
                    description={events.length === 0 ? 'Registra la primera cotización para empezar.' : undefined}
                />
            );
        }
        return (
            <div className="catering-grid">
                {filteredEvents.map((event) => (
                    <article key={event.id} className="catering-card">
                        <button
                            type="button"
                            className="catering-card__main"
                            aria-label={`Ver evento ${event.title}`}
                            onClick={() => void handleOpenSidebar(event)}
                        >
                            <span className="catering-card__head">
                                <span className="catering-card__title">{event.title}</span>
                                <Badge tone={STATUS_TONE[event.status] ?? 'neutral'} dot>{getStatusText(event.status)}</Badge>
                            </span>
                            <span className="catering-card__row"><Users size={16} aria-hidden="true" />{event.customer?.name || 'Sin cliente'}</span>
                            {event.customer?.phone && <span className="catering-card__row"><Phone size={16} aria-hidden="true" />{event.customer.phone}</span>}
                            <span className="catering-card__row is-muted"><Calendar size={16} aria-hidden="true" />{formatEventDateTime(event.date)}</span>
                            <span className="catering-card__row is-muted"><Users size={16} aria-hidden="true" />{event.peopleCount} personas</span>
                            {event.location && <span className="catering-card__row is-muted"><MapPin size={16} aria-hidden="true" />{event.location}</span>}
                        </button>
                        <div className="catering-card__actions">
                            <IconButton icon={Eye} tooltip="Ver detalle" label={`Ver detalle de ${event.title}`} onClick={() => void handleOpenSidebar(event, 'info')} />
                            <IconButton icon={DollarSign} tooltip="Pagos" label={`Ver pagos de ${event.title}`} onClick={() => void handleOpenSidebar(event, 'financial')} />
                            <IconButton
                                icon={Download}
                                tooltip={contractPdfBusyId === event.id ? 'Generando contrato' : 'Descargar contrato'}
                                onClick={() => void handleDownloadContract(event)}
                                disabled={contractPdfBusyId !== null}
                                aria-busy={contractPdfBusyId === event.id}
                                label={contractPdfBusyId === event.id
                                    ? `Generando contrato de ${event.title}`
                                    : `Descargar contrato de ${event.title}`}
                            />
                            {canManageCatering && (
                                <IconButton icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar evento ${event.title}`} onClick={() => void handleDeleteEvent(event)} />
                            )}
                        </div>
                    </article>
                ))}
            </div>
        );
    };

    return (
        <PageContent>
            <PageHeader
                title="Servicios de Catering"
                description="Cotizaciones, reservas, pagos y contratos de eventos"
                actions={(
                    <>
                        <SegmentedControl<CateringViewMode>
                            ariaLabel="Vista"
                            iconOnly
                            options={[
                                { value: 'grid', label: 'Tarjetas', icon: LayoutGrid },
                                { value: 'table', label: 'Tabla', icon: Table2 },
                                { value: 'calendar', label: 'Calendario', icon: CalendarDays },
                            ]}
                            value={viewMode}
                            onChange={setViewMode}
                        />
                        {canManageCatering && (
                            <Button variant="primary" icon={Plus} onClick={() => void handleOpenSidebar()}>
                                Nuevo evento
                            </Button>
                        )}
                    </>
                )}
            />

            {viewMode !== 'calendar' && (
                <Tabs
                    ariaLabel="Filtrar eventos por estado"
                    active={filterStatus}
                    onChange={(id) => setFilterStatus(id as typeof filterStatus)}
                    tabs={([
                        ['all', 'Todos'],
                        ['QUOTED', 'Cotizados'],
                        ['RESERVED', 'Reservados'],
                        ['PAID', 'Pagados'],
                        ['FINISHED', 'Finalizados'],
                        ['CANCELLED', 'Cancelados'],
                    ] as const).map(([id, label]) => ({
                        id,
                        label,
                        badge: id === 'all' ? events.length : events.filter((event) => event.status === id).length,
                    }))}
                />
            )}

            {viewMode !== 'calendar' && (
                <TableToolbar>
                    <Input
                        type="search"
                        aria-label="Buscar evento o cliente"
                        placeholder="Buscar evento o cliente..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </TableToolbar>
            )}

            {contractPdfBusyId !== null && (
                <p className="catering-status" role="status" aria-live="polite">Preparando contrato PDF…</p>
            )}

            {renderEventsContent()}

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={selectedEvent ? `Editar: ${selectedEvent.title}` : 'Nuevo evento de catering'}
                breadcrumb={['Catering', 'Eventos']}
                tabs={[
                    { id: 'info', label: 'Datos' },
                    { id: 'logistics', label: 'Logística' },
                    { id: 'services', label: 'Servicios', badge: formData.services.length > 0 ? formData.services.length : undefined },
                    { id: 'menu', label: 'Menú', badge: formData.menuItems.length > 0 ? formData.menuItems.length : undefined },
                    { id: 'clauses', label: 'Contrato' },
                    ...(selectedEvent ? [{ id: 'financial', label: 'Finanzas' }] : []),
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as typeof activeTab)}
                footerStart={(
                    <>
                        <span className="catering-total-label">
                            Total estimado: <strong className="catering-total-value">{formatMoney(calculateTabTotals())}</strong>
                        </span>
                        {activeTab === 'menu' && (
                            <Button icon={AlertCircle} onClick={() => void checkAvailability()}>Verificar inventario</Button>
                        )}
                    </>
                )}
                footer={({ requestClose }) => (activeTab === 'financial' && selectedEvent ? (
                    <Button onClick={requestClose}>Cerrar</Button>
                ) : (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        {canManageCatering && (
                            <Button variant="primary" type="submit" form="catering-event-form" loading={savingEvent}>
                                {selectedEvent ? 'Guardar cambios' : 'Crear evento'}
                            </Button>
                        )}
                    </>
                ))}
            >
                <form
                    id="catering-event-form"
                    className="catering-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleSave();
                    }}
                >
                    {activeTab === 'info' && (
                        <>
                            <FormSection title="Información del cliente">
                                <FormGrid columns="repeat(auto-fit, minmax(14rem, 1fr))">
                                    <Field label="Nombre del cliente" htmlFor="catering-customer-name" required>
                                        <Input
                                            id="catering-customer-name"
                                            placeholder="Ej: Juan Pérez"
                                            value={formData.customerName}
                                            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Cédula / RUC" htmlFor="catering-customer-tax-id">
                                        <Input
                                            id="catering-customer-tax-id"
                                            placeholder="Ej: 001-000000-0000X"
                                            value={formData.customerTaxId}
                                            onChange={(e) => setFormData({ ...formData, customerTaxId: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Teléfono" htmlFor="catering-customer-phone">
                                        <Input
                                            id="catering-customer-phone"
                                            type="tel"
                                            placeholder="Ej: +505 8888-8888"
                                            value={formData.customerPhone}
                                            onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <FormSection title="Detalles del evento">
                                <FormGrid>
                                    <Field label="Sucursal" htmlFor="catering-select-1" required>
                                        <AppSelect
                                            inputId="catering-select-1"
                                            value={formData.branchId || null}
                                            onChange={(option) => setFormData({ ...formData, branchId: option || '' })}
                                            options={allBranches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                                            placeholder="Seleccione sucursal..."
                                            isClearable
                                        />
                                    </Field>
                                    <Field label="Título del evento" htmlFor="catering-event-title" required>
                                        <Input
                                            id="catering-event-title"
                                            placeholder="Ej: Cumpleaños de María"
                                            value={formData.title}
                                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Fecha" htmlFor="catering-event-date" required>
                                        <DateInput
                                            id="catering-event-date"
                                            value={formData.date}
                                            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Hora" htmlFor="catering-event-time" required>
                                        <Input
                                            id="catering-event-time"
                                            type="time"
                                            value={formData.time}
                                            onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                                        />
                                    </Field>
                                    <Field label="Estado" htmlFor="catering-select-2" hint={selectedEvent?.status === 'RESERVED' ? 'El estado Pagado se asigna automáticamente al completar el saldo.' : undefined}>
                                        <AppSelect
                                            inputId="catering-select-2"
                                            value={formData.status}
                                            isClearable={false}
                                            onChange={(option) => {
                                                if (!option) return;
                                                setFormData({ ...formData, status: option });
                                                if (option !== 'FINISHED') setFinishWarehouseId(null);
                                            }}
                                            options={getCateringStatusOptions(selectedEvent?.status).map((value) => ({
                                                value,
                                                label: getStatusText(value),
                                            }))}
                                            isDisabled={Boolean(selectedEvent && isCateringStatusTerminal(selectedEvent.status))}
                                        />
                                    </Field>
                                    <Field label="Invitados" htmlFor="catering-people-count" required>
                                        <NumberInput
                                            id="catering-people-count"
                                            decimals={0}
                                            min={1}
                                            value={Number.isFinite(formData.peopleCount) ? formData.peopleCount : null}
                                            onChange={(v) => setFormData({ ...formData, peopleCount: v === null ? 0 : Math.trunc(v) })}
                                        />
                                    </Field>
                                    {selectedEvent?.status === 'PAID' && formData.status === 'FINISHED' && (
                                        <Field label="Bodega para consumo" htmlFor="catering-select-3" required>
                                            <AppSelect
                                                inputId="catering-select-3"
                                                options={allWarehouses
                                                    .filter((warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === Number(formData.branchId))
                                                    .map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                                                value={finishWarehouseId}
                                                onChange={(option) => setFinishWarehouseId(option ?? null)}
                                                placeholder="Seleccionar bodega de la sucursal..."
                                                noOptionsText="No hay bodegas de sucursal disponibles"
                                            />
                                        </Field>
                                    )}
                                </FormGrid>

                                {finishPreviewEventId != null && finishWarehouseId != null && (
                                    <div className="catering-finish-preview" aria-live="polite">
                                        <p className="catering-hint">
                                            Cada ingrediente se descuenta de la bodega asignada por las reglas de la sucursal;
                                            sin regla, de la bodega seleccionada.
                                        </p>
                                        {finishPreviewError && <LoadErrorState message={finishPreviewError} />}
                                        {finishPreview && finishPreview.length === 0 && (
                                            <p className="catering-hint">El evento no tiene ingredientes con receta para descontar.</p>
                                        )}
                                        {finishPreview && finishPreview.length > 0 && (
                                            <DataTable<CateringInventoryPreviewLine>
                                                ariaLabel="Ingredientes a descontar"
                                                variant="flat"
                                                columns={FINISH_PREVIEW_COLUMNS}
                                                rows={finishPreview}
                                                rowKey={(line) => line.productId}
                                                rowTone={(line) => (line.shortage > 0 ? 'danger' : undefined)}
                                                pagination={{ mode: 'client' }}
                                                defaultPageSize={50}
                                                hidePaginationIfSinglePage
                                            />
                                        )}
                                        {finishPreview?.some((line) => line.shortage > 0) && (
                                            <p className="catering-hint">
                                                Hay faltantes: como en ventas, el evento se finaliza igual y se registra existencia negativa.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </FormSection>
                        </>
                    )}

                    {activeTab === 'logistics' && (
                        <FormSection title="Logística y notas">
                            <Field label="Ubicación" htmlFor="catering-location">
                                <Input
                                    id="catering-location"
                                    placeholder="Dirección, salón o punto de referencia"
                                    value={formData.location}
                                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                />
                            </Field>
                            <Field label="Notas operativas" htmlFor="catering-notes">
                                <Textarea
                                    id="catering-notes"
                                    rows={7}
                                    placeholder="Montaje, acceso, contacto en sitio y observaciones para el equipo"
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                />
                            </Field>
                        </FormSection>
                    )}

                    {activeTab === 'services' && (
                        <FormSection title="Servicios del evento">
                            <Field label="Agregar servicio" htmlFor="catering-select-4">
                                <AppSelect
                                    inputId="catering-select-4"
                                    value={null}
                                    onChange={(option) => {
                                        if (!option) return;
                                        const service = allServices.find((s) => s.id.toString() === option);
                                        if (service) {
                                            setFormData({
                                                ...formData,
                                                services: [...formData.services, { service, quantity: 1, unitPrice: service.salePrice ?? 0 }],
                                            });
                                        }
                                    }}
                                    options={allServices.map((s) => ({ value: s.id.toString(), label: `${s.name} - ${formatMoney(Number(s.salePrice))}` }))}
                                    placeholder="Seleccione un servicio..."
                                    isClearable
                                />
                            </Field>
                            <DataTable<ItemRow<CateringServiceEntry>>
                                ariaLabel="Servicios del evento"
                                variant="flat"
                                columns={serviceColumns}
                                rows={formData.services.map((item, index) => ({ item, index }))}
                                rowKey={(row) => row.index}
                                hidePaginationIfSinglePage
                                defaultPageSize={100}
                                stackOnMobile
                                empty={<EmptyState icon={ConciergeBell} title="Sin servicios agregados" description="Selecciona un servicio para incorporarlo al evento." />}
                            />
                        </FormSection>
                    )}

                    {activeTab === 'menu' && (
                        <FormSection title="Menú del evento">
                            <FormGrid>
                                <Field label="Categoría" htmlFor="catering-select-5">
                                    <AppSelect
                                        inputId="catering-select-5"
                                        value={menuCategoryFilter}
                                        isClearable={false}
                                        onChange={(option) => setMenuCategoryFilter(option ?? 'all')}
                                        options={menuCategoryOptions}
                                        placeholder="Todas las categorías"
                                    />
                                </Field>
                                <Field label="Agregar plato" htmlFor="catering-select-6">
                                    <AppSelect
                                        inputId="catering-select-6"
                                        value={null}
                                        onChange={(option) => {
                                            if (!option) return;
                                            const menuItem = allMenuItems.find((m) => m.id.toString() === option);
                                            if (menuItem) {
                                                setFormData({
                                                    ...formData,
                                                    menuItems: [...formData.menuItems, { menuItem, quantity: 1, unitPrice: menuItem.price || 0 }],
                                                });
                                            }
                                        }}
                                        options={filteredMenuItems.map((m) => ({ value: m.id.toString(), label: `${m.name} · ${m.category?.name || 'Sin categoría'} - ${formatMoney(Number(m.price || 0))}` }))}
                                        placeholder="Seleccione un plato..."
                                        isClearable
                                    />
                                </Field>
                            </FormGrid>
                            {availabilityAlerts.length > 0 && (
                                <div className="catering-alert" role="alert">
                                    <AlertCircle size={20} aria-hidden="true" />
                                    <div>
                                        <strong>Alertas de inventario</strong>
                                        <ul>
                                            {availabilityAlerts.map((alert, i) => (
                                                <li key={alert.productId ?? i}>{formatAvailabilityAlert(alert)}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            )}

                            <DataTable<ItemRow<CateringMenuEntry>>
                                ariaLabel="Platos del evento"
                                variant="flat"
                                columns={menuColumns}
                                rows={formData.menuItems.map((item, index) => ({ item, index }))}
                                rowKey={(row) => row.index}
                                hidePaginationIfSinglePage
                                defaultPageSize={100}
                                stackOnMobile
                                empty={<EmptyState icon={Users} title="Menú pendiente" description="Selecciona los platos que formarán parte del evento." />}
                            />
                        </FormSection>
                    )}

                    {activeTab === 'clauses' && (
                        <FormSection title="Cláusulas del contrato" description="Defina los términos específicos para este evento de catering.">
                            <Field label="Manifiestan (introducción)" htmlFor="catering-clause-manifiestan">
                                <Textarea
                                    id="catering-clause-manifiestan"
                                    rows={2}
                                    placeholder="Declaraciones iniciales de las partes..."
                                    value={formData.clauses.manifiestan}
                                    onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, manifiestan: e.target.value } })}
                                />
                            </Field>
                            <Field label="Objeto del contrato" htmlFor="catering-clause-objeto">
                                <Textarea
                                    id="catering-clause-objeto"
                                    rows={2}
                                    placeholder="Descripción detallada del servicio contratado..."
                                    value={formData.clauses.objetoContrato}
                                    onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, objetoContrato: e.target.value } })}
                                />
                            </Field>
                            <FormGrid>
                                <Field label="Duración del servicio" htmlFor="catering-clause-duracion">
                                    <Textarea
                                        id="catering-clause-duracion"
                                        rows={2}
                                        placeholder="Ej: 5 horas desde el inicio..."
                                        value={formData.clauses.duracionServicio}
                                        onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, duracionServicio: e.target.value } })}
                                    />
                                </Field>
                                <Field label="Gastos durante el servicio" htmlFor="catering-clause-gastos">
                                    <Textarea
                                        id="catering-clause-gastos"
                                        rows={2}
                                        placeholder="Ej: Incluye transporte y limpieza..."
                                        value={formData.clauses.gastosServicio}
                                        onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, gastosServicio: e.target.value } })}
                                    />
                                </Field>
                            </FormGrid>
                            <Field label="Demora de pago" htmlFor="catering-clause-demora">
                                <Textarea
                                    id="catering-clause-demora"
                                    rows={2}
                                    placeholder="Penalidades o condiciones por retraso en pagos..."
                                    value={formData.clauses.demoraPago}
                                    onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, demoraPago: e.target.value } })}
                                />
                            </Field>
                            <Field label="Obligaciones del proveedor" htmlFor="catering-clause-proveedor">
                                <Textarea
                                    id="catering-clause-proveedor"
                                    rows={3}
                                    placeholder="Compromisos específicos de la empresa..."
                                    value={formData.clauses.obligacionesProveedor}
                                    onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, obligacionesProveedor: e.target.value } })}
                                />
                            </Field>
                            <Field label="Obligaciones del cliente" htmlFor="catering-clause-cliente">
                                <Textarea
                                    id="catering-clause-cliente"
                                    rows={3}
                                    placeholder="Compromisos específicos del cliente..."
                                    value={formData.clauses.obligacionesCliente}
                                    onChange={(e) => setFormData({ ...formData, clauses: { ...formData.clauses, obligacionesCliente: e.target.value } })}
                                />
                            </Field>
                        </FormSection>
                    )}

                </form>

                {activeTab === 'financial' && selectedEvent && (
                    <div className="catering-form">
                            <FormSection title="Resumen financiero">
                                <dl className="catering-facts">
                                    <div>
                                        <dt>Subtotal</dt>
                                        <dd>{selectedEvent.fiscalSubtotal == null ? 'No certificado' : formatMoney(Number(selectedEvent.fiscalSubtotal))}</dd>
                                    </div>
                                    <div>
                                        <dt>IVA ({selectedEvent.fiscalTaxRatePercent == null ? taxRate : Number(selectedEvent.fiscalTaxRatePercent)}%)</dt>
                                        <dd>{selectedEvent.fiscalTax == null ? 'No certificado' : formatMoney(Number(selectedEvent.fiscalTax))}</dd>
                                    </div>
                                    <div className="is-strong">
                                        <dt>Total general</dt>
                                        <dd>{formatMoney(Number(selectedEvent.totalAmount || 0))}</dd>
                                    </div>
                                    <div>
                                        <dt>Total pagado</dt>
                                        <dd className="is-success">{formatMoney(paidTotal)}</dd>
                                    </div>
                                    <div>
                                        <dt>Saldo pendiente</dt>
                                        <dd className={Number(selectedEvent.balance || 0) > 0 ? 'is-danger' : undefined}>{formatMoney(Number(selectedEvent.balance || 0))}</dd>
                                    </div>
                                </dl>
                            </FormSection>

                            <FormSection
                                title="Documentos fiscales"
                                actions={(
                                    <>
                                        {!selectedEvent.fiscalInvoice && (
                                            <Button
                                                onClick={() => void handleIssueFiscalInvoice()}
                                                disabled={!canManageCatering || fiscalBusy || !['PAID', 'FINISHED'].includes(selectedEvent.status)}
                                                loading={fiscalBusy}
                                            >
                                                Emitir factura fiscal
                                            </Button>
                                        )}
                                        {!selectedEvent.fiscalCreditNote && selectedEvent.fiscalInvoice?.status === 'ISSUED' && (
                                            <Button onClick={() => void handleIssueFiscalCreditNote()} disabled={!canManageCatering || fiscalBusy} loading={fiscalBusy}>
                                                Emitir nota de crédito total
                                            </Button>
                                        )}
                                    </>
                                )}
                            >
                                {selectedEvent.fiscalInvoice ? (
                                    <p className="catering-line">
                                        Factura <strong>{selectedEvent.fiscalInvoice.number}</strong> · {selectedEvent.fiscalInvoice.status === 'CREDITED' ? 'Acreditada' : 'Emitida'}
                                    </p>
                                ) : (
                                    <p className="catering-line">Aún no se ha emitido la factura fiscal.</p>
                                )}

                                {selectedEvent.fiscalCreditNote ? (
                                    <p className="catering-line">
                                        Nota de crédito <strong>{selectedEvent.fiscalCreditNote.number}</strong> · {selectedEvent.fiscalCreditNote.reason}
                                    </p>
                                ) : selectedEvent.fiscalInvoice?.status === 'ISSUED' && (
                                    <>
                                        <Field label="Motivo fiscal de devolución total" htmlFor="catering-credit-reason">
                                            <Input
                                                id="catering-credit-reason"
                                                value={fiscalCreditReason}
                                                onChange={(event) => setFiscalCreditReason(event.target.value)}
                                                placeholder="Ej. cancelación total autorizada"
                                            />
                                        </Field>
                                        {activeNonCashPayments.map((payment) => (
                                            <Field
                                                key={payment.id}
                                                label={`Referencia reembolso ${payment.paymentMethod?.name || `pago #${payment.id}`}`}
                                                htmlFor={`catering-refund-${payment.id}`}
                                            >
                                                <Input
                                                    id={`catering-refund-${payment.id}`}
                                                    value={payment.id ? externalRefundReferences[payment.id] || '' : ''}
                                                    onChange={(event) => payment.id && setExternalRefundReferences((current) => ({ ...current, [payment.id!]: event.target.value }))}
                                                />
                                            </Field>
                                        ))}
                                        {selectedEvent.status === 'FINISHED' && (
                                            <Checkbox
                                                checked={returnCateringInventory}
                                                onChange={(event) => setReturnCateringInventory(event.target.checked)}
                                                label="La mercancía regresó físicamente: restaurar inventario y costo exactos"
                                            />
                                        )}
                                    </>
                                )}
                            </FormSection>

                            <FormSection
                                title="Registrar pago"
                                actions={(
                                    <Button variant="primary" icon={Plus} onClick={() => void handleAddPayment()} disabled={!canManageCatering || addingPayment} loading={addingPayment}>
                                        Agregar pago
                                    </Button>
                                )}
                            >
                                <FormGrid columns="repeat(auto-fit, minmax(12rem, 1fr))">
                                    <Field label="Monto" htmlFor="catering-payment-amount">
                                        <NumberInput
                                            id="catering-payment-amount"
                                            min={0}
                                            value={paymentData.amount || null}
                                            onChange={(v) => setPaymentData({ ...paymentData, amount: v ?? 0 })}
                                        />
                                    </Field>
                                    <Field label="Método de pago" htmlFor="catering-select-7">
                                        <AppSelect
                                            inputId="catering-select-7"
                                            value={paymentData.paymentMethodId || null}
                                            onChange={(option) => setPaymentData({ ...paymentData, paymentMethodId: option || '' })}
                                            options={paymentMethods.map((pm) => ({ value: pm.id.toString(), label: pm.name }))}
                                            placeholder="Seleccione..."
                                            isClearable
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <FormSection title="Historial de pagos">
                                {canManageCatering && selectedEvent.payments?.some((payment) => payment.status !== 'REVERSED') && (
                                    <Field label="Motivo del reverso" htmlFor="catering-reversal-reason">
                                        <Input
                                            id="catering-reversal-reason"
                                            value={reversalReason}
                                            onChange={(event) => setReversalReason(event.target.value)}
                                            placeholder="Ej. pago duplicado o devolución autorizada"
                                        />
                                    </Field>
                                )}
                                <DataTable<CateringPaymentEntry>
                                    ariaLabel="Historial de pagos"
                                    variant="flat"
                                    columns={paymentColumns}
                                    rows={selectedEvent.payments ?? []}
                                    rowKey={(p) => p.id ?? `${p.date}-${p.amount}`}
                                    hidePaginationIfSinglePage
                                    stackOnMobile
                                    empty="Aún no hay pagos registrados."
                                />
                            </FormSection>
                    </div>
                )}
            </FullScreenModal>
        </PageContent>
    );
}
