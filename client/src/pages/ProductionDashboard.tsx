import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { productionReportsAPI, branchesAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCurrency } from '../hooks/useCurrency';
import { getUserRoleNames } from '../utils/authz';
import { formatCurrencyGrouped } from '../utils/currency';
import { formatLocalDateInput } from '../utils/dateInput';
import Button from '../components/Button';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import type { Branch } from '../types';
import {
    Factory, RefreshCw, ClipboardCheck, Boxes, DollarSign, TrendingDown,
    TrendingUp, Percent, FlaskConical, Package, ArrowRight, Activity,
    CheckCircle2, Coins, Scale, Building2, Users
} from 'lucide-react';
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    PieChart, Pie, Cell, Legend, ComposedChart, Area, Line
} from 'recharts';
import './ProductionDashboard.css';

interface Kpis {
    total: number; draft: number; pending: number; inProgress: number; finished: number; cancelled: number;
    totalPlanned: number; totalProduced: number; totalEstimatedCost: number; totalRealCost: number;
    costVariance: number; avgYieldPct: number;
    activeOrders: number; completionRate: number; cancelRate: number;
    realizedOrders: number; avgRealOrderCost: number; costVariancePct: number;
}
interface PreviousKpis {
    total: number; finished: number; totalProduced: number; totalRealCost: number;
    costVariance: number; avgYieldPct: number;
}
interface StatusRow { status: string; count: number; [k: string]: string | number }
interface DaySeries { date: string; orders: number; realCost: number; estimatedCost: number }
interface ProducedRow {
    productId: number; name: string; sku: string | null; type: string; orders: number;
    unit: string; produced: number; realCost: number; estimatedCost: number; costVariance: number; yieldPct: number;
}
interface ConsumedRow { componentProductId: number; name: string; sku: string | null; unit: string; consumedQuantity: number; totalCost: number }
interface BranchRow { branchId: number; name: string; orders: number; realCost: number }
interface OperatorRow { userId: number; name: string; orders: number; realCost: number }
interface RecentRow {
    id: number; code: string; product?: { id: number; name: string; sku: string | null; unit: string; baseUnit?: { abbreviation: string } | null };
    status: string; plannedQuantity: number; producedQuantity: number; realCost: number; estimatedCost: number;
    date: string; finishedAt: string | null;
}
interface DashboardData {
    kpis: Kpis;
    previous: PreviousKpis | null;
    statusBreakdown: StatusRow[];
    timeSeries: DaySeries[];
    topProduced: ProducedRow[];
    topConsumed: ConsumedRow[];
    branchComparison: BranchRow[];
    topOperators: OperatorRow[];
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
const fmtPct = (n: number) => `${new Intl.NumberFormat('es-NI', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
const fmtDay = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-NI') : '-');

const yieldTone = (pct: number) => (pct >= 100 ? 'green' : pct >= 90 ? 'amber' : 'red');

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
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
    const [branchWarning, setBranchWarning] = useState<string | null>(null);

    useEffect(() => {
        if (!isAdmin) return;
        branchesAPI.getAll()
            .then((res) => {
                setBranches((res.data?.data ?? res.data ?? []) as Branch[]);
                setBranchWarning(null);
            })
            .catch(() => {
                setBranches([]);
                setBranchWarning('No se pudieron cargar las sucursales. El filtro de sucursal puede estar incompleto.');
            });
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
    const prev = data?.previous ?? null;
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
                        <p>Inteligencia de negocios: rendimiento, costos y consumo de tus órdenes de producción</p>
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

            {branchWarning && <div className="prod-dash-error" role="status">{branchWarning}</div>}
            {error && <div className="prod-dash-error">{error}</div>}

            {loading ? (
                <div className="prod-dash-loading">Cargando panel de producción...</div>
            ) : !kpis ? (
                <div className="prod-dash-loading">Sin datos para el período seleccionado.</div>
            ) : (
                <>
                    {/* Primary KPI cards (with period-over-period comparison) */}
                    <div className="prod-kpis-section">
                        <div className="prod-section-label">Resumen del período</div>
                        <div className="prod-dash-kpis">
                            <KpiCard icon={<ClipboardCheck size={18} />} tone="indigo" label="Órdenes" value={fmtNum(kpis.total)}
                                hint={`${fmtNum(kpis.finished)} finalizadas · ${fmtNum(kpis.inProgress)} en proceso`}
                                badge={<DeltaBadge current={kpis.total} previous={prev?.total} />} />
                            <KpiCard icon={<Boxes size={18} />} tone="blue" label="Producciones realizadas" value={fmtNum(kpis.realizedOrders)}
                                hint="Finalizadas dentro del período seleccionado" />
                            <KpiCard icon={<DollarSign size={18} />} tone="green" label="Costo real" value={formatCurrencyGrouped(kpis.totalRealCost, settings)}
                                hint={`Estimado: ${formatCurrencyGrouped(kpis.totalEstimatedCost, settings)}`}
                                badge={<DeltaBadge current={kpis.totalRealCost} previous={prev?.totalRealCost} invert />} />
                            <KpiCard icon={kpis.costVariance > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                                tone={kpis.costVariance > 0 ? 'red' : 'green'} label="Variación de costo"
                                value={formatCurrencyGrouped(kpis.costVariance, settings)}
                                hint={`${fmtPct(kpis.costVariancePct)} vs estimado`}
                                badge={<DeltaBadge current={kpis.costVariance} previous={prev?.costVariance} invert />} />
                            <KpiCard icon={<Percent size={18} />} tone={yieldTone(kpis.avgYieldPct)}
                                label="Rendimiento prom." value={fmtPct(kpis.avgYieldPct)} hint="Producido / Planificado"
                                badge={<DeltaBadge current={kpis.avgYieldPct} previous={prev?.avgYieldPct} />} />
                        </div>
                    </div>

                    {/* Secondary KPIs */}
                    <div className="prod-kpis-section">
                        <div className="prod-section-label">Indicadores operativos</div>
                        <div className="prod-dash-kpis prod-dash-kpis-sm">
                            <KpiCard icon={<CheckCircle2 size={18} />} tone={kpis.completionRate >= 80 ? 'green' : kpis.completionRate >= 50 ? 'amber' : 'red'}
                                label="Tasa de finalización" value={fmtPct(kpis.completionRate)} hint={`${fmtNum(kpis.cancelled)} anuladas (${fmtPct(kpis.cancelRate)})`} />
                            <KpiCard icon={<Activity size={18} />} tone="blue" label="Órdenes activas" value={fmtNum(kpis.activeOrders)}
                                hint={`${fmtNum(kpis.draft)} borrador · ${fmtNum(kpis.pending)} pend.`} />
                            <KpiCard icon={<Coins size={18} />} tone="amber" label="Costo promedio por orden" value={formatCurrencyGrouped(kpis.avgRealOrderCost, settings)}
                                hint="Costo real / producciones realizadas" />
                            <KpiCard icon={<Scale size={18} />} tone={kpis.costVariancePct > 0 ? 'red' : 'green'} label="% variación de costo"
                                value={fmtPct(kpis.costVariancePct)} hint="Real vs estimado" />
                            <KpiCard icon={<FlaskConical size={18} />} tone="violet" label="Recetas activas" value={fmtNum(data!.catalog.activeRecipes)}
                                hint={`${fmtNum(data!.catalog.producibleProducts)} productos producibles`} />
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="prod-dash-grid">
                        <div className="prod-card prod-card-wide">
                            <div className="prod-card-head"><h3>Costo real vs estimado por día</h3><span>Costos y órdenes finalizadas por fecha de finalización</span></div>
                            {data!.timeSeries.length === 0 ? (
                                <div className="prod-empty">Sin producciones finalizadas en el período.</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <ComposedChart data={data!.timeSeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="prodArea" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                        <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
                                        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => `Día ${fmtDay(String(l))}`}
                                            formatter={(value: number, name: string) => [name === 'Órdenes finalizadas' ? fmtNum(Number(value)) : formatCurrencyGrouped(Number(value), settings), name]} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Area yAxisId="left" type="monotone" dataKey="orders" name="Órdenes finalizadas" stroke="#3b82f6" strokeWidth={2} fill="url(#prodArea)" />
                                        <Line yAxisId="right" type="monotone" dataKey="estimatedCost" name="Costo estimado" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                                        <Line yAxisId="right" type="monotone" dataKey="realCost" name="Costo real" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        <div className="prod-card">
                            <div className="prod-card-head"><h3>Órdenes por estado</h3><span>Distribución del período</span></div>
                            {kpis.total === 0 ? (
                                <div className="prod-empty">Sin órdenes.</div>
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
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
                    </div>

                    {/* Top products fabricados */}
                    <div className="prod-card">
                        <div className="prod-card-head"><h3>Top productos fabricados</h3><span>Producción, costo y rendimiento</span></div>
                        {data!.topProduced.length === 0 ? (
                            <div className="prod-empty">Sin datos.</div>
                        ) : (
                            <div className="prod-table-wrap">
                                <table className="prod-table">
                                    <thead>
                                        <tr>
                                            <th>Producto</th><th>SKU</th><th className="num">Órdenes</th>
                                            <th className="num">Producido</th><th className="num">Costo real</th>
                                            <th className="num">Variación</th><th className="num">Rendimiento</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data!.topProduced.map((p) => (
                                            <tr key={p.productId}>
                                                <td className="strong">{p.name}</td>
                                                <td className="muted">{p.sku || '-'}</td>
                                                <td className="num">{fmtNum(p.orders)}</td>
                                                <td className="num">{fmtNum(p.produced)} {p.unit}</td>
                                                <td className="num">{formatCurrencyGrouped(p.realCost, settings)}</td>
                                                <td className={`num ${p.costVariance > 0 ? 'neg' : 'pos'}`}>
                                                    {formatCurrencyGrouped(p.costVariance, settings)}
                                                </td>
                                                <td className="num">
                                                    <span className={`prod-yield prod-yield-${yieldTone(p.yieldPct)}`}>{fmtPct(p.yieldPct)}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Branch comparison + Operators */}
                    <div className="prod-dash-grid">
                        <div className="prod-card">
                            <div className="prod-card-head"><h3>Comparativa por sucursal</h3><span>Órdenes finalizadas y costo real</span></div>
                            {data!.branchComparison.length === 0 ? (
                                <div className="prod-empty"><Building2 size={26} /><p>Sin datos por sucursal en el período.</p></div>
                            ) : data!.branchComparison.length === 1 ? (
                                <SingleBranchSummary branch={data!.branchComparison[0]} settings={settings} />
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={data!.branchComparison} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtNum(Number(v))} />
                                        <Tooltip contentStyle={tooltipStyle}
                                            formatter={(value: number, name: string) => [name === 'Órdenes finalizadas' ? fmtNum(Number(value)) : formatCurrencyGrouped(Number(value), settings), name]} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Bar yAxisId="left" dataKey="orders" name="Órdenes finalizadas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                        <Bar yAxisId="right" dataKey="realCost" name="Costo real" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        <div className="prod-card">
                            <div className="prod-card-head"><h3>Producción por operario</h3><span>Órdenes finalizadas por usuario</span></div>
                            {data!.topOperators.length === 0 ? (
                                <div className="prod-empty"><Users size={26} /><p>Sin producción por operario en el período.</p></div>
                            ) : (
                                <div className="prod-table-wrap">
                                    <table className="prod-table">
                                        <thead>
                                            <tr>
                                                <th>Operario</th><th className="num">Órdenes</th>
                                                <th className="num">Costo real</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data!.topOperators.map((op) => (
                                                <tr key={op.userId}>
                                                    <td className="strong">{op.name}</td>
                                                    <td className="num">{fmtNum(op.orders)}</td>
                                                    <td className="num">{formatCurrencyGrouped(op.realCost, settings)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Top insumos consumidos */}
                    <div className="prod-card">
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
                                                <td className="num strong">{formatCurrencyGrouped(c.totalCost, settings)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
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
                                                <td className="num">{fmtNum(o.plannedQuantity)} {o.product?.baseUnit?.abbreviation || o.product?.unit || ''}</td>
                                                <td className="num">{fmtNum(o.producedQuantity)} {o.product?.baseUnit?.abbreviation || o.product?.unit || ''}</td>
                                                <td className="num">{formatCurrencyGrouped(o.realCost, settings)}</td>
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

function DeltaBadge({ current, previous, invert = false }: { current: number; previous: number | null | undefined; invert?: boolean }) {
    if (previous == null) return null;
    if (previous === 0) {
        if (current === 0) return null;
        return <span className="prod-delta prod-delta-neutral">nuevo</span>;
    }
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(pct)) return null;
    const flat = Math.abs(pct) < 0.05;
    const good = invert ? pct < 0 : pct > 0;
    const tone = flat ? 'neutral' : good ? 'up' : 'down';
    const Icon = pct > 0 ? TrendingUp : TrendingDown;
    return (
        <span className={`prod-delta prod-delta-${tone}`}>
            {!flat && <Icon size={12} />}
            {fmtPct(Math.abs(pct))}
        </span>
    );
}

function SingleBranchSummary({ branch, settings }: { branch: BranchRow; settings: ReturnType<typeof useCurrency>['settings'] }) {
    return (
        <div className="prod-branch-single">
            <div className="prod-branch-single-name"><Building2 size={16} /> {branch.name}</div>
            <div className="prod-branch-single-grid">
                <div><span className="prod-branch-single-label">Órdenes finalizadas</span><span className="prod-branch-single-val">{fmtNum(branch.orders)}</span></div>
                <div><span className="prod-branch-single-label">Costo real</span><span className="prod-branch-single-val">{formatCurrencyGrouped(branch.realCost, settings)}</span></div>
            </div>
        </div>
    );
}

function KpiCard({ icon, label, value, hint, tone, badge }: {
    icon: React.ReactNode; label: string; value: string; hint?: string; tone: string; badge?: React.ReactNode;
}) {
    return (
        <div className={`prod-kpi prod-kpi-${tone}`}>
            <div className="prod-kpi-icon">{icon}</div>
            <div className="prod-kpi-body">
                <div className="prod-kpi-top">
                    <span className="prod-kpi-label">{label}</span>
                    {badge}
                </div>
                <span className="prod-kpi-value">{value}</span>
                {hint && <span className="prod-kpi-hint">{hint}</span>}
            </div>
        </div>
    );
}
