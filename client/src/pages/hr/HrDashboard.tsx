import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    Briefcase,
    Building2,
    CheckCircle,
    Clock,
    Link,
    MapPin,
    RefreshCw,
    UserMinus,
    UsersRound,
} from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import { getHrErrorMessage, hrClient } from '../../components/hr/hrClient';
import type { HrDashboardData } from '../../types/hr';
import './hr.css';

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
            setError(getHrErrorMessage(loadError, 'No fue posible cargar el resumen de Recursos Humanos.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadDashboard();
    }, [loadDashboard]);

    return (
        <div className="page-wrapper hr-dashboard-page">
            <PageHeader
                title="Recursos Humanos"
                subtitle="Resumen de la fundación RH y estado del personal"
                icon={UsersRound}
                actions={<Button onClick={() => navigate('/rh/personal')}>Gestionar personal</Button>}
            />

            {loading && <LoadingSpinner text="Cargando resumen de RH…" />}

            {!loading && error && (
                <div className="state-placeholder" role="alert">
                    <AlertTriangle size={42} aria-hidden="true" />
                    <p className="state-error">{error}</p>
                    <Button variant="ghost" onClick={() => void loadDashboard()}><RefreshCw size={16} /> Reintentar</Button>
                </div>
            )}

            {!loading && !error && data && (
                <>
                    <div className="kpi-grid" aria-label="Indicadores de personal">
                        <article className="kpi-card">
                            <div className="kpi-label"><UsersRound size={17} /> Total de empleados</div>
                            <div className="kpi-value">{asNumber(data.employees.total)}</div>
                        </article>
                        <article className="kpi-card kpi-success">
                            <div className="kpi-label"><CheckCircle size={17} /> Activos</div>
                            <div className="kpi-value">{asNumber(data.employees.active)}</div>
                        </article>
                        <article className="kpi-card kpi-warning">
                            <div className="kpi-label"><Clock size={17} /> Suspendidos</div>
                            <div className="kpi-value">{asNumber(data.employees.suspended)}</div>
                        </article>
                        <article className="kpi-card kpi-neutral">
                            <div className="kpi-label"><Clock size={17} /> Con permiso</div>
                            <div className="kpi-value">{asNumber(data.employees.onLeave)}</div>
                        </article>
                        <article className="kpi-card kpi-neutral">
                            <div className="kpi-label"><UserMinus size={17} /> Inactivos</div>
                            <div className="kpi-value">{asNumber(data.employees.inactive)}</div>
                        </article>
                        <article className="kpi-card">
                            <div className="kpi-label"><Link size={17} /> Usuarios vinculados</div>
                            <div className="kpi-value">{asNumber(data.employees.internalAccounts)}</div>
                        </article>
                    </div>

                    <section className="hr-dashboard-alerts" aria-labelledby="hr-dashboard-setup-title">
                        <div className="hr-panel-header">
                            <h2 id="hr-dashboard-setup-title">Fundación RH</h2>
                            <span className="status-pill status-info">Fase 1</span>
                        </div>
                        <div className="hr-foundation-grid">
                            <div>
                                <Briefcase size={20} aria-hidden="true" />
                                <span>Departamentos</span>
                                <strong>{asNumber(data.catalogs.departments)}</strong>
                            </div>
                            <div>
                                <UsersRound size={20} aria-hidden="true" />
                                <span>Puestos</span>
                                <strong>{asNumber(data.catalogs.jobPositions)}</strong>
                            </div>
                            <div>
                                <Building2 size={20} aria-hidden="true" />
                                <span>Centros de costo</span>
                                <strong>{asNumber(data.catalogs.costCenters)}</strong>
                            </div>
                            <div>
                                <MapPin size={20} aria-hidden="true" />
                                <span>Sucursales con geocerca</span>
                                <strong>{asNumber(data.branches.geofenceConfigured)} / {asNumber(data.branches.total)}</strong>
                            </div>
                            <div>
                                <CheckCircle size={20} aria-hidden="true" />
                                <span>Asistencia habilitada</span>
                                <strong>{asNumber(data.branches.attendanceEnabled)}</strong>
                            </div>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
