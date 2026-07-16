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
import PageHeader from '../../components/PageHeader';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrDashboardData } from '../../types/hr';
import './hr.css';
import './hr-dashboard.css';

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

    return (
        <div className="page-wrapper hr-dashboard-page">
            <PageHeader
                title="Centro de trabajo RH"
                subtitle="Pendientes, personal y nómina en un solo lugar"
                icon={UsersRound}
                actions={
                    <div className="hr-dashboard-header-actions">
                        <Button variant="ghost" onClick={() => navigate('/rh/personal')}>Gestionar personal</Button>
                        <Button onClick={() => navigate('/rh/nomina')}>Abrir nómina</Button>
                    </div>
                }
            />

            {loading && <LoadingSpinner text="Cargando operación de RH…" />}

            {!loading && error && (
                <div className="state-placeholder" role="alert">
                    <AlertTriangle size={42} aria-hidden="true" />
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={() => void loadDashboard()}><RefreshCw size={16} /> Reintentar</Button>
                </div>
            )}

            {!loading && !error && data && (
                <>
                    <section className="hr-dashboard-overview" aria-label="Resumen de personal">
                        <article>
                            <span>Personal activo</span>
                            <strong>{asNumber(data.employees.active)}</strong>
                            <small>de {asNumber(data.employees.total)} expedientes</small>
                        </article>
                        <article className={attentionTotal > 0 ? 'needs-attention' : 'is-ready'}>
                            <span>Requieren atención</span>
                            <strong>{asNumber(attentionTotal)}</strong>
                            <small>{attentionTotal > 0 ? 'solicitudes e incidencias pendientes' : 'sin pendientes'}</small>
                        </article>
                        <article className={data.payroll.activeRule ? 'is-ready' : 'needs-attention'}>
                            <span>Configuración de nómina</span>
                            <strong>{data.payroll.activeRule ? 'Lista' : 'Pendiente'}</strong>
                            <small>{data.payroll.activeRule ? 'hay una regla legal activa' : 'falta activar IR, INSS e INATEC'}</small>
                        </article>
                        <article>
                            <span>Corridas en proceso</span>
                            <strong>{asNumber(data.payroll.draftRuns + data.payroll.reviewRuns + data.payroll.approvedRuns)}</strong>
                            <small>borrador, revisión o listas para pago</small>
                        </article>
                    </section>

                    <div className="hr-dashboard-workgrid">
                        <section className="hr-dashboard-card" aria-labelledby="hr-attention-title">
                            <header>
                                <div>
                                    <span className="hr-dashboard-eyebrow">Bandeja de trabajo</span>
                                    <h2 id="hr-attention-title">Por atender</h2>
                                </div>
                                <span className="hr-dashboard-count">{asNumber(attentionTotal)}</span>
                            </header>
                            <div className="hr-dashboard-task-list">
                                <button type="button" onClick={() => navigate('/rh/ausencias')}>
                                    <CalendarDays size={20} />
                                    <span><strong>Permisos y vacaciones</strong><small>Revisar solicitudes del equipo</small></span>
                                    <b>{asNumber(data.attention.leaveRequests)}</b><ArrowRight size={17} />
                                </button>
                                <button type="button" onClick={() => navigate('/rh/jornadas')}>
                                    <Clock3 size={20} />
                                    <span><strong>Horas extra</strong><small>Validar tiempo solicitado</small></span>
                                    <b>{asNumber(data.attention.overtimeRequests)}</b><ArrowRight size={17} />
                                </button>
                                <button type="button" onClick={() => navigate('/rh/asistencia')}>
                                    <ClipboardCheck size={20} />
                                    <span><strong>Asistencia y correcciones</strong><small>Resolver marcajes e incidencias abiertas</small></span>
                                    <b>{asNumber(data.attention.attendanceCorrections + data.attention.attendanceIncidents)}</b><ArrowRight size={17} />
                                </button>
                                <button type="button" onClick={() => navigate('/rh/prestaciones')}>
                                    <BadgeDollarSign size={20} />
                                    <span><strong>Préstamos</strong><small>Evaluar nuevas solicitudes</small></span>
                                    <b>{asNumber(data.attention.loanRequests)}</b><ArrowRight size={17} />
                                </button>
                            </div>
                        </section>

                        <section className="hr-dashboard-card" aria-labelledby="hr-payroll-route-title">
                            <header>
                                <div>
                                    <span className="hr-dashboard-eyebrow">Proceso guiado</span>
                                    <h2 id="hr-payroll-route-title">Ruta de nómina</h2>
                                </div>
                                <WalletCards size={24} />
                            </header>
                            <ol className="hr-dashboard-payroll-route">
                                <li className={data.payroll.activeRule ? 'complete' : 'current'}>
                                    <button type="button" onClick={() => navigate('/rh/nomina/configuracion-legal')}>
                                        <span className="step-number">1</span>
                                        <span><strong>Reglas legales</strong><small>{data.payroll.activeRule ? 'Configuración activa' : 'Configura régimen, IR, INSS e INATEC'}</small></span>
                                        {data.payroll.activeRule ? <CheckCircle2 size={19} /> : <ArrowRight size={17} />}
                                    </button>
                                </li>
                                <li className={data.payroll.draftRuns > 0 ? 'current' : ''}>
                                    <button type="button" onClick={() => navigate('/rh/nomina')}>
                                        <span className="step-number">2</span>
                                        <span><strong>Preparar y calcular</strong><small>{asNumber(data.payroll.draftRuns)} corridas en borrador</small></span>
                                        <ArrowRight size={17} />
                                    </button>
                                </li>
                                <li className={data.payroll.reviewRuns > 0 ? 'current' : ''}>
                                    <button type="button" onClick={() => navigate('/rh/nomina')}>
                                        <span className="step-number">3</span>
                                        <span><strong>Revisar y aprobar</strong><small>{asNumber(data.payroll.reviewRuns)} esperando revisión</small></span>
                                        <ArrowRight size={17} />
                                    </button>
                                </li>
                                <li className={data.payroll.approvedRuns > 0 ? 'current' : ''}>
                                    <button type="button" onClick={() => navigate('/rh/nomina')}>
                                        <span className="step-number">4</span>
                                        <span><strong>Pagar y publicar colillas</strong><small>{asNumber(data.payroll.approvedRuns)} listas para pago</small></span>
                                        <ArrowRight size={17} />
                                    </button>
                                </li>
                            </ol>
                        </section>
                    </div>

                    <section className="hr-dashboard-card hr-dashboard-setup" aria-labelledby="hr-setup-title">
                        <header>
                            <div>
                                <span className="hr-dashboard-eyebrow">Preparación del módulo</span>
                                <h2 id="hr-setup-title">Configuración base</h2>
                            </div>
                            <Settings2 size={22} />
                        </header>
                        <div className="hr-dashboard-setup-grid">
                            <button type="button" onClick={() => navigate('/rh/personal')}>
                                <UserCheck size={21} /><span><strong>Personal</strong><small>{asNumber(data.employees.internalAccounts)} cuentas vinculadas</small></span>
                            </button>
                            <button type="button" onClick={() => navigate('/rh/personal')}>
                                <Building2 size={21} /><span><strong>Organización</strong><small>{asNumber(data.catalogs.departments)} departamentos · {asNumber(data.catalogs.jobPositions)} puestos</small></span>
                            </button>
                            <button type="button" onClick={() => navigate('/rh/asistencia/configuracion')}>
                                <MapPin size={21} /><span><strong>Asistencia</strong><small>{asNumber(data.branches.attendanceEnabled)} de {asNumber(data.branches.total)} sucursales habilitadas</small></span>
                            </button>
                            <button type="button" onClick={() => navigate('/rh/nomina/configuracion-legal')}>
                                <Landmark size={21} /><span><strong>Obligaciones laborales</strong><small>{data.payroll.activeRule ? 'IR, INSS e INATEC activos' : 'Requiere configuración'}</small></span>
                            </button>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
