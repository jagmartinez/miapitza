import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { productionReportsAPI, branchesAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCurrency } from '../hooks/useCurrency';
import { getUserRoleNames } from '../utils/authz';
import { formatCurrency } from '../utils/currency';
import Button from '../components/Button';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import type { Branch } from '../types';
import {
    Factory, RefreshCw, ClipboardCheck, Boxes, DollarSign, TrendingDown,
    TrendingUp, Percent, FlaskConical, Package, ArrowRight
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import './ProductionDashboard.css';

interface Kpis {
    total: number; draft: number; pending: number; inProgress: number; finished: number; cancelled: number;
    totalPlanned: number; totalProduced: number; totalEstimatedCost: number; totalRealCost: number;
    costVariance: number; avgYieldPct: number;
}
interface StatusRow { status: string; count: number; [k: string]: string | number }
interface DaySeries { date: string; orders: number; produced: number; realCost: number }
interface ProducedRow { productId: number; name: string; sku: string | null; type: string; orders: number; produced: number; realCost: number }
interface ConsumedRow { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number }
interface RecentRow {
    id: number; code: string; product?: { id: number; name: string; sku: string | null };
    status: string; plannedQuantity: number; producedQuantity: number; realCost: number; estimatedCost: number;
    date: string; finishedAt: string | null;
}
interface DashboardData {
    kpis: Kpis;
    statusBreakdown: StatusRow[];
    timeSeries: DaySeries[];
    topProduced: ProducedRow[];
    topConsumed: ConsumedRow[];
    recentOrders: RecentRow[];
    catalog: { activeRecipes: number; producibleProducts: number };
}

const STATUS_META: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'Borrador', color: '#94a3b8' },
    PENDING: { label: 'Pendiente', color: '#f59e0b' },
    IN_PROGRESS: { label: 'En Proceso', color: '#3b82f6' },
    FINISHED: { label: 'Finalizada', color: '#22c55e' },
    CANCELLED: { label: 'Anulada', color: '#ef4444' }
};

const fmtNum = (n: number) => new Intl.NumberFormat('es-NI', { maximumFractionDigits: 2 }).format(n);
const fmtDay = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-NI') : '-');

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStartStr = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return error instanceof Error ? error.message : 'Error al cargar el panel';
}

export default function ProductionDashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { settings } = useCurrency();
    const roles = getUserRoleNames(user);
    const isAdmin = roles.includes('SUPERADMIN') || roles.includes('ADMIN');

    const [dateFrom, setDateFrom] = useState(monthStartStr());
    const [dateTo, setDateTo] = useState(todayStr());
    const [branches, setBranches] = useState<Branch[]>([]);
    const [branchId, setBranchId] = useState<string>('all');
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isAdmin) return;
        branchesAPI.getAll()
            .then((res) => setBranches((res.data?.data ?? res.data ?? []) as Branch[]))
            .catch(() => setBranches([]));
    }, [isAdmin]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params: Record<string, unknown> = { dateFrom, dateTo };
            if (isAdmin && branchId !== 'all') params.branchId = branchId;
            const res = await productionReportsAPI.getDashboard(params);
            setData(res.data.data as DashboardData);
        } catch (err) {
            setError(apiErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo, branchId, isAdmin]);

    useEffect(() => { load(); }, [load]);

    const branchOptions = [{ value: 'all', label: 'Todas las sucursales' }, ...branches.map(b => ({ value: String(b.id), label: b.name }))];
    const selectedBranch = branchOptions.find(o => o.value === branchId) || branchOptions[0];

    const kpis = data?.kpis;
    const tooltipStyle = {
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '8px',
        color: 'var(--color-text)',
        fontSize: '12px'
    };

    return (
        <div className="prod-dash">
            {/* Header */}
            <div className="prod-dash-header">
                <div className="prod-dash-title">
                    <div className="prod-dash-title-icon"><Factory size={22} /></div>
                    <div>
                        <h1>Panel de Producción</h1>
                        <p>Indicadores, rendimiento y consumo de insumos de tus órdenes de producción</p>
                    </div>
                </div>
                <div className="prod-dash-filters">
                    <div className="prod-dash-field">
                        <label>Desde</label>
                        <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
                    </div>
                    <div className="prod-dash-field">
                        <label>Hasta</label>
                        <input type="date" value={dateTo} min={dateFrom} max={todayStr()} onChange={(e) => setDateTo(e.target.value)} />
                    </div>
                    {isAdmin && branches.length > 0 && (
                        <div className="prod-dash-field prod-dash-branch">
                            <label>Sucursal</label>
                            <Select
                                value={selectedBranch}
                                onChange={(opt: SingleValue<{ value: string; label: string }>) => opt && setBranchId(opt.value)}
                                options={branchOptions}
                                isSearchable={false}
                            />
                        </div>
                    )}
                    <Button variant="secondary" onClick={load}><RefreshCw size={16} /> Actualizar</Button>
                </div>
            </div>

            {error && <div className="prod-dash-error">{error}</div>}

            {loading ? (
                <div className="prod-dash-loading">Cargando panel de producción...</div>
            ) : !kpis ? (
                <div className="prod-dash-loading">Sin datos para el período seleccionado.</div>
            ) : (
                <>
                    {/* KPI cards */}
                    <div className="prod-dash-kpis">
                        <KpiCard icon={<ClipboardCheck size={18} />} tone="indigo" label="Órdenes" value={fmtNum(kpis.total)}
                            hint={`${kpis.finished} finalizadas · ${kpis.inProgress} en proceso`} />
                        <KpiCard icon={<Boxes size={18} />} tone="blue" label="Producido" value={fmtNum(kpis.totalProduced)}
                            hint={`Planificado: ${fmtNum(kpis.totalPlanned)}`} />
                        <KpiCard icon={<DollarSign size={18} />} tone="green" label="Costo real" value={formatCurrency(kpis.totalRealCost, settings)}
                            hint={`Estimado: ${formatCurrency(kpis.totalEstimatedCost, settings)}`} />
                        <KpiCard icon={kpis.costVariance > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                            tone={kpis.costVariance > 0 ? 'red' : 'green'} label="Variación de costo"
                            value={formatCurrency(kpis.costVariance, settings)}
                            hint={kpis.costVariance > 0 ? 'Por encima de lo estimado' : 'Dentro de lo estimado'} />
                        <KpiCard icon={<Percent size={18} />} tone={kpis.avgYieldPct >= 100 ? 'green' : kpis.avgYieldPct >= 90 ? 'amber' : 'red'}
                            label="Rendimiento prom." value={`${fmtNum(kpis.avgYieldPct)}%`} hint="Producido / Planificado" />
                        <KpiCard icon={<FlaskConical size={18} />} tone="violet" label="Recetas activas" value={fmtNum(data!.catalog.activeRecipes)}
                            hint={`${data!.catalog.producibleProducts} productos producibles`} />
                    </div>

                    {/* Charts */}
                    <div className="prod-dash-grid">
                        <div className="prod-card prod-card-wide">
                            <div className="prod-card-head"><h3>Producción por día</h3><span>Unidades producidas y costo real</span></div>
                            {data!.timeSeries.length === 0 ? (
                                <div className="prod-empty">Sin producciones finalizadas en el período.</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <LineChart data={data!.timeSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                        <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Día ${fmtDay(String(l))}`}
                                            formatter={(value: number, name: string) => [name === 'Costo real' ? formatCurrency(Number(value), settings) : fmtNum(Number(value)), name]} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Line yAxisId="left" type="monotone" dataKey="produced" name="Producido" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                                        <Line yAxisId="right" type="monotone" dataKey="realCost" name="Costo real" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        <div className="prod-card">
                            <div className="prod-card-head"><h3>Órdenes por estado</h3><span>Distribución del período</span></div>
                            {kpis.total === 0 ? (
                                <div className="prod-empty">Sin órdenes.</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <PieChart>
                                        <Pie data={data!.statusBreakdown.filter(s => s.count > 0)} dataKey="count" nameKey="status"
                                            cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                                            {data!.statusBreakdown.filter(s => s.count > 0).map((s) => (
                                                <Cell key={s.status} fill={STATUS_META[s.status]?.color || '#94a3b8'} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle}
                                            formatter={(value: number, name: string) => [fmtNum(Number(value)), STATUS_META[name]?.label || name]} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} formatter={(v) => STATUS_META[v]?.label || v} />
                                    </PieChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        <div className="prod-card">
                            <div className="prod-card-head"><h3>Top productos fabricados</h3><span>Por cantidad producida</span></div>
                            {data!.topProduced.length === 0 ? (
                                <div className="prod-empty">Sin datos.</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={280}>
                                    <BarChart data={data!.topProduced} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                                        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-surface-hover, rgba(148,163,184,0.12))' }}
                                            formatter={(value: number) => [fmtNum(Number(value)), 'Producido']} />
                                        <Bar dataKey="produced" fill="#6366f1" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        <div className="prod-card prod-card-wide">
                            <div className="prod-card-head"><h3>Top insumos consumidos</h3><span>Por costo total</span></div>
                            {data!.topConsumed.length === 0 ? (
                                <div className="prod-empty">Sin consumos registrados.</div>
                            ) : (
                                <div className="prod-table-wrap">
                                    <table className="prod-table">
                                        <thead>
                                            <tr>
                                                <th>Insumo</th><th>SKU</th><th className="num">Cantidad</th><th className="num">Costo total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data!.topConsumed.map((c) => (
                                                <tr key={c.componentProductId}>
                                                    <td>{c.name}</td>
                                                    <td className="muted">{c.sku || '-'}</td>
                                                    <td className="num">{fmtNum(c.consumedQuantity)} {c.unit}</td>
                                                    <td className="num strong">{formatCurrency(c.totalCost, settings)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Recent orders */}
                    <div className="prod-card">
                        <div className="prod-card-head">
                            <h3>Órdenes recientes</h3>
                            <button className="prod-link" onClick={() => navigate('/production-orders')}>Ver todas <ArrowRight size={14} /></button>
                        </div>
                        {data!.recentOrders.length === 0 ? (
                            <div className="prod-empty">
                                <Package size={28} />
                                <p>No hay órdenes de producción en el período.</p>
                                <Button variant="primary" onClick={() => navigate('/production-orders')}>Crear producción</Button>
                            </div>
                        ) : (
                            <div className="prod-table-wrap">
                                <table className="prod-table">
                                    <thead>
                                        <tr>
                                            <th>Código</th><th>Producto</th><th>Estado</th>
                                            <th className="num">Plan.</th><th className="num">Prod.</th>
                                            <th className="num">Costo real</th><th>Fecha</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data!.recentOrders.map((o) => (
                                            <tr key={o.id} className="prod-row" onClick={() => navigate('/production-orders')}>
                                                <td className="strong">{o.code}</td>
                                                <td>{o.product?.name || '-'}</td>
                                                <td>
                                                    <span className="prod-pill" style={{
                                                        color: STATUS_META[o.status]?.color,
                                                        background: `${STATUS_META[o.status]?.color}1a`
                                                    }}>{STATUS_META[o.status]?.label || o.status}</span>
                                                </td>
                                                <td className="num">{fmtNum(o.plannedQuantity)}</td>
                                                <td className="num">{fmtNum(o.producedQuantity)}</td>
                                                <td className="num">{formatCurrency(o.realCost, settings)}</td>
                                                <td className="muted">{fmtDate(o.finishedAt || o.date)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function KpiCard({ icon, label, value, hint, tone }: {
    icon: React.ReactNode; label: string; value: string; hint?: string; tone: string;
}) {
    return (
        <div className={`prod-kpi prod-kpi-${tone}`}>
            <div className="prod-kpi-icon">{icon}</div>
            <div className="prod-kpi-body">
                <span className="prod-kpi-label">{label}</span>
                <span className="prod-kpi-value">{value}</span>
                {hint && <span className="prod-kpi-hint">{hint}</span>}
            </div>
        </div>
    );
}
