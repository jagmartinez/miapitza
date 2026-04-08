import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { formatCurrency, type CurrencySettings } from '../utils/currency';

function errorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const msg = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof msg === 'string' && msg) return msg;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}
import '../index.css';

interface ReconciliationStatus {
    period: {
        start: string;
        end: string;
    };
    shifts: number;
    totals: {
        totalSales: number;
        byMethod: {
            cash: number;
            card: number;
            transfer: number;
            other: number;
        };
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

const BankReconciliation: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'status' | 'pending' | 'deposit'>('status');
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

            alert('Depósito registrado exitosamente');
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
            alert('Error al registrar depósito: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleMarkAsReconciled = async () => {
        if (selectedShifts.length === 0) {
            alert('Seleccione al menos un turno para conciliar');
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

            alert(`${selectedShifts.length} turno(s) marcado(s) como conciliado(s)`);
            setSelectedShifts([]);
            loadPendingReconciliations();
            loadReconciliationStatus();
        } catch (error: unknown) {
            alert('Error al marcar como conciliado: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const toggleShiftSelection = (shiftId: number) => {
        setSelectedShifts((prev) =>
            prev.includes(shiftId) ? prev.filter((id) => id !== shiftId) : [...prev, shiftId]
        );
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>🏦 Conciliación Bancaria</h1>
                <p>Gestiona la conciliación de caja con depósitos bancarios</p>
            </div>

            {/* Tabs */}
            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'status' ? 'active' : ''}`}
                    onClick={() => setActiveTab('status')}
                >
                    📊 Estado
                </button>
                <button
                    className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
                    onClick={() => setActiveTab('pending')}
                >
                    ⏳ Pendientes
                </button>
                <button
                    className={`tab ${activeTab === 'deposit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('deposit')}
                >
                    💰 Registrar Depósito
                </button>
            </div>

            {/* Status Tab */}
            {activeTab === 'status' && (
                <>
                    <div className="card">
                        <h2>Período de Conciliación</h2>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Fecha Inicio</label>
                                <input
                                    type="date"
                                    value={dateRange.startDate}
                                    onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label>Fecha Fin</label>
                                <input
                                    type="date"
                                    value={dateRange.endDate}
                                    onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                                />
                            </div>

                            <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                                <button onClick={loadReconciliationStatus} className="btn btn-primary" disabled={loading}>
                                    {loading ? 'Cargando...' : '🔍 Consultar'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {status && (
                        <>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-icon">📅</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Turnos Cerrados</div>
                                        <div className="stat-value">{status.shifts}</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-icon">💵</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Ventas Totales</div>
                                        <div className="stat-value">{formatCurrency(status.totals.totalSales, settings)}</div>
                                    </div>
                                </div>

                                <div className="stat-card">
                                    <div className="stat-icon">🏦</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Efectivo en Cajas</div>
                                        <div className="stat-value">{formatCurrency(status.totals.cashInRegisters, settings)}</div>
                                    </div>
                                </div>

                                <div className={`stat-card ${status.reconciliation.status === 'RECONCILED' ? 'success' : 'warning'}`}>
                                    <div className="stat-icon">{status.reconciliation.status === 'RECONCILED' ? '✅' : '⚠️'}</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Estado</div>
                                        <div className="stat-value">
                                            {status.reconciliation.status === 'RECONCILED' ? 'Conciliado' : 'Pendiente'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="card">
                                <h2>Ventas por Método de Pago</h2>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Método</th>
                                            <th>Monto</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>💵 Efectivo</td>
                                            <td>{formatCurrency(status.totals.byMethod.cash, settings)}</td>
                                        </tr>
                                        <tr>
                                            <td>💳 Tarjeta</td>
                                            <td>{formatCurrency(status.totals.byMethod.card, settings)}</td>
                                        </tr>
                                        <tr>
                                            <td>🏦 Transferencia</td>
                                            <td>{formatCurrency(status.totals.byMethod.transfer, settings)}</td>
                                        </tr>
                                        <tr>
                                            <td>📱 Otros</td>
                                            <td>{formatCurrency(status.totals.byMethod.other, settings)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="card">
                                <h2>Conciliación de Efectivo</h2>
                                <table className="data-table">
                                    <tbody>
                                        <tr>
                                            <td><strong>Efectivo Esperado</strong></td>
                                            <td>{formatCurrency(status.reconciliation.cashExpected, settings)}</td>
                                        </tr>
                                        <tr>
                                            <td><strong>Efectivo Real en Cajas</strong></td>
                                            <td>{formatCurrency(status.reconciliation.cashActual, settings)}</td>
                                        </tr>
                                        <tr className={status.reconciliation.difference === 0 ? 'success' : 'warning'}>
                                            <td><strong>Diferencia</strong></td>
                                            <td>
                                                <strong>
                                                    {formatCurrency(status.reconciliation.difference, settings)}
                                                    {status.reconciliation.difference > 0 && ' (Sobrante)'}
                                                    {status.reconciliation.difference < 0 && ' (Faltante)'}
                                                </strong>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </>
            )}

            {/* Pending Tab */}
            {activeTab === 'pending' && (
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2>Turnos Pendientes de Conciliación</h2>
                        {selectedShifts.length > 0 && (
                            <button onClick={handleMarkAsReconciled} className="btn btn-success" disabled={loading}>
                                ✅ Marcar {selectedShifts.length} como Conciliado(s)
                            </button>
                        )}
                    </div>

                    <div className="table-container">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>
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
                                    <th>Monto Inicial</th>
                                    <th>Monto Final</th>
                                    <th>Diferencia</th>
                                    <th>Estado</th>
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
                                        <td>{shift.user}</td>
                                        <td>{formatCurrency(shift.startAmount, settings)}</td>
                                        <td>{formatCurrency(shift.endAmount, settings)}</td>
                                        <td className={shift.difference === 0 ? 'success' : 'warning'}>
                                            {formatCurrency(shift.difference, settings)}
                                        </td>
                                        <td>
                                            <span className={`badge ${shift.status === 'BALANCED' ? 'success' : 'warning'}`}>
                                                {shift.status === 'BALANCED' ? 'Cuadrado' : 'Con Diferencia'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {pending.length === 0 && (
                        <p style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
                            No hay turnos pendientes de conciliación
                        </p>
                    )}
                </div>
            )}

            {/* Deposit Tab */}
            {activeTab === 'deposit' && (
                <div className="card">
                    <h2>Registrar Depósito Bancario</h2>
                    <form onSubmit={handleRecordDeposit} className="form">
                        <div className="form-row">
                            <div className="form-group">
                                <label>Fecha del Depósito *</label>
                                <input
                                    type="date"
                                    value={depositForm.date}
                                    onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label>Monto *</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={depositForm.amount}
                                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                                    required
                                    min="0.01"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Cuenta Bancaria *</label>
                                <input
                                    type="text"
                                    value={depositForm.bankAccount}
                                    onChange={(e) => setDepositForm({ ...depositForm, bankAccount: e.target.value })}
                                    required
                                    placeholder="Ej: BAC - Cuenta Corriente 123456"
                                />
                            </div>

                            <div className="form-group">
                                <label>Referencia/Boleta *</label>
                                <input
                                    type="text"
                                    value={depositForm.reference}
                                    onChange={(e) => setDepositForm({ ...depositForm, reference: e.target.value })}
                                    required
                                    placeholder="Número de boleta o referencia"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Notas</label>
                            <textarea
                                value={depositForm.notes}
                                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                                rows={3}
                                placeholder="Detalles adicionales del depósito..."
                            />
                        </div>

                        {pending.length > 0 && (
                            <div className="form-group">
                                <label>Turnos Asociados (Opcional)</label>
                                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #333', borderRadius: '8px', padding: '0.5rem' }}>
                                    {pending.map((shift) => (
                                        <div key={shift.shiftId} style={{ padding: '0.5rem' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedShifts.includes(shift.shiftId)}
                                                    onChange={() => toggleShiftSelection(shift.shiftId)}
                                                />
                                                <span>
                                                    {new Date(shift.date).toLocaleDateString()} - {shift.cashRegister} - {formatCurrency(shift.endAmount, settings)}
                                                </span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Guardando...' : '💾 Registrar Depósito'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
};

export default BankReconciliation;
