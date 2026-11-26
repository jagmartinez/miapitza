import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Link, Mail, MapPin, Phone } from 'lucide-react';
import { Button, EmptyState, LoadErrorState, PageContent, PageHeader, Tabs } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import HrStatusPill from '../../components/hr/HrStatusPill';
import EmployeeRecordPanel from '../../components/hr/EmployeeRecordPanel';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrEmployee } from '../../types/hr';
import styles from '../../components/hr/hrForm.module.css';
import detail from './EmployeeDetail.module.css';

type DetailTab = 'data' | 'relationship' | 'user' | 'assignment' | 'contracts' | 'compensation' | 'documents';

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
    children,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className={detail.group}>
            <header>
                <h3>{title}</h3>
                <p>{description}</p>
            </header>
            <dl className={detail.list}>{children}</dl>
        </section>
    );
}

function DetailItem({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className={wide ? detail.wide : undefined}>
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

    const tab = (tabId: DetailTab, label: string) => ({ id: tabId, label });
    const tabs = [
        tab('data', 'Datos'),
        tab('relationship', 'Relación'),
        tab('user', 'Usuario'),
        tab('assignment', 'Asignación'),
        tab('contracts', 'Contratos'),
        tab('compensation', 'Compensación'),
        tab('documents', 'Documentos'),
    ];

    const restDays = (fallback: string) => (employee?.weeklyRestDays?.length
        ? employee.weeklyRestDays.map((day) => REST_DAY_NAMES[day] ?? String(day)).join(', ')
        : fallback);

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Recursos humanos', 'Personal']}
                title={employee ? employee.legalName : 'Expediente del colaborador'}
                description={employee ? (
                    <span className={`hr-employee-profile-card ${detail.identity}`} aria-label="Resumen del expediente">
                        <HrStatusPill status={employee.status} />
                        <span>{employee.employeeCode}</span>
                        <span>{employee.jobPosition?.name ?? 'Puesto sin asignar'}</span>
                        <span>{employee.department?.name ?? 'Departamento sin asignar'}</span>
                        <span><MapPin size={13} aria-hidden="true" /> {employee.primaryBranch?.name ?? 'Sucursal sin asignar'}</span>
                        {employee.workEmail && <span><Mail size={13} aria-hidden="true" /> {employee.workEmail}</span>}
                        {employee.workPhone && <span><Phone size={13} aria-hidden="true" /> {employee.workPhone}</span>}
                    </span>
                ) : 'Identidad, relación laboral, asignaciones y documentos en un solo lugar'}
                actions={<Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/rh/personal')}>Volver a personal</Button>}
            />

            {loading && <HrLoading text="Cargando expediente…" />}

            {!loading && error && <LoadErrorState message={error} onRetry={() => void loadEmployee()} />}

            {!loading && !error && employee && (
                <>
                    <dl className={`hr-employee-facts ${detail.signals}`} aria-label="Datos laborales clave">
                        <div>
                            <dt>Ingreso</dt>
                            <dd>{displayDate(employee.hireDate)}</dd>
                            <small>{employee.terminationDate ? `Terminación ${displayDate(employee.terminationDate)}` : 'fecha de alta laboral'}</small>
                        </div>
                        <div>
                            <dt>Antigüedad</dt>
                            <dd>{tenureText(employee.hireDate, employee.terminationDate)}</dd>
                            <small>según fecha de ingreso</small>
                        </div>
                        <div className={employee.currentContract ? undefined : detail.warning}>
                            <dt>Contrato vigente</dt>
                            <dd>{employee.currentContract?.contractType?.replace(/_/g, ' ') ?? 'Sin contrato vigente'}</dd>
                            <small>{employee.currentContract ? 'relación formalizada' : 'registrar en Contratos'}</small>
                        </div>
                        <div className={employee.user ? undefined : detail.warning}>
                            <dt>Cuenta vinculada</dt>
                            <dd>{employee.user ? `@${employee.user.username}` : 'Sin usuario'}</dd>
                            <small>{employee.user ? 'acceso al sistema' : 'sin acceso al sistema'}</small>
                        </div>
                        <div>
                            <dt>Descanso semanal</dt>
                            <dd>{restDays('Domingo')}</dd>
                            <small>{employee.weeklyRestDays?.length ? 'configurado' : 'por defecto legal'}</small>
                        </div>
                    </dl>

                    <Tabs ariaLabel="Secciones del expediente" tabs={tabs} active={activeTab} onChange={(next) => setActiveTab(next as DetailTab)} />

                    <section id={`hr-detail-panel-${activeTab}`} className={detail.panel} role="tabpanel" aria-label={TAB_LABELS[activeTab]}>
                        <header className={detail.panelHead}>
                            <h2>{TAB_LABELS[activeTab]}</h2>
                            <p>{TAB_DESCRIPTIONS[activeTab]}</p>
                        </header>

                        {activeTab === 'data' && (
                            <>
                                <DetailGroup title="Identificación" description="Datos legales y fiscales del colaborador">
                                    <DetailItem label="Nombre legal">{employee.legalName}</DetailItem>
                                    <DetailItem label="Nombre preferido">{value(employee.preferredName)}</DetailItem>
                                    <DetailItem label="Tipo de documento">{value(employee.documentType)}</DetailItem>
                                    <DetailItem label="Número de documento">{value(employee.documentNumber)}</DetailItem>
                                    <DetailItem label="Número INSS">{value(employee.socialSecurityNumber)}</DetailItem>
                                    <DetailItem label="RUC / identificación fiscal">{value(employee.taxId)}</DetailItem>
                                </DetailGroup>
                                <DetailGroup title="Contacto" description="Canales laborales y ubicación registrada">
                                    <DetailItem label="Correo laboral">{value(employee.workEmail)}</DetailItem>
                                    <DetailItem label="Teléfono laboral">{value(employee.workPhone)}</DetailItem>
                                    <DetailItem label="Correo personal">{value(employee.email)}</DetailItem>
                                    <DetailItem label="Teléfono personal">{value(employee.phone)}</DetailItem>
                                    <DetailItem label="Dirección" wide>{value(employee.address)}</DetailItem>
                                </DetailGroup>
                                <DetailGroup title="Contacto de emergencia" description="Persona a contactar ante una incidencia">
                                    <DetailItem label="Nombre">{value(employee.emergencyContactName)}</DetailItem>
                                    <DetailItem label="Teléfono">{value(employee.emergencyContactPhone)}</DetailItem>
                                    <DetailItem label="Relación">{value(employee.emergencyContactRelationship)}</DetailItem>
                                    <DetailItem label="Notas internas" wide>{value(employee.notes)}</DetailItem>
                                </DetailGroup>
                            </>
                        )}

                        {activeTab === 'relationship' && (
                            <DetailGroup title="Relación laboral" description="Vigencia y estructura organizacional">
                                <DetailItem label="Fecha de ingreso">{displayDate(employee.hireDate)}</DetailItem>
                                <DetailItem label="Tipo de empleo">{value(employee.employmentType).replace(/_/g, ' ')}</DetailItem>
                                <DetailItem label="Descanso semanal">{restDays('Domingo (por defecto legal, sin configurar)')}</DetailItem>
                                <DetailItem label="Departamento">{employee.department?.name ?? 'Sin asignar'}</DetailItem>
                                <DetailItem label="Puesto">{employee.jobPosition?.name ?? 'Sin asignar'}</DetailItem>
                                <DetailItem label="Centro de costo">{employee.costCenter?.name ?? 'Sin asignar'}</DetailItem>
                                <DetailItem label="Supervisor">{employee.supervisor?.legalName ?? 'Sin asignar'}</DetailItem>
                                <DetailItem label="Sucursal principal">{employee.primaryBranch?.name ?? 'Sin asignar'}</DetailItem>
                                <DetailItem label="Fecha de terminación">{displayDate(employee.terminationDate)}</DetailItem>
                                <DetailItem label="Contrato vigente">{employee.currentContract?.contractType?.replace(/_/g, ' ') ?? 'Sin contrato vigente'}</DetailItem>
                            </DetailGroup>
                        )}

                        {activeTab === 'user' && (
                            employee.user ? (
                                <DetailGroup title="Acceso al sistema" description="Cuenta vinculada con el expediente laboral">
                                    <DetailItem label="Nombre">{employee.user.name}</DetailItem>
                                    <DetailItem label="Usuario">@{employee.user.username}</DetailItem>
                                    <DetailItem label="Correo">{value(employee.user.email)}</DetailItem>
                                    <DetailItem label="Tipo de cuenta">{employee.user.accountType ?? 'INTERNAL'}</DetailItem>
                                    <DetailItem label="Estado de cuenta">{value(employee.user.status)}</DetailItem>
                                </DetailGroup>
                            ) : (
                                <EmptyState icon={Link} title="El expediente no devolvió un usuario vinculado." />
                            )
                        )}

                        {activeTab === 'assignment' && (
                            employee.branchAssignments && employee.branchAssignments.length > 0 ? (
                                <ul className={styles.list}>
                                    {employee.branchAssignments.map((assignment) => (
                                        <li key={assignment.id ?? assignment.branchId}>
                                            <span className={styles.cellStack}>
                                                <span className={styles.cellTitle}>{assignment.branch?.name ?? `Sucursal ${assignment.branchId}`}</span>
                                                <span className={styles.cellSub}>
                                                    {assignment.effectiveTo
                                                        ? `Histórica · ${displayDate(assignment.effectiveFrom)} a ${displayDate(assignment.effectiveTo)}`
                                                        : `${assignment.isPrimary ? 'Principal' : 'Secundaria'} · desde ${displayDate(assignment.effectiveFrom)}`}
                                                </span>
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <EmptyState icon={MapPin} title="Sin adscripciones laborales registradas." />
                            )
                        )}
                        {activeTab === 'contracts' && <EmployeeRecordPanel employeeId={employee.id} mode="contracts" />}
                        {activeTab === 'compensation' && <EmployeeRecordPanel employeeId={employee.id} mode="compensation" />}
                        {activeTab === 'documents' && <EmployeeRecordPanel employeeId={employee.id} mode="documents" />}
                    </section>
                </>
            )}
        </PageContent>
    );
}
