import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import type { CurrencySettings } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import {
    Badge, Button, Checkbox, DataTable, DateInput, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    EmptyState, LoadErrorState, NumberInput, PageContent, PageHeader, StatCard, TableToolbar, Tabs, Textarea, formatMoney,
    type Column,
} from '@/ui';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { Ban, CheckCircle2, Plus, Search } from 'lucide-react';
import styles from './BankReconciliation.module.css';
import { getApiErrorMessage } from '../utils/apiError';

function errorMessage(error: unknown): string {
    return getApiErrorMessage(error);
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

const BankReconciliation: React.FC = () => {
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const [activeTab, setActiveTab] = useState<TabKey>('status');
    const [status, setStatus] = useState<ReconciliationStatus | null>(null);
    const [pending, setPending] = useState<PendingReconciliation[]>([]);
    const [deposits, setDeposits] = useState<BankDeposit[]>([]);
    const [selectedShifts, setSelectedShifts] = useState<number[]>([]);
    const [isDepositOpen, setIsDepositOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState<CurrencySettings>({});
    const [statusLoadError, setStatusLoadError] = useState<string | null>(null);
    const [pendingLoading, setPendingLoading] = useState(true);
    const [depositsLoading, setDepositsLoading] = useState(true);
    const [pendingLoadError, setPendingLoadError] = useState<string | null>(null);
    const [reverseTarget, setReverseTarget] = useState<BankDeposit | null>(null);
    const [reverseReason, setReverseReason] = useState('');
    const [isReconcileOpen, setIsReconcileOpen] = useState(false);
    const [reconcileReference, setReconcileReference] = useState('');
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
            showError(getApiErrorMessage(error, 'No se pudo cargar la configuración monetaria (verifique los importes antes de conciliar)'));
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
        setPendingLoading(true);
        try {
            const response = await api.get('/advanced/reconciliation/pending');
            setPending(response.data.data || []);
        } catch (error: unknown) {
            console.error('Error loading pending:', error);
            const message = 'No se pudieron cargar los turnos pendientes: ' + errorMessage(error);
            setPendingLoadError(message);
            showError(message);
        } finally {
            setPendingLoading(false);
        }
    }, [showError]);

    const loadDeposits = useCallback(async () => {
        setDepositsLoadError(null);
        setDepositsLoading(true);
        try {
            const response = await api.get('/advanced/reconciliation/deposits');
            setDeposits(response.data.data || []);
        } catch (error: unknown) {
            console.error('Error loading deposits:', error);
            const message = 'No se pudo cargar el historial de depósitos: ' + errorMessage(error);
            setDepositsLoadError(message);
            showError(message);
        } finally {
            setDepositsLoading(false);
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


    const handleRecordDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!(parseFloat(depositForm.amount) > 0)) {
            showError('El monto del depósito debe ser mayor a 0');
            return;
        }
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
            setIsDepositOpen(false);
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

    const handleReverseDeposit = async (e: React.FormEvent) => {
        e.preventDefault();
        const reason = reverseReason.trim();
        if (!reverseTarget || !reason) return;
        setLoading(true);
        try {
            await api.post(`/advanced/reconciliation/deposit/${reverseTarget.id}/reverse`, { reason });
            showSuccess('Depósito revertido; sus turnos vuelven a estar pendientes');
            setReverseTarget(null);
            setReverseReason('');
            void loadDeposits();
            void loadPendingReconciliations();
        } catch (error: unknown) {
            showError('Error al revertir depósito: ' + errorMessage(error));
        } finally {
            setLoading(false);
        }
    };

    const handleMarkAsReconciled = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedShifts.length === 0) {
            showError('Seleccione al menos un turno para conciliar');
            return;
        }
        const reference = reconcileReference.trim();
        if (!reference) return;

        setLoading(true);
        try {
            await api.post('/advanced/reconciliation/mark-reconciled', {
                shiftIds: selectedShifts,
                depositReference: reference
            });
            showSuccess(`${selectedShifts.length} turno(s) marcado(s) como conciliado(s)`);
            setSelectedShifts([]);
            setIsReconcileOpen(false);
            setReconcileReference('');
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


    const symbol = settings.currency_symbol || 'C$';
    const money = (value: unknown) => formatMoney(value, symbol);

    const tabs = [
        { id: 'status', label: 'Estado' },
        { id: 'pending', label: 'Pendientes', badge: pendingLoadError ? undefined : pending.length },
        { id: 'deposit', label: 'Depósitos' },
    ];

    const isReconciled = status?.reconciliation.status === 'RECONCILED';
    const difference = status?.reconciliation.difference ?? 0;

    const allSelected = selectedShifts.length === pending.length && pending.length > 0;

    const methodRows = status
        ? [
            { key: 'cash', label: 'Efectivo', amount: status.totals.byMethod.cash },
            { key: 'card', label: 'Tarjeta', amount: status.totals.byMethod.card },
            { key: 'transfer', label: 'Transferencia', amount: status.totals.byMethod.transfer },
            { key: 'other', label: 'Otros', amount: status.totals.byMethod.other },
        ]
        : [];
    const methodColumns: Column<{ key: string; label: string; amount: number }>[] = [
        { key: 'label', header: 'Método', width: '2fr' },
        { key: 'amount', header: `Monto (${symbol})`, width: '1fr', type: 'money' },
    ];

    const pendingColumns: Column<PendingReconciliation>[] = [
        {
            key: 'select',
            header: (
                <Checkbox
                    aria-label="Seleccionar todos los turnos"
                    checked={allSelected}
                    onChange={(e) => setSelectedShifts(e.target.checked ? pending.map((p) => p.shiftId) : [])}
                    label=""
                />
            ),
            width: '3rem',
            render: (shift) => (
                <Checkbox
                    aria-label={`Seleccionar turno ${shift.shiftId}`}
                    checked={selectedShifts.includes(shift.shiftId)}
                    onChange={() => toggleShiftSelection(shift.shiftId)}
                    label=""
                />
            ),
        },
        { key: 'date', header: 'Fecha', width: '1fr', type: 'date' },
        { key: 'cashRegister', header: 'Caja', width: '1.2fr' },
        { key: 'user', header: 'Usuario', width: '1.2fr', hideBelow: 'md' },
        { key: 'startAmount', header: `Monto inicial (${symbol})`, width: '1fr', type: 'money', hideBelow: 'lg' },
        { key: 'endAmount', header: `Monto final (${symbol})`, width: '1fr', type: 'money' },
        {
            key: 'difference', header: `Diferencia (${symbol})`, width: '1fr', type: 'money',
        },
        {
            key: 'status', header: 'Estado', width: '1fr',
            render: (shift) => (
                <Badge tone={shift.status === 'BALANCED' ? 'success' : 'warning'} dot>
                    {shift.status === 'BALANCED' ? 'Cuadrado' : 'Con diferencia'}
                </Badge>
            ),
        },
    ];

    const depositColumns: Column<BankDeposit>[] = [
        { key: 'date', header: 'Fecha', width: '1fr', type: 'date' },
        { key: 'reference', header: 'Referencia', width: '1.2fr' },
        { key: 'bankAccount', header: 'Cuenta', width: '1.6fr', hideBelow: 'md' },
        { key: 'amount', header: `Monto (${symbol})`, width: '1fr', type: 'money', accessor: (d) => Number(d.amount) },
        { key: 'shifts', header: 'Turnos', width: '0.7fr', type: 'number', decimals: 0, hideBelow: 'lg', accessor: (d) => d.shifts.length },
        {
            key: 'status', header: 'Estado', width: '1fr',
            render: (d) => <Badge tone={d.status === 'ACTIVE' ? 'success' : 'warning'} dot>{d.status === 'ACTIVE' ? 'Activo' : 'Revertido'}</Badge>,
        },
        {
            key: 'actions', header: 'Acciones', width: '100px', type: 'actions',
            render: (d) => (
                <span className={styles.rowActions}>
                    {d.status === 'ACTIVE' && (
                        <IconButton
                            icon={Ban} size="sm" tone="danger" tooltip="Anular" label="Revertir depósito" disabled={loading}
                            onClick={() => { setReverseReason(''); setReverseTarget(d); }}
                        />
                    )}
                    {d.status === 'REVERSED' && d.reversalReason && (
                        <span className={styles.muted} title={d.reversalReason}>Reverso registrado</span>
                    )}
                </span>
            ),
        },
    ];

    const depositDirty = Boolean(depositForm.amount || depositForm.bankAccount || depositForm.reference || depositForm.notes || selectedShifts.length > 0);

    return (
        <PageContent>
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            <PageHeader
                title="Conciliación Bancaria"
                description="Gestiona la conciliación de caja con depósitos bancarios"
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => setIsDepositOpen(true)}>
                        Registrar depósito
                    </Button>
                )}
            />

            <Tabs ariaLabel="Secciones de conciliación" tabs={tabs} active={activeTab} onChange={(id) => setActiveTab(id as TabKey)} />

            {activeTab === 'status' && (
                <>
                    <TableToolbar
                        actions={(
                            <Button icon={Search} loading={loading} onClick={() => void loadReconciliationStatus()} disabled={loading}>
                                {loading ? 'Cargando...' : 'Consultar'}
                            </Button>
                        )}
                    >
                        <Field label="Desde" htmlFor="rec-from">
                            <DateInput
                                id="rec-from"
                                value={dateRange.startDate}
                                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                            />
                        </Field>
                        <Field label="Hasta" htmlFor="rec-to">
                            <DateInput
                                id="rec-to"
                                value={dateRange.endDate}
                                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                            />
                        </Field>
                    </TableToolbar>

                    {statusLoadError && (
                        <LoadErrorState message={statusLoadError} onRetry={() => void loadReconciliationStatus()} />
                    )}

                    {status && !statusLoadError && (
                        <>
                            <div className={styles.kpiGrid}>
                                <StatCard
                                    label="Diferencia de efectivo"
                                    value={money(difference)}
                                    tone={difference === 0 ? 'success' : 'warning'}
                                    context={`${difference > 0 ? 'Sobrante' : difference < 0 ? 'Faltante' : 'Cuadrado'} · ${isReconciled ? 'Conciliado' : 'Pendiente de conciliar'} · esperado ${money(status.reconciliation.cashExpected)}, real ${money(status.reconciliation.cashActual)} en ${status.shifts} turnos`}
                                    action={!isReconciled && pending.length > 0
                                        ? { label: 'Ver turnos pendientes', onClick: () => setActiveTab('pending') }
                                        : undefined}
                                />
                            </div>

                            <DataTable
                                ariaLabel="Ventas por método de pago"
                                columns={methodColumns}
                                rows={methodRows}
                                rowKey={(r) => r.key}
                                resetKey={status.period.start}
                            />
                        </>
                    )}

                    {!status && !loading && !statusLoadError && (
                        <EmptyState title="No hay datos disponibles para el período seleccionado." />
                    )}
                </>
            )}

            {activeTab === 'pending' && (
                <>
                    {selectedShifts.length > 0 && (
                        <TableToolbar
                            actions={(
                                <Button variant="primary" icon={CheckCircle2} onClick={() => { setReconcileReference(''); setIsReconcileOpen(true); }} disabled={loading}>
                                    Marcar {selectedShifts.length} como conciliado(s)
                                </Button>
                            )}
                        />
                    )}
                    <DataTable
                        ariaLabel="Turnos pendientes de conciliación"
                        columns={pendingColumns}
                        rows={pendingLoadError ? [] : pending}
                        rowKey={(shift) => shift.shiftId}
                        resetKey={pending.length}
                        loading={pendingLoading}
                        error={pendingLoadError}
                        onRetry={() => void loadPendingReconciliations()}
                        empty="No hay turnos pendientes de conciliación."
                    />
                </>
            )}

            {activeTab === 'deposit' && (
                <>
                    <DataTable
                        ariaLabel="Historial de depósitos"
                        columns={depositColumns}
                        rows={depositsLoadError ? [] : deposits}
                        rowKey={(d) => d.id}
                        resetKey={deposits.length}
                        loading={depositsLoading}
                        error={depositsLoadError}
                        onRetry={() => void loadDeposits()}
                        empty="Sin depósitos registrados."
                    />
                </>
            )}

            <FullScreenModal
                isOpen={isDepositOpen}
                onClose={() => setIsDepositOpen(false)}
                title="Registrar depósito bancario"
                dirty={depositDirty}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="deposit-form" loading={loading} disabled={loading}>
                            {loading ? 'Guardando...' : 'Registrar depósito'}
                        </Button>
                    </>
                )}
            >
                <form id="deposit-form" onSubmit={handleRecordDeposit} className={styles.stack}>
                    <FormSection step={1} title="Datos del depósito">
                        <FormGrid>
                            <Field label="Fecha del depósito" htmlFor="deposit-date" required>
                                <DateInput
                                    id="deposit-date"
                                    value={depositForm.date}
                                    onChange={(e) => setDepositForm({ ...depositForm, date: e.target.value })}
                                    required
                                />
                            </Field>
                            <Field label="Monto" htmlFor="deposit-amount" required>
                                <NumberInput
                                    id="deposit-amount"
                                    value={depositForm.amount === '' ? null : Number(depositForm.amount)}
                                    onChange={(v) => setDepositForm({ ...depositForm, amount: v === null ? '' : String(v) })}
                                    min={0.01}
                                    prefix={symbol}
                                />
                            </Field>
                            <Field label="Cuenta bancaria" htmlFor="deposit-bank-account" required>
                                <Input
                                    id="deposit-bank-account"
                                    value={depositForm.bankAccount}
                                    onChange={(e) => setDepositForm({ ...depositForm, bankAccount: e.target.value })}
                                    required
                                    placeholder="Ej: BAC — Cuenta Corriente 123456"
                                />
                            </Field>
                            <Field label="Referencia / Boleta" htmlFor="deposit-reference" required>
                                <Input
                                    id="deposit-reference"
                                    value={depositForm.reference}
                                    onChange={(e) => setDepositForm({ ...depositForm, reference: e.target.value })}
                                    required
                                    placeholder="Número de boleta o referencia"
                                />
                            </Field>
                        </FormGrid>
                        <Field label="Notas" htmlFor="deposit-notes">
                            <Textarea
                                id="deposit-notes"
                                value={depositForm.notes}
                                onChange={(e) => setDepositForm({ ...depositForm, notes: e.target.value })}
                                placeholder="Detalles adicionales del depósito..."
                            />
                        </Field>
                    </FormSection>

                    {pending.length > 0 && (
                        <FormSection step={2} title="Turnos asociados (opcional)">
                            <div role="group" aria-label="Turnos asociados" className={styles.checkList}>
                                {pending.map((shift) => (
                                    <Checkbox
                                        key={shift.shiftId}
                                        checked={selectedShifts.includes(shift.shiftId)}
                                        onChange={() => toggleShiftSelection(shift.shiftId)}
                                        label={`${new Date(shift.date).toLocaleDateString('es-NI')} — ${shift.cashRegister} — ${money(shift.endAmount)}`}
                                    />
                                ))}
                            </div>
                        </FormSection>
                    )}
                </form>
            </FullScreenModal>
            <FullScreenModal
                isOpen={reverseTarget !== null}
                size="compact"
                onClose={() => setReverseTarget(null)}
                title="Revertir depósito"
                subtitle={reverseTarget ? `Referencia ${reverseTarget.reference}` : undefined}
                dirty={reverseReason.trim() !== ''}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="danger" type="submit" form="reverse-deposit-form" loading={loading} disabled={loading || !reverseReason.trim()}>
                            Revertir depósito
                        </Button>
                    </>
                )}
            >
                <form id="reverse-deposit-form" onSubmit={(e) => void handleReverseDeposit(e)}>
                    <Field label="Motivo del reverso" htmlFor="reverse-deposit-reason" required>
                        <Textarea
                            id="reverse-deposit-reason"
                            value={reverseReason}
                            onChange={(e) => setReverseReason(e.target.value)}
                            maxLength={500}
                            autoFocus
                        />
                    </Field>
                </form>
            </FullScreenModal>

            <FullScreenModal
                isOpen={isReconcileOpen}
                size="compact"
                onClose={() => setIsReconcileOpen(false)}
                title="Marcar turnos como conciliados"
                subtitle={`${selectedShifts.length} turno(s) seleccionado(s)`}
                dirty={reconcileReference.trim() !== ''}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="reconcile-form" loading={loading} disabled={loading || !reconcileReference.trim()}>
                            Marcar como conciliados
                        </Button>
                    </>
                )}
            >
                <form id="reconcile-form" onSubmit={(e) => void handleMarkAsReconciled(e)}>
                    <Field label="Referencia del depósito bancario" htmlFor="reconcile-reference" required>
                        <Input
                            id="reconcile-reference"
                            value={reconcileReference}
                            onChange={(e) => setReconcileReference(e.target.value)}
                            placeholder="Número de boleta o referencia"
                            autoFocus
                        />
                    </Field>
                </form>
            </FullScreenModal>
        </PageContent>
    );
};

export default BankReconciliation;
