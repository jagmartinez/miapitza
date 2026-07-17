import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SingleValue } from 'react-select';
import {
    Briefcase,
    BadgeCheck,
    Building2,
    Edit2,
    Eye,
    Plus,
    RefreshCw,
    Search,
    UserMinus,
    UsersRound,
    WalletCards,
} from 'lucide-react';
import Button from '../../components/Button';
import CatalogTable, { type CatalogColumn } from '../../components/CatalogTable';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import Select from '../../components/Select';
import Sidebar from '../../components/Sidebar';
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
import { formatHrMoney } from '../../utils/hrFormat';
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

    const clearFilters = () => {
        setSearch('');
        setStatus('ALL');
        setDepartmentId('');
        setJobPositionId('');
        setCostCenterId('');
        setBranchId('');
    };

    const columns: CatalogColumn<HrEmployee>[] = [
        {
            key: 'employee',
            header: 'Empleado',
            render: (employee) => (
                <div className="catalog-cell-stack">
                    <span className="cell-title">{employee.legalName}</span>
                    <span className="cell-sub">{employee.employeeCode}</span>
                </div>
            ),
        },
        {
            key: 'user',
            header: 'Usuario',
            render: (employee) => employee.user
                ? <div className="catalog-cell-stack"><span className="cell-title">@{employee.user.username}</span><span className="cell-sub">Interno</span></div>
                : '—',
        },
        {
            key: 'identification',
            header: 'Identificación',
            render: (employee) => (
                <div className="catalog-cell-stack">
                    <span className="cell-title">{identificationText(employee)}</span>
                    <span className="cell-sub">{employee.documentNumber === undefined ? 'Dato protegido' : employee.documentType || 'Tipo no definido'}</span>
                </div>
            ),
        },
        { key: 'position', header: 'Puesto', render: (employee) => employee.jobPosition?.name ?? 'Sin puesto' },
        {
            key: 'compensation',
            header: 'Compensación vigente',
            align: 'right',
            render: (employee) => {
                const compensation = currentCompensation(employee);
                if (employee.compensation === undefined) return <span className="cell-sub">Acceso restringido</span>;
                if (!compensation) return <span className="cell-sub">Sin compensación vigente</span>;
                return (
                    <div className="catalog-cell-stack hr-employee-compensation-cell">
                        <span className="cell-title hr-money">{formatHrMoney(compensation.currency, compensation.amount)}</span>
                        <span className="cell-sub">{compensation.compensationType === 'SALARY' ? 'Salario' : 'Por hora'} · {payFrequencyText(compensation.payFrequency)}</span>
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
            align: 'right',
            render: (employee) => (
                <div className="catalog-table-actions">
                    <button className="catalog-action-btn" type="button" onClick={() => navigate(`/rh/personal/${employee.id}`)} title="Ver expediente" aria-label={`Ver expediente de ${employee.legalName}`}><Eye size={16} /></button>
                    <button className="catalog-action-btn" type="button" onClick={() => void openEdit(employee)} title="Editar" aria-label={`Editar ${employee.legalName}`}><Edit2 size={16} /></button>
                    {employee.status === 'ACTIVE' && (
                        <button className="catalog-action-btn danger" type="button" onClick={() => void deactivate(employee)} title="Desactivar" aria-label={`Desactivar ${employee.legalName}`}><UserMinus size={16} /></button>
                    )}
                </div>
            ),
        },
    ];

    return (
        <div className="page-wrapper hr-employees-page">
            <PageHeader
                title="Gestión de Personal"
                subtitle="Expedientes, identificación autorizada y compensación vigente"
                icon={UsersRound}
                actions={
                    <>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        <Button onClick={openCreate}><Plus size={18} /> Nuevo empleado</Button>
                    </>
                }
            />

            <div className="filters-toolbar">
                <div className="filter-field filter-field-wide">
                    <label className="filter-field-label" htmlFor="hr-employee-search"><Search size={12} /> Buscar</label>
                    <div className="search-box">
                        <Search size={16} aria-hidden="true" />
                        <input id="hr-employee-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, código o usuario" />
                    </div>
                </div>
                <div className="filter-field">
                    <Select<Option>
                        label="Estado"
                        options={STATUS_OPTIONS}
                        value={STATUS_OPTIONS.find((option) => option.value === status)}
                        onChange={(option: SingleValue<Option>) => setStatus((option?.value ?? 'ALL') as HrEmploymentStatus | 'ALL')}
                        isSearchable={false}
                    />
                </div>
                <div className="filter-field">
                    <Select<Option>
                        label="Departamento"
                        options={[{ value: '', label: 'Todos' }, ...lookups.departments.map((item) => ({ value: String(item.id), label: item.name }))]}
                        value={departmentId ? { value: departmentId, label: lookups.departments.find((item) => String(item.id) === departmentId)?.name ?? '' } : { value: '', label: 'Todos' }}
                        onChange={(option: SingleValue<Option>) => { setDepartmentId(option?.value ?? ''); setJobPositionId(''); }}
                        isSearchable
                    />
                </div>
                <div className="filter-field">
                    <Select<Option>
                        label="Puesto"
                        options={[{ value: '', label: 'Todos' }, ...filteredPositions.map((item) => ({ value: String(item.id), label: item.name }))]}
                        value={jobPositionId ? { value: jobPositionId, label: filteredPositions.find((item) => String(item.id) === jobPositionId)?.name ?? '' } : { value: '', label: 'Todos' }}
                        onChange={(option: SingleValue<Option>) => setJobPositionId(option?.value ?? '')}
                        isSearchable
                    />
                </div>
                <div className="filter-field">
                    <Select<Option>
                        label="Centro de costo"
                        options={[{ value: '', label: 'Todos' }, ...lookups.costCenters.map((item) => ({ value: String(item.id), label: item.name }))]}
                        value={costCenterId ? { value: costCenterId, label: lookups.costCenters.find((item) => String(item.id) === costCenterId)?.name ?? '' } : { value: '', label: 'Todos' }}
                        onChange={(option: SingleValue<Option>) => setCostCenterId(option?.value ?? '')}
                        isSearchable
                    />
                </div>
                <div className="filter-field">
                    <Select<Option>
                        label="Sucursal"
                        options={[{ value: '', label: 'Todas' }, ...(lookups.branches ?? []).map((item) => ({ value: String(item.id), label: item.name }))]}
                        value={branchId
                            ? { value: branchId, label: (lookups.branches ?? []).find((item) => String(item.id) === branchId)?.name ?? '' }
                            : { value: '', label: 'Todas' }}
                        onChange={(option: SingleValue<Option>) => setBranchId(option?.value ?? '')}
                        isSearchable
                    />
                </div>
                <div className="filter-spacer" />
                <div className="filter-actions">
                    <Button variant="ghost" onClick={clearFilters}>Limpiar</Button>
                </div>
            </div>

            {loading && <LoadingSpinner text="Cargando personal…" />}

            {!loading && error && (
                <div className="state-placeholder" role="alert">
                    <UsersRound size={42} aria-hidden="true" />
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={() => void loadEmployees()}><RefreshCw size={16} /> Reintentar</Button>
                </div>
            )}

            {!loading && !error && employees.length === 0 && (
                <div className="state-placeholder">
                    <UsersRound size={48} aria-hidden="true" />
                    <p>No hay empleados que coincidan con los filtros.</p>
                    <Button variant="ghost" onClick={clearFilters}>Limpiar filtros</Button>
                </div>
            )}

            {!loading && !error && employees.length > 0 && viewMode === 'table' && (
                <CatalogTable<HrEmployee>
                    rows={employees}
                    rowKey={(employee) => employee.id}
                    columns={columns}
                    pageSize={Math.max(1, employees.length)}
                    resetKey={`${page}|${debouncedSearch}|${status}|${departmentId}|${jobPositionId}|${costCenterId}|${branchId}`}
                />
            )}

            {!loading && !error && employees.length > 0 && viewMode === 'cards' && (
                <div className="entity-grid hr-employee-grid">
                    {employees.map((employee) => (
                        <article key={employee.id} className={`entity-card entity-card-accent hr-employee-card ${employee.status === 'ACTIVE' ? 'entity-accent-success' : 'entity-accent-warning'}`}>
                            <div className="entity-card-body">
                                <div className="hr-employee-card-heading">
                                    <div className="hr-employee-avatar" aria-hidden="true">{initials(employee)}</div>
                                    <div>
                                        <h3 className="entity-card-title">{employee.legalName}</h3>
                                        <span className="entity-card-tag">{employee.employeeCode}</span>
                                    </div>
                                </div>
                                <div className="hr-card-status"><HrStatusPill status={employee.status} /></div>
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
                            <div className="entity-card-actions">
                                <button className="entity-card-action view" type="button" aria-label={`Ver expediente de ${employee.legalName}`} onClick={() => navigate(`/rh/personal/${employee.id}`)}><Eye size={18} /><span>Ver</span></button>
                                <button className="entity-card-action edit" type="button" aria-label={`Editar ${employee.legalName}`} onClick={() => void openEdit(employee)}><Edit2 size={18} /><span>Editar</span></button>
                                {employee.status === 'ACTIVE' && <button className="entity-card-action delete" type="button" aria-label={`Desactivar ${employee.legalName}`} onClick={() => void deactivate(employee)}><UserMinus size={18} /><span>Desactivar</span></button>}
                            </div>
                        </article>
                    ))}
                </div>
            )}

            {!loading && !error && totalPages > 1 && (
                <Pagination page={page} totalPages={totalPages} totalItems={totalItems} pageSize={25} onPageChange={setPage} />
            )}

            <Sidebar
                isOpen={editorOpen}
                onClose={closeEditor}
                title={editingEmployee ? `Editar: ${editingEmployee.legalName}` : 'Nuevo empleado'}
                width="large"
                closeOnBackdrop={!saving}
                closeOnEscape={!saving}
            >
                <EmployeeForm
                    employee={editingEmployee}
                    lookups={lookups}
                    users={users}
                    saving={saving}
                    onCancel={closeEditor}
                    onSubmit={saveEmployee}
                />
            </Sidebar>
        </div>
    );
}
