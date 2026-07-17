import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
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
    RotateCcw,
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

interface BankDeposit {
    id: number;
    date: string;
    amount: number | string;
    bankAccount: string;
    reference: string;
    status: 'ACTIVE' | 'REVERSED';
    createdBy: { name: string };
    reversedBy?: { name: string } | null;
    reversalReason?: string | null;
    shifts: Array<{ shiftId: number }>;
}

type TabKey = 'status' | 'pending' | 'deposit';

const PAGE_SIZE = 20;

const BankReconciliation: React.FC = () => {
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const [activeTab, setActiveTab] = useState<TabKey>('status');
    const [pendingPage, setPendingPage] = useState(1);
    const [status, setStatus] = useState<ReconciliationStatus | null>(null);
    const [pending, setPending] = useState<PendingReconciliation[]>([]);
    const [deposits, setDeposits] = useState<BankDeposit[]>([]);
    const [selectedShifts, setSelectedShifts] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [statusLoadError, setStatusLoadError] = useState<string | null>(null);
    const [pendingLoadError, setPendingLoadError] = useState<string | null>(null);
    const [depositsLoadError, setDepositsLoadError] = useState<string | null>(null);

    const [dateRange, setDateRange] = useState({
        startDate: formatLocalDateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        endDate: formatLocalDateInput()
    });

    const [depositForm, setDepositForm] = useState({
        date: formatLocalDateInput(),
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
            showError('No se pudo cargar la configuración monetaria. Verifique los importes antes de conciliar.');
        }
    }, [showError]);

    const loadReconciliationStatus = useCallback(async () => {
        setLoading(true);
        setStatusLoadError(null);
        try {
            const response = await api.get(
                `/advanced/reconciliation?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
            );
            setStatus(response.data.data);
        } catch (error: unknown) {
            console.error('Error loading status:', error);
            const message = 'No se pudo cargar el estado de conciliación: ' + errorMessage(error);
            setStatusLoadError(message);
            showError(message);
        } finally {
            setLoading(false);
        }
    }, [dateRange.endDate, dateRange.startDate, showError]);

    const loadPendingReconciliations = useCallback(async () => {
        setPendingLoadError(null);
        try {
            const response = await api.get('/advanced/reconciliation/pending');
            setPending(response.data.data || []);
        } catch (error: unknown) {
            console.error('Error loading pending:', error);
            const message = 'No se pudieron cargar los turnos pendientes: ' + errorMessage(error);
            setPendingLoadError(message);
            showError(message);
        }
    }, [showError]);

    const loadDeposits = useCallback(async () => {
        setDepositsLoadError(null);
        try {
            const response = await api.get('/advanced/reconciliation/deposits');
            setDeposits(response.data.data || []);
        } catch (error: unknown) {
            console.error('Error loading deposits:', error);
            const message = 'No se pudo cargar el historial de depósitos: ' + errorMessage(error);
            setDepositsLoadError(message);
            showError(message);
        }
    }, [showError]);

    useEffect(() => {
        void loadSettings();
        void loadPendingReconciliations();
        void loadDeposits();
    }, [loadDeposits, loadPendingReconciliations, loadSettings]);

    useEffect(() => {
        void loadReconciliationStatus();
    }, [loadReconciliationStatus]);

    useEffect(() => {
        setPendingPage(1);
    }, [pending.length]);

    const pendingTotalPages = Math.max(1, Math.ceil(pending.length / PAGE_SIZE));
    const pagedPending = pending.slice((pendingPage - 1) * PAGE_SIZE, pendingPage * PAGE_SIZE);

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
                date: formatLocalDateInput(),
                amount: '',
                bankAccount: '',
                reference: '',
                notes: ''
            });
            setSelectedShifts([]);
            void loadPendingReconciliations();
            void loadDeposits();
        } catch (error: unknown) {
            showError('Error al registrar depósito: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleReverseDeposit = async (deposit: BankDeposit) => {
        const reason = prompt(`Motivo para revertir el depósito ${deposit.reference}:`);
        if (!reason?.trim()) return;
        setLoading(true);
        try {
            await api.post(`/advanced/reconciliation/deposit/${deposit.id}/reverse`, { reason });
            showSuccess('Depósito revertido; sus turnos vuelven a estar pendientes');
            void loadDeposits();
            void loadPendingReconciliations();
        } catch (error: unknown) {
            showError('Error al revertir depósito: ' + errorMessage(error));
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

                    {!status && !loading && statusLoadError && (
                        <div className="state-placeholder">
                            <AlertTriangle size={48} />
                            <p>{statusLoadError}</p>
                        </div>
                    )}

                    {!status && !loading && !statusLoadError && (
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
                    {pendingLoadError ? (
                        <div className="state-placeholder" style={{ borderTop: 'none', borderRadius: 0 }}>
                            <AlertTriangle size={48} />
                            <p>{pendingLoadError}</p>
                        </div>
                    ) : pending.length > 0 ? (
                        <>
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
                                    {pagedPending.map((shift) => (
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
                            <Pagination
                                page={pendingPage}
                                totalPages={pendingTotalPages}
                                totalItems={pending.length}
                                pageSize={PAGE_SIZE}
                                onPageChange={setPendingPage}
                            />
                        </>
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
                                <label className="modal-input-label" htmlFor="deposit-date">Fecha del depósito *</label>
                                <input
                                    id="deposit-date"
                                    type="date"
                                    className="modal-standard-input"
                                    value={depositForm.date}
                                    onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="deposit-amount">Monto *</label>
                                <input
                                    id="deposit-amount"
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
                                <label className="modal-input-label" htmlFor="deposit-bank-account">Cuenta bancaria *</label>
                                <input
                                    id="deposit-bank-account"
                                    type="text"
                                    className="modal-standard-input"
                                    value={depositForm.bankAccount}
                                    onChange={(e) => setDepositForm({ ...depositForm, bankAccount: e.target.value })}
                                    required
                                    placeholder="Ej: BAC — Cuenta Corriente 123456"
                                />
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label" htmlFor="deposit-reference">Referencia / Boleta *</label>
                                <input
                                    id="deposit-reference"
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
                            <label className="modal-input-label" htmlFor="deposit-notes">Notas</label>
                            <textarea
                                id="deposit-notes"
                                className="modal-textarea"
                                value={depositForm.notes}
                                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                                rows={3}
                                placeholder="Detalles adicionales del depósito..."
                            />
                        </div>

                        {pending.length > 0 && (
                            <div className="modal-input-group">
                                <label className="modal-input-label" id="deposit-shifts-label">Turnos asociados (opcional)</label>
                                <div role="group" aria-labelledby="deposit-shifts-label" style={{
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

                    <div className="data-table-wrapper" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <div className="data-table-header">Historial de depósitos</div>
                        <div className="data-table-scroll">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Fecha</th><th>Referencia</th><th>Cuenta</th>
                                        <th className="text-right">Monto</th><th>Turnos</th><th>Estado</th><th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {deposits.map((deposit) => (
                                        <tr key={deposit.id}>
                                            <td>{new Date(deposit.date).toLocaleDateString()}</td>
                                            <td>{deposit.reference}</td>
                                            <td>{deposit.bankAccount}</td>
                                            <td className="text-right font-semibold">{formatCurrency(Number(deposit.amount), settings)}</td>
                                            <td>{deposit.shifts.length}</td>
                                            <td>
                                                <span className={`status-pill ${deposit.status === 'ACTIVE' ? 'status-success' : 'status-warning'}`}>
                                                    {deposit.status === 'ACTIVE' ? 'Activo' : 'Revertido'}
                                                </span>
                                            </td>
                                            <td>
                                                {deposit.status === 'ACTIVE' && (
                                                    <button type="button" className="table-action-btn danger" disabled={loading}
                                                        onClick={() => void handleReverseDeposit(deposit)} title="Revertir depósito">
                                                        <RotateCcw size={16} />
                                                    </button>
                                                )}
                                                {deposit.status === 'REVERSED' && deposit.reversalReason && (
                                                    <span className="text-secondary" title={deposit.reversalReason}>Reverso registrado</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {depositsLoadError && (
                                        <tr><td colSpan={7} className="text-center text-secondary">{depositsLoadError}</td></tr>
                                    )}
                                    {!depositsLoadError && deposits.length === 0 && (
                                        <tr><td colSpan={7} className="text-center text-secondary">Sin depósitos registrados.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BankReconciliation;
