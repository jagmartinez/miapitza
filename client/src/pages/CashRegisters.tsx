import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { useNavigate } from 'react-router-dom';
import { branchesAPI, cashRegistersAPI, cashShiftsAPI } from '../services/api';
import { Wallet, Unlock, History, Plus, Search } from 'lucide-react';
import type { Branch, CashRegister, CashShift } from '../types';
import { useCurrency } from '../hooks/useCurrency';
import { formatLocalDateInput } from '../utils/dateInput';
import styles from './CashRegisters.module.css';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, FormSection, FullScreenModal, Input,
    PageHeader, SegmentedControl, formatNumber, type Column,
} from '@/ui';

export default function CashRegisters() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const navigate = useNavigate();
    const { formatMoney } = useCurrency();
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
        return formatLocalDateInput(d);
    });
    const [endDate, setEndDate] = useState(() => {
        return formatLocalDateInput();
    });

    // Open Shift Modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedRegisterId, setSelectedRegisterId] = useState<number | null>(null);
    const [startAmount, setStartAmount] = useState('');

    // Create Register Modal
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newRegisterName, setNewRegisterName] = useState('');
    const [newRegisterBranchId, setNewRegisterBranchId] = useState(() => user?.branchId ? String(user.branchId) : '');
    const [branches, setBranches] = useState<Branch[]>([]);
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

    useEffect(() => {
        if (user?.branchId) return;
        let cancelled = false;
        branchesAPI.getAll({ status: 'ACTIVE' })
            .then((response) => {
                if (cancelled) return;
                const rows = (response.data.data || []) as Branch[];
                setBranches(rows);
                if (rows.length === 1) setNewRegisterBranchId(String(rows[0].id));
            })
            .catch(() => {
                if (!cancelled) showError('No se pudieron cargar las sucursales.');
            });
        return () => { cancelled = true; };
    }, [showError, user?.branchId]);

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
            showWarning('Solo administradores pueden crear cajas registradoras.');
            return;
        }
        if (!newRegisterName.trim()) {
            showWarning('Indique el nombre de la caja.');
            return;
        }
        if (!user?.branchId && !newRegisterBranchId) {
            showWarning('Seleccione la sucursal de la caja.');
            setActiveTab('configuracion');
            return;
        }
        const payload: { name: string; branchId?: number } = { name: newRegisterName.trim() };
        if (user?.branchId) {
            payload.branchId = user.branchId;
        } else {
            payload.branchId = Number(newRegisterBranchId);
        }
        try {
            await cashRegistersAPI.create(payload);
            setIsCreateModalOpen(false);
            setNewRegisterName('');
            setNewRegisterBranchId(user?.branchId ? String(user.branchId) : '');
            loadRegisters();
        } catch (error) {
            console.error('Error creating register:', error);
            showError('Error al crear caja');
        }
    };

    const handleOpenShiftClick = (e?: React.MouseEvent, registerId?: number | null) => {
        e?.stopPropagation();
        setSelectedRegisterId(registerId ?? null);
        setStartAmount('');
        setIsModalOpen(true);
    };

    const confirmOpenShift = async () => {
        if (!selectedRegisterId) {
            showWarning('Seleccione una caja para abrir el turno.');
            return;
        }
        if (startAmount === '' || Number.isNaN(Number(startAmount)) || Number(startAmount) < 0) {
            showWarning('Indique un monto inicial válido (0 o mayor).');
            return;
        }

        try {
            const res = await cashShiftsAPI.open({
                cashRegisterId: selectedRegisterId,
                startAmount: Number(startAmount)
            });
            setIsModalOpen(false);
            navigate(`/cash-shifts/${res.data.data.id}`);
        } catch (error: unknown) {
            const errData = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string; errors?: Array<{ message: string }> } } }).response?.data
                : undefined;
            const apiMsg = errData?.message;
            const validationMsg = errData?.errors?.map((e) => e.message).join('. ');
            const errorMessage = (apiMsg && apiMsg !== 'Error de validación' ? apiMsg : validationMsg) || apiMsg || 'Error al abrir turno';
            if (errorMessage.includes('turno abierto') || errorMessage.includes('already has an open shift')) {
                const confirmNavigate = await confirm('Esta caja ya tiene un turno abierto. ¿Deseas ir al turno activo?', { title: 'Confirmar acción' });
                if (confirmNavigate && selectedRegisterId) {
                    handleViewActiveShift(undefined, selectedRegisterId);
                }
                setIsModalOpen(false);
            } else {
                showError(errorMessage);
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
                showError('No hay turno activo (error de sincronización)');
                loadRegisters();
            }
        } catch (error) {
            console.error('Error getting active shift:', error);
        }
    };

    const selectedRegister = selectedRegisterId
        ? registers.find((r) => r.id === selectedRegisterId)
        : null;

    const query = searchQuery.trim().toLowerCase();
    const filteredRegisters = registers.filter((r) =>
        r.name.toLowerCase().includes(query) ||
        (r.branch?.name || '').toLowerCase().includes(query)
    );

    const filteredShifts = shifts.filter((s) =>
        (s.register?.name || s.cashRegister?.name || '').toLowerCase().includes(query) ||
        (s.user?.name || '').toLowerCase().includes(query)
    );

    const registerColumns: Column<CashRegister>[] = [
        { key: 'name', header: 'Caja', width: '1.6fr', render: (r) => <strong>{r.name}</strong> },
        { key: 'branch', header: 'Sucursal', width: '1.4fr', render: (r) => r.branch?.name || 'Sucursal Principal' },
        {
            key: 'status',
            header: 'Estado',
            type: 'status',
            width: '0.8fr',
            render: (r) => <Badge tone={r.status === 'OPEN' ? 'success' : 'neutral'} dot>{r.status === 'OPEN' ? 'Abierta' : 'Cerrada'}</Badge>,
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '1fr',
            render: (r) => r.status === 'CLOSED' ? (
                <Button size="sm" variant="secondary" icon={Unlock} onClick={(e) => handleOpenShiftClick(e, r.id)}>Abrir Caja</Button>
            ) : (
                <Button size="sm" variant="primary" icon={History} onClick={(e) => void handleViewActiveShift(e, r.id)}>Ver Turno</Button>
            ),
        },
    ];

    const shiftColumns: Column<CashShift>[] = [
        { key: 'id', header: 'Turno', width: '0.6fr', render: (s) => `#${s.id}` },
        { key: 'register', header: 'Caja', width: '1.2fr', render: (s) => s.register?.name || s.cashRegister?.name || 'Caja' },
        { key: 'user', header: 'Cajero', width: '1.2fr', render: (s) => s.user?.name || 'N/D' },
        {
            key: 'startDate',
            header: 'Inicio',
            width: '1.2fr',
            render: (s) => `${new Date(s.startDate).toLocaleDateString('es-NI')} ${new Date(s.startDate).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}`,
        },
        {
            key: 'state',
            header: 'Estado',
            type: 'status',
            width: '0.8fr',
            render: (s) => <Badge tone={s.endDate ? 'neutral' : 'success'} dot>{s.endDate ? 'Finalizado' : 'En Curso'}</Badge>,
        },
        { key: 'startAmount', header: 'Saldo Inicial', type: 'money', width: '1fr', render: (s) => formatMoney(Number(s.startAmount)) },
        {
            key: 'difference',
            header: 'Diferencia',
            type: 'money',
            width: '1fr',
            render: (s) => {
                if (!s.endDate || s.difference === undefined || s.difference === null) return 'N/D';
                const diff = Number(s.difference);
                if (!Number.isFinite(diff)) return 'N/D';
                return <span className={diff < 0 ? styles.loss : undefined}>{formatMoney(diff)}</span>;
            },
        },
    ];

    return (
        <div className={styles.page}>
            <PageHeader
                title="Cajas Registradoras"
                description={viewTab === 'registers'
                    ? `${formatNumber(registers.length, 0)} cajas registradas`
                    : `${formatNumber(shifts.length, 0)} turnos encontrados`}
                actions={viewTab === 'registers' && canCreateRegister ? (
                    <Button variant="primary" icon={Plus} onClick={() => {
                        setActiveTab('general');
                        setIsCreateModalOpen(true);
                    }}>
                        Nueva Caja
                    </Button>
                ) : undefined}
            />

            <div className={styles.filters}>
                <Field label="Buscar" htmlFor="cash-search">
                    <Input
                        id="cash-search"
                        type="search"
                        prefix={<Search size={16} aria-hidden="true" />}
                        placeholder={viewTab === 'registers' ? 'Buscar caja o sucursal...' : 'Buscar por caja o cajero...'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </Field>
                {viewTab === 'history' && (
                    <>
                        <Field label="Desde" htmlFor="cash-from">
                            <DateInput id="cash-from" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </Field>
                        <Field label="Hasta" htmlFor="cash-to">
                            <DateInput id="cash-to" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        </Field>
                    </>
                )}
                <SegmentedControl
                    ariaLabel="Vista de cajas"
                    value={viewTab}
                    onChange={setViewTab}
                    options={[
                        { value: 'registers', label: 'Cajas' },
                        { value: 'history', label: 'Historial' },
                    ]}
                />
            </div>

            {viewTab === 'registers' ? (
                <DataTable<CashRegister>
                    ariaLabel="Cajas registradoras"
                    columns={registerColumns}
                    rows={filteredRegisters}
                    rowKey={(r) => r.id}
                    loading={loading}
                    defaultPageSize={25}
                    resetKey={searchQuery}
                    onRowClick={(r) => void (r.status === 'OPEN' ? handleViewActiveShift(undefined, r.id) : handleOpenShiftClick(undefined, r.id))}
                    empty={<EmptyState icon={Wallet} title="No se encontraron cajas registradas" />}
                />
            ) : (
                <DataTable<CashShift>
                    ariaLabel="Historial de turnos de caja"
                    columns={shiftColumns}
                    rows={filteredShifts}
                    rowKey={(s) => s.id}
                    loading={loading}
                    defaultPageSize={25}
                    resetKey={`${searchQuery}|${startDate}|${endDate}`}
                    onRowClick={(s) => navigate(`/cash-shifts/${s.id}`)}
                    empty={<EmptyState icon={History} title="No se encontró actividad en el rango seleccionado" />}
                />
            )}

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Apertura de Caja"
                subtitle={selectedRegister ? `${selectedRegister.name}${selectedRegister.branch?.name ? ` · ${selectedRegister.branch.name}` : ''}` : undefined}
                footer={({ requestClose }) => (
                    <>
                        <Button variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" onClick={() => void confirmOpenShift()}>Abrir Turno</Button>
                    </>
                )}
            >
                <FormSection title="Saldo de Apertura">
                    <Field label="Monto Inicial en Efectivo" htmlFor="register-start-amount" hint="Ingrese la cantidad total de efectivo disponible al iniciar.">
                        <Input
                            id="register-start-amount"
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={startAmount}
                            onChange={(e) => setStartAmount(e.target.value)}
                            placeholder="0.00"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirmOpenShift(); } }}
                        />
                    </Field>
                </FormSection>
            </FullScreenModal>

            <FullScreenModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                title="Nueva Caja Registradora"
                tabs={[{ id: 'general', label: 'General' }, { id: 'configuracion', label: 'Configuración' }]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as 'general' | 'configuracion')}
                footer={({ requestClose }) => (
                    <>
                        <Button type="button" variant="ghost" onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="button" onClick={handleCreateRegister}>Guardar Caja</Button>
                    </>
                )}
            >
                {activeTab === 'general' && (
                    <FormSection title="Identificación">
                        <Field label="Nombre de la Caja" htmlFor="register-name" required>
                            <Input id="register-name" type="text" value={newRegisterName} onChange={(e) => setNewRegisterName(e.target.value)} placeholder="Ej: Caja Barra..." autoFocus />
                        </Field>
                    </FormSection>
                )}
                {activeTab === 'configuracion' && (
                    <FormSection title="Ubicación">
                        {user?.branchId ? (
                            <Field label="Sucursal" htmlFor="register-branch">
                                <Input id="register-branch" type="text" value={user.branch?.name || `Sucursal #${user.branchId}`} disabled />
                            </Field>
                        ) : (
                            <Field label="Sucursal" htmlFor="register-branch-select" required>
                                <AppSelect<string>
                                    isClearable={false}
                                    inputId="register-branch-select"
                                    options={branches.map((branch) => ({ value: String(branch.id), label: branch.name }))}
                                    value={newRegisterBranchId || null}
                                    onChange={(value) => setNewRegisterBranchId(value ?? '')}
                                />
                            </Field>
                        )}
                    </FormSection>
                )}
            </FullScreenModal>
        </div>
    );
}
