import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    BadgeCheck,
    Briefcase,
    Building2,
    CalendarDays,
    FileText,
    FileLock2,
    Landmark,
    Link,
    Mail,
    MapPin,
    Phone,
    RefreshCw,
    ShieldCheck,
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
import './hr-admin-operations.css';

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

function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'RH';
}

function DetailGroup({
    title,
    description,
    icon,
    children,
}: {
    title: string;
    description: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="hr-detail-group">
            <header>
                <span className="hr-detail-group-icon">{icon}</span>
                <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
            </header>
            <dl className="hr-detail-list">{children}</dl>
        </section>
    );
}

function DetailItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className={wide ? 'hr-detail-item hr-detail-item-wide' : 'hr-detail-item'}>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
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
        <div className="page-wrapper inventory-page hr-employee-detail-page hr-admin-catalog-page">
            <PageHeader
                title="Expediente del colaborador"
                subtitle="Identidad, relación laboral, asignaciones y documentos en un solo lugar"
                icon={UserRound}
                backButton={
                    <button type="button" className="back-link-btn" onClick={() => navigate('/rh/personal')}>
                        <ArrowLeft size={16} /> Volver a personal
                    </button>
                }
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
                    <section className="hr-employee-profile-card" aria-label="Resumen del expediente">
                        <div className="hr-employee-avatar" aria-hidden="true">{initials(employee.legalName)}</div>
                        <div className="hr-employee-profile-main">
                            <span className="hr-employee-eyebrow">Expediente {employee.employeeCode}</span>
                            <h2>{employee.legalName}</h2>
                            <p>
                                {employee.jobPosition?.name ?? 'Puesto sin asignar'}
                                <span aria-hidden="true">·</span>
                                {employee.department?.name ?? 'Departamento sin asignar'}
                            </p>
                            <div className="hr-employee-profile-contact">
                                <span><Mail size={14} aria-hidden="true" />{value(employee.workEmail)}</span>
                                <span><Phone size={14} aria-hidden="true" />{value(employee.workPhone)}</span>
                                <span><MapPin size={14} aria-hidden="true" />{employee.primaryBranch?.name ?? 'Sucursal sin asignar'}</span>
                            </div>
                        </div>
                        <div className="hr-employee-profile-status">
                            <HrStatusPill status={employee.status} />
                            <small>Actualizado {displayDate(employee.updatedAt)}</small>
                        </div>
                    </section>

                    <section className="hr-employee-facts" aria-label="Datos laborales clave">
                        <div><CalendarDays size={19} /><span>Ingreso</span><strong>{displayDate(employee.hireDate)}</strong></div>
                        <div><Briefcase size={19} /><span>Relación</span><strong>{value(employee.employmentType).replace(/_/g, ' ')}</strong></div>
                        <div><Building2 size={19} /><span>Sucursal principal</span><strong>{employee.primaryBranch?.name ?? 'Sin asignar'}</strong></div>
                        <div><BadgeCheck size={19} /><span>Cuenta vinculada</span><strong>{employee.user ? `@${employee.user.username}` : 'Sin usuario'}</strong></div>
                    </section>

                    <div className="page-tabs hr-employee-tabs" role="tablist" aria-label="Secciones del expediente">
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
                        className="hr-detail-panel pr-table-card"
                        role="tabpanel"
                        aria-labelledby={`hr-detail-tab-${activeTab}`}
                    >
                        {activeTab === 'data' && (
                            <div className="hr-detail-sections">
                                <DetailGroup title="Identificación" description="Datos legales y fiscales del colaborador" icon={<ShieldCheck size={18} />}>
                                    <DetailItem label="Nombre legal">{employee.legalName}</DetailItem>
                                    <DetailItem label="Nombre preferido">{value(employee.preferredName)}</DetailItem>
                                    <DetailItem label="Tipo de documento">{value(employee.documentType)}</DetailItem>
                                    <DetailItem label="Número de documento">{value(employee.documentNumber)}</DetailItem>
                                    <DetailItem label="Número INSS">{value(employee.socialSecurityNumber)}</DetailItem>
                                    <DetailItem label="RUC / identificación fiscal">{value(employee.taxId)}</DetailItem>
                                </DetailGroup>
                                <DetailGroup title="Contacto" description="Canales laborales y ubicación registrada" icon={<UserRound size={18} />}>
                                    <DetailItem label="Correo laboral">{value(employee.workEmail)}</DetailItem>
                                    <DetailItem label="Teléfono laboral">{value(employee.workPhone)}</DetailItem>
                                    <DetailItem label="Correo personal">{value(employee.email)}</DetailItem>
                                    <DetailItem label="Teléfono personal">{value(employee.phone)}</DetailItem>
                                    <DetailItem label="Dirección" wide>{value(employee.address)}</DetailItem>
                                </DetailGroup>
                                <DetailGroup title="Contacto de emergencia" description="Persona a contactar ante una incidencia" icon={<Phone size={18} />}>
                                    <DetailItem label="Nombre">{value(employee.emergencyContactName)}</DetailItem>
                                    <DetailItem label="Teléfono">{value(employee.emergencyContactPhone)}</DetailItem>
                                    <DetailItem label="Relación">{value(employee.emergencyContactRelationship)}</DetailItem>
                                    <DetailItem label="Notas internas" wide>{value(employee.notes)}</DetailItem>
                                </DetailGroup>
                            </div>
                        )}

                        {activeTab === 'relationship' && (
                            <div className="hr-detail-sections">
                                <DetailGroup title="Relación laboral" description="Vigencia y estructura organizacional" icon={<Briefcase size={18} />}>
                                    <DetailItem label="Fecha de ingreso">{displayDate(employee.hireDate)}</DetailItem>
                                    <DetailItem label="Tipo de empleo">{value(employee.employmentType).replace(/_/g, ' ')}</DetailItem>
                                    <DetailItem label="Departamento">{employee.department?.name ?? 'Sin asignar'}</DetailItem>
                                    <DetailItem label="Puesto">{employee.jobPosition?.name ?? 'Sin asignar'}</DetailItem>
                                    <DetailItem label="Centro de costo">{employee.costCenter?.name ?? 'Sin asignar'}</DetailItem>
                                    <DetailItem label="Supervisor">{employee.supervisor?.legalName ?? 'Sin asignar'}</DetailItem>
                                    <DetailItem label="Fecha de terminación">{displayDate(employee.terminationDate)}</DetailItem>
                                    <DetailItem label="Contrato vigente">{employee.currentContract?.contractType?.replace(/_/g, ' ') ?? 'Sin contrato vigente'}</DetailItem>
                                </DetailGroup>
                            </div>
                        )}

                        {activeTab === 'user' && (
                            employee.user ? (
                                <div className="hr-detail-sections">
                                    <DetailGroup title="Acceso al sistema" description="Cuenta vinculada con el expediente laboral" icon={<Link size={18} />}>
                                        <DetailItem label="Nombre">{employee.user.name}</DetailItem>
                                        <DetailItem label="Usuario">@{employee.user.username}</DetailItem>
                                        <DetailItem label="Correo">{value(employee.user.email)}</DetailItem>
                                        <DetailItem label="Tipo de cuenta">{employee.user.accountType ?? 'INTERNAL'}</DetailItem>
                                        <DetailItem label="Estado de cuenta">{value(employee.user.status)}</DetailItem>
                                    </DetailGroup>
                                </div>
                            ) : (
                                <div className="hr-panel-empty"><Link size={32} /><p>El expediente no devolvió un usuario vinculado.</p></div>
                            )
                        )}

                        {activeTab === 'assignment' && (
                            employee.branchAssignments && employee.branchAssignments.length > 0 ? (
                                <div className="hr-assignment-list" role="list">
                                    {employee.branchAssignments.map((assignment) => (
                                        <article key={assignment.id ?? assignment.branchId} role="listitem">
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
