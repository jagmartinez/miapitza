import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Calendar, CalendarDays, Users, Phone, Plus, CheckCircle2, Ban, ChevronLeft, ChevronRight, Pencil, UserX, Search, Table2 } from 'lucide-react';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormGrid, FormSection, FullScreenModal,
    IconButton, Input, LoadErrorState, NumberInput, PageContent, PageHeader, SegmentedControl, TableToolbar, Tabs, Textarea,
    type Column, type Opt, type Tone,
} from '@/ui';
import { branchesAPI, reservationsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import type { Branch } from '../types';
import { formatLocalDateInput } from '../utils/dateInput';
import './Reservations.css';
import { getApiErrorMessage } from '../utils/apiError';

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
    const [loadError, setLoadError] = useState<string | null>(null);
    const [branches, setBranches] = useState<Branch[]>([]);


    const loadReservations = useCallback(async () => {
        try {
            setLoading(true);
            const response = await reservationsAPI.getAll();
            setReservations(response.data.data);
            setLoadError(null);
        } catch (error) {
            console.error('Error loading reservations:', error);
            setLoadError(getApiErrorMessage(error, 'No se pudieron cargar las reservaciones (se conserva la última información disponible hasta reintentar)'));
        } finally {
            setLoading(false);
        }
    }, []);

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
            .catch((error) => {
                if (!cancelled) showError(getApiErrorMessage(error, 'No se pudieron cargar las sucursales para reservar'));
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
            showError(getApiErrorMessage(error, 'Error al actualizar el estado'));
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
            // getApiErrorMessage already appends field-level validation details.
            showError(getApiErrorMessage(error, 'Error al guardar la reservación'));
        } finally {
            setSaving(false);
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
            showError(getApiErrorMessage(err, 'Error al actualizar el estado'));
        }
    };

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);

    const statusTabs = ([
        ['all', 'Todas'],
        ['PENDING', 'Pendientes'],
        ['CONFIRMED', 'Confirmadas'],
        ['COMPLETED', 'Completadas'],
        ['CANCELLED', 'Canceladas'],
        ['NO_SHOW', 'No asistió'],
    ] as const).map(([id, label]) => ({
        id,
        label,
        // Sin datos fiables (carga inicial o error) no se muestra 0: el conteo es desconocido.
        badge: loading && reservations.length === 0 || loadError ? undefined
            : id === 'all' ? reservations.length : reservations.filter((r) => r.status === id).length,
    }));
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

    // Solo las reservaciones pendientes se editan desde el calendario.
    const calendarItem = (res: Reservation, className: string, children: ReactNode) => {
        const summary = `${res.customerName} - ${formatTime(res.date)} - ${res.peopleCount} personas - ${getStatusText(res.status)}`;
        return res.status === 'PENDING' ? (
            <button
                key={res.id}
                type="button"
                className={`${className} res-item`}
                data-status={res.status}
                title={summary}
                onClick={() => handleOpenSidebar(res)}
            >
                {children}
            </button>
        ) : (
            <div key={res.id} className={`${className} res-item`} data-status={res.status} title={summary}>
                {children}
            </div>
        );
    };

    const columns: Column<Reservation>[] = [
        {
            key: 'customer',
            header: 'Cliente',
            render: (r) => (
                <span>
                    <strong>{r.customerName}</strong>
                    {r.phone && <small className="reservations-cell-sub">{r.phone}</small>}
                </span>
            ),
        },
        { key: 'people', header: 'Personas', type: 'qty', decimals: 0, accessor: (r) => r.peopleCount },
        { key: 'table', header: 'Mesa', render: (r) => r.table?.number || 'Sin asignar' },
        { key: 'date', header: 'Fecha', type: 'date', render: (r) => formatDate(r.date) },
        { key: 'time', header: 'Hora', type: 'time', render: (r) => formatTime(r.date) },
        { key: 'email', header: 'Email', hideBelow: 'lg', render: (r) => r.email || '-' },
        { key: 'status', header: 'Estado', type: 'status', render: (r) => <Badge tone={getStatusTone(r.status)} dot>{getStatusText(r.status)}</Badge> },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            render: (r) => (
                <>
                    {canManageReservations && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                        <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar reservación de ${r.customerName}`} onClick={() => handleOpenSidebar(r)} />
                    )}
                    {canManageReservations && r.status === 'PENDING' && (
                        <IconButton size="sm" icon={CheckCircle2} tone="primary" tooltip="Confirmar" label={`Confirmar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'CONFIRMED')} />
                    )}
                    {canManageReservations && r.status === 'CONFIRMED' && (
                        <>
                            <IconButton size="sm" icon={CheckCircle2} tone="primary" tooltip="Completar" label={`Completar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'COMPLETED')} />
                            <IconButton size="sm" icon={UserX} tooltip="No asistió" label={`Marcar no asistió a ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'NO_SHOW')} />
                        </>
                    )}
                    {canManageReservations && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                        <IconButton size="sm" icon={Ban} tone="danger" tooltip="Cancelar" label={`Cancelar reservación de ${r.customerName}`} onClick={() => void handleUpdateStatus(r.id, 'CANCELLED')} />
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
                            iconOnly
                            options={[{ value: 'table', label: 'Tabla', icon: Table2 }, { value: 'calendar', label: 'Calendario', icon: CalendarDays }]}
                            value={viewMode}
                            onChange={setViewMode}
                        />
                        {canManageReservations && (
                            <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()}>Nueva reservación</Button>
                        )}
                    </>
                )}
            />

            {viewMode === 'table' && !loadError && (
                <Tabs ariaLabel="Estado de la reservación" tabs={statusTabs} active={filterStatus} onChange={setFilterStatus} />
            )}

            {/* Con error de carga no se muestra una agenda desactualizada como si fuera real. */}
            {loadError && <LoadErrorState message={loadError} onRetry={() => { void loadReservations(); }} />}

            {!loadError && viewMode === 'table' && (
                <>
                    <TableToolbar>
                        <Input
                            type="search"
                            prefix={<Search size={16} aria-hidden="true" />}
                            aria-label="Buscar reservación"
                            placeholder="Buscar por nombre, teléfono o fecha..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </TableToolbar>
                    <DataTable
                        ariaLabel="Reservaciones"
                        columns={columns}
                        rows={sortedReservations}
                        rowKey={(r) => r.id}
                        loading={loading && reservations.length === 0}
                        resetKey={`${filterStatus}|${searchQuery}`}
                        empty={(
                            <EmptyState
                                icon={Calendar}
                                title="No hay reservaciones"
                                description={searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'Crea una nueva reservación para comenzar'}
                            />
                        )}
                    />
                </>
            )}

            {!loadError && viewMode === 'calendar' && (
                <section className="res-calendar" aria-label="Calendario de reservaciones">
                    <TableToolbar
                        actions={(
                            <>
                                <SegmentedControl
                                    ariaLabel="Escala del calendario"
                                    options={[{ value: 'day', label: 'Día' }, { value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }]}
                                    value={calendarViewMode}
                                    onChange={setCalendarViewMode}
                                />
                                <Button onClick={handleToday}>Hoy</Button>
                            </>
                        )}
                    >
                        <div className="res-calendar__nav" role="group" aria-label="Periodo">
                            <IconButton icon={ChevronLeft} label="Periodo anterior" tooltip="Periodo anterior" onClick={handlePrevPeriod} />
                            <h2 className="res-calendar__title">{getCalendarTitle()}</h2>
                            <IconButton icon={ChevronRight} label="Periodo siguiente" tooltip="Periodo siguiente" onClick={handleNextPeriod} />
                        </div>
                    </TableToolbar>

                    {calendarViewMode === 'month' && (
                        <div className="res-month">
                            {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map(day => (
                                <div key={day} className="res-month__weekday">{day}</div>
                            ))}

                            {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                                <div key={`empty-${i}`} className="res-month__day is-empty" aria-hidden="true"></div>
                            ))}

                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const date = new Date(year, month, day);
                                const dayReservations = getReservationsForDate(date);
                                const isToday = new Date().toDateString() === date.toDateString();

                                return (
                                    <div key={day} className={`res-month__day ${isToday ? 'is-today' : ''}`}>
                                        <span className="res-month__number">{day}</span>
                                        {dayReservations.length > 0 && (
                                            <div className="res-month__items">
                                                {dayReservations.slice(0, 3).map(res => calendarItem(res, 'res-month__item', (
                                                    <>
                                                        <span className="res-month__time">{formatTime(res.date)}</span>
                                                        <span className="res-month__name">{res.customerName}</span>
                                                        <span className="res-month__people">{res.peopleCount}<Users size={10} aria-hidden="true" /></span>
                                                    </>
                                                )))}
                                                {dayReservations.length > 3 && (
                                                    <span className="res-month__more">+{dayReservations.length - 3} más</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {calendarViewMode === 'week' && (
                        <div className="res-week">
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
                                    <div key={dayIndex} className={`res-week__day ${isToday ? 'is-today' : ''}`}>
                                        <div className="res-week__head">
                                            <span className="res-week__name">{date.toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                                            <span className="res-week__number">{date.getDate()}</span>
                                        </div>
                                        <div className="res-week__items">
                                            {dayReservations.length > 0 ? (
                                                dayReservations.map(res => calendarItem(res, 'res-week__item', (
                                                    <>
                                                        <span className="res-week__time">{formatTime(res.date)}</span>
                                                        <span className="res-week__customer">{res.customerName}</span>
                                                        <span className="res-week__people"><Users size={14} aria-hidden="true" /> {res.peopleCount}</span>
                                                    </>
                                                )))
                                            ) : (
                                                <p className="res-week__empty">Sin reservaciones</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {calendarViewMode === 'day' && (
                        <div className="res-day">
                            {Array.from({ length: 24 }).map((_, hour) => {
                                const hourReservations = reservations.filter(r => {
                                    const resDate = new Date(r.date);
                                    return resDate.getDate() === currentDay.getDate() &&
                                        resDate.getMonth() === currentDay.getMonth() &&
                                        resDate.getFullYear() === currentDay.getFullYear() &&
                                        resDate.getHours() === hour;
                                }).sort((a, b) => new Date(a.date).getMinutes() - new Date(b.date).getMinutes());

                                return (
                                    <div key={hour} className="res-day__slot">
                                        <div className="res-day__hour">
                                            {hour.toString().padStart(2, '0')}:00
                                        </div>
                                        <div className="res-day__items">
                                            {hourReservations.map(res => calendarItem(res, 'res-day__item', (
                                                <>
                                                    <span className="res-day__head">
                                                        <span className="res-day__time">{formatTime(res.date)}</span>
                                                        <Badge tone={getStatusTone(res.status)}>{getStatusText(res.status)}</Badge>
                                                    </span>
                                                    <span className="res-day__customer">{res.customerName}</span>
                                                    <span className="res-day__details">
                                                        <span><Users size={14} aria-hidden="true" /> {res.peopleCount} personas</span>
                                                        {res.phone && <span><Phone size={14} aria-hidden="true" /> {res.phone}</span>}
                                                    </span>
                                                    {res.notes && <span className="res-day__notes">{res.notes}</span>}
                                                </>
                                            )))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
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
