import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Briefcase,
    BadgeCheck,
    Building2,
    Eye,
    Pencil,
    Power,
    Plus,
    Search,
    UsersRound,
    WalletCards,
} from 'lucide-react';
import {
    AppSelect, Button, DataTable, EmptyState, FullScreenModal, IconButton, Input, LoadErrorState, PageContent, PageHeader,
    Pagination, StatCard, TableToolbar, type Column,
} from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import ViewToggle from '../../components/ViewToggle';
import EmployeeForm from '../../components/hr/EmployeeForm';
import HrStatusPill from '../../components/hr/HrStatusPill';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import { useViewMode } from '../../hooks/useViewMode';
import type {
    HrEmployee,
    HrEmployeePayload,
    HrEmploymentStatus,
    HrNamedEntity,
    HrOrganizationCatalogs,
    HrPayFrequency,
    HrUserSummary,
} from '../../types/hr';
import { useDebounce } from '../../utils/useDebounce';
import { formatHrMoney } from '../../utils/hrDisplay';
import styles from '../../components/hr/hrForm.module.css';
import './hr.css';

type Option = { value: string; label: string };

const EMPTY_LOOKUPS: HrOrganizationCatalogs = {
    departments: [],
    positions: [],
    costCenters: [],
    branches: [],
    users: [],
};

const STATUS_OPTIONS: Array<Option & { value: HrEmploymentStatus | 'ALL' }> = [
    { value: 'ALL', label: 'Todos los estados' },
    { value: 'ACTIVE', label: 'Activos' },
    { value: 'ON_LEAVE', label: 'Con permiso' },
    { value: 'INACTIVE', label: 'Inactivos' },
    { value: 'SUSPENDED', label: 'Suspendidos' },
    { value: 'TERMINATED', label: 'Finalizados' },
];

function initials(employee: HrEmployee): string {
    return (employee.legalName || employee.user?.name || 'E')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

function displayDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(date);
}

function primaryBranch(employee: HrEmployee): HrNamedEntity | null {
    return employee.branchAssignments?.find((assignment) => assignment.isPrimary)?.branch ?? null;
}

function currentCompensation(employee: HrEmployee) {
    return employee.compensation?.[0] ?? null;
}

function payFrequencyText(value: HrPayFrequency): string {
    return ({
        WEEKLY: 'Semanal',
        BIWEEKLY: 'Quincenal',
        FORTNIGHTLY: 'Catorcenal',
        MONTHLY: 'Mensual',
    })[value];
}

function identificationText(employee: HrEmployee): string {
    if (employee.documentNumber === undefined) return 'Acceso restringido';
    return employee.documentNumber || 'Sin registrar';
}

export default function Employees() {
    const navigate = useNavigate();
    const { confirm } = useConfirmDialog();
    const { error: showError, success: showSuccess } = useAppToast();
    const { viewMode, setViewMode } = useViewMode('hr-employees');
    const [employees, setEmployees] = useState<HrEmployee[]>([]);
    const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 300);
    const [status, setStatus] = useState<HrEmploymentStatus | 'ALL'>('ALL');
    const [departmentId, setDepartmentId] = useState('');
    const [jobPositionId, setJobPositionId] = useState('');
    const [costCenterId, setCostCenterId] = useState('');
    const [branchId, setBranchId] = useState('');
    const [page, setPage] = useState(1);
    const [preview, setPreview] = useState<HrEmployee | null>(null);
    const [totalPages, setTotalPages] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<HrEmployee | null>(null);
    const [saving, setSaving] = useState(false);

    const loadLookups = useCallback(async () => {
        try {
            const result = await hrClient.getOrganization();
            setLookups(result);
        } catch (lookupError) {
            showError(getHrErrorMessage(lookupError, 'No fue posible cargar los catálogos de RH.'));
        }
    }, [showError]);

    const loadEmployees = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await hrClient.getEmployees({
                search: debouncedSearch,
                status,
                departmentId: departmentId ? Number(departmentId) : undefined,
                jobPositionId: jobPositionId ? Number(jobPositionId) : undefined,
                costCenterId: costCenterId ? Number(costCenterId) : undefined,
                branchId: branchId ? Number(branchId) : undefined,
                page,
                limit: 25,
            });
            setEmployees(result.items);
            setTotalPages(result.pagination?.totalPages ?? 1);
            setTotalItems(result.pagination?.total ?? result.items.length);
        } catch (loadError) {
            setEmployees([]);
            setError(getHrErrorMessage(loadError, 'No fue posible cargar el personal.'));
        } finally {
            setLoading(false);
        }
    }, [branchId, costCenterId, debouncedSearch, departmentId, jobPositionId, page, status]);

    useEffect(() => {
        void loadLookups();
    }, [loadLookups]);

    useEffect(() => {
        void loadEmployees();
    }, [loadEmployees]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, status, departmentId, jobPositionId, costCenterId, branchId]);

    const filteredPositions = useMemo(() => lookups.positions.filter((position) =>
        !departmentId || String(position.departmentId ?? '') === departmentId
    ), [departmentId, lookups.positions]);

    const users: HrUserSummary[] = lookups.users ?? [];

    const closeEditor = () => {
        if (saving) return;
        setEditorOpen(false);
        setEditingEmployee(null);
    };

    const openCreate = () => {
        setEditingEmployee(null);
        setEditorOpen(true);
    };

    const openEdit = async (employee: HrEmployee) => {
        try {
            // The list contract intentionally excludes sensitive PII. Always load
            // the protected detail before editing so omitted fields are not
            // overwritten with null values.
            const detail = await hrClient.getEmployee(employee.id);
            setEditingEmployee(detail);
            setEditorOpen(true);
        } catch (loadError) {
            showError(getHrErrorMessage(loadError, 'No fue posible cargar el expediente para editarlo.'));
        }
    };

    const saveEmployee = async (payload: HrEmployeePayload) => {
        setSaving(true);
        try {
            if (editingEmployee) {
                await hrClient.updateEmployee(editingEmployee.id, payload);
                showSuccess('Empleado actualizado correctamente.');
            } else {
                await hrClient.createEmployee(payload);
                showSuccess('Empleado, usuario y compensación inicial creados en una sola operación.');
            }
            setEditorOpen(false);
            setEditingEmployee(null);
            await Promise.all([loadEmployees(), loadLookups()]);
        } catch (saveError) {
            showError(getHrErrorMessage(saveError, 'No fue posible guardar el empleado.'));
        } finally {
            setSaving(false);
        }
    };

    const deactivate = async (employee: HrEmployee) => {
        const accepted = await confirm(
            `¿Desactivar el expediente laboral de ${employee.legalName}? El historial se conservará.`,
            { title: 'Desactivar empleado', confirmText: 'Desactivar', variant: 'warning' }
        );
        if (!accepted) return;
        try {
            await hrClient.changeEmployeeStatus(employee.id, 'INACTIVE');
            showSuccess('Empleado desactivado.');
            await loadEmployees();
        } catch (statusError) {
            showError(getHrErrorMessage(statusError, 'No fue posible desactivar el empleado.'));
        }
    };

    const pageStats = useMemo(() => ({
        withoutCompensation: employees.filter((employee) => employee.compensation !== undefined && !currentCompensation(employee)).length,
        withoutUser: employees.filter((employee) => !employee.user).length,
    }), [employees]);

    const clearFilters = () => {
        setSearch('');
        setStatus('ALL');
        setDepartmentId('');
        setJobPositionId('');
        setCostCenterId('');
        setBranchId('');
    };

    const columns: Column<HrEmployee>[] = [
        {
            key: 'employee',
            header: 'Empleado',
            render: (employee) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{employee.legalName}</span>
                    <span className={styles.cellSub}>{employee.employeeCode}</span>
                </div>
            ),
        },
        {
            key: 'user',
            header: 'Usuario',
            render: (employee) => employee.user
                ? <div className={styles.cellStack}><span className={styles.cellTitle}>@{employee.user.username}</span><span className={styles.cellSub}>Interno</span></div>
                : '—',
        },
        {
            key: 'identification',
            header: 'Identificación',
            render: (employee) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{identificationText(employee)}</span>
                    <span className={styles.cellSub}>{employee.documentNumber === undefined ? 'Dato protegido' : employee.documentType || 'Tipo no definido'}</span>
                </div>
            ),
        },
        { key: 'position', header: 'Puesto', render: (employee) => employee.jobPosition?.name ?? 'Sin puesto' },
        {
            key: 'compensation',
            header: 'Compensación vigente',
            type: 'money',
            render: (employee) => {
                const compensation = currentCompensation(employee);
                if (employee.compensation === undefined) return <span className={styles.cellSub}>Acceso restringido</span>;
                if (!compensation) return <span className={styles.cellSub}>Sin compensación vigente</span>;
                return (
                    <div className={styles.cellStack}>
                        <span className={`${styles.cellTitle} hr-money`}>{formatHrMoney(compensation.currency, compensation.amount)}</span>
                        <span className={styles.cellSub}>{compensation.compensationType === 'SALARY' ? 'Salario' : 'Por hora'} · {payFrequencyText(compensation.payFrequency)}</span>
                    </div>
                );
            },
        },
        { key: 'branch', header: 'Sucursal principal', render: (employee) => primaryBranch(employee)?.name ?? 'Sin asignar' },
        { key: 'hireDate', header: 'Ingreso', render: (employee) => displayDate(employee.hireDate) },
        { key: 'status', header: 'Estado', render: (employee) => <HrStatusPill status={employee.status} /> },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '136px',
            render: (employee) => (
                <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
                    <IconButton icon={Eye} size="sm" tooltip="Ver detalle" label={`Ver expediente de ${employee.legalName}`} onClick={() => navigate(`/rh/personal/${employee.id}`)} />
                    <IconButton icon={Pencil} size="sm" tooltip="Editar" label={`Editar ${employee.legalName}`} onClick={() => void openEdit(employee)} />
                    {employee.status === 'ACTIVE' && (
                        <IconButton icon={Power} size="sm" tone="danger" tooltip="Desactivar" label={`Desactivar ${employee.legalName}`} onClick={() => void deactivate(employee)} />
                    )}
                </div>
            ),
        },
    ];

    const hasFilters = Boolean(search || status !== 'ALL' || departmentId || jobPositionId || costCenterId || branchId);
    const emptyState = (
        <EmptyState
            icon={UsersRound}
            title="No hay empleados que coincidan con los filtros"
            action={hasFilters ? <Button onClick={clearFilters}>Limpiar filtros</Button> : undefined}
        />
    );

    return (
        <PageContent>
            <PageHeader
                title="Gestión de Personal"
                description="Expedientes, identificación autorizada y compensación vigente"
                actions={<Button variant="primary" icon={Plus} onClick={openCreate}>Nuevo empleado</Button>}
            />

            {!loading && !error && (pageStats.withoutCompensation > 0 || pageStats.withoutUser > 0) && (
                <section className={styles.kpis} aria-label="Brechas del expediente en esta página">
                    {pageStats.withoutCompensation > 0 && (
                        <StatCard tone="danger" label="Sin compensación vigente" value={String(pageStats.withoutCompensation)} context="En esta página · requieren versión salarial." />
                    )}
                    {pageStats.withoutUser > 0 && (
                        <StatCard tone="warning" label="Sin usuario vinculado" value={String(pageStats.withoutUser)} context="En esta página · sin acceso al sistema." />
                    )}
                </section>
            )}

            <TableToolbar
                actions={(
                    <>
                        {hasFilters && <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>}
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                    </>
                )}
            >
                <div className={styles.search} role="search">
                    <Input
                        id="hr-employee-search"
                        type="search"
                        aria-label="Buscar empleado"
                        placeholder="Nombre, código o usuario"
                        prefix={<Search size={14} aria-hidden="true" />}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </div>
                <div className={styles.filter}>
                    <AppSelect<string> aria-label="Estado" options={STATUS_OPTIONS} value={status} isClearable={false}
                        onChange={(value) => setStatus((value ?? 'ALL') as HrEmploymentStatus | 'ALL')} />
                </div>
                <div className={styles.filter}>
                    <AppSelect<string> aria-label="Departamento" placeholder="Departamento" isClearable
                        options={lookups.departments.map((item) => ({ value: String(item.id), label: item.name }))}
                        value={departmentId || null}
                        onChange={(value) => { setDepartmentId(value ?? ''); setJobPositionId(''); }} />
                </div>
                <div className={styles.filter}>
                    <AppSelect<string> aria-label="Puesto" placeholder="Puesto" isClearable
                        options={filteredPositions.map((item) => ({ value: String(item.id), label: item.name }))}
                        value={jobPositionId || null}
                        onChange={(value) => setJobPositionId(value ?? '')} />
                </div>
                <div className={styles.filter}>
                    <AppSelect<string> aria-label="Centro de costo" placeholder="Centro de costo" isClearable
                        options={lookups.costCenters.map((item) => ({ value: String(item.id), label: item.name }))}
                        value={costCenterId || null}
                        onChange={(value) => setCostCenterId(value ?? '')} />
                </div>
                <div className={styles.filter}>
                    <AppSelect<string> aria-label="Sucursal" placeholder="Sucursal" isClearable
                        options={(lookups.branches ?? []).map((item) => ({ value: String(item.id), label: item.name }))}
                        value={branchId || null}
                        onChange={(value) => setBranchId(value ?? '')} />
                </div>
            </TableToolbar>

            {error ? (
                <LoadErrorState message={error} onRetry={() => void loadEmployees()} />
            ) : viewMode === 'table' ? (
                <DataTable<HrEmployee>
                    rows={employees}
                    rowKey={(employee) => employee.id}
                    columns={columns}
                    ariaLabel="Personal"
                    loading={loading}
                    empty={emptyState}
                    onRowClick={setPreview}
                    pagination={{ mode: 'server', page, pageSize: 25, total: totalItems, onChange: (nextPage) => setPage(nextPage) }}
                    pageSizeOptions={[25]}
                    minWidth="64rem"
                    resetKey={`${page}|${debouncedSearch}|${status}|${departmentId}|${jobPositionId}|${costCenterId}|${branchId}`}
                />
            ) : loading ? (
                <HrLoading text="Cargando personal…" />
            ) : employees.length === 0 ? (
                emptyState
            ) : (
                <div className="entity-grid hr-employee-grid">
                    {employees.map((employee) => (
                        <article key={employee.id} className={`entity-card entity-card-accent hr-employee-card ${employee.status === 'ACTIVE' ? 'entity-accent-success' : 'entity-accent-warning'}`}>
                            <div className="entity-card-body">
                                <div className="hr-employee-card-heading">
                                    <div className="hr-employee-avatar" aria-hidden="true">{initials(employee)}</div>
                                    <div style={{ minWidth: 0 }}>
                                        <h3 className="entity-card-title" title={employee.legalName}>{employee.legalName}</h3>
                                        <span className="entity-card-tag">{employee.employeeCode}</span>
                                    </div>
                                </div>
                                <div><HrStatusPill status={employee.status} /></div>
                                <div className="entity-card-meta">
                                    <span className="entity-card-meta-item"><Briefcase size={15} /> {employee.jobPosition?.name ?? 'Sin puesto'}</span>
                                    <span className="entity-card-meta-item"><Building2 size={15} /> {primaryBranch(employee)?.name ?? 'Sin sucursal'}</span>
                                    <span className="entity-card-meta-item"><UsersRound size={15} /> {employee.user ? `@${employee.user.username}` : 'Sin usuario'}</span>
                                    <span className="entity-card-meta-item"><BadgeCheck size={15} /> {identificationText(employee)}</span>
                                </div>
                                <div className="hr-employee-card-compensation">
                                    <WalletCards size={17} aria-hidden="true" />
                                    <div>
                                        <span>Compensación vigente</span>
                                        {employee.compensation === undefined
                                            ? <strong>Acceso restringido</strong>
                                            : currentCompensation(employee)
                                                ? <><strong>{formatHrMoney(currentCompensation(employee)!.currency, currentCompensation(employee)!.amount)}</strong><small>{currentCompensation(employee)!.compensationType === 'SALARY' ? 'Salario' : 'Por hora'} · {payFrequencyText(currentCompensation(employee)!.payFrequency)}</small></>
                                                : <strong>Sin compensación vigente</strong>}
                                    </div>
                                </div>
                            </div>
                            <div className={styles.cardActions}>
                                <IconButton icon={Eye} size="sm" tooltip="Ver expediente" label={`Ver expediente de ${employee.legalName}`} onClick={() => navigate(`/rh/personal/${employee.id}`)} />
                                <IconButton icon={Pencil} size="sm" tooltip="Editar" label={`Editar ${employee.legalName}`} onClick={() => void openEdit(employee)} />
                                {employee.status === 'ACTIVE' && <IconButton icon={Power} size="sm" tone="danger" tooltip="Desactivar" label={`Desactivar ${employee.legalName}`} onClick={() => void deactivate(employee)} />}
                            </div>
                        </article>
                    ))}
                </div>
            )}

            {!loading && !error && viewMode === 'cards' && totalPages > 1 && (
                <Pagination page={page} pageSize={25} total={totalItems} pageSizeOptions={[25]} hidePageSize onChange={(nextPage) => setPage(nextPage)} />
            )}

            <FullScreenModal
                isOpen={Boolean(preview)}
                onClose={() => setPreview(null)}
                title={preview?.legalName ?? 'Expediente'}
                breadcrumb={['Recursos humanos', 'Personal']}
                status={preview ? <HrStatusPill status={preview.status} /> : undefined}
                subtitle={preview ? `${preview.jobPosition?.name ?? 'Sin puesto'} · ${preview.department?.name ?? 'Sin departamento'}` : undefined}
                footer={preview ? (
                    <>
                        <Button variant="secondary" icon={Pencil} onClick={() => { const target = preview; setPreview(null); void openEdit(target); }}>Editar</Button>
                        <Button variant="primary" icon={Eye} onClick={() => navigate(`/rh/personal/${preview.id}`)}>Abrir expediente completo</Button>
                    </>
                ) : undefined}
            >
                {preview && (() => {
                    const compensation = currentCompensation(preview);
                    return (
                        <dl className={styles.facts}>
                            <div><dt>Código</dt><dd>{preview.employeeCode}</dd></div>
                            <div><dt>Ingreso</dt><dd>{displayDate(preview.hireDate)}</dd></div>
                            <div><dt>Identificación</dt><dd>{identificationText(preview)}</dd></div>
                            <div><dt>Sucursal principal</dt><dd>{primaryBranch(preview)?.name ?? 'Sin asignar'}</dd></div>
                            <div><dt>Usuario</dt><dd>{preview.user ? `@${preview.user.username}` : 'Sin usuario vinculado'}</dd></div>
                            <div><dt>Compensación vigente</dt><dd>{preview.compensation === undefined ? 'Acceso restringido' : compensation ? formatHrMoney(compensation.currency, compensation.amount) : 'Sin compensación vigente'}</dd></div>
                            <div><dt>Correo laboral</dt><dd>{preview.workEmail || '—'}</dd></div>
                            <div><dt>Teléfono</dt><dd>{preview.phone || '—'}</dd></div>
                        </dl>
                    );
                })()}
            </FullScreenModal>

            <EmployeeForm
                isOpen={editorOpen}
                employee={editingEmployee}
                lookups={lookups}
                users={users}
                saving={saving}
                onCancel={closeEditor}
                onSubmit={saveEmployee}
            />
        </PageContent>
    );
}
