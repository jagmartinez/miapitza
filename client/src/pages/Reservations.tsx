import { useState, useEffect, useCallback } from 'react';
import { Calendar, Users, Phone, Plus, CheckCircle, XCircle, Mail, MessageSquare, Grid3x3, CalendarDays, ChevronLeft, ChevronRight, List, Edit2 } from 'lucide-react';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
// import Input from '../components/Input';
import { branchesAPI, reservationsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { getUserRoleNames } from '../utils/authz';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
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
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [viewMode, setViewMode] = useState<'cards' | 'table' | 'calendar'>('cards');
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
    const [branches, setBranches] = useState<Branch[]>([]);


    const loadReservations = useCallback(async () => {
        try {
            const response = await reservationsAPI.getAll();
            setReservations(response.data.data);
        } catch (error) {
            console.error('Error loading reservations:', error);
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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

    if (loading) {
        return <div className="reservations-loading">Cargando reservaciones...</div>;
    }

    const { daysInMonth, startingDayOfWeek, year, month } = getDaysInMonth(currentMonth);

    return (
        <div className="reservations-page">
            {/* Header */}
            <div className="reservations-header">
                <div>
                    <h1><Calendar size={32} /> Reservaciones</h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    {/* View Toggle */}
                    <div className="view-toggle">
                        <button
                            className={`view-toggle-btn ${viewMode === 'cards' ? 'active' : ''}`}
                            onClick={() => setViewMode('cards')}
                            title="Vista de Tarjetas"
                        >
                            <Grid3x3 size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
                            onClick={() => setViewMode('table')}
                            title="Vista de Tabla"
                        >
                            <List size={18} />
                        </button>
                        <button
                            className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
                            onClick={() => setViewMode('calendar')}
                            title="Vista de Calendario"
                        >
                            <CalendarDays size={18} />
                        </button>
                    </div>
                    {canManageReservations && (
                        <Button onClick={() => handleOpenSidebar()}>
                            <Plus size={20} />
                            Nueva Reservación
                        </Button>
                    )}
                </div>
            </div>

            {/* Filters - show in cards and table views */}
            {viewMode !== 'calendar' && (
                <div className="reservations-filters">
                    {/* Status Filters */}
                    <div className="filter-buttons">
                        <button
                            className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('all')}
                        >
                            Todas
                        </button>
                        <button
                            className={`filter-btn pending ${filterStatus === 'PENDING' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('PENDING')}
                        >
                            Pendientes
                        </button>
                        <button
                            className={`filter-btn confirmed ${filterStatus === 'CONFIRMED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('CONFIRMED')}
                        >
                            Confirmadas
                        </button>
                        <button
                            className={`filter-btn completed ${filterStatus === 'COMPLETED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('COMPLETED')}
                        >
                            Completadas
                        </button>
                        <button
                            className={`filter-btn cancelled ${filterStatus === 'CANCELLED' ? 'active' : ''}`}
                            onClick={() => setFilterStatus('CANCELLED')}
                        >
                            Canceladas
                        </button>
                    </div>

                    {/* Stats and Search */}
                    <div className="filter-right-section">
                        {/* Stats Counters */}
                        <input
                            type="text"
                            placeholder="Buscar por nombre, teléfono o fecha..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input reservations-search"
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
                            <button className="calendar-nav-btn" onClick={handlePrevPeriod}>
                                <ChevronLeft size={20} />
                            </button>
                            <h2>{getCalendarTitle()}</h2>
                            <button className="calendar-nav-btn" onClick={handleNextPeriod}>
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {/* Calendar View Mode Selector */}
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

            {/* Cards View */}
            {viewMode === 'cards' && (
                <>
                    {sortedReservations.length === 0 ? (
                        <div className="reservations-empty">
                            <Calendar size={64} />
                            <p>No hay reservaciones</p>
                            <small>{searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'Crea una nueva reservación para comenzar'}</small>
                        </div>
                    ) : (
                        <div className="reservations-grid">
                            {sortedReservations.map(reservation => (
                                <div key={reservation.id} className={`reservation-card status-${reservation.status.toLowerCase()}`} onClick={() => handleOpenSidebar(reservation)}>
                                    {/* Status Badge */}
                                    <div className={`status-badge-new status-${reservation.status.toLowerCase()}`}>
                                        <span>{getStatusText(reservation.status)}</span>
                                    </div>

                                    {/* Card Body */}
                                    <div className="reservation-card-body-new">
                                        <div className="reservation-name-new">{reservation.customerName}</div>

                                        <div className="reservation-details-new">
                                            <div className="detail-item-new">
                                                <Users size={16} />
                                                <span>{reservation.peopleCount} personas{reservation.table ? ` · Mesa ${reservation.table.number}` : ''}</span>
                                            </div>
                                            {reservation.phone && (
                                                <div className="detail-item-new">
                                                    <Phone size={16} />
                                                    <span>{reservation.phone}</span>
                                                </div>
                                            )}
                                            <div className="detail-item-new" style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border)', opacity: 0.8 }}>
                                                <Calendar size={14} />
                                                <span>{formatDate(reservation.date)} • {formatTime(reservation.date)}</span>
                                            </div>
                                            {reservation.email && (
                                                <div className="detail-item-new" style={{ opacity: 0.8 }}>
                                                    <Mail size={14} />
                                                    <span>{reservation.email}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions Footer */}
                                    <div className="reservation-card-actions-new" onClick={(e) => e.stopPropagation()}>
                                        {canManageReservations && reservation.status === 'PENDING' && (
                                            <>
                                                <button
                                                    className="action-btn-new"
                                                    onClick={() => handleUpdateStatus(reservation.id, 'CONFIRMED')}
                                                    title="Confirmar"
                                                >
                                                    <CheckCircle size={20} />
                                                    <span>Confirmar</span>
                                                </button>
                                                <button
                                                    className="action-btn-new delete"
                                                    onClick={() => handleUpdateStatus(reservation.id, 'CANCELLED')}
                                                    title="Cancelar"
                                                >
                                                    <XCircle size={20} />
                                                </button>
                                            </>
                                        )}
                                        {canManageReservations && reservation.status === 'CONFIRMED' && (
                                            <>
                                                <button
                                                    className="action-btn-new"
                                                    onClick={() => handleUpdateStatus(reservation.id, 'COMPLETED')}
                                                    title="Marcar como Llegó"
                                                >
                                                    <Users size={20} />
                                                    <span>Completar</span>
                                                </button>
                                                <button
                                                    className="action-btn-new delete"
                                                    onClick={() => handleUpdateStatus(reservation.id, 'CANCELLED')}
                                                    title="Cancelar"
                                                >
                                                    <XCircle size={20} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Table View */}
            {viewMode === 'table' && (
                sortedReservations.length === 0 ? (
                    <div className="reservations-empty">
                        <Calendar size={64} />
                        <p>No hay reservaciones</p>
                        <small>{searchQuery ? 'No se encontraron resultados para tu búsqueda' : 'Crea una nueva reservación para comenzar'}</small>
                    </div>
                ) : (
                    <CatalogTable<Reservation>
                        rows={sortedReservations}
                        rowKey={(r) => r.id}
                        resetKey={`${filterStatus}|${searchQuery}`}
                        columns={[
                            {
                                key: 'customer',
                                header: 'Cliente',
                                render: (r) => (
                                    <div className="catalog-cell-stack">
                                        <span className="cell-title">{r.customerName}</span>
                                        {r.phone && <span className="cell-sub">{r.phone}</span>}
                                    </div>
                                )
                            },
                            { key: 'people', header: 'Personas', align: 'center', render: (r) => r.peopleCount },
                            { key: 'table', header: 'Mesa', align: 'center', render: (r) => r.table?.number || 'Sin asignar' },
                            { key: 'date', header: 'Fecha y hora', render: (r) => `${formatDate(r.date)} • ${formatTime(r.date)}` },
                            { key: 'email', header: 'Email', render: (r) => r.email || '-' },
                            {
                                key: 'status',
                                header: 'Estado',
                                render: (r) => {
                                    const tone = r.status === 'CONFIRMED' ? 'ok'
                                        : r.status === 'PENDING' ? 'warning'
                                        : r.status === 'COMPLETED' ? 'neutral'
                                        : 'danger';
                                    return <span className={`catalog-pill ${tone}`}>{getStatusText(r.status)}</span>;
                                }
                            },
                            {
                                key: 'actions',
                                header: 'Acciones',
                                align: 'right',
                                render: (r) => (
                                    <div className="catalog-table-actions">
                                        {canManageReservations && r.status === 'PENDING' && (
                                            <>
                                                <button className="catalog-action-btn" onClick={() => handleUpdateStatus(r.id, 'CONFIRMED')} title="Confirmar">
                                                    <CheckCircle size={16} />
                                                </button>
                                                <button className="catalog-action-btn danger" onClick={() => handleUpdateStatus(r.id, 'CANCELLED')} title="Cancelar">
                                                    <XCircle size={16} />
                                                </button>
                                            </>
                                        )}
                                        {canManageReservations && r.status === 'CONFIRMED' && (
                                            <>
                                                <button className="catalog-action-btn" onClick={() => handleUpdateStatus(r.id, 'COMPLETED')} title="Completar">
                                                    <Users size={16} />
                                                </button>
                                                <button className="catalog-action-btn danger" onClick={() => handleUpdateStatus(r.id, 'CANCELLED')} title="Cancelar">
                                                    <XCircle size={16} />
                                                </button>
                                            </>
                                        )}
                                        {canManageReservations && (r.status === 'PENDING' || r.status === 'CONFIRMED') && (
                                            <button className="catalog-action-btn" onClick={() => handleOpenSidebar(r)} title="Editar">
                                                <Edit2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                )
                            }
                        ] as CatalogColumn<Reservation>[]}
                    />
                )
            )}

            {/* Sidebar Form */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingReservation ? 'Editar Reservación' : 'Nueva Reservación'}
            >
                <div className="premium-modal-content reservation-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs" role="tablist">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'cliente'}
                            className={`modal-tab ${activeTab === 'cliente' ? 'active' : ''}`}
                            onClick={() => setActiveTab('cliente')}
                        >
                            <Users size={18} />
                            <span>Cliente</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'reserva'}
                            className={`modal-tab ${activeTab === 'reserva' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reserva')}
                        >
                            <Calendar size={18} />
                            <span>Reserva</span>
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={activeTab === 'notas'}
                            className={`modal-tab ${activeTab === 'notas' ? 'active' : ''}`}
                            onClick={() => setActiveTab('notas')}
                        >
                            <MessageSquare size={18} />
                            <span>Notas</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {activeTab === 'cliente' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Users size={18} />
                                        <h3>Información del Cliente</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="reservation-customer-name">Nombre del Cliente</label>
                                        <input
                                            id="reservation-customer-name"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.customerName}
                                            onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                                            required
                                            placeholder="Nombre completo"
                                        />
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="reservation-phone">Teléfono</label>
                                            <input
                                                id="reservation-phone"
                                                type="tel"
                                                className="modal-standard-input"
                                                value={formData.customerPhone}
                                                onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                                                required
                                                placeholder="Ej: +505 8888 8888"
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="reservation-email">Email (opcional)</label>
                                            <input
                                                id="reservation-email"
                                                type="email"
                                                className="modal-standard-input"
                                                value={formData.customerEmail}
                                                onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
                                                placeholder="cliente@email.com"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'reserva' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Calendar size={18} />
                                        <h3>Detalles de la Reserva</h3>
                                    </div>

                                    <Select
                                        variant="modal"
                                        label="Sucursal"
                                        options={branches.map((branch) => ({ value: String(branch.id), label: branch.name }))}
                                        value={branches
                                            .map((branch) => ({ value: String(branch.id), label: branch.name }))
                                            .find((option) => option.value === formData.branchId) || null}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                            setFormData({ ...formData, branchId: option?.value || '' })}
                                        isDisabled={Boolean(editingReservation) || Boolean(user?.branchId)}
                                        isSearchable
                                    />

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="reservation-date">Fecha</label>
                                            <input
                                                id="reservation-date"
                                                type="date"
                                                className="modal-standard-input"
                                                value={formData.date}
                                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="reservation-time">Hora</label>
                                            <input
                                                id="reservation-time"
                                                type="time"
                                                className="modal-standard-input"
                                                value={formData.time}
                                                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="reservation-guests">Número de Personas</label>
                                            <input
                                                id="reservation-guests"
                                                type="number"
                                                className="modal-standard-input"
                                                min="1"
                                                value={formData.guests}
                                                onChange={(e) => setFormData({ ...formData, guests: e.target.value })}
                                                required
                                            />
                                        </div>
                                        {editingReservation && canManageReservations && (
                                            <Select
                                                variant="modal"
                                                label="Estado"
                                                options={([
                                                    { value: 'PENDING', label: 'Pendiente' },
                                                    { value: 'CONFIRMED', label: 'Confirmada' },
                                                    { value: 'COMPLETED', label: 'Completada' },
                                                    { value: 'CANCELLED', label: 'Cancelada' },
                                                    { value: 'NO_SHOW', label: 'No Asistió' }
                                                ] as { value: Reservation['status']; label: string }[]).map((opt) => ({
                                                    ...opt,
                                                    isDisabled: !canTransitionReservation(editingReservation.status, opt.value)
                                                }))}
                                                value={{
                                                    value: editingReservation.status,
                                                    label: getStatusText(editingReservation.status)
                                                }}
                                                onChange={async (option: SingleValue<{ value: Reservation['status']; label: string }>) => {
                                                    if (!option) return;
                                                    if (!canManageReservations) return;
                                                    if (!canTransitionReservation(editingReservation.status, option.value)) return;
                                                    if (option.value === 'CANCELLED') {
                                                        if (!(await confirm('¿Cancelar esta reservación?', { variant: 'warning', confirmText: 'Sí, cancelar' }))) {
                                                            return;
                                                        }
                                                    }
                                                    try {
                                                        if (option.value === 'COMPLETED') {
                                                            await reservationsAPI.checkIn(editingReservation.id);
                                                        } else {
                                                            await reservationsAPI.updateStatus(editingReservation.id, option.value);
                                                        }
                                                        loadReservations();
                                                        setIsSidebarOpen(false);
                                                    } catch (err) {
                                                        console.error('Error updating status:', err);
                                                    }
                                                }}
                                                isSearchable={false}
                                            />
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'notas' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <MessageSquare size={18} />
                                        <h3>Notas y Observaciones</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="reservation-notes">Notas Adicionales</label>
                                        <textarea
                                            id="reservation-notes"
                                            className="modal-textarea"
                                            rows={8}
                                            value={formData.notes}
                                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                            placeholder="Alergias, preferencias, ocasión especial (cumpleaños, aniversario)..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            {canManageReservations && (
                                <Button type="submit" variant="primary" disabled={saving}>
                                    {saving ? 'Guardando...' : editingReservation ? 'Actualizar Reservación' : 'Crear Reservación'}
                                </Button>
                            )}
                        </div>
                    </form>
                </div>
            </Sidebar>

        </div>
    );
}
