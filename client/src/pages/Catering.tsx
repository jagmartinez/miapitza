import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
    Calendar, Users, Plus, MapPin, FileText,
    Download,
    Trash2, AlertCircle, DollarSign, ConciergeBell,
    Grid3x3, CalendarDays, ChevronLeft, ChevronRight, Phone,
    Eye
} from 'lucide-react';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import LoadingSpinner from '../components/LoadingSpinner';
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
    status?: 'ACTIVE' | 'REVERSED';
    reversedAt?: string | null;
    reversalReason?: string | null;
}

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
}

type CateringEventDetail = CateringEvent & {
    customerId?: string | number;
    branchId?: number;
    clauses?: CateringClausesForm;
};

export default function Catering() {
    const { formatMoney } = useCurrency();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canManageCatering = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [events, setEvents] = useState<CateringEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [savingEvent, setSavingEvent] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CateringEvent | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'calendar'>('grid');
    const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week' | 'day'>('month');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [currentWeek, setCurrentWeek] = useState(new Date());
    const [currentDay, setCurrentDay] = useState(new Date());
    const [filterStatus, setFilterStatus] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'info' | 'services' | 'menu' | 'clauses' | 'financial'>('info');

    // Master data
    const [allServices, setAllServices] = useState<CateringServiceCatalog[]>([]);
    const [allMenuItems, setAllMenuItems] = useState<MenuItem[]>([]);
    const [menuCategoryFilter, setMenuCategoryFilter] = useState('all');
    const [allBranches, setAllBranches] = useState<Branch[]>([]);
    const [allWarehouses, setAllWarehouses] = useState<Warehouse[]>([]);
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
    const [availabilityAlerts, setAvailabilityAlerts] = useState<string[]>([]);
    const [settings, setSettings] = useState<CateringCompanySettings>({});

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
    const paymentIdempotencyKeyRef = useRef(newIdempotencyKey());

    useEffect(() => {
        paymentIdempotencyKeyRef.current = newIdempotencyKey();
    }, [selectedEvent?.id, paymentData.amount, paymentData.paymentMethodId]);
    const [reversalReason, setReversalReason] = useState('');
    const [finishWarehouseId, setFinishWarehouseId] = useState<number | null>(null);

    const menuCategoryOptions = useMemo(
        () => [{ value: 'all', label: 'Todas las categorías' }, ...getMenuCategoryOptions(allMenuItems)],
        [allMenuItems]
    );
    const filteredMenuItems = useMemo(
        () => filterMenuItemsByCategory(allMenuItems, menuCategoryFilter),
        [allMenuItems, menuCategoryFilter]
    );

    const handleDownloadContract = useCallback(async (event: CateringEvent) => {
        try {
            const [{ pdf }, { default: ContractPDF }] = await Promise.all([
                import('@react-pdf/renderer'),
                import('../components/ContractPDF')
            ]);

            const contractEvent = {
                ...event,
                customer: event.customer || undefined
            };
            const blob = await pdf(<ContractPDF event={contractEvent} settings={settings} />).toBlob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Contrato_${event.title.replace(/\s+/g, '_')}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error generating contract PDF:', error);
            showError('Error al generar el contrato en PDF');
        }
    }, [settings, showError]);

    const loadEvents = useCallback(async () => {
        try {
            setLoading(true);
            const response = await cateringAPI.getAllEvents();
            setEvents(response.data.data);
        } catch (error) {
            console.error('Error loading catering events:', error);
            showError('No se pudieron cargar los eventos de catering.');
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
            showError('No se pudieron cargar sucursales, menú o métodos de pago de catering.');
        }
    }, [showError]);

    useEffect(() => {
        loadEvents();
        loadMasterData();
    }, [loadEvents, loadMasterData]);

    const handleOpenSidebar = async (event?: CateringEvent, tab: 'info' | 'services' | 'menu' | 'financial' = 'info') => {
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
                showError('No se pudo cargar el detalle del evento.');
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
                    await cateringAPI.updateEvent(selectedEvent.id, { status: 'FINISHED', warehouseId: finishWarehouseId });
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
            const message = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'No se pudo guardar el evento de catering.');
        } finally {
            setSavingEvent(false);
        }
    };

    const checkAvailability = async () => {
        try {
            const date = new Date(`${formData.date}T${formData.time}`).toISOString();
            const response = await cateringAPI.checkAvailability(
                date,
                formData.branchId ? Number(formData.branchId) : undefined
            );
            setAvailabilityAlerts(response.data.data?.alerts || []);
        } catch (error) {
            console.error('Error checking availability:', error);
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
    const taxDivisor = 1 + taxRate / 100;

    return (
        <div className="catering-page">
            {/* Header */}
            <div className="catering-header">
                <div>
                    <h1><ConciergeBell size={32} /> Servicios de Catering</h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <div className="view-toggle">
                        <button
                            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Vista de Tarjetas"
                        >
                            <Grid3x3 size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
                            onClick={() => setViewMode('calendar')}
                            title="Vista de Calendario"
                        >
                            <CalendarDays size={18} />
                        </button>
                    </div>
                    {canManageCatering && (
                        <Button onClick={() => handleOpenSidebar()}>
                            <Plus size={20} />
                            Nuevo Evento
                        </Button>
                    )}
                </div>
            </div>

            {/* Filters - Only show in grid view */}
            {viewMode === 'grid' && (
                <div className="catering-filters">
                    {/* Status Filters */}
                    <div className="filter-buttons">
                        <button
                            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('all')}
                        >
                            Todos
                        </button>
                        <button
                            className={`filter-btn quoted ${filterStatus === 'QUOTED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('QUOTED')}
                        >
                            Cotizados
                        </button>
                        <button
                            className={`filter-btn reserved ${filterStatus === 'RESERVED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('RESERVED')}
                        >
                            Reservados
                        </button>
                        <button
                            className={`filter-btn paid ${filterStatus === 'PAID' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('PAID')}
                        >
                            Pagados
                        </button>
                        <button
                            className={`filter-btn finished ${filterStatus === 'FINISHED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('FINISHED')}
                        >
                            Finalizados
                        </button>
                        <button
                            className={`filter-btn cancelled ${filterStatus === 'CANCELLED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('CANCELLED')}
                        >
                            Cancelados
                        </button>
                    </div>

                    {/* Stats and Search */}
                    <div className="filter-right-section">
                        {/* Stats Counters */}
                        <input
                            type="text"
                            placeholder="Buscar evento o cliente..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input catering-search"
                        />
                    </div>
                </div>
            )}

            {loading ? (
                <LoadingSpinner text="Cargando eventos..." />
            ) : viewMode === 'calendar' ? (
                <div className="calendar-container">
                    <div className="calendar-header">
                        <div className="calendar-month-year">
                            <button className="calendar-nav-btn" onClick={handlePrevPeriod}>
                                <ChevronLeft size={20} />
                            </button>
                            <h2>{getCalendarTitle()}</h2>
                            <button className="calendar-nav-btn" onClick={handleNextPeriod}>
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <div className="view-toggle" style={{ marginRight: '8px' }}>
                                <button
                                    className={`view-toggle-btn ${calendarViewMode === 'day' ? 'active' : ''}`}
                                    onClick={() => setCalendarViewMode('day')}
                                    title="Vista de día"
                                >
                                    Día
                                </button>
                                <button
                                    className={`view-toggle-btn ${calendarViewMode === 'week' ? 'active' : ''}`}
                                    onClick={() => setCalendarViewMode('week')}
                                    title="Vista de semana"
                                >
                                    Semana
                                </button>
                                <button
                                    className={`view-toggle-btn ${calendarViewMode === 'month' ? 'active' : ''}`}
                                    onClick={() => setCalendarViewMode('month')}
                                    title="Vista de mes"
                                >
                                    Mes
                                </button>
                            </div>
                            <button className="today-btn" onClick={handleToday}>
                                Hoy
                            </button>
                        </div>
                    </div>

                    {calendarViewMode === 'month' && (
                        <div className="calendar-grid">
                            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(d => (
                                <div key={d} className="calendar-day-header">{d}</div>
                            ))}
                            {(() => {
                                const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);
                                const cells = [];
                                for (let i = 0; i < startingDayOfWeek; i++) {
                                    cells.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
                                }
                                for (let day = 1; day <= daysInMonth; day++) {
                                    const date = new Date(year, month, day);
                                    const dayEvents = getEventsForDate(date);
                                    const isToday = new Date().toDateString() === date.toDateString();
                                    cells.push(
                                        <div key={day} className={`calendar-day ${isToday ? 'today' : ''} ${dayEvents.length > 0 ? 'has-events' : ''}`}>
                                            <div className="calendar-day-number">{day}</div>
                                            {dayEvents.length > 0 && (
                                                <div className="calendar-events">
                                                    {dayEvents.slice(0, 3).map(e => (
                                                        <div
                                                            key={e.id}
                                                            className={`calendar-event-item status-${e.status.toLowerCase()}`}
                                                            onClick={() => handleOpenSidebar(e)}
                                                            title={`${e.title} - ${e.customer?.name}`}
                                                        >
                                                            <span className="res-time">{new Date(e.date).getHours()}:{new Date(e.date).getMinutes().toString().padStart(2, '0')}</span>
                                                            <span className="res-name">{e.title}</span>
                                                        </div>
                                                    ))}
                                                    {dayEvents.length > 3 && (
                                                        <div className="calendar-more">+{dayEvents.length - 3} más</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }
                                return cells;
                            })()}
                        </div>
                    )}

                    {calendarViewMode === 'week' && (
                        <div className="week-view">
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
                                        <div key={i} className={`week-day ${isToday ? 'today' : ''}`}>
                                            <div className="week-day-header">
                                                <div className="week-day-name">{date.toLocaleDateString('es-ES', { weekday: 'short' })}</div>
                                                <div className="week-day-number">{date.getDate()}</div>
                                            </div>
                                            <div className="week-day-events">
                                                {dayEvents.map(e => (
                                                    <div key={e.id} className={`week-event-item status-${e.status.toLowerCase()}`} onClick={() => handleOpenSidebar(e)}>
                                                        <div className="year-event-time">{new Date(e.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
                                                        <div className="week-event-name">{e.title}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }
                                return days;
                            })()}
                        </div>
                    )}

                    {calendarViewMode === 'day' && (
                        <div className="day-view">
                            {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map(hour => {
                                const dayEvents = getEventsForDate(currentDay).filter(e => new Date(e.date).getHours() === hour);
                                return (
                                    <div key={hour} className="day-hour-slot">
                                        <div className="day-hour-label">{hour}:00</div>
                                        <div className="day-hour-content">
                                            {dayEvents.map(e => (
                                                <div key={e.id} className={`day-event-item status-${e.status.toLowerCase()}`} onClick={() => handleOpenSidebar(e)}>
                                                    <div className="day-event-info">
                                                        <span className="day-event-time">{new Date(e.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span className="day-event-name">{e.title}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : filteredEvents.length === 0 ? (
                <div className="empty-state">
                    <FileText size={64} opacity={0.2} />
                    <p>No se encontraron eventos</p>
                </div>
            ) : (
                <div className="catering-grid">
                    {filteredEvents.map(event => (
                        <div key={event.id} className={`table-card-new status-${event.status.toLowerCase()}`} onClick={() => handleOpenSidebar(event)}>
                            {/* Status Badge */}
                            <div className={`status-badge-new status-${event.status.toLowerCase()}`}>
                                <span>{getStatusText(event.status)}</span>
                            </div>

                            {/* Card Body */}
                            <div className="table-card-body-new">
                                <div className="table-number-new">{event.title}</div>

                                <div className="table-details-new">
                                    <div className="detail-item">
                                        <Users size={16} />
                                        <span>{event.customer?.name || 'Sin Cliente'}</span>
                                    </div>
                                    {event.customer?.phone && (
                                        <div className="detail-item">
                                            <Phone size={16} />
                                            <span>{event.customer.phone}</span>
                                        </div>
                                    )}
                                    <div className="detail-item" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', opacity: 0.8 }}>
                                        <Calendar size={14} />
                                        <span>{new Date(event.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} • {new Date(event.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <div className="detail-item" style={{ opacity: 0.8 }}>
                                        <Users size={14} />
                                        <span>{event.peopleCount} personas</span>
                                    </div>
                                    {event.location && (
                                        <div className="detail-item" style={{ opacity: 0.8 }}>
                                            <MapPin size={14} />
                                            <span>{event.location}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions Footer */}
                            <div className="table-card-actions-new" onClick={(e) => e.stopPropagation()}>
                                <button
                                    className="action-btn-new view"
                                    onClick={() => handleOpenSidebar(event, 'info')}
                                >
                                    <Eye size={20} />
                                    <span>Ver</span>
                                </button>

                                <button
                                    className="action-btn-new"
                                    onClick={() => handleOpenSidebar(event, 'financial')}
                                >
                                    <DollarSign size={20} />
                                    <span>Pagos</span>
                                </button>

                                <button
                                    className="action-btn-new"
                                    onClick={() => void handleDownloadContract(event)}
                                >
                                    <Download size={20} />
                                    <span>PDF</span>
                                </button>

                                {canManageCatering && (
                                    <button
                                        className="action-btn-new delete"
                                        onClick={async () => {
                                            if (await confirm('¿Estás seguro de eliminar este evento?', { title: 'Confirmar acción' })) {
                                                try {
                                                    await cateringAPI.deleteEvent(event.id);
                                                    loadEvents();
                                                } catch (error) {
                                                    console.error('Error deleting event:', error);
                                                }
                                            }
                                        }}
                                        title="Eliminar"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={selectedEvent ? `Editar: ${selectedEvent.title}` : 'Nuevo Evento de Catering'}
                width="wide"
            >
                <div className="premium-modal-content catering-modal-content catering-event-modal-content">
                    <div className="modal-tabs" role="tablist" aria-label="Secciones del evento de catering">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'info'}
                            className={`modal-tab ${activeTab === 'info' ? 'active' : ''}`}
                            onClick={() => setActiveTab('info')}
                        >
                            <FileText size={18} />
                            <span>Datos</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'services'}
                            className={`modal-tab ${activeTab === 'services' ? 'active' : ''}`}
                            onClick={() => setActiveTab('services')}
                        >
                            <ConciergeBell size={18} />
                            <span>Servicios</span>
                            {formData.services.length > 0 && <b>{formData.services.length}</b>}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'menu'}
                            className={`modal-tab ${activeTab === 'menu' ? 'active' : ''}`}
                            onClick={() => setActiveTab('menu')}
                        >
                            <Users size={18} />
                            <span>Menú</span>
                            {formData.menuItems.length > 0 && <b>{formData.menuItems.length}</b>}
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'clauses'}
                            className={`modal-tab ${activeTab === 'clauses' ? 'active' : ''}`}
                            onClick={() => setActiveTab('clauses')}
                        >
                            <FileText size={18} />
                            <span>Contrato</span>
                        </button>
                        {selectedEvent && (
                            <button
                                type="button"
                                role="tab"
                                aria-selected={activeTab === 'financial'}
                                className={`modal-tab ${activeTab === 'financial' ? 'active' : ''}`}
                                onClick={() => setActiveTab('financial')}
                            >
                                <DollarSign size={18} />
                                <span>Finanzas</span>
                            </button>
                        )}
                    </div>

                    <div className="modal-tab-content">
                        {activeTab === 'info' && (
                            <div className="catering-tab-panel catering-info-layout">
                                <section className="modal-content-group catering-event-section catering-customer-section">
                                    <div className="catering-section-heading">
                                        <span><Users size={18} /></span>
                                        <div><h3>Cliente</h3><p>Persona o empresa responsable de la contratación.</p></div>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-customer-name">Nombre del cliente</label>
                                            <input
                                                id="catering-customer-name"
                                                className="modal-standard-input"
                                                placeholder="Ej: Juan Pérez"
                                                value={formData.customerName}
                                                onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-customer-tax-id">Cédula / RUC</label>
                                            <input
                                                id="catering-customer-tax-id"
                                                className="modal-standard-input"
                                                placeholder="Ej: 001-000000-0000X"
                                                value={formData.customerTaxId}
                                                onChange={e => setFormData({ ...formData, customerTaxId: e.target.value })}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-customer-phone">Teléfono</label>
                                            <input
                                                id="catering-customer-phone"
                                                type="tel"
                                                className="modal-standard-input"
                                                placeholder="Ej: +505 8888-8888"
                                                value={formData.customerPhone}
                                                onChange={e => setFormData({ ...formData, customerPhone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section className="modal-content-group catering-event-section catering-event-section-main">
                                    <div className="catering-section-heading">
                                        <span><Calendar size={18} /></span>
                                        <div><h3>Evento</h3><p>Define dónde, cuándo y para cuántas personas.</p></div>
                                    </div>
                                    <div className="modal-form-row">
                                        <Select
                                            variant="modal"
                                            label="Sucursal"
                                            value={
                                                formData.branchId
                                                    ? {
                                                        value: formData.branchId,
                                                        label: allBranches.find((b) => b.id.toString() === formData.branchId)?.name || ''
                                                    }
                                                    : null
                                            }
                                            onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                                setFormData({ ...formData, branchId: option?.value || '' })}
                                            options={allBranches.map((b) => ({ value: b.id.toString(), label: b.name }))}
                                            placeholder="Seleccione Sucursal..."
                                            isClearable
                                            isSearchable
                                        />
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-event-title">Título del evento</label>
                                            <input
                                                id="catering-event-title"
                                                className="modal-standard-input"
                                                placeholder="Ej: Cumpleaños de María"
                                                value={formData.title}
                                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-event-date">Fecha</label>
                                            <input
                                                id="catering-event-date"
                                                type="date"
                                                className="modal-standard-input"
                                                value={formData.date}
                                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-event-time">Hora</label>
                                            <input
                                                id="catering-event-time"
                                                type="time"
                                                className="modal-standard-input"
                                                value={formData.time}
                                                onChange={e => setFormData({ ...formData, time: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="modal-form-row">
                                        <Select
                                            variant="modal"
                                            label="Estado"
                                            value={{ value: formData.status, label: getStatusText(formData.status) }}
                                            onChange={(option: SingleValue<{ value: CateringEvent['status']; label: string }>) => {
                                                if (!option) return;
                                                setFormData({ ...formData, status: option.value });
                                                if (option.value !== 'FINISHED') setFinishWarehouseId(null);
                                            }}
                                            options={getCateringStatusOptions(selectedEvent?.status).map((value) => ({
                                                value,
                                                label: getStatusText(value),
                                            }))}
                                            isDisabled={Boolean(selectedEvent && isCateringStatusTerminal(selectedEvent.status))}
                                            isSearchable={false}
                                        />
                                        {selectedEvent?.status === 'RESERVED' && (
                                            <small>El estado Pagado se asigna automáticamente al completar el saldo.</small>
                                        )}
                                        {selectedEvent?.status === 'PAID' && formData.status === 'FINISHED' && (
                                            <Select
                                                variant="modal"
                                                label="Bodega para consumo"
                                                options={allWarehouses
                                                    .filter((warehouse) => warehouse.type === 'BRANCH' && warehouse.branchId === Number(formData.branchId))
                                                    .map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))}
                                                value={allWarehouses
                                                    .filter((warehouse) => warehouse.id === finishWarehouseId)
                                                    .map((warehouse) => ({ value: warehouse.id, label: `${warehouse.name} (${warehouse.code})` }))[0] ?? null}
                                                onChange={(option: SingleValue<{ value: number; label: string }>) => setFinishWarehouseId(option?.value ?? null)}
                                                placeholder="Seleccionar bodega de la sucursal..."
                                                noOptionsMessage={() => 'No hay bodegas de sucursal disponibles'}
                                            />
                                        )}
                                        <div className="modal-input-group">
                                            <label htmlFor="catering-people-count">Invitados</label>
                                            <input
                                                id="catering-people-count"
                                                type="number"
                                                min="1"
                                                className="modal-standard-input"
                                                value={formData.peopleCount}
                                                onChange={e => setFormData({ ...formData, peopleCount: parseInt(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section className="modal-content-group catering-event-section catering-event-section-full">
                                    <div className="catering-section-heading">
                                        <span><MapPin size={18} /></span>
                                        <div><h3>Logística y notas</h3><p>Agrega la dirección y cualquier indicación operativa.</p></div>
                                    </div>
                                    <div className="modal-input-group">
                                        <label htmlFor="catering-location">Ubicación</label>
                                        <input
                                            id="catering-location"
                                            className="modal-standard-input"
                                            value={formData.location}
                                            onChange={e => setFormData({ ...formData, location: e.target.value })}
                                        />
                                    </div>
                                    <div className="modal-input-group" style={{ marginTop: '12px' }}>
                                        <label htmlFor="catering-notes">Notas</label>
                                        <textarea
                                            id="catering-notes"
                                            className="modal-standard-input"
                                            rows={4}
                                            value={formData.notes}
                                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                        />
                                    </div>
                                </section>
                            </div>
                        )}

                        {activeTab === 'services' && (
                            <div className="catering-tab-panel">
                                <div className="catering-tab-toolbar single-control">
                                    <Select
                                        variant="modal"
                                        label="Agregar Servicio"
                                        value={null}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => {
                                            if (option) {
                                                const service = allServices.find((s) => s.id.toString() === option.value);
                                                if (service) {
                                                    setFormData({
                                                        ...formData,
                                                        services: [...formData.services, { service, quantity: 1, unitPrice: service.salePrice ?? 0 }]
                                                    });
                                                }
                                            }
                                        }}
                                        options={allServices.map((s) => ({ value: s.id.toString(), label: `${s.name} - ${formatMoney(Number(s.salePrice))}` }))}
                                        placeholder="Seleccione un servicio..."
                                        isClearable
                                        isSearchable
                                    />
                                </div>

                                <div className="items-table">
                                    {formData.services.length > 0 && (
                                        <div className="items-table-header">
                                            <span>Servicio</span>
                                            <span>Precio</span>
                                            <span>Cant.</span>
                                            <span>Subtotal</span>
                                            <span></span>
                                        </div>
                                    )}
                                    {formData.services.length === 0 && (
                                        <div className="catering-empty-items">
                                            <ConciergeBell size={24} aria-hidden="true" />
                                            <strong>Sin servicios agregados</strong>
                                            <span>Selecciona un servicio para incorporarlo al evento.</span>
                                        </div>
                                    )}
                                    {formData.services.map((item, index) => (
                                        <div key={index} className="items-table-row">
                                            <span>{item.service?.name || 'Servicio'}</span>
                                            <span>{formatMoney(Number(item.unitPrice))}</span>
                                            <input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    const newServices = [...formData.services];
                                                    newServices[index].quantity = parseInt(e.target.value) || 1;
                                                    setFormData({ ...formData, services: newServices });
                                                }}
                                            />
                                            <span>{formatMoney(Number(item.quantity * item.unitPrice))}</span>
                                            <button
                                                type="button"
                                                className="remove-btn"
                                                onClick={() => {
                                                    const newServices = formData.services.filter((_, i) => i !== index);
                                                    setFormData({ ...formData, services: newServices });
                                                }}
                                            >
                                                <Trash2 size={16} />
                                                <span className="sr-only">Quitar servicio</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'menu' && (
                            <div className="catering-tab-panel">
                                <div className="catering-tab-toolbar">
                                    <Select
                                        variant="modal"
                                        label="Categoría"
                                        value={menuCategoryOptions.find((option) => option.value === menuCategoryFilter) ?? menuCategoryOptions[0]}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => setMenuCategoryFilter(option?.value ?? 'all')}
                                        options={menuCategoryOptions}
                                        placeholder="Todas las categorías"
                                    />
                                    <Select
                                        variant="modal"
                                        label="Agregar Plato"
                                        value={null}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => {
                                            if (option) {
                                                const menuItem = allMenuItems.find((m) => m.id.toString() === option.value);
                                                if (menuItem) {
                                                    setFormData({
                                                        ...formData,
                                                        menuItems: [...formData.menuItems, { menuItem, quantity: 1, unitPrice: menuItem.price || 0 }]
                                                    });
                                                }
                                            }
                                        }}
                                        options={filteredMenuItems.map((m) => ({ value: m.id.toString(), label: `${m.name} · ${m.category?.name || 'Sin categoría'} - ${formatMoney(Number(m.price || 0))}` }))}
                                        placeholder="Seleccione un plato..."
                                        isClearable
                                        isSearchable
                                    />
                                    <Button type="button" variant="ghost" className="catering-stock-check" onClick={checkAvailability}>
                                        <AlertCircle size={18} />
                                        <span>Verificar inventario</span>
                                    </Button>
                                </div>

                                {availabilityAlerts.length > 0 && (
                                    <div className="availability-alert">
                                        <AlertCircle size={20} />
                                        <div>
                                            <strong>Alertas de Inventario:</strong>
                                            <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
                                                {availabilityAlerts.map((alert, i) => <li key={i}>{alert}</li>)}
                                            </ul>
                                        </div>
                                    </div>
                                )}

                                <div className="items-table">
                                    {formData.menuItems.length > 0 && (
                                        <div className="items-table-header">
                                            <span>Plato</span>
                                            <span>Precio</span>
                                            <span>Cant.</span>
                                            <span>Subtotal</span>
                                            <span></span>
                                        </div>
                                    )}
                                    {formData.menuItems.length === 0 && (
                                        <div className="catering-empty-items">
                                            <Users size={24} aria-hidden="true" />
                                            <strong>Menú pendiente</strong>
                                            <span>Selecciona los platos que formarán parte del evento.</span>
                                        </div>
                                    )}
                                    {formData.menuItems.map((item, index) => (
                                        <div key={index} className="items-table-row">
                                            <span>{item.menuItem?.name || 'Plato'}</span>
                                            <span>{formatMoney(Number(item.unitPrice))}</span>
                                            <input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => {
                                                    const newMenu = [...formData.menuItems];
                                                    newMenu[index].quantity = parseInt(e.target.value) || 1;
                                                    setFormData({ ...formData, menuItems: newMenu });
                                                }}
                                            />
                                            <span>{formatMoney(Number(item.quantity * item.unitPrice))}</span>
                                            <button
                                                type="button"
                                                className="remove-btn"
                                                onClick={() => {
                                                    const newMenu = formData.menuItems.filter((_, i) => i !== index);
                                                    setFormData({ ...formData, menuItems: newMenu });
                                                }}
                                            >
                                                <Trash2 size={16} />
                                                <span className="sr-only">Quitar plato</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'clauses' && (
                            <div className="catering-tab-panel">
                                <div className="modal-content-group">
                                    <h3 className="section-title-v2">Cláusulas del Contrato</h3>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: '16px' }}>
                                        Defina los términos específicos para este evento de catering.
                                    </p>

                                    <div className="modal-input-group">
                                        <label>Manifiestan (Introducción)</label>
                                        <textarea
                                            className="modal-standard-input"
                                            rows={2}
                                            placeholder="Declaraciones iniciales de las partes..."
                                            value={formData.clauses.manifiestan}
                                            onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, manifiestan: e.target.value } })}
                                        />
                                    </div>

                                    <div className="modal-input-group" style={{ marginTop: '16px' }}>
                                        <label>Objeto del Contrato</label>
                                        <textarea
                                            className="modal-standard-input"
                                            rows={2}
                                            placeholder="Descripción detallada del servicio contratado..."
                                            value={formData.clauses.objetoContrato}
                                            onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, objetoContrato: e.target.value } })}
                                        />
                                    </div>

                                    <div className="modal-form-row" style={{ marginTop: '16px' }}>
                                        <div className="modal-input-group">
                                            <label>Duración del Servicio</label>
                                            <textarea
                                                className="modal-standard-input"
                                                rows={2}
                                                placeholder="Ej: 5 horas desde el inicio..."
                                                value={formData.clauses.duracionServicio}
                                                onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, duracionServicio: e.target.value } })}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label>Gastos durante el Servicio</label>
                                            <textarea
                                                className="modal-standard-input"
                                                rows={2}
                                                placeholder="Ej: Incluye transporte y limpieza..."
                                                value={formData.clauses.gastosServicio}
                                                onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, gastosServicio: e.target.value } })}
                                            />
                                        </div>
                                    </div>

                                    <div className="modal-input-group" style={{ marginTop: '16px' }}>
                                        <label>Demora de Pago</label>
                                        <textarea
                                            className="modal-standard-input"
                                            rows={2}
                                            placeholder="Penalidades o condiciones por retraso en pagos..."
                                            value={formData.clauses.demoraPago}
                                            onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, demoraPago: e.target.value } })}
                                        />
                                    </div>

                                    <div className="modal-input-group" style={{ marginTop: '16px' }}>
                                        <label>Obligaciones del Proveedor</label>
                                        <textarea
                                            className="modal-standard-input"
                                            rows={3}
                                            placeholder="Compromisos específicos de la empresa..."
                                            value={formData.clauses.obligacionesProveedor}
                                            onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, obligacionesProveedor: e.target.value } })}
                                        />
                                    </div>

                                    <div className="modal-input-group" style={{ marginTop: '16px' }}>
                                        <label>Obligaciones del Cliente</label>
                                        <textarea
                                            className="modal-standard-input"
                                            rows={3}
                                            placeholder="Compromisos específicos del cliente..."
                                            value={formData.clauses.obligacionesCliente}
                                            onChange={e => setFormData({ ...formData, clauses: { ...formData.clauses, obligacionesCliente: e.target.value } })}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'financial' && selectedEvent && (
                            <div className="catering-tab-panel">
                                <div className="financial-container">
                                    <div className="financial-secondary-row">
                                        <div className="summary-box-plain">
                                            <span className="label">Subtotal</span>
                                            <span className="value">{formatMoney(Number(selectedEvent.totalAmount || 0) / taxDivisor)}</span>
                                        </div>
                                        <div className="summary-box-plain">
                                            <span className="label">IVA ({taxRate}%)</span>
                                            <span className="value">{formatMoney(Number(selectedEvent.totalAmount || 0) * (taxRate / 100) / taxDivisor)}</span>
                                        </div>
                                    </div>

                                    <div className="financial-main-row">
                                        <div className="summary-item highlighted">
                                            <span className="label">Total General</span>
                                            <span className="value">{formatMoney(Number(selectedEvent.totalAmount || 0))}</span>
                                        </div>
                                        <div className="summary-item success">
                                            <span className="label">Total Pagado</span>
                                            <span className="value">{formatMoney(selectedEvent.payments?.filter((p) => p.status !== 'REVERSED').reduce((sum, p) => sum + Number(p.amount), 0) || 0)}</span>
                                        </div>
                                        <div className="summary-item danger">
                                            <span className="label">Saldo Pendiente</span>
                                            <span className="value">{formatMoney(Number(selectedEvent.balance || 0))}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="payment-form" style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                                    <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem' }}>
                                        Registrar Pago
                                    </h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: '12px', alignItems: 'flex-end' }}>
                                        <div className="modal-input-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.7rem' }}>Monto</label>
                                            <input
                                                type="number"
                                                className="modal-standard-input"
                                                value={paymentData.amount}
                                                style={{ height: '40px', boxSizing: 'border-box' }}
                                                onChange={e => setPaymentData({ ...paymentData, amount: parseFloat(e.target.value) })}
                                            />
                                        </div>
                                        <Select
                                            variant="modal"
                                            label="Método de Pago"
                                            value={
                                                paymentData.paymentMethodId
                                                    ? {
                                                        value: paymentData.paymentMethodId,
                                                        label: paymentMethods.find((pm) => pm.id.toString() === paymentData.paymentMethodId)?.name || ''
                                                    }
                                                    : null
                                            }
                                            onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                                setPaymentData({ ...paymentData, paymentMethodId: option?.value || '' })}
                                            options={paymentMethods.map((pm) => ({ value: pm.id.toString(), label: pm.name }))}
                                            placeholder="Seleccione..."
                                            isClearable
                                            isSearchable={false}
                                        />
                                        <div className="modal-input-group" style={{ marginBottom: 0 }}>
                                            <Button onClick={handleAddPayment} disabled={!canManageCatering || addingPayment} style={{ height: '40px', padding: '0 20px', whiteSpace: 'nowrap' }}>
                                                Agregar Pago
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                <div className="payments-list">
                                    <h3 style={{ marginTop: '30px', marginBottom: '10px' }}>Historial de Pagos</h3>
                                    {canManageCatering && selectedEvent.payments?.some((payment) => payment.status !== 'REVERSED') && (
                                        <div className="modal-input-group" style={{ marginBottom: '12px' }}>
                                            <label>Motivo del reverso</label>
                                            <input
                                                className="modal-standard-input"
                                                value={reversalReason}
                                                onChange={(event) => setReversalReason(event.target.value)}
                                                placeholder="Ej. pago duplicado o devolución autorizada"
                                            />
                                        </div>
                                    )}
                                    <div className="items-table">
                                        <div className="items-table-header" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                                            <span>Fecha</span>
                                            <span>Método</span>
                                            <span>Monto</span>
                                            <span>Estado</span>
                                        </div>
                                        {selectedEvent.payments?.map((p, i) => (
                                            <div key={p.id ?? i} className="items-table-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                                                <span>{p.date ? new Date(p.date).toLocaleDateString() : '-'}</span>
                                                <span>{p.paymentMethod?.name}</span>
                                                <span>{formatMoney(Number(p.amount))}</span>
                                                <span>
                                                    {p.status === 'REVERSED' ? `Revertido${p.reversalReason ? `: ${p.reversalReason}` : ''}` : (
                                                        canManageCatering
                                                            ? <Button variant="secondary" onClick={() => handleReversePayment(p)}>Revertir</Button>
                                                            : 'Activo'
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="modal-footer catering-modal-footer">
                        <div className="catering-modal-total">
                            <div className="tab-total-preview">
                                <span className="catering-total-label">Total estimado:</span>
                                <span className="catering-total-value">{formatMoney(calculateTabTotals())}</span>
                            </div>
                        </div>
                        <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>Cancelar</Button>
                        {canManageCatering && (
                            <Button type="button" onClick={handleSave} disabled={savingEvent}>
                                {savingEvent ? 'Guardando...' : selectedEvent ? 'Guardar Cambios' : 'Crear Evento'}
                            </Button>
                        )}
                    </div>
                </div>
            </Sidebar >
        </div >
    );
}
