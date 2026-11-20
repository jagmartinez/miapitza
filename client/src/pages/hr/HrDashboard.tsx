import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowRight,
    BadgeDollarSign,
    Building2,
    CalendarDays,
    CheckCircle2,
    ClipboardCheck,
    Clock3,
    Landmark,
    MapPin,
    RefreshCw,
    Settings2,
    UserCheck,
    UsersRound,
    WalletCards,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrDashboardData } from '../../types/hr';
import { HrHero, HrPage, HrSection, HrSplit, type HrFact } from '../../components/hr/layout/HrWorkspace';
import './hr.css';
import './layouts/personal.css';

function asNumber(value: number | undefined): string {
    return new Intl.NumberFormat('es-NI').format(value ?? 0);
}

export default function HrDashboard() {
    const navigate = useNavigate();
    const [data, setData] = useState<HrDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await hrClient.getDashboard());
        } catch (loadError) {
            setData(null);
            setError(getHrErrorMessage(loadError, 'No fue posible cargar el centro de trabajo de Recursos Humanos.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadDashboard();
    }, [loadDashboard]);

    const attentionTotal = useMemo(() => {
        if (!data) return 0;
        return Object.values(data.attention).reduce((total, value) => total + value, 0);
    }, [data]);

    const runsInProcess = data ? data.payroll.draftRuns + data.payroll.reviewRuns + data.payroll.approvedRuns : 0;

    const facts: HrFact[] = data ? [
        { label: 'Personal activo', value: asNumber(data.employees.active), hint: `de ${asNumber(data.employees.total)} expedientes`, tone: 'accent' },
        {
            label: 'Requieren atención',
            value: asNumber(attentionTotal),
            hint: attentionTotal > 0 ? 'solicitudes e incidencias pendientes' : 'sin pendientes',
            tone: attentionTotal > 0 ? 'warning' : 'success',
        },
        {
            label: 'Configuración de nómina',
            value: data.payroll.activeRule ? 'Lista' : 'Pendiente',
            hint: data.payroll.activeRule ? 'hay una regla legal activa' : 'falta activar IR, INSS e INATEC',
            tone: data.payroll.activeRule ? 'success' : 'danger',
        },
        { label: 'Corridas en proceso', value: asNumber(runsInProcess), hint: 'borrador, revisión o listas para pago' },
        {
            label: 'Sucursales con asistencia',
            value: `${asNumber(data.branches.attendanceEnabled)} / ${asNumber(data.branches.total)}`,
            hint: 'habilitadas para marcaje',
            tone: data.branches.total > 0 && data.branches.attendanceEnabled < data.branches.total ? 'warning' : 'default',
        },
    ] : [];

    const attentionTasks = data ? [
        { key: 'leave', to: '/rh/ausencias', icon: CalendarDays, title: 'Permisos y vacaciones', hint: 'Revisar solicitudes del equipo', count: data.attention.leaveRequests },
        { key: 'overtime', to: '/rh/jornadas', icon: Clock3, title: 'Horas extra', hint: 'Validar tiempo solicitado', count: data.attention.overtimeRequests },
        { key: 'attendance', to: '/rh/asistencia', icon: ClipboardCheck, title: 'Asistencia y correcciones', hint: 'Resolver marcajes e incidencias abiertas', count: data.attention.attendanceCorrections + data.attention.attendanceIncidents },
        { key: 'loans', to: '/rh/prestaciones', icon: BadgeDollarSign, title: 'Préstamos', hint: 'Evaluar nuevas solicitudes', count: data.attention.loanRequests },
    ] : [];

    return (
        <HrPage className="hr-dashboard-page hr-personal-page">
            <HrHero
                eyebrow="Recursos humanos"
                icon={UsersRound}
                title="Centro de trabajo RH"
                subtitle="Pendientes, personal y nómina en un solo lugar"
                actions={
                    <>
                        <Button variant="ghost" onClick={() => navigate('/rh/personal')}>Gestionar personal</Button>
                        <Button onClick={() => navigate('/rh/nomina')}>Abrir nómina</Button>
                    </>
                }
                facts={data && !loading && !error ? facts : undefined}
            />

            {loading && <LoadingSpinner text="Cargando operación de RH…" />}

            {!loading && error && (
                <HrSection className="hr-hd-state-card">
                    <div className="hr-hd-state" role="alert">
                        <AlertTriangle size={42} aria-hidden="true" />
                        <p className="state-error">{error}</p>
                        <Button variant="ghost" onClick={() => void loadDashboard()}><RefreshCw size={16} /> Reintentar</Button>
                    </div>
                </HrSection>
            )}

            {!loading && !error && data && (
                <>
                    <HrSplit
                        main={(
                            <HrSection
                                aria-labelledby="hr-attention-title"
                                eyebrow="Bandeja de trabajo"
                                title={<span id="hr-attention-title">Por atender</span>}
                                count={attentionTotal}
                                description="Solicitudes del equipo que esperan una decisión de RH."
                            >
                                <div className="hr-ws-grid hr-hd-task-grid">
                                    {attentionTasks.map(({ key, to, icon: Icon, title, hint, count }) => (
                                        <button key={key} type="button" className={`hr-ws-tile hr-hd-task${count > 0 ? ' has-pending' : ''}`} onClick={() => navigate(to)}>
                                            <div className="hr-hd-tile-icon" aria-hidden="true"><Icon size={20} /></div>
                                            <div className="hr-hd-tile-text">
                                                <strong>{title}</strong>
                                                <small>{hint}</small>
                                            </div>
                                            <b className="hr-hd-task-count">{asNumber(count)}</b>
                                            <ArrowRight size={17} aria-hidden="true" />
                                        </button>
                                    ))}
                                </div>
                            </HrSection>
                        )}
                        aside={(
                            <HrSection
                                aria-labelledby="hr-payroll-route-title"
                                eyebrow="Proceso guiado"
                                title={<span id="hr-payroll-route-title">Ruta de nómina</span>}
                                actions={<WalletCards size={22} aria-hidden="true" className="hr-hd-section-icon" />}
                                className="hr-hd-route-card"
                            >
                                <ol className="hr-hd-route">
                                    <li className={data.payroll.activeRule ? 'complete' : 'current'}>
                                        <button type="button" onClick={() => navigate('/rh/nomina/configuracion-legal')}>
                                            <i className="hr-hd-step" aria-hidden="true">1</i>
                                            <div><strong>Reglas legales</strong><small>{data.payroll.activeRule ? 'Configuración activa' : 'Configura régimen, IR, INSS e INATEC'}</small></div>
                                            {data.payroll.activeRule ? <CheckCircle2 size={19} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
                                        </button>
                                    </li>
                                    <li className={data.payroll.draftRuns > 0 ? 'current' : ''}>
                                        <button type="button" onClick={() => navigate('/rh/nomina')}>
                                            <i className="hr-hd-step" aria-hidden="true">2</i>
                                            <div><strong>Preparar y calcular</strong><small>{asNumber(data.payroll.draftRuns)} corridas en borrador</small></div>
                                            <ArrowRight size={17} aria-hidden="true" />
                                        </button>
                                    </li>
                                    <li className={data.payroll.reviewRuns > 0 ? 'current' : ''}>
                                        <button type="button" onClick={() => navigate('/rh/nomina')}>
                                            <i className="hr-hd-step" aria-hidden="true">3</i>
                                            <div><strong>Revisar y aprobar</strong><small>{asNumber(data.payroll.reviewRuns)} esperando revisión</small></div>
                                            <ArrowRight size={17} aria-hidden="true" />
                                        </button>
                                    </li>
                                    <li className={data.payroll.approvedRuns > 0 ? 'current' : ''}>
                                        <button type="button" onClick={() => navigate('/rh/nomina')}>
                                            <i className="hr-hd-step" aria-hidden="true">4</i>
                                            <div><strong>Pagar y publicar colillas</strong><small>{asNumber(data.payroll.approvedRuns)} listas para pago</small></div>
                                            <ArrowRight size={17} aria-hidden="true" />
                                        </button>
                                    </li>
                                </ol>
                            </HrSection>
                        )}
                    />

                    <HrSection
                        aria-labelledby="hr-setup-title"
                        eyebrow="Preparación del módulo"
                        title={<span id="hr-setup-title">Configuración base</span>}
                        description="Catálogos y reglas que habilitan el resto del módulo."
                        actions={<Settings2 size={20} aria-hidden="true" className="hr-hd-section-icon" />}
                    >
                        <div className="hr-ws-grid hr-hd-setup-grid">
                            <button type="button" className="hr-ws-tile hr-hd-setup" onClick={() => navigate('/rh/personal')}>
                                <div className="hr-hd-tile-icon" aria-hidden="true"><UserCheck size={20} /></div>
                                <div className="hr-hd-tile-text"><strong>Personal</strong><small>{asNumber(data.employees.internalAccounts)} cuentas vinculadas</small></div>
                            </button>
                            <button type="button" className="hr-ws-tile hr-hd-setup" onClick={() => navigate('/rh/personal')}>
                                <div className="hr-hd-tile-icon" aria-hidden="true"><Building2 size={20} /></div>
                                <div className="hr-hd-tile-text"><strong>Organización</strong><small>{asNumber(data.catalogs.departments)} departamentos · {asNumber(data.catalogs.jobPositions)} puestos</small></div>
                            </button>
                            <button type="button" className="hr-ws-tile hr-hd-setup" onClick={() => navigate('/rh/asistencia/configuracion')}>
                                <div className="hr-hd-tile-icon" aria-hidden="true"><MapPin size={20} /></div>
                                <div className="hr-hd-tile-text"><strong>Asistencia</strong><small>{asNumber(data.branches.attendanceEnabled)} de {asNumber(data.branches.total)} sucursales habilitadas</small></div>
                            </button>
                            <button type="button" className={`hr-ws-tile hr-hd-setup${data.payroll.activeRule ? '' : ' needs-setup'}`} onClick={() => navigate('/rh/nomina/configuracion-legal')}>
                                <div className="hr-hd-tile-icon" aria-hidden="true"><Landmark size={20} /></div>
                                <div className="hr-hd-tile-text"><strong>Obligaciones laborales</strong><small>{data.payroll.activeRule ? 'IR, INSS e INATEC activos' : 'Requiere configuración'}</small></div>
                            </button>
                        </div>
                    </HrSection>
                </>
            )}
        </HrPage>
    );
}
