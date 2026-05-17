import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import Button from '../components/Button';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import {
    Landmark,
    BarChart3,
    Hourglass,
    CircleDollarSign,
    CalendarRange,
    Search,
    Calendar,
    TrendingUp,
    Wallet,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    Save,
} from 'lucide-react';

function errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const msg = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof msg === 'string' && msg) return msg;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

interface ReconciliationStatus {
    period: { start: string; end: string };
    shifts: number;
    totals: {
        totalSales: number;
        byMethod: { cash: number; card: number; transfer: number; other: number };
        cashInRegisters: number;
    };
    reconciliation: {
        cashExpected: number;
        cashActual: number;
        difference: number;
        status: string;
    };
}

interface PendingReconciliation {
    shiftId: number;
    date: string;
    cashRegister: string;
    user: string;
    startAmount: number;
    endAmount: number;
    difference: number;
    status: string;
}

type TabKey = 'status' | 'pending' | 'deposit';

const BankReconciliation: React.FC = () => {
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const [activeTab, setActiveTab] = useState<TabKey>('status');
    const [status, setStatus] = useState<ReconciliationStatus | null>(null);
    const [pending, setPending] = useState<PendingReconciliation[]>([]);
    const [selectedShifts, setSelectedShifts] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});

    const [dateRange, setDateRange] = useState({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
    });

    const [depositForm, setDepositForm] = useState({
        date: new Date().toISOString().split('T')[0],
        amount: '',
        bankAccount: '',
        reference: '',
        notes: ''
    });

    const loadSettings = useCallback(async () => {
        try {
            const response = await api.get('/settings');
            setSettings(response.data.data || {});
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }, []);

    const loadReconciliationStatus = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.get(
                `/advanced/reconciliation?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
            );
            setStatus(response.data.data);
        } catch (error: unknown) {
            console.error('Error loading status:', error);
        } finally {
            setLoading(false);
        }
    }, [dateRange.endDate, dateRange.startDate]);

    const loadPendingReconciliations = useCallback(async () => {
        try {
            const response = await api.get('/advanced/reconciliation/pending');
            setPending(response.data.data || []);
        } catch (error: unknown) {
            console.error('Error loading pending:', error);
        }
    }, []);

    useEffect(() => {
        void loadSettings();
        void loadPendingReconciliations();
    }, [loadPendingReconciliations, loadSettings]);

    useEffect(() => {
        void loadReconciliationStatus();
    }, [loadReconciliationStatus]);

    const handleRecordDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/advanced/reconciliation/deposit', {
                date: new Date(depositForm.date),
                amount: parseFloat(depositForm.amount),
                bankAccount: depositForm.bankAccount,
                reference: depositForm.reference,
                notes: depositForm.notes,
                shiftIds: selectedShifts
            });
            showSuccess('Depósito registrado exitosamente');
            setDepositForm({
                date: new Date().toISOString().split('T')[0],
                amount: '',
                bankAccount: '',
                reference: '',
                notes: ''
            });
            setSelectedShifts([]);
            loadPendingReconciliations();
        } catch (error: unknown) {
            showError('Error al registrar depósito: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleMarkAsReconciled = async () => {
        if (selectedShifts.length === 0) {
            showError('Seleccione al menos un turno para conciliar');
            return;
        }
        const reference = prompt('Ingrese la referencia del depósito bancario:');
        if (!reference) return;

        setLoading(true);
        try {
            await api.post('/advanced/reconciliation/mark-reconciled', {
                shiftIds: selectedShifts,
                depositReference: reference
            });
            showSuccess(`${selectedShifts.length} turno(s) marcado(s) como conciliado(s)`);
            setSelectedShifts([]);
            loadPendingReconciliations();
            loadReconciliationStatus();
        } catch (error: unknown) {
            showError('Error al marcar como conciliado: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const toggleShiftSelection = (shiftId: number) => {
        setSelectedShifts((prev) =>
            prev.includes(shiftId) ? prev.filter((id) => id !== shiftId) : [...prev, shiftId]
        );
    };

    const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
        { key: 'status', label: 'Estado', icon: <BarChart3 size={16} /> },
        { key: 'pending', label: 'Pendientes', icon: <Hourglass size={16} /> },
        { key: 'deposit', label: 'Registrar Depósito', icon: <CircleDollarSign size={16} /> },
    ];

    const isReconciled = status?.reconciliation.status === 'RECONCILED';

    return (
        <div className="page-wrapper">
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <div className="page-header-bar">
                <div className="header-title-section">
                    <h1><Landmark size={32} /> Conciliación Bancaria</h1>
                    <p className="header-subtitle">Gestiona la conciliación de caja con depósitos bancarios</p>
                </div>
            </div>

            <div className="page-tabs" style={{ marginBottom: 'var(--spacing-lg)' }}>
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        className={`page-tab ${activeTab === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ========================= STATUS TAB ========================= */}
            {activeTab === 'status' && (
                <>
                    <div className="filters-toolbar" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="filter-field filter-field-narrow">
                            <label className="filter-field-label">
                                <Calendar size={14} /> Desde
                            </label>
                            <input
                                type="date"
                                className="filter-input"
                                value={dateRange.startDate}
                                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                            />
                        </div>
                        <div className="filter-field filter-field-narrow">
                            <label className="filter-field-label">
                                <Calendar size={14} /> Hasta
                            </label>
                            <input
                                type="date"
                                className="filter-input"
                                value={dateRange.endDate}
                                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                            />
                        </div>
                        <div className="filter-actions" style={{ alignSelf: 'flex-end' }}>
                            <Button onClick={loadReconciliationStatus} disabled={loading}>
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                                {loading ? 'Cargando...' : 'Consultar'}
                            </Button>
                        </div>
                    </div>

                    {status && (
                        <>
                            <div className="kpi-grid">
                                <div className="kpi-card kpi-neutral">
                                    <div className="kpi-label"><CalendarRange size={14} /> Turnos cerrados</div>
                                    <div className="kpi-value">{status.shifts}</div>
                                </div>
                                <div className="kpi-card">
                                    <div className="kpi-label"><TrendingUp size={14} /> Ventas totales</div>
                                    <div className="kpi-value">{formatCurrency(status.totals.totalSales, settings)}</div>
                                </div>
                                <div className="kpi-card">
                                    <div className="kpi-label"><Wallet size={14} /> Efectivo en cajas</div>
                                    <div className="kpi-value">{formatCurrency(status.totals.cashInRegisters, settings)}</div>
                                </div>
                                <div className={`kpi-card ${isReconciled ? 'kpi-success' : 'kpi-warning'}`}>
                                    <div className="kpi-label">
                                        {isReconciled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                                        Estado
                                    </div>
                                    <div className="kpi-value">
                                        {isReconciled ? 'Conciliado' : 'Pendiente'}
                                    </div>
                                </div>
                            </div>

                            <div className="data-table-wrapper">
                                <div className="data-table-header">Ventas por método de pago</div>
                                <div className="data-table-scroll">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Método</th>
                                                <th className="text-right">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr>
                                                <td>Efectivo</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.totals.byMethod.cash, settings)}</td>
                                            </tr>
                                            <tr>
                                                <td>Tarjeta</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.totals.byMethod.card, settings)}</td>
                                            </tr>
                                            <tr>
                                                <td>Transferencia</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.totals.byMethod.transfer, settings)}</td>
                                            </tr>
                                            <tr>
                                                <td>Otros</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.totals.byMethod.other, settings)}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="data-table-wrapper">
                                <div className="data-table-header">Conciliación de efectivo</div>
                                <div className="data-table-scroll">
                                    <table className="data-table">
                                        <tbody>
                                            <tr>
                                                <td>Efectivo esperado</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.reconciliation.cashExpected, settings)}</td>
                                            </tr>
                                            <tr>
                                                <td>Efectivo real en cajas</td>
                                                <td className="text-right font-semibold">{formatCurrency(status.reconciliation.cashActual, settings)}</td>
                                            </tr>
                                            <tr>
                                                <td><strong>Diferencia</strong></td>
                                                <td className="text-right">
                                                    <span className={`status-pill ${status.reconciliation.difference === 0 ? 'status-success' : 'status-warning'}`}>
                                                        {formatCurrency(status.reconciliation.difference, settings)}
                                                        {status.reconciliation.difference > 0 && ' • Sobrante'}
                                                        {status.reconciliation.difference < 0 && ' • Faltante'}
                                                    </span>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}

                    {!status && !loading && (
                        <div className="state-placeholder">
                            <BarChart3 size={48} />
                            <p>No hay datos disponibles para el período seleccionado.</p>
                        </div>
                    )}
                </>
            )}

            {/* ========================= PENDING TAB ========================= */}
            {activeTab === 'pending' && (
                <div className="data-table-wrapper">
                    <div className="data-table-header">
                        <span>Turnos pendientes de conciliación</span>
                        {selectedShifts.length > 0 && (
                            <Button variant="primary" onClick={handleMarkAsReconciled} disabled={loading}>
                                <CheckCircle2 size={16} /> Marcar {selectedShifts.length} como conciliado(s)
                            </Button>
                        )}
                    </div>
                    {pending.length > 0 ? (
                        <div className="data-table-scroll">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: 36 }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedShifts.length === pending.length && pending.length > 0}
                                                onChange={(e) =>
                                                    setSelectedShifts(e.target.checked ? pending.map((p) => p.shiftId) : [])
                                                }
                                            />
                                        </th>
                                        <th>Fecha</th>
                                        <th>Caja</th>
                                        <th>Usuario</th>
                                        <th className="text-right">Monto inicial</th>
                                        <th className="text-right">Monto final</th>
                                        <th className="text-right">Diferencia</th>
                                        <th className="text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pending.map((shift) => (
                                        <tr key={shift.shiftId}>
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedShifts.includes(shift.shiftId)}
                                                    onChange={() => toggleShiftSelection(shift.shiftId)}
                                                />
                                            </td>
                                            <td>{new Date(shift.date).toLocaleDateString()}</td>
                                            <td>{shift.cashRegister}</td>
                                            <td className="text-secondary">{shift.user}</td>
                                            <td className="text-right font-semibold">{formatCurrency(shift.startAmount, settings)}</td>
                                            <td className="text-right font-semibold">{formatCurrency(shift.endAmount, settings)}</td>
                                            <td className="text-right">
                                                <span className={`status-pill ${shift.difference === 0 ? 'status-success' : 'status-warning'}`}>
                                                    {formatCurrency(shift.difference, settings)}
                                                </span>
                                            </td>
                                            <td className="text-center">
                                                <span className={`status-pill ${shift.status === 'BALANCED' ? 'status-success' : 'status-warning'}`}>
                                                    {shift.status === 'BALANCED' ? 'Cuadrado' : 'Con diferencia'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="state-placeholder" style={{ borderTop: 'none', borderRadius: 0 }}>
                            <Hourglass size={48} />
                            <p>No hay turnos pendientes de conciliación.</p>
                        </div>
                    )}
                </div>
            )}

            {/* ========================= DEPOSIT TAB ========================= */}
            {activeTab === 'deposit' && (
                <div className="data-table-wrapper" style={{ padding: 'var(--spacing-lg)' }}>
                    <h2 style={{ margin: '0 0 var(--spacing-md) 0', fontSize: 'var(--font-size-lg)' }}>
                        Registrar depósito bancario
                    </h2>
                    <form onSubmit={handleRecordDeposit} className="modal-form-new" style={{ padding: 0 }}>
                        <div className="modal-form-row">
                            <div className="modal-input-group">
                                <label className="modal-input-label">Fecha del depósito *</label>
                                <input
                                    type="date"
                                    className="modal-standard-input"
                                    value={depositForm.date}
                                    onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label">Monto *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="modal-standard-input"
                                    value={depositForm.amount}
                                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                                    required
                                    min="0.01"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div className="modal-form-row">
                            <div className="modal-input-group">
                                <label className="modal-input-label">Cuenta bancaria *</label>
                                <input
                                    type="text"
                                    className="modal-standard-input"
                                    value={depositForm.bankAccount}
                                    onChange={(e) => setDepositForm({ ...depositForm, bankAccount: e.target.value })}
                                    required
                                    placeholder="Ej: BAC — Cuenta Corriente 123456"
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label">Referencia / Boleta *</label>
                                <input
                                    type="text"
                                    className="modal-standard-input"
                                    value={depositForm.reference}
                                    onChange={(e) => setDepositForm({ ...depositForm, reference: e.target.value })}
                                    required
                                    placeholder="Número de boleta o referencia"
                                />
                            </div>
                        </div>

                        <div className="modal-input-group">
                            <label className="modal-input-label">Notas</label>
                            <textarea
                                className="modal-textarea"
                                value={depositForm.notes}
                                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                                rows={3}
                                placeholder="Detalles adicionales del depósito..."
                            />
                        </div>

                        {pending.length > 0 && (
                            <div className="modal-input-group">
                                <label className="modal-input-label">Turnos asociados (opcional)</label>
                                <div style={{
                                    maxHeight: 200,
                                    overflowY: 'auto',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-sm)',
                                    background: 'var(--color-background)'
                                }}>
                                    {pending.map((shift) => (
                                        <label key={shift.shiftId} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--spacing-sm)',
                                            cursor: 'pointer',
                                            padding: 'var(--spacing-xs) var(--spacing-sm)',
                                            borderRadius: 'var(--radius-sm)',
                                            fontSize: 'var(--font-size-sm)',
                                            color: 'var(--color-text)'
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedShifts.includes(shift.shiftId)}
                                                onChange={() => toggleShiftSelection(shift.shiftId)}
                                            />
                                            <span>
                                                {new Date(shift.date).toLocaleDateString()} — {shift.cashRegister} — {formatCurrency(shift.endAmount, settings)}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="modal-footer" style={{ borderTop: 'none', padding: 'var(--spacing-md) 0 0', marginTop: 'var(--spacing-md)' }}>
                            <Button type="submit" disabled={loading}>
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {loading ? 'Guardando...' : 'Registrar depósito'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};

export default BankReconciliation;
