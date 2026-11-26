import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    BadgeDollarSign,
    Building2,
    CalendarDays,
    CheckCircle2,
    ClipboardCheck,
    Clock3,
    Landmark,
    MapPin,
    Settings2,
    UserCheck,
    WalletCards,
} from 'lucide-react';
import { Button, formatNumber, LoadErrorState, PageContent, PageHeader, StatCard } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrDashboardData } from '../../types/hr';
import styles from './HrDashboard.module.css';

/** Dato faltante o no numérico se muestra N/D; nunca como 0. */
function asNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, 0) : 'N/D';
}

/** Suma solo valores conocidos; null si alguno falta para no presentar un total parcial como completo. */
function sumKnown(values: Array<number | null | undefined>): number | null {
    let total = 0;
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return null;
        total += value;
    }
    return total;
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

    const attentionTotal = useMemo(() => (data ? sumKnown(Object.values(data.attention)) : null), [data]);
    const runsInProcess = data ? sumKnown([data.payroll.draftRuns, data.payroll.reviewRuns, data.payroll.approvedRuns]) : null;

    return (
        <PageContent>
            <PageHeader
        breadcrumb={['Recursos humanos']}
        title="Centro de trabajo RH"
        description="Pendientes, personal y nómina en un solo lugar"
        actions={
                    <div className={styles.headerActions}>
                        <Button variant="ghost" onClick={() => navigate('/rh/personal')}>Gestionar personal</Button>
                        <Button variant="primary" onClick={() => navigate('/rh/nomina')}>Abrir nómina</Button>
                    </div>
                }
      />

            {loading && <HrLoading text="Cargando operación de RH…" />}

            {!loading && error && <LoadErrorState message={error} onRetry={() => void loadDashboard()} />}

            {!loading && !error && data && (
                <>
                    <section className={styles.kpiRow} aria-label="Resumen de personal">
                        <StatCard
                            label="Requieren atención"
                            tone={attentionTotal == null ? 'neutral' : attentionTotal > 0 ? 'warning' : 'success'}
                            value={asNumber(attentionTotal)}
                            context={attentionTotal == null ? 'Algún pendiente no está disponible; no se suma un total parcial.' : attentionTotal > 0 ? 'Solicitudes e incidencias pendientes de resolver.' : 'Sin pendientes.'}
                            action={attentionTotal ? { label: 'Ver pendientes', onClick: () => navigate('/rh/ausencias') } : undefined}
                        />
                        <StatCard
                            label="Configuración de nómina"
                            tone={data.payroll.activeRule ? 'success' : 'warning'}
                            value={data.payroll.activeRule ? 'Lista' : 'Pendiente'}
                            context={data.payroll.activeRule ? 'Hay una regla legal activa (IR, INSS e INATEC).' : 'Falta activar IR, INSS e INATEC para calcular nómina.'}
                            action={data.payroll.activeRule ? undefined : { label: 'Configurar', onClick: () => navigate('/rh/nomina/configuracion-legal') }}
                        />
                        <StatCard
                            label="Corridas en proceso"
                            value={asNumber(runsInProcess)}
                            context={runsInProcess == null ? 'El estado de las corridas no está disponible.' : `Borrador, revisión o listas para pago (${asNumber(data.payroll.approvedRuns)} listas para pago).`}
                            action={runsInProcess ? { label: 'Abrir nómina', onClick: () => navigate('/rh/nomina') } : undefined}
                        />
                        <StatCard
                            label="Sucursales con asistencia"
                            tone={data.branches.total > 0 && data.branches.attendanceEnabled < data.branches.total ? 'warning' : 'success'}
                            value={`${asNumber(data.branches.attendanceEnabled)} / ${asNumber(data.branches.total)}`}
                            context="Sucursales habilitadas para marcaje."
                            action={data.branches.total > 0 && data.branches.attendanceEnabled < data.branches.total ? { label: 'Configurar', onClick: () => navigate('/rh/asistencia/configuracion') } : undefined}
                        />
                    </section>

                    <div className={styles.workgrid}>
                        <section className={styles.card} aria-labelledby="hr-attention-title">
                            <header>
                                <div>
                                    <span className={styles.eyebrow}>Bandeja de trabajo</span>
                                    <h2 id="hr-attention-title">Por atender</h2>
                                </div>
                                <span className={styles.count}>{asNumber(attentionTotal)}</span>
                            </header>
                            <div className={styles.taskList}>
                                <Link to="/rh/ausencias">
                                    <CalendarDays size={20} />
                                    <span><strong>Permisos y vacaciones</strong><small>Revisar solicitudes del equipo</small></span>
                                    <b>{asNumber(data.attention.leaveRequests)}</b><ArrowRight size={17} />
                                </Link>
                                <Link to="/rh/jornadas">
                                    <Clock3 size={20} />
                                    <span><strong>Horas extra</strong><small>Validar tiempo solicitado</small></span>
                                    <b>{asNumber(data.attention.overtimeRequests)}</b><ArrowRight size={17} />
                                </Link>
                                <Link to="/rh/asistencia">
                                    <ClipboardCheck size={20} />
                                    <span><strong>Asistencia y correcciones</strong><small>Resolver marcajes e incidencias abiertas</small></span>
                                    <b>{asNumber(data.attention.attendanceCorrections + data.attention.attendanceIncidents)}</b><ArrowRight size={17} />
                                </Link>
                                <Link to="/rh/prestaciones">
                                    <BadgeDollarSign size={20} />
                                    <span><strong>Préstamos</strong><small>Evaluar nuevas solicitudes</small></span>
                                    <b>{asNumber(data.attention.loanRequests)}</b><ArrowRight size={17} />
                                </Link>
                            </div>
                        </section>

                        <section className={styles.card} aria-labelledby="hr-payroll-route-title">
                            <header>
                                <div>
                                    <span className={styles.eyebrow}>Proceso guiado</span>
                                    <h2 id="hr-payroll-route-title">Ruta de nómina</h2>
                                </div>
                                <WalletCards size={24} />
                            </header>
                            <ol className={styles.route}>
                                <li className={data.payroll.activeRule ? styles.complete : styles.current}>
                                    <Link to="/rh/nomina/configuracion-legal">
                                        <span className={styles.stepNumber}>1</span>
                                        <span><strong>Reglas legales</strong><small>{data.payroll.activeRule ? 'Configuración activa' : 'Configura régimen, IR, INSS e INATEC'}</small></span>
                                        {data.payroll.activeRule ? <CheckCircle2 size={19} /> : <ArrowRight size={17} />}
                                    </Link>
                                </li>
                                <li className={data.payroll.draftRuns > 0 ? styles.current : undefined}>
                                    <Link to="/rh/nomina">
                                        <span className={styles.stepNumber}>2</span>
                                        <span><strong>Preparar y calcular</strong><small>{asNumber(data.payroll.draftRuns)} corridas en borrador</small></span>
                                        <ArrowRight size={17} />
                                    </Link>
                                </li>
                                <li className={data.payroll.reviewRuns > 0 ? styles.current : undefined}>
                                    <Link to="/rh/nomina">
                                        <span className={styles.stepNumber}>3</span>
                                        <span><strong>Revisar y aprobar</strong><small>{asNumber(data.payroll.reviewRuns)} esperando revisión</small></span>
                                        <ArrowRight size={17} />
                                    </Link>
                                </li>
                                <li className={data.payroll.approvedRuns > 0 ? styles.current : undefined}>
                                    <Link to="/rh/nomina">
                                        <span className={styles.stepNumber}>4</span>
                                        <span><strong>Pagar y publicar colillas</strong><small>{asNumber(data.payroll.approvedRuns)} listas para pago</small></span>
                                        <ArrowRight size={17} />
                                    </Link>
                                </li>
                            </ol>
                        </section>
                    </div>

                    <section className={`${styles.card} ${styles.setup}`} aria-labelledby="hr-setup-title">
                        <header>
                            <div>
                                <span className={styles.eyebrow}>Preparación del módulo</span>
                                <h2 id="hr-setup-title">Configuración base</h2>
                            </div>
                            <Settings2 size={22} />
                        </header>
                        <div className={styles.setupGrid}>
                            <Link to="/rh/personal">
                                <UserCheck size={21} /><span><strong>Personal</strong><small>{asNumber(data.employees.internalAccounts)} cuentas vinculadas</small></span>
                            </Link>
                            <Link to="/rh/personal">
                                <Building2 size={21} /><span><strong>Organización</strong><small>{asNumber(data.catalogs.departments)} departamentos · {asNumber(data.catalogs.jobPositions)} puestos</small></span>
                            </Link>
                            <Link to="/rh/asistencia/configuracion">
                                <MapPin size={21} /><span><strong>Asistencia</strong><small>{asNumber(data.branches.attendanceEnabled)} de {asNumber(data.branches.total)} sucursales habilitadas</small></span>
                            </Link>
                            <Link to="/rh/nomina/configuracion-legal">
                                <Landmark size={21} /><span><strong>Obligaciones laborales</strong><small>{data.payroll.activeRule ? 'IR, INSS e INATEC activos' : 'Requiere configuración'}</small></span>
                            </Link>
                        </div>
                    </section>
                </>
            )}
        </PageContent>
    );
}
