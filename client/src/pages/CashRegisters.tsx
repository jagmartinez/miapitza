import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import { useNavigate } from 'react-router-dom';
import { cashRegistersAPI, cashShiftsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import {
    Wallet, Unlock, History, Plus,
    Search, Calendar, User, ArrowRight,
    Clock, Building2, Settings
} from 'lucide-react';
import type { CashRegister, CashShift } from '../types';
import './CashRegisters.css';

export default function CashRegisters() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const canCreateRegister = hasAnyRole(user, ['ADMIN', 'SUPERADMIN']);
    const [registers, setRegisters] = useState<CashRegister[]>([]);
    const [shifts, setShifts] = useState<CashShift[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewTab, setViewTab] = useState<'registers' | 'history'>('registers');

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });

    // Open Shift Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
    const [startAmount, setStartAmount] = useState('');

    // Create Register Modal
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newRegisterName, setNewRegisterName] = useState('');
    const [activeTab, setActiveTab] = useState<'general' | 'configuracion'>('general');

    const loadRegisters = useCallback(async () => {
        try {
            setLoading(true);
            const res = await cashRegistersAPI.getAll();
            setRegisters(res.data.data);
        } catch (error) {
            console.error('Error loading registers:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadShifts = useCallback(async () => {
        try {
            setLoading(true);
            const res = await cashShiftsAPI.getAll({
                startDate,
                endDate: endDate + 'T23:59:59.999Z'
            });
            setShifts(res.data.data);
        } catch (error: unknown) {
            console.error('Error loading shifts:', error);
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate]);

    useEffect(() => {
        if (viewTab === 'registers') {
            loadRegisters();
        } else {
            loadShifts();
        }
    }, [viewTab, loadRegisters, loadShifts]);

    const handleCreateRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canCreateRegister) {
            alert('Solo administradores pueden crear cajas registradoras.');
            return;
        }
        try {
            await cashRegistersAPI.create({ name: newRegisterName, branchId: user?.branchId || 1 });
            setIsCreateModalOpen(false);
            setNewRegisterName('');
            loadRegisters();
        } catch (error) {
            console.error('Error creating register:', error);
            alert('Error al crear caja');
        }
    };

    const handleOpenShiftClick = (e?: React.MouseEvent, registerId?: number | null) => {
        e?.stopPropagation();
        setSelectedRegisterId(registerId ?? null);
        setStartAmount('');
        setIsModalOpen(true);
    };

    const confirmOpenShift = async () => {
        if (!selectedRegisterId || !startAmount) return;

        try {
            const res = await cashShiftsAPI.open({
                cashRegisterId: selectedRegisterId,
                startAmount: Number(startAmount)
            });
            setIsModalOpen(false);
            navigate(`/cash-shifts/${res.data.data.id}`);
        } catch (error: unknown) {
            const apiMsg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            const errorMessage = apiMsg || 'Error al abrir turno';
            if (errorMessage.includes('already has an open shift')) {
                const confirmNavigate = window.confirm('Esta caja ya tiene un turno abierto. ¿Deseas ir al turno activo?');
                if (confirmNavigate && selectedRegisterId) {
                    handleViewActiveShift(undefined, selectedRegisterId);
                }
                setIsModalOpen(false);
            } else {
                alert(errorMessage);
            }
        }
    };

    const handleViewActiveShift = async (e?: React.MouseEvent, registerId?: number) => {
        e?.stopPropagation();
        if (!registerId) return;
        try {
            const res = await cashRegistersAPI.getActiveShift(registerId);
            if (res.data.data) {
                navigate(`/cash-shifts/${res.data.data.id}`);
            } else {
                alert('No hay turno activo (error de sincronización)');
                loadRegisters();
            }
        } catch (error) {
            console.error('Error getting active shift:', error);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO', minimumFractionDigits: 0 }).format(amount);
    };

    const filteredRegisters = registers.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.branch?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const filteredShifts = shifts.filter(s =>
        (s.register?.name || s.cashRegister?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.user?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );


    return (
        <div className="cash-registers-page">
            <div className="cash-registers-header">
                <div className="header-title-section">
                    <h1><Wallet size={32} /> Cajas Registradoras</h1>
                    <p className="header-subtitle">
                        {viewTab === 'registers'
                            ? `${registers.length} cajas registradas`
                            : `${shifts.length} turnos encontrados`}
                    </p>
                </div>
                {viewTab === 'registers' && canCreateRegister && (
                    <Button onClick={() => {
                        setActiveTab('general');
                        setIsCreateModalOpen(true);
                    }}>
                        <Plus size={20} />
                        Nueva Caja
                    </Button>
                )}
            </div>

            <div className="filters-row">
                <div className="filters-left">
                    <div className="search-container">
                        <Search className="search-icon" size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                        <input
                            type="text"
                            className="premium-search-input"
                            style={{ paddingLeft: '40px' }}
                            placeholder={viewTab === 'registers' ? "Buscar caja o sucursal..." : "Buscar por caja o cajero..."}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {viewTab === 'history' && (
                        <div className="date-filter-group">
                            <Calendar size={18} style={{ color: 'var(--color-primary)' }} />
                            <input
                                type="date"
                                className="date-input"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                            />
                            <ArrowRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                            <input
                                type="date"
                                className="date-input"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                            />
                        </div>
                    )}
                </div>

                <div className="navigation-right">

                    <div className="view-tabs">
                        <button
                            className={`tab-btn ${viewTab === 'registers' ? 'active' : ''}`}
                            onClick={() => setViewTab('registers')}
                        >
                            Cajas
                        </button>
                        <button
                            className={`tab-btn ${viewTab === 'history' ? 'active' : ''}`}
                            onClick={() => setViewTab('history')}
                        >
                            Historial
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="loading-state" style={{ padding: '80px', textAlign: 'center' }}>Cargando datos...</div>
            ) : (
                <>
                    {viewTab === 'registers' ? (
                        <div className="registers-grid">
                            {filteredRegisters.length === 0 ? (
                                <div className="no-results-message">
                                    <Wallet size={64} opacity={0.2} />
                                    <p>No se encontraron cajas registradas</p>
                                </div>
                            ) : (
                                filteredRegisters.map(register => (
                                    <div
                                        key={register.id}
                                        className="premium-register-card"
                                        onClick={() => register.status === 'OPEN' ? handleViewActiveShift(undefined, register.id) : handleOpenShiftClick(undefined, register.id)}
                                    >
                                        <div className={`register-status-badge ${register.status.toLowerCase()}`}>
                                            {register.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                                        </div>

                                        <div className="register-card-body-premium">
                                            <div className="register-icon-wrapper">
                                                <Wallet size={24} />
                                            </div>
                                            <div className="register-info-premium">
                                                <h3>{register.name}</h3>
                                                <div className="branch-tag">
                                                    <Building2 size={12} />
                                                    {register.branch?.name || 'Sucursal Principal'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="register-card-actions-premium">
                                            {register.status === 'CLOSED' ? (
                                                <button className="premium-action-btn" onClick={(e) => handleOpenShiftClick(e, register.id)}>
                                                    <Unlock size={16} />
                                                    <span>Abrir Caja</span>
                                                </button>
                                            ) : (
                                                <button className="premium-action-btn active" onClick={(e) => handleViewActiveShift(e, register.id)}>
                                                    <History size={16} />
                                                    <span>Ver Turno</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    ) : (
                        <div className="shifts-grid">
                            {filteredShifts.length === 0 ? (
                                <div className="no-results-message">
                                    <History size={64} opacity={0.2} />
                                    <p>No se encontró actividad en el rango seleccionado</p>
                                </div>
                            ) : (
                                filteredShifts.map(shift => (
                                    <div
                                        key={shift.id}
                                        className="premium-shift-card"
                                        onClick={() => navigate(`/cash-shifts/${shift.id}`)}
                                    >
                                        <div className="register-status-badge closed">
                                            {shift.endDate ? 'Finalizado' : 'En Curso'}
                                        </div>

                                        <div className="shift-card-header-wrapper">
                                            <div className="shift-card-header">
                                                <span className="shift-id-badge">#{shift.id}</span>
                                            </div>

                                            <div className="shift-details-list">
                                                <div className="shift-detail-row">
                                                    <div className="detail-label-group">
                                                        <Wallet size={16} />
                                                        <span className="detail-label-text">Caja</span>
                                                    </div>
                                                    <span className="detail-value-text">{shift.register?.name || shift.cashRegister?.name || 'Caja'}</span>
                                                </div>
                                                <div className="shift-detail-row">
                                                    <div className="detail-label-group">
                                                        <User size={16} />
                                                        <span className="detail-label-text">Cajero</span>
                                                    </div>
                                                    <span className="detail-value-text">{shift.user?.name}</span>
                                                </div>
                                                <div className="shift-detail-row">
                                                    <div className="detail-label-group">
                                                        <Calendar size={16} />
                                                        <span className="detail-label-text">Fecha</span>
                                                    </div>
                                                    <span className="detail-value-text">{new Date(shift.startDate).toLocaleDateString()}</span>
                                                </div>
                                                <div className="shift-detail-row">
                                                    <div className="detail-label-group">
                                                        <Clock size={16} />
                                                        <span className="detail-label-text">Hora Inicio</span>
                                                    </div>
                                                    <span className="detail-value-text">{new Date(shift.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="shift-amount-footer">
                                            <div className="amount-display">
                                                <span className="label">Saldo Inicial</span>
                                                <span className="value">{formatCurrency(Number(shift.startAmount))}</span>
                                            </div>
                                            {shift.endDate && (
                                                <div className={`amount-display ${Number(shift.difference) >= 0 ? 'profit' : 'loss'}`}>
                                                    <span className="label">
                                                        Diferencia
                                                    </span>
                                                    <span className="value">
                                                        {formatCurrency(Math.abs(Number(shift.difference)))}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </>
            )}

            <Sidebar isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Apertura de Caja">
                <div className="catering-modal-content">
                    <div className="modal-tab-body" style={{ padding: '30px' }}>
                        <div className="modal-section-v2">
                            <h3 className="section-title-v2">Saldo de Apertura</h3>
                            <div className="modal-input-group">
                                <label>Monto Inicial en Efectivo</label>
                                <input type="number" className="modal-standard-input" value={startAmount} onChange={(e) => setStartAmount(e.target.value)} placeholder="0.00" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirmOpenShift(); } }} />
                                <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '8px' }}>Ingrese la cantidad total de efectivo disponible al iniciar.</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                            <Button variant="secondary" fullWidth onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                            <Button fullWidth onClick={() => void confirmOpenShift()}>Abrir Turno</Button>
                        </div>
                    </div>
                </div>
            </Sidebar>

            <Sidebar isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="Nueva Caja Registradora">
                <div className="catering-modal-content">
                    <div className="modal-tabs">
                        <div className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`} onClick={() => setActiveTab('general')}>
                            <Wallet size={18} />
                            <span>General</span>
                        </div>
                        <div className={`modal-tab ${activeTab === 'configuracion' ? 'active' : ''}`} onClick={() => setActiveTab('configuracion')}>
                            <Settings size={18} />
                            <span>Configuración</span>
                        </div>
                    </div>
                    <div className="modal-tab-body" style={{ padding: '30px' }}>
                        {activeTab === 'general' && (
                            <div className="modal-section-v2">
                                <h3 className="section-title-v2">Identificación</h3>
                                <div className="modal-input-group">
                                    <label>Nombre de la Caja</label>
                                    <input type="text" className="modal-standard-input" value={newRegisterName} onChange={(e) => setNewRegisterName(e.target.value)} placeholder="Ej: Caja Barra..." autoFocus />
                                </div>
                            </div>
                        )}
                        {activeTab === 'configuracion' && (
                            <div className="modal-section-v2">
                                <h3 className="section-title-v2">Ubicación</h3>
                                <div className="modal-input-group">
                                    <label>Sucursal</label>
                                    <input type="text" className="modal-standard-input" value={user?.branch?.name || 'Sucursal Principal'} disabled />
                                </div>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                            <Button variant="secondary" fullWidth onClick={() => setIsCreateModalOpen(false)}>Cancelar</Button>
                            <Button fullWidth onClick={handleCreateRegister}>Guardar Caja</Button>
                        </div>
                    </div>
                </div>
            </Sidebar>
        </div>
    );
}
