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
import HrStatusPill from '../../components/hr/HrStatusPill';
import EmployeeRecordPanel from '../../components/hr/EmployeeRecordPanel';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrEmployee } from '../../types/hr';
import { HrHero, HrPage, HrSection, HrSplit, type HrFact } from '../../components/hr/layout/HrWorkspace';
import './hr.css';
import './layouts/personal.css';

type DetailTab = 'data' | 'relationship' | 'user' | 'assignment' | 'contracts' | 'compensation' | 'documents';
const DETAIL_TABS: DetailTab[] = ['data', 'relationship', 'user', 'assignment', 'contracts', 'compensation', 'documents'];

const TAB_LABELS: Record<DetailTab, string> = {
    data: 'Datos personales',
    relationship: 'Relación laboral',
    user: 'Usuario del sistema',
    assignment: 'Asignación a sucursales',
    contracts: 'Contratos',
    compensation: 'Compensación',
    documents: 'Documentos',
};

const TAB_DESCRIPTIONS: Record<DetailTab, string> = {
    data: 'Identificación, contacto y contacto de emergencia.',
    relationship: 'Vigencia, estructura organizacional y descanso semanal.',
    user: 'Cuenta vinculada con el expediente laboral.',
    assignment: 'Adscripciones vigentes e históricas por sucursal.',
    contracts: 'Borradores, activación firmada y transiciones auditadas.',
    compensation: 'Versiones append-only de salario o tarifa por hora.',
    documents: 'Custodia verificada de documentos del colaborador.',
};

const REST_DAY_NAMES: Record<number, string> = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

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

function tenureText(hireDate?: string | null, terminationDate?: string | null): string {
    if (!hireDate) return '—';
    const from = new Date(`${hireDate.slice(0, 10)}T00:00:00`);
    const to = terminationDate ? new Date(`${terminationDate.slice(0, 10)}T00:00:00`) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return '—';
    let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (to.getDate() < from.getDate()) months -= 1;
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (years === 0 && rest === 0) return 'Menos de 1 mes';
    return [years ? `${years} ${years === 1 ? 'año' : 'años'}` : '', rest ? `${rest} ${rest === 1 ? 'mes' : 'meses'}` : ''].filter(Boolean).join(' y ');
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
        <section className="hr-pd-group">
            <header className="hr-pd-group-head">
                <span className="hr-pd-group-icon" aria-hidden="true">{icon}</span>
                <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                </div>
            </header>
            <dl className="hr-pd-list">{children}</dl>
        </section>
    );
}

function DetailItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className={wide ? 'hr-pd-item is-wide' : 'hr-pd-item'}>
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
            className={activeTab === tabId ? 'active' : undefined}
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
            {icon}<span>{label}</span>
        </button>
    );

    const tabLabel = TAB_LABELS[activeTab];

    const facts: HrFact[] = employee ? [
        { label: 'Ingreso', value: displayDate(employee.hireDate), hint: employee.terminationDate ? `Terminación ${displayDate(employee.terminationDate)}` : 'fecha de alta laboral' },
        { label: 'Antigüedad', value: tenureText(employee.hireDate, employee.terminationDate), hint: 'según fecha de ingreso', tone: 'accent' },
        { label: 'Relación', value: value(employee.employmentType).replace(/_/g, ' '), hint: 'tipo de empleo' },
        {
            label: 'Contrato vigente',
            value: employee.currentContract?.contractType?.replace(/_/g, ' ') ?? 'Sin contrato vigente',
            hint: employee.currentContract ? 'relación formalizada' : 'registrar en Contratos',
            tone: employee.currentContract ? 'success' : 'warning',
        },
        {
            label: 'Cuenta vinculada',
            value: employee.user ? `@${employee.user.username}` : 'Sin usuario',
            hint: employee.user ? 'acceso al sistema' : 'sin acceso al sistema',
            tone: employee.user ? 'default' : 'warning',
        },
    ] : [];

    return (
        <HrPage className="hr-employee-detail-page hr-personal-page">
            <HrHero
                eyebrow={employee ? `Recursos humanos · Expediente ${employee.employeeCode}` : 'Recursos humanos'}
                icon={UserRound}
                title={employee ? employee.legalName : 'Expediente del colaborador'}
                subtitle={employee
                    ? `${employee.jobPosition?.name ?? 'Puesto sin asignar'} · ${employee.department?.name ?? 'Departamento sin asignar'}`
                    : 'Identidad, relación laboral, asignaciones y documentos en un solo lugar'}
                badges={employee ? <HrStatusPill status={employee.status} /> : undefined}
                actions={
                    <button type="button" className="hr-pd-back" onClick={() => navigate('/rh/personal')}>
                        <ArrowLeft size={16} /> Volver a personal
                    </button>
                }
                aside={employee ? (
                    <section className="hr-employee-profile-card hr-pd-profile" aria-label="Resumen del expediente">
                        <div className="hr-pd-profile-top">
                            <div className="hr-pd-avatar" aria-hidden="true">{initials(employee.legalName)}</div>
                            <div className="hr-pd-profile-id">
                                <span className="hr-ws-eyebrow">Expediente del colaborador</span>
                                <strong>{employee.employeeCode}</strong>
                                <small>Actualizado {displayDate(employee.updatedAt)}</small>
                            </div>
                        </div>
                        <ul className="hr-pd-contact">
                            <li><Mail size={14} aria-hidden="true" /><span>{value(employee.workEmail)}</span></li>
                            <li><Phone size={14} aria-hidden="true" /><span>{value(employee.workPhone)}</span></li>
                            <li><MapPin size={14} aria-hidden="true" /><span>{employee.primaryBranch?.name ?? 'Sucursal sin asignar'}</span></li>
                        </ul>
                    </section>
                ) : undefined}
                facts={employee ? facts : undefined}
            />

            {loading && <LoadingSpinner text="Cargando expediente…" />}

            {!loading && error && (
                <HrSection className="hr-pd-state-card">
                    <div className="hr-pd-state" role="alert">
                        <FileText size={42} aria-hidden="true" />
                        <p className="state-error">{error}</p>
                        <Button variant="ghost" onClick={() => void loadEmployee()}><RefreshCw size={16} /> Reintentar</Button>
                    </div>
                </HrSection>
            )}

            {!loading && !error && employee && (
                <>
                    <nav className="hr-ws-tabs-bar" aria-label="Secciones del expediente">
                        <div className="hr-ws-tabs hr-pd-tabs" role="tablist" aria-label="Secciones del expediente">
                            {tab('data', 'Datos', <UserRound size={16} />)}
                            {tab('relationship', 'Relación', <Briefcase size={16} />)}
                            {tab('user', 'Usuario', <Link size={16} />)}
                            {tab('assignment', 'Asignación', <MapPin size={16} />)}
                            {tab('contracts', 'Contratos', <FileText size={16} />)}
                            {tab('compensation', 'Compensación', <Landmark size={16} />)}
                            {tab('documents', 'Documentos', <FileLock2 size={16} />)}
                        </div>
                    </nav>

                    <HrSplit
                        main={(
                                <section
                                    id={`hr-detail-panel-${activeTab}`}
                                    className="hr-ws-section hr-pd-panel"
                                    role="tabpanel"
                                    aria-labelledby={`hr-detail-tab-${activeTab}`}
                                >
                                    <header className="hr-ws-section-header">
                                        <div>
                                            <span className="hr-ws-eyebrow">Expediente {employee.employeeCode}</span>
                                            <h2>{tabLabel}</h2>
                                            <p>{TAB_DESCRIPTIONS[activeTab]}</p>
                                        </div>
                                    </header>
                                    <div className="hr-ws-section-body">
                                    {activeTab === 'data' && (
                                        <div className="hr-pd-sections">
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
                                        <div className="hr-pd-sections">
                                            <DetailGroup title="Relación laboral" description="Vigencia y estructura organizacional" icon={<Briefcase size={18} />}>
                                                <DetailItem label="Fecha de ingreso">{displayDate(employee.hireDate)}</DetailItem>
                                                <DetailItem label="Tipo de empleo">{value(employee.employmentType).replace(/_/g, ' ')}</DetailItem>
                                                <DetailItem label="Descanso semanal">{employee.weeklyRestDays?.length ? employee.weeklyRestDays.map((day) => REST_DAY_NAMES[day] ?? String(day)).join(', ') : 'Domingo (por defecto legal, sin configurar)'}</DetailItem>
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
                                            <div className="hr-pd-sections">
                                                <DetailGroup title="Acceso al sistema" description="Cuenta vinculada con el expediente laboral" icon={<Link size={18} />}>
                                                    <DetailItem label="Nombre">{employee.user.name}</DetailItem>
                                                    <DetailItem label="Usuario">@{employee.user.username}</DetailItem>
                                                    <DetailItem label="Correo">{value(employee.user.email)}</DetailItem>
                                                    <DetailItem label="Tipo de cuenta">{employee.user.accountType ?? 'INTERNAL'}</DetailItem>
                                                    <DetailItem label="Estado de cuenta">{value(employee.user.status)}</DetailItem>
                                                </DetailGroup>
                                            </div>
                                        ) : (
                                            <div className="hr-panel-empty hr-pd-empty"><Link size={32} /><p>El expediente no devolvió un usuario vinculado.</p></div>
                                        )
                                    )}

                                    {activeTab === 'assignment' && (
                                        employee.branchAssignments && employee.branchAssignments.length > 0 ? (
                                            <div className="hr-pd-assignments" role="list">
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
                                            <div className="hr-panel-empty hr-pd-empty"><MapPin size={32} /><p>Sin adscripciones laborales registradas.</p></div>
                                        )
                                    )}
                                    {activeTab === 'contracts' && <EmployeeRecordPanel employeeId={employee.id} mode="contracts" />}
                                    {activeTab === 'compensation' && <EmployeeRecordPanel employeeId={employee.id} mode="compensation" />}
                                    {activeTab === 'documents' && <EmployeeRecordPanel employeeId={employee.id} mode="documents" />}
                                    </div>
                                </section>
                        )}
                        aside={(
                            <HrSection eyebrow="Organización" title="Datos laborales clave" className="hr-pd-aside-card">
                                <dl className="hr-employee-facts hr-pd-facts" aria-label="Datos laborales clave">
                                    <div><dt><Building2 size={15} aria-hidden="true" />Sucursal principal</dt><dd>{employee.primaryBranch?.name ?? 'Sin asignar'}</dd></div>
                                    <div><dt><Briefcase size={15} aria-hidden="true" />Departamento</dt><dd>{employee.department?.name ?? 'Sin asignar'}</dd></div>
                                    <div><dt><BadgeCheck size={15} aria-hidden="true" />Puesto</dt><dd>{employee.jobPosition?.name ?? 'Sin asignar'}</dd></div>
                                    <div><dt><Landmark size={15} aria-hidden="true" />Centro de costo</dt><dd>{employee.costCenter?.name ?? 'Sin asignar'}</dd></div>
                                    <div><dt><ShieldCheck size={15} aria-hidden="true" />Supervisor</dt><dd>{employee.supervisor?.legalName ?? 'Sin asignar'}</dd></div>
                                    <div><dt><CalendarDays size={15} aria-hidden="true" />Descanso semanal</dt><dd>{employee.weeklyRestDays?.length ? employee.weeklyRestDays.map((day) => REST_DAY_NAMES[day] ?? String(day)).join(', ') : 'Domingo (por defecto legal)'}</dd></div>
                                </dl>
                            </HrSection>
                        )}
                    />
                </>
            )}
        </HrPage>
    );
}
