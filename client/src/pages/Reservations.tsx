import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, Phone, Plus, CheckCircle, XCircle, ChevronLeft, ChevronRight, Edit2, UserX } from 'lucide-react';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal,
    IconButton, Input, NumberInput, PageContent, PageHeader, SegmentedControl, Textarea,
    type Column, type Opt, type Tone,
} from '@/ui';
import SalonCards from '../components/SalonCards';
import { branchesAPI, reservationsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import type { Branch } from '../types';
import { formatLocalDateInput } from '../utils/dateInput';
import './Reservations.css';

interface Reservation {
    id: number;
    customerName: string;
    phone: string;
    email?: string;
    date: string;
    peopleCount: number;
    status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
    notes?: string;
    createdAt: string;
    branchId: number;
    branch?: { id: number; name: string };
    table?: { id: number; number: string; capacity: number; location?: string | null } | null;
}

// Allowed status transitions. The current status is always selectable; any
// target not listed here (for a given source) is disabled in the UI.
const RESERVATION_TRANSITIONS: Record<string, Reservation['status'][]> = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
};

const canTransitionReservation = (from: string, to: string): boolean =>
    from === to || (RESERVATION_TRANSITIONS[from]?.includes(to as Reservation['status']) ?? false);

export default function Reservations() {
    const { user } = useAuth();
    const { success, error: showError, warning: showWarning } = useAppToast();
    const { confirm } = useConfirmDialog();
    const userRoleNames = getUserRoleNames(user);
    const canManageReservations = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN', 'HOST'].includes(role));
    const canChooseReservationBranch = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
    const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week' | 'day'>('month');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [currentWeek, setCurrentWeek] = useState(new Date());
    const [currentDay, setCurrentDay] = useState(new Date());
    const [formData, setFormData] = useState({
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        date: '',
        time: '',
        guests: '2',
        notes: '',
        branchId: user?.branchId ? String(user.branchId) : ''
    });
    const [activeTab, setActiveTab] = useState<'cliente' | 'reserva' | 'notas'>('cliente');
    const [saving, setSaving] = useState(false);
    const [formDirty, setFormDirty] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);


    const loadReservations = useCallback(async () => {
        try {
            const response = await reservationsAPI.getAll();
            setReservations(response.data.data);
            setLoadError(false);
        } catch (error) {
            console.error('Error loading reservations:', error);
            setLoadError(true);
            showError('No se pudieron cargar las reservaciones.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadReservations();
    }, [loadReservations]);

    useEffect(() => {
        let cancelled = false;
        branchesAPI.getAll({ status: 'ACTIVE' })
            .then((response) => {
                if (cancelled) return;
                const rows = (response.data.data || []) as Branch[];
                setBranches(rows);
                if (!user?.branchId && rows.length === 1) {
                    setFormData((current) => ({ ...current, branchId: String(rows[0].id) }));
                }
            })
            .catch(() => {
                if (!cancelled) showError('No se pudieron cargar las sucursales para reservar.');
            });
        return () => { cancelled = true; };
    }, [showError, user?.branchId]);

    const handleOpenSidebar = (reservation?: Reservation) => {
        if (!reservation && !canManageReservations) {
            showWarning('No tienes permisos para gestionar reservaciones');
            return;
        }

        if (reservation) {
            setEditingReservation(reservation);
            const reservationDate = new Date(reservation.date);
            setFormData({
                customerName: reservation.customerName,
                customerPhone: reservation.phone,
                customerEmail: reservation.email || '',
                date: formatLocalDateInput(reservationDate),
                time: reservationDate.toTimeString().slice(0, 5),
                guests: reservation.peopleCount.toString(),
                notes: reservation.notes || '',
                branchId: String(reservation.branchId)
            });
        } else {
            setEditingReservation(null);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setFormData({
                customerName: '',
                customerPhone: '',
                customerEmail: '',
                date: formatLocalDateInput(tomorrow),
                time: '19:00',
                guests: '2',
                notes: '',
                branchId: user?.branchId ? String(user.branchId) : (branches.length === 1 ? String(branches[0].id) : '')
            });
        }
        setActiveTab('cliente');
        setFormDirty(false);
        setIsSidebarOpen(true);
    };

    const handleUpdateStatus = async (id: number, status: string) => {
        if (!canManageReservations) {
            showWarning('No tienes permisos para actualizar reservaciones');
            return;
        }
        if (status === 'CANCELLED') {
            if (!(await confirm('¿Cancelar esta reservación?', { variant: 'warning', confirmText: 'Sí, cancelar' }))) {
                return;
            }
        }
        if (status === 'NO_SHOW') {
            if (!(await confirm('¿Marcar esta reservación como no asistió?', { variant: 'warning', confirmText: 'Sí, no asistió' }))) {
                return;
            }
        }
        try {
            if (status === 'COMPLETED') {
                await reservationsAPI.checkIn(id);
                success('Llegada registrada y orden POS creada');
            } else {
                await reservationsAPI.updateStatus(id, status);
            }
            loadReservations();
        } catch (error: unknown) {
            console.error('Error updating status:', error);
            const apiMsg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            const errorMessage = apiMsg || (error instanceof Error ? error.message : '') || 'Error al actualizar el estado';
            showError(errorMessage);
        }
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!canManageReservations) {
            showWarning('No tienes permisos para guardar reservaciones');
            return;
        }

        if (!formData.customerName?.trim()) {
            showError('El nombre del cliente es obligatorio');
            setActiveTab('cliente');
            return;
        }
        if (!formData.customerPhone?.trim()) {
            showError('El teléfono es obligatorio');
            setActiveTab('cliente');
            return;
        }
        if (formData.customerEmail?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.customerEmail.trim())) {
            showError('El email no tiene un formato válido');
            setActiveTab('cliente');
            return;
        }
        if (!formData.date) {
            showError('La fecha es obligatoria');
            setActiveTab('reserva');
            return;
        }
        if (!formData.time) {
            showError('La hora es obligatoria');
            setActiveTab('reserva');
            return;
        }
        if (!editingReservation && !formData.branchId) {
            showError('Selecciona la sucursal de la reservación');
            setActiveTab('reserva');
            return;
        }
        if (!formData.guests || parseInt(formData.guests, 10) < 1) {
            showError('Indica el número de personas');
            setActiveTab('reserva');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                customerName: formData.customerName.trim(),
                phone: formData.customerPhone.trim(),
                email: formData.customerEmail || undefined,
                // Interpret the picked date+time as LOCAL wall-clock time. Building a
                // Date without a trailing "Z" uses the browser's timezone, and
                // toISOString() converts that exact instant to UTC — preserving the
                // wall-clock the host selected (the old `...Z` suffix forced the local
                // time to be treated as UTC, shifting it by the timezone offset).
                date: new Date(`${formData.date}T${formData.time}:00`).toISOString(),
                peopleCount: parseInt(formData.guests, 10),
                notes: formData.notes || undefined,
                ...(!editingReservation ? { branchId: Number(formData.branchId) } : {})
            };

            if (editingReservation) {
                await reservationsAPI.update(editingReservation.id, payload);
            } else {
                await reservationsAPI.create(payload);
            }

            setIsSidebarOpen(false);
            loadReservations();
            success(editingReservation ? 'Reservación actualizada' : 'Reservación creada');
        } catch (error: unknown) {
            console.error('Error saving reservation:', error);
            const resp = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string; errors?: Array<{ field: string; message: string }> } } }).response?.data
                : undefined;
            const detail = resp?.errors?.map(e => `${e.field}: ${e.message}`).join('\n');
            const apiMsg = resp?.message;
            const baseMsg = apiMsg || (error instanceof Error ? error.message : '') || 'Error al guardar la reservación';
            showError(detail ? `${baseMsg}\n\n${detail}` : baseMsg);
        } finally {
            setSaving(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PENDING': return 'status-pending';
            case 'CONFIRMED': return 'status-confirmed';
            case 'COMPLETED': return 'status-completed';
            case 'CANCELLED': return 'status-cancelled';
            case 'NO_SHOW': return 'status-cancelled';
            default: return '';
        }
    };

    const getStatusTone = (status: string): Tone => {
        switch (status) {
            case 'CONFIRMED': return 'success';
            case 'PENDING': return 'warning';
            case 'COMPLETED': return 'primary';
            case 'CANCELLED':
            case 'NO_SHOW': return 'danger';
            default: return 'neutral';
        }
    };

    const setField = (patch: Partial<typeof formData>) => {
        setFormData((current) => ({ ...current, ...patch }));
        setFormDirty(true);
    };

    const getStatusText = (status: string) => {
        const statusMap: Record<string, string> = {
            'PENDING': 'Pendiente',
            'CONFIRMED': 'Confirmada',
            'COMPLETED': 'Completada',
            'CANCELLED': 'Cancelada',
            'NO_SHOW': 'No Asistió'
        };
        return statusMap[status] || status;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    };

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Filter by status
    const statusFiltered = filterStatus === 'all'
        ? reservations
        : reservations.filter(r => r.status === filterStatus);

    // Filter by search query (name, phone, or date)
    const searchFiltered = statusFiltered.filter(r => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const matchesName = r.customerName?.toLowerCase().includes(query) || false;
        const matchesPhone = r.phone?.includes(query) || false;
        const matchesDate = formatDate(r.date).toLowerCase().includes(query);
        return matchesName || matchesPhone || matchesDate;
    });

    // Sort: upcoming first, then by date
    const sortedReservations = [...searchFiltered].sort((a, b) => {
        const now = new Date();
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);

        const aUpcoming = dateA >= now;
        const bUpcoming = dateB >= now;

        if (aUpcoming && !bUpcoming) return -1;
        if (!aUpcoming && bUpcoming) return 1;

        return dateA.getTime() - dateB.getTime();
    });

    // Calendar functions
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        return { daysInMonth, startingDayOfWeek, year, month };
    };

    const getReservationsForDate = (date: Date) => {
        return reservations.filter(r => {
            const resDate = new Date(r.date);
            return resDate.getDate() === date.getDate() &&
                resDate.getMonth() === date.getMonth() &&
                resDate.getFullYear() === date.getFullYear();
        });
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

    const handleStatusFromForm = async (next: Reservation['status']) => {
        if (!editingReservation) return;
        if (!canManageReservations) return;
        if (!canTransitionReservation(editingReservation.status, next)) return;
        if (next === 'CANCELLED') {
            if (!(await confirm('¿Cancelar esta reservación?', { variant: 'warning', confirmText: 'Sí, cancelar' }))) {
                return;
            }
        }
        if (next === 'NO_SHOW') {
            if (!(await confirm('¿Marcar esta reservación como no asistió?', { variant: 'warning', confirmText: 'Sí, no asistió' }))) {
                return;
            }
        }
        try {
            if (next === 'COMPLETED') {
                await reservationsAPI.checkIn(editingReservation.id);
                success('Llegada registrada y orden POS creada');
            } else {
                await reservationsAPI.updateStatus(editingReservation.id, next);
            }
            loadReservations();
            setIsSidebarOpen(false);
        } catch (err) {
            console.error('Error updating status:', err);
            const apiMsg = typeof err === 'object' && err !== null && 'response' in err
                ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(apiMsg || 'Error al actualizar el estado');
        }
    };

    if (loading) {
        return <div className="reservations-loading">Cargando reservaciones...</div>;
    }

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);

    const statusSegments: { value: string; label: string }[] = [
        { value: 'all', label: 'Todas' },
        { value: 'PENDING', label: 'Pendientes' },
        { value: 'CONFIRMED', label: 'Confirmadas' },
        { value: 'COMPLETED', label: 'Completadas' },
        { value: 'CANCELLED', label: 'Canceladas' },
        { value: 'NO_SHOW', label: 'No asistió' },
    ];
    const branchOptions: Opt<number>[] = branches.map((branch) => ({ value: branch.id, label: branch.name }));
    const reservationStatusOptions: Opt<Reservation['status']>[] = editingReservation
        ? ([
            { value: 'PENDING', label: 'Pendiente' },
            { value: 'CONFIRMED', label: 'Confirmada' },
            { value: 'COMPLETED', label: 'Completada' },
            { value: 'CANCELLED', label: 'Cancelada' },
            { value: 'NO_SHOW', label: 'No asistió' },
        ] as Opt<Reservation['status']>[]).map((opt) => ({
            ...opt,
            isDisabled: !canTransitionReservation(editingReservation.status, opt.value),
        }))
        : [];

    const columns: Column<Reservation>[] = [
        {
            key: 'customer',
            header: 'Cliente',
            width: '1fr',
            render: (r) => (
                <span>
                    <strong>{r.customerName}</strong>
                    {r.phone && <small className="reservations-cell-sub">{r.phone}</small>}
                </span>
            ),
        },
        { key: 'people', header: 'Personas', width: '1fr', type: 'number', decimals: 0, accessor: (r) => r.peopleCount },
        { key: 'table', header: 'Mesa', width: '1.2fr', render: (r) => r.table?.number || 'Sin asignar' },
        { key: 'date', header: 'Fecha y hora', width: '2.3fr', render: (r) => `${formatDate(r.date)} · ${formatTime(r.date)}` },
        { key: 'email', header: 'Email', width: '1fr', hideBelow: 'lg', render: (r) => r.email || '-' },
        { key: 'status', header: 'Estado', width: '1.5fr', type: 'status', render: (r) => <Badge tone={getStatusTone(r.status)} dot>{getStatusText(r.status)}</Badge> },
        {
            key: 'actions',
            header: 'Acciones',
            width: '1.7fr',
            type: 'actions',
            render: (r) => (
                <>
                    {canManageReservations && r.status === 'PENDING' && (
                        <>
                            <IconButton icon={CheckCircle} label={`Confirmar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'CONFIRMED')} />
                            <IconButton icon={XCircle} label={`Cancelar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'CANCELLED')} />
                        </>
                    )}
                    {canManageReservations && r.status === 'CONFIRMED' && (
                        <>
                            <IconButton icon={Users} label={`Completar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'COMPLETED')} />
                            <IconButton icon={UserX} label={`Marcar no asistió a ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'NO_SHOW')} />
                            <IconButton icon={XCircle} label={`Cancelar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'CANCELLED')} />
                        </>
                    )}
                    {canManageReservations && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                        <IconButton icon={Edit2} label={`Editar reservación de ${r.customerName}`} onClick={() => handleOpenSidebar(r)} />
                    )}
                </>
            ),
        },
    ];

    return (
        <PageContent>
            <PageHeader
                title="Reservaciones"
                description="Agenda de reservas por sucursal"
                actions={(
                    <>
                        <SegmentedControl
                            ariaLabel="Vista de reservaciones"
                            options={[{ value: 'table', label: 'Tabla' }, { value: 'calendar', label: 'Calendario' }]}
                            value={viewMode}
                            onChange={setViewMode}
                        />
                        {canManageReservations && (
                            <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()}>Nueva reservación</Button>
                        )}
                    </>
                )}
            />

            <SalonCards only="reservation" />

            {loadError && (
                <div className="reservations-warning" role="alert">
                    <span>No se pudieron cargar las reservaciones. Los datos mostrados pueden estar desactualizados.</span>
                    <Button size="sm" onClick={() => void loadReservations()}>Reintentar</Button>
                </div>
            )}

            {viewMode !== 'calendar' && (
                <div className="reservations-filters">
                    <SegmentedControl ariaLabel="Estado de la reservación" options={statusSegments} value={filterStatus} onChange={setFilterStatus} />
                    <div className="reservations-search">
                        <Input
                            aria-label="Buscar reservación"
                            placeholder="Buscar por nombre, teléfono o fecha..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            )}

            {/* Calendar View */}
            {viewMode === 'calendar' && (
                <div className="calendar-container">
                    {/* Calendar Header */}
                    <div className="calendar-header">
                        <div className="calendar-month-year">
                            <button className="calendar-nav-btn" onClick={handlePrevPeriod} aria-label="Periodo anterior">
                                <ChevronLeft size={20} />
                            </button>
                            <h2>{getCalendarTitle()}</h2>
                            <button className="calendar-nav-btn" onClick={handleNextPeriod} aria-label="Periodo siguiente">
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {/* Calendar View Mode Selector */}
                            <SegmentedControl
                                ariaLabel="Escala del calendario"
                                options={[{ value: 'day', label: 'Día' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }]}
                                value={calendarViewMode}
                                onChange={setCalendarViewMode}
                            />
                            <button className="today-btn" onClick={handleToday}>
                                Hoy
                            </button>
                        </div>
                    </div>

                    {/* Calendar Content - Changes based on view mode */}
                    {calendarViewMode === 'month' && (
                        <div className="calendar-grid">
                            {/* Day headers */}
                            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(day => (
                                <div key={day} className="calendar-day-header">{day}</div>
                            ))}

                            {/* Empty cells for days before month starts */}
                            {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                                <div key={`empty-${i}`} className="calendar-day empty"></div>
                            ))}

                            {/* Days of the month */}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const date = new Date(year, month, day);
                                const dayReservations = getReservationsForDate(date);
                                const isToday = new Date().toDateString() === date.toDateString();

                                return (
                                    <div
                                        key={day}
                                        className={`calendar-day ${isToday ? 'today' : ''} ${dayReservations.length > 0 ? 'has-reservations' : ''}`}
                                    >
                                        <div className="calendar-day-number">{day}</div>
                                        {dayReservations.length > 0 && (
                                            <div className="calendar-reservations">
                                                {dayReservations.slice(0, 3).map(res => (
                                                    <div
                                                        key={res.id}
                                                        className={`calendar-reservation-item ${getStatusColor(res.status)}`}
                                                        onClick={() => {
                                                            if (res.status === 'PENDING') {
                                                                handleOpenSidebar(res);
                                                            }
                                                        }}
                                                        style={{ cursor: res.status === 'PENDING' ? 'pointer' : 'default' }}
                                                        title={`${res.customerName} - ${formatTime(res.date)} - ${res.peopleCount} personas - ${getStatusText(res.status)}`}
                                                    >
                                                        <span className="res-time">{formatTime(res.date)}</span>
                                                        <span className="res-name">{res.customerName}</span>
                                                        <span className="res-people">{res.peopleCount}<Users size={10} /></span>
                                                    </div>
                                                ))}
                                                {dayReservations.length > 3 && (
                                                    <div className="calendar-more">+{dayReservations.length - 3} más</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Week View - Timeline by day */}
                    {calendarViewMode === 'week' && (
                        <div className="week-view">
                            {Array.from({ length: 7 }).map((_, dayIndex) => {
                                const weekStart = new Date(currentWeek);
                                weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                                const date = new Date(weekStart);
                                date.setDate(weekStart.getDate() + dayIndex);
                                const dayReservations = getReservationsForDate(date).sort((a, b) =>
                                    new Date(a.date).getTime() - new Date(b.date).getTime()
                                );
                                const isToday = new Date().toDateString() === date.toDateString();

                                return (
                                    <div key={dayIndex} className={`week-day ${isToday ? 'today' : ''}`}>
                                        <div className="week-day-header">
                                            <div className="week-day-name">{date.toLocaleDateString('es-ES', { weekday: 'short' })}</div>
                                            <div className="week-day-number">{date.getDate()}</div>
                                        </div>
                                        <div className="week-day-reservations">
                                            {dayReservations.length > 0 ? (
                                                dayReservations.map(res => (
                                                    <div
                                                        key={res.id}
                                                        className={`week-reservation-item ${getStatusColor(res.status)}`}
                                                        onClick={() => {
                                                            if (res.status === 'PENDING') {
                                                                handleOpenSidebar(res);
                                                            }
                                                        }}
                                                        style={{ cursor: res.status === 'PENDING' ? 'pointer' : 'default' }}
                                                    >
                                                        <div className="week-res-time">{formatTime(res.date)}</div>
                                                        <div className="week-res-name">{res.customerName}</div>
                                                        <div className="week-res-people"><Users size={14} /> {res.peopleCount}</div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="no-reservations">Sin reservaciones</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Day View - Timeline by hour */}
                    {calendarViewMode === 'day' && (
                        <div className="day-view">
                            {Array.from({ length: 24 }).map((_, hour) => {
                                const hourReservations = reservations.filter(r => {
                                    const resDate = new Date(r.date);
                                    return resDate.getDate() === currentDay.getDate() &&
                                        resDate.getMonth() === currentDay.getMonth() &&
                                        resDate.getFullYear() === currentDay.getFullYear() &&
                                        resDate.getHours() === hour;
                                }).sort((a, b) => new Date(a.date).getMinutes() - new Date(b.date).getMinutes());

                                return (
                                    <div key={hour} className="day-hour-slot">
                                        <div className="day-hour-label">
                                            {hour.toString().padStart(2, '0')}:00
                                        </div>
                                        <div className="day-hour-content">
                                            {hourReservations.length > 0 ? (
                                                hourReservations.map(res => (
                                                    <div
                                                        key={res.id}
                                                        className={`day-reservation-item ${getStatusColor(res.status)}`}
                                                        onClick={() => {
                                                            if (res.status === 'PENDING') {
                                                                handleOpenSidebar(res);
                                                            }
                                                        }}
                                                        style={{ cursor: res.status === 'PENDING' ? 'pointer' : 'default' }}
                                                    >
                                                        <div className="day-res-header">
                                                            <span className="day-res-time">{formatTime(res.date)}</span>
                                                            <span className={`day-res-status ${getStatusColor(res.status)}`}>
                                                                {getStatusText(res.status)}
                                                            </span>
                                                        </div>
                                                        <div className="day-res-name">{res.customerName}</div>
                                                        <div className="day-res-details">
                                                            <span><Users size={14} /> {res.peopleCount} personas</span>
                                                            {res.phone && <span><Phone size={14} /> {res.phone}</span>}
                                                        </div>
                                                        {res.notes && <div className="day-res-notes">{res.notes}</div>}
                                                    </div>
                                                ))
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {viewMode === 'table' && (
                <DataTable
                    ariaLabel="Reservaciones"
                    columns={columns}
                    rows={sortedReservations}
                    rowKey={(r) => r.id}
                    resetKey={`${filterStatus}|${searchQuery}`}
                    empty={(
                        <EmptyState
                            icon={Calendar}
                            title="No hay reservaciones"
                            description={searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'Crea una nueva reservación para comenzar'}
                        />
                    )}
                />
            )}

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingReservation ? 'Editar reservación' : 'Nueva reservación'}
                dirty={formDirty}
                tabs={[{ id: 'cliente', label: 'Cliente' }, { id: 'reserva', label: 'Reserva' }, { id: 'notas', label: 'Notas' }]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as 'cliente' | 'reserva' | 'notas')}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="secondary" onClick={requestClose}>Cancelar</Button>
                        {canManageReservations && (
                            <Button type="submit" form="reservation-form" variant="primary" loading={saving}>
                                {saving ? 'Guardando...' : editingReservation ? 'Actualizar reservación' : 'Crear reservación'}
                            </Button>
                        )}
                    </>
                )}
            >
                <form id="reservation-form" onSubmit={handleSubmit} noValidate>
                    {activeTab === 'cliente' && (
                        <FormSection title="Información del cliente">
                            <FormGrid>
                                <Field label="Nombre del cliente" htmlFor="reservation-customer-name" required>
                                    <Input
                                        id="reservation-customer-name"
                                        value={formData.customerName}
                                        onChange={(e) => setField({ customerName: e.target.value })}
                                        required
                                        placeholder="Nombre completo"
                                    />
                                </Field>
                                <Field label="Teléfono" htmlFor="reservation-phone" required>
                                    <Input
                                        id="reservation-phone"
                                        type="tel"
                                        value={formData.customerPhone}
                                        onChange={(e) => setField({ customerPhone: e.target.value })}
                                        required
                                        placeholder="Ej: +505 8888 8888"
                                    />
                                </Field>
                                <Field label="Email (opcional)" htmlFor="reservation-email">
                                    <Input
                                        id="reservation-email"
                                        type="email"
                                        value={formData.customerEmail}
                                        onChange={(e) => setField({ customerEmail: e.target.value })}
                                        placeholder="cliente@email.com"
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>
                    )}

                    {activeTab === 'reserva' && (
                        <FormSection title="Detalles de la reserva">
                            <FormGrid>
                                <Field label="Sucursal" htmlFor="reservation-branch" required>
                                    <AppSelect<number>
                                        inputId="reservation-branch"
                                        options={branchOptions}
                                        value={formData.branchId ? Number(formData.branchId) : null}
                                        onChange={(value) => setField({ branchId: value ? String(value) : '' })}
                                        isDisabled={Boolean(editingReservation) || (Boolean(user?.branchId) && !canChooseReservationBranch)}
                                        isClearable={false}
                                    />
                                </Field>
                                <Field label="Fecha" htmlFor="reservation-date" required>
                                    <DateInput
                                        id="reservation-date"
                                        value={formData.date}
                                        onChange={(e) => setField({ date: e.target.value })}
                                        required
                                    />
                                </Field>
                                <Field label="Hora" htmlFor="reservation-time" required>
                                    <Input
                                        id="reservation-time"
                                        type="time"
                                        value={formData.time}
                                        onChange={(e) => setField({ time: e.target.value })}
                                        required
                                    />
                                </Field>
                                <Field label="Número de personas" htmlFor="reservation-guests" required>
                                    <NumberInput
                                        id="reservation-guests"
                                        decimals={0}
                                        min={1}
                                        value={formData.guests === '' ? null : Number(formData.guests)}
                                        onChange={(value) => setField({ guests: value === null ? '' : String(value) })}
                                    />
                                </Field>
                                {editingReservation && canManageReservations && (
                                    <Field label="Estado" htmlFor="reservation-status">
                                        <AppSelect<Reservation['status']>
                                            inputId="reservation-status"
                                            options={reservationStatusOptions}
                                            value={editingReservation.status}
                                            isClearable={false}
                                            onChange={(value) => { if (value) void handleStatusFromForm(value); }}
                                        />
                                    </Field>
                                )}
                            </FormGrid>
                        </FormSection>
                    )}

                    {activeTab === 'notas' && (
                        <FormSection title="Notas y observaciones">
                            <Field label="Notas adicionales" htmlFor="reservation-notes">
                                <Textarea
                                    id="reservation-notes"
                                    rows={8}
                                    value={formData.notes}
                                    onChange={(e) => setField({ notes: e.target.value })}
                                    placeholder="Alergias, preferencias, ocasión especial (cumpleaños, aniversario)..."
                                />
                            </Field>
                        </FormSection>
                    )}
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
