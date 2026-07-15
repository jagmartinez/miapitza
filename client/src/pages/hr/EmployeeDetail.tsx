import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Briefcase,
    Building2,
    FileText,
    FileLock2,
    Landmark,
    Link,
    MapPin,
    RefreshCw,
    UserRound,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import HrStatusPill from '../../components/hr/HrStatusPill';
import EmployeeRecordPanel from '../../components/hr/EmployeeRecordPanel';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrEmployee } from '../../types/hr';
import './hr.css';

type DetailTab = 'data' | 'relationship' | 'user' | 'assignment' | 'contracts' | 'compensation' | 'documents';
const DETAIL_TABS: DetailTab[] = ['data', 'relationship', 'user', 'assignment', 'contracts', 'compensation', 'documents'];

function displayDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(`${value.slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(date);
}

function value(value?: string | null): string {
    return value?.trim() || '—';
}

export default function EmployeeDetail() {
    const navigate = useNavigate();
    const { employeeId } = useParams<{ employeeId: string }>();
    const id = Number(employeeId);
    const [employee, setEmployee] = useState<HrEmployee | null>(null);
    const [activeTab, setActiveTab] = useState<DetailTab>('data');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadEmployee = useCallback(async () => {
        if (!Number.isInteger(id) || id <= 0) {
            setError('El identificador del empleado no es válido.');
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setEmployee(await hrClient.getEmployee(id));
        } catch (loadError) {
            setEmployee(null);
            setError(getHrErrorMessage(loadError, 'No fue posible cargar el expediente.'));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadEmployee();
    }, [loadEmployee]);

    const tab = (tabId: DetailTab, label: string, icon: React.ReactNode) => (
        <button
            type="button"
            id={`hr-detail-tab-${tabId}`}
            role="tab"
            aria-selected={activeTab === tabId}
            aria-controls={`hr-detail-panel-${tabId}`}
            tabIndex={activeTab === tabId ? 0 : -1}
            className={`page-tab ${activeTab === tabId ? 'active' : ''}`}
            onClick={() => setActiveTab(tabId)}
            onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const current = DETAIL_TABS.indexOf(tabId);
                const next = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                        ? DETAIL_TABS.length - 1
                        : (current + (event.key === 'ArrowRight' ? 1 : -1) + DETAIL_TABS.length) % DETAIL_TABS.length;
                const nextTab = DETAIL_TABS[next];
                setActiveTab(nextTab);
                requestAnimationFrame(() => document.getElementById(`hr-detail-tab-${nextTab}`)?.focus());
            }}
        >
            {icon}{label}
        </button>
    );

    return (
        <div className="page-wrapper hr-employee-detail-page">
            <PageHeader
                title={employee?.legalName ?? 'Expediente laboral'}
                subtitle={employee ? `Código ${employee.employeeCode}` : undefined}
                icon={UserRound}
                backButton={
                    <button type="button" className="back-link-btn" onClick={() => navigate('/rh/personal')}>
                        <ArrowLeft size={16} /> Volver a personal
                    </button>
                }
                actions={employee ? <HrStatusPill status={employee.status} /> : undefined}
            />

            {loading && <LoadingSpinner text="Cargando expediente…" />}

            {!loading && error && (
                <div className="state-placeholder" role="alert">
                    <FileText size={42} aria-hidden="true" />
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={() => void loadEmployee()}><RefreshCw size={16} /> Reintentar</Button>
                </div>
            )}

            {!loading && !error && employee && (
                <>
                    <div className="page-tabs" role="tablist" aria-label="Secciones del expediente">
                        {tab('data', 'Datos', <UserRound size={17} />)}
                        {tab('relationship', 'Relación', <Briefcase size={17} />)}
                        {tab('user', 'Usuario', <Link size={17} />)}
                        {tab('assignment', 'Asignación', <MapPin size={17} />)}
                        {tab('contracts', 'Contratos', <FileText size={17} />)}
                        {tab('compensation', 'Compensación', <Landmark size={17} />)}
                        {tab('documents', 'Documentos', <FileLock2 size={17} />)}
                    </div>

                    <section
                        id={`hr-detail-panel-${activeTab}`}
                        className="hr-detail-panel"
                        role="tabpanel"
                        aria-labelledby={`hr-detail-tab-${activeTab}`}
                    >
                        {activeTab === 'data' && (
                            <div className="hr-detail-grid">
                                <div><span>Nombre legal</span><strong>{employee.legalName}</strong></div>
                                <div><span>Identificación</span><strong>{value(employee.documentNumber)}</strong></div>
                                <div><span>Correo laboral</span><strong>{value(employee.workEmail)}</strong></div>
                                <div><span>Teléfono laboral</span><strong>{value(employee.workPhone)}</strong></div>
                                <div className="hr-detail-wide"><span>Dirección</span><strong>{value(employee.address)}</strong></div>
                                <div className="hr-detail-wide"><span>Notas</span><strong>{value(employee.notes)}</strong></div>
                            </div>
                        )}

                        {activeTab === 'relationship' && (
                            <div className="hr-detail-grid">
                                <div><span>Fecha de ingreso</span><strong>{displayDate(employee.hireDate)}</strong></div>
                                <div><span>Tipo de empleo</span><strong>{value(employee.employmentType).replace(/_/g, ' ')}</strong></div>
                                <div><span>Departamento</span><strong>{employee.department?.name ?? 'Sin asignar'}</strong></div>
                                <div><span>Puesto</span><strong>{employee.jobPosition?.name ?? 'Sin asignar'}</strong></div>
                                <div><span>Centro de costo</span><strong>{employee.costCenter?.name ?? 'Sin asignar'}</strong></div>
                                <div><span>Fecha de terminación</span><strong>{displayDate(employee.terminationDate)}</strong></div>
                            </div>
                        )}

                        {activeTab === 'user' && (
                            employee.user ? (
                                <div className="hr-detail-grid">
                                    <div><span>Nombre</span><strong>{employee.user.name}</strong></div>
                                    <div><span>Usuario</span><strong>@{employee.user.username}</strong></div>
                                    <div><span>Correo</span><strong>{value(employee.user.email)}</strong></div>
                                    <div><span>Tipo de cuenta</span><strong>{employee.user.accountType ?? 'INTERNAL'}</strong></div>
                                    <div><span>Estado de cuenta</span><strong>{value(employee.user.status)}</strong></div>
                                </div>
                            ) : (
                                <div className="hr-panel-empty"><Link size={32} /><p>El expediente no devolvió un usuario vinculado.</p></div>
                            )
                        )}

                        {activeTab === 'assignment' && (
                            employee.branchAssignments && employee.branchAssignments.length > 0 ? (
                                <div className="hr-assignment-list">
                                    {employee.branchAssignments.map((assignment) => (
                                        <article key={assignment.id ?? assignment.branchId}>
                                            <Building2 size={20} aria-hidden="true" />
                                            <div>
                                                <strong>{assignment.branch?.name ?? `Sucursal ${assignment.branchId}`}</strong>
                                                <span>
                                                    {assignment.effectiveTo
                                                        ? `Histórica · ${displayDate(assignment.effectiveFrom)} a ${displayDate(assignment.effectiveTo)}`
                                                        : `${assignment.isPrimary ? 'Principal' : 'Secundaria'} · desde ${displayDate(assignment.effectiveFrom)}`}
                                                </span>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="hr-panel-empty"><MapPin size={32} /><p>Sin adscripciones laborales registradas.</p></div>
                            )
                        )}
                        {activeTab === 'contracts' && <EmployeeRecordPanel employeeId={employee.id} mode="contracts" />}
                        {activeTab === 'compensation' && <EmployeeRecordPanel employeeId={employee.id} mode="compensation" />}
                        {activeTab === 'documents' && <EmployeeRecordPanel employeeId={employee.id} mode="documents" />}
                    </section>
                </>
            )}
        </div>
    );
}
