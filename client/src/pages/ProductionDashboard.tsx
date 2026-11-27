import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { productionReportsAPI, branchesAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useCurrency } from '../hooks/useCurrency';
import { getUserRoleNames } from '../utils/authz';
import { formatLocalDateInput } from '../utils/dateInput';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, PageContent, PageHeader, Skeleton, StatCard, TableToolbar,
    formatNumber, formatPercent,
    type Column, type Opt, type Tone,
} from '@/ui';
import type { Branch } from '../types';
import { Building2, Package, RefreshCw, Users } from 'lucide-react';
import { DonutChart, ParetoBars, TrendChart } from '@/ui/charts';
import { toPareto } from './dashboardCharts';
import s from './Production.module.css';
import { getApiErrorMessage } from '../utils/apiError';

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

const STATUS_META: Record<string, { label: string; color: string; tone: Tone }> = {
    DRAFT: { label: 'Borrador', color: 'var(--ui-text-muted)', tone: 'neutral' },
    PENDING: { label: 'Pendiente', color: 'var(--ui-warning)', tone: 'warning' },
    IN_PROGRESS: { label: 'En proceso', color: 'var(--ui-primary)', tone: 'primary' },
    FINISHED: { label: 'Finalizada', color: 'var(--ui-success)', tone: 'success' },
    CANCELLED: { label: 'Anulada', color: 'var(--ui-danger)', tone: 'neutral' }
};

const fmtDay = (d: string) => {
    const parts = d.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-NI') : '-');

const yieldTone = (pct: number): Tone => (pct >= 100 ? 'success' : pct >= 90 ? 'warning' : 'danger');

const todayStr = () => formatLocalDateInput();
const monthStartStr = () => {
    const d = new Date();
    return formatLocalDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
};

function apiErrorMessage(error: unknown): string {
    return getApiErrorMessage(error);
}

/** Comparación contra el período anterior como texto de contexto; null si no hay base comparable. */
function deltaText(current: number, previous: number | null | undefined): string | null {
    if (previous == null) return null;
    if (previous === 0) return current === 0 ? null : 'nuevo frente al período anterior';
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(pct)) return null;
    if (Math.abs(pct) < 0.05) return 'sin cambio frente al período anterior';
    return `${pct > 0 ? '+' : '-'}${formatPercent(Math.abs(pct))} frente al período anterior`;
}

export default function ProductionDashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatMoney, symbol } = useCurrency();
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

    useEffect(() => { void load(); }, [load]);

    const branchOptions: Opt<string>[] = [{ value: 'all', label: 'Todas las sucursales' }, ...branches.map(b => ({ value: String(b.id), label: b.name }))];

    const kpis = data?.kpis;
    const prev = data?.previous ?? null;
    const unitOf = (o: RecentRow) => o.product?.baseUnit?.abbreviation || o.product?.unit || '';

    const producedColumns: Column<ProducedRow>[] = [
        { key: 'name', header: 'Producto', width: '2fr', render: (p) => <span className={s.cellTitle}>{p.name}</span> },
        { key: 'sku', header: 'SKU', width: '1fr', hideBelow: 'md', render: (p) => p.sku || '-' },
        { key: 'orders', header: 'Órdenes', type: 'number', width: '0.8fr', decimals: 0 },
        { key: 'produced', header: 'Producido', type: 'qty', width: '1.2fr', render: (p) => `${formatNumber(p.produced)} ${p.unit}` },
        { key: 'realCost', header: `Costo real (${symbol})`, type: 'money', width: '1.1fr' },
        {
            key: 'costVariance',
            header: `Variación (${symbol})`,
            type: 'money',
            width: '1.1fr',
            render: (p) => <span className={p.costVariance > 0 ? s.bad : s.good}>{formatNumber(p.costVariance)}</span>,
        },
        {
            key: 'yieldPct',
            header: 'Rendimiento',
            type: 'percent',
            width: '1fr',
            render: (p) => <Badge tone={yieldTone(p.yieldPct)}>{formatPercent(p.yieldPct)}</Badge>,
        },
    ];

    const operatorColumns: Column<OperatorRow>[] = [
        { key: 'name', header: 'Operario', width: '2fr', render: (op) => <span className={s.cellTitle}>{op.name}</span> },
        { key: 'orders', header: 'Órdenes', type: 'number', width: '1fr', decimals: 0 },
        { key: 'realCost', header: `Costo real (${symbol})`, type: 'money', width: '1.2fr' },
    ];

    const consumedColumns: Column<ConsumedRow>[] = [
        { key: 'name', header: 'Insumo', width: '2fr' },
        { key: 'sku', header: 'SKU', width: '1fr', hideBelow: 'md', render: (c) => c.sku || '-' },
        { key: 'qty', header: 'Cantidad', type: 'qty', width: '1.2fr', render: (c) => `${formatNumber(c.consumedQuantity)} ${c.unit}` },
        { key: 'totalCost', header: `Costo total (${symbol})`, type: 'money', width: '1.2fr' },
    ];

    const recentColumns: Column<RecentRow>[] = [
        { key: 'code', header: 'Código', width: '1fr', render: (o) => <span className={s.cellTitle}>{o.code}</span> },
        { key: 'product', header: 'Producto', width: '2fr', render: (o) => o.product?.name || '-' },
        {
            key: 'status',
            header: 'Estado',
            type: 'status',
            width: '1fr',
            render: (o) => <Badge tone={STATUS_META[o.status]?.tone ?? 'neutral'}>{STATUS_META[o.status]?.label || o.status}</Badge>,
        },
        { key: 'planned', header: 'Plan.', type: 'qty', width: '1.1fr', hideBelow: 'md', render: (o) => `${formatNumber(o.plannedQuantity)} ${unitOf(o)}` },
        { key: 'produced', header: 'Prod.', type: 'qty', width: '1.1fr', hideBelow: 'md', render: (o) => `${formatNumber(o.producedQuantity)} ${unitOf(o)}` },
        {
            key: 'realCost',
            header: `Costo real (${symbol})`,
            type: 'money',
            width: '1.1fr',
            render: (o) => (o.status === 'FINISHED' && Number(o.realCost) > 0 ? formatNumber(o.realCost) : <span className={s.nd}>N/D</span>),
        },
        { key: 'date', header: 'Fecha', type: 'date', width: '1fr', hideBelow: 'lg', render: (o) => fmtDate(o.finishedAt || o.date) },
    ];

    const hasRealized = (kpis?.realizedOrders ?? 0) > 0;

    return (
        <PageContent>
            <PageHeader
                title="Panel de producción"
                description="Rendimiento, costos y consumo de tus órdenes de producción"
                actions={<Button icon={RefreshCw} onClick={() => void load()}>Actualizar</Button>}
            />

            <TableToolbar>
                <div className={s.filter}>
                    <Field label="Desde" htmlFor="pd-from">
                        <DateInput id="pd-from" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} />
                    </Field>
                </div>
                <div className={s.filter}>
                    <Field label="Hasta" htmlFor="pd-to">
                        <DateInput id="pd-to" value={dateTo} min={dateFrom} max={todayStr()} onChange={(e) => setDateTo(e.target.value)} />
                    </Field>
                </div>
                {isAdmin && branches.length > 0 && (
                    <div className={s.filter}>
                        <Field label="Sucursal" htmlFor="pd-branch">
                            <AppSelect<string>
                                inputId="pd-branch"
                                options={branchOptions}
                                value={branchId}
                                onChange={(v) => setBranchId(v ?? 'all')}
                                isClearable={false}
                            />
                        </Field>
                    </div>
                )}
            </TableToolbar>

            {branchWarning && <div className={s.banner} role="status">{branchWarning}</div>}
            {error && (
                <div className={s.banner} role="alert">
                    <span>{error}</span>
                    <Button size="sm" onClick={() => void load()}>Reintentar</Button>
                </div>
            )}

            {loading ? (
                <Skeleton height={240} />
            ) : !kpis || !data ? (
                !error && <EmptyState icon={Package} title="Sin datos para el período seleccionado" />
            ) : (
                <>
                    <div className={s.stats}>
                        <StatCard
                            label="Variación de costo"
                            value={hasRealized ? formatMoney(kpis.costVariance) : 'N/D'}
                            context={hasRealized
                                ? `${formatPercent(kpis.costVariancePct)} frente al estimado: real ${formatMoney(kpis.totalRealCost)} vs estimado ${formatMoney(kpis.totalEstimatedCost)} en ${formatNumber(kpis.realizedOrders, 0)} producciones.${deltaText(kpis.costVariance, prev?.costVariance) ? ` ${deltaText(kpis.costVariance, prev?.costVariance)}.` : ''}`
                                : 'Requiere producciones finalizadas con costo estimado.'}
                            tone={!hasRealized ? 'neutral' : kpis.costVariance > 0 ? 'danger' : 'success'}
                            action={hasRealized && kpis.costVariance > 0 ? { label: 'Ver órdenes', onClick: () => navigate('/production-orders') } : undefined}
                        />
                        <StatCard
                            label="Rendimiento promedio"
                            value={hasRealized ? formatPercent(kpis.avgYieldPct) : 'N/D'}
                            context={hasRealized
                                ? `Producido sobre planificado.${deltaText(kpis.avgYieldPct, prev?.avgYieldPct) ? ` ${deltaText(kpis.avgYieldPct, prev?.avgYieldPct)}.` : ''}`
                                : 'Sin producciones finalizadas en el período.'}
                            tone={hasRealized ? yieldTone(kpis.avgYieldPct) : 'neutral'}
                        />
                        <StatCard
                            label="Tasa de finalización"
                            value={kpis.total > 0 ? formatPercent(kpis.completionRate) : 'N/D'}
                            context={kpis.total > 0
                                ? `${formatNumber(kpis.finished, 0)} de ${formatNumber(kpis.total, 0)} órdenes; ${formatNumber(kpis.cancelled, 0)} anuladas (${formatPercent(kpis.cancelRate)}); ${formatNumber(kpis.activeOrders, 0)} sin finalizar.`
                                : 'No hay órdenes en el período.'}
                            tone={kpis.total === 0 ? 'neutral' : kpis.completionRate >= 80 ? 'success' : kpis.completionRate >= 50 ? 'warning' : 'danger'}
                            action={kpis.activeOrders > 0 ? { label: 'Ver órdenes', onClick: () => navigate('/production-orders') } : undefined}
                        />
                    </div>

                    <div className={s.chartGrid}>
                        <section className={`${s.panel} ${s.panelWide}`} aria-label="Costo real vs estimado por día">
                            <header className={s.panelHead}><h3>Costo real vs estimado por día</h3><span>Costos y órdenes finalizadas por fecha de finalización</span></header>
                            {data.timeSeries.length === 0 ? (
                                <EmptyState title="Sin producciones finalizadas en el período" />
                            ) : (
                                <>
                                    <TrendChart
                                        buckets={data.timeSeries.map((d) => fmtDay(d.date))}
                                        current={data.timeSeries.map((d) => d.realCost)}
                                        previous={data.timeSeries.map((d) => d.estimatedCost)}
                                        previousLabel="Costo estimado"
                                        format={(v) => formatMoney(v)}
                                        ariaLabel="Costo real frente al estimado por día"
                                    />
                                    <TrendChart
                                        buckets={data.timeSeries.map((d) => fmtDay(d.date))}
                                        current={data.timeSeries.map((d) => d.orders)}
                                        previousLabel="Sin comparación"
                                        format={(v) => formatNumber(v, 0)}
                                        ariaLabel="Órdenes finalizadas por día"
                                    />
                                </>
                            )}
                        </section>

                        <section className={s.panel} aria-label="Órdenes por estado">
                            <header className={s.panelHead}><h3>Órdenes por estado</h3><span>Distribución del período</span></header>
                            {kpis.total === 0 ? (
                                <EmptyState title="Sin órdenes" />
                            ) : (
                                <DonutChart
                                    ariaLabel="Órdenes por estado"
                                    segments={data.statusBreakdown.filter(st => st.count > 0).map((st) => ({
                                        label: STATUS_META[st.status]?.label || st.status,
                                        share: st.count,
                                        tone: STATUS_META[st.status]?.color || 'var(--ui-text-muted)',
                                    }))}
                                />
                            )}
                        </section>
                    </div>

                    <section className={s.panel} aria-label="Top productos fabricados">
                        <header className={s.panelHead}><h3>Top productos fabricados</h3><span>Producción, costo y rendimiento</span></header>
                        <DataTable<ProducedRow>
                            ariaLabel="Top productos fabricados"
                            columns={producedColumns}
                            rows={data.topProduced}
                            rowKey={(p) => p.productId}
                            minWidth="40rem"
                            empty={<EmptyState title="Sin datos" />}
                        />
                    </section>

                    <div className={s.chartGrid}>
                        <section className={s.panel} aria-label="Comparativa por sucursal">
                            <header className={s.panelHead}><h3>Comparativa por sucursal</h3><span>Órdenes finalizadas y costo real</span></header>
                            {data.branchComparison.length === 0 ? (
                                <EmptyState icon={Building2} title="Sin datos por sucursal en el período" />
                            ) : data.branchComparison.length === 1 ? (
                                <dl className={s.facts}>
                                    <div><dt>Sucursal</dt><dd>{data.branchComparison[0].name}</dd></div>
                                    <div><dt>Órdenes finalizadas</dt><dd>{formatNumber(data.branchComparison[0].orders, 0)}</dd></div>
                                    <div><dt>Costo real</dt><dd>{formatMoney(data.branchComparison[0].realCost)}</dd></div>
                                </dl>
                            ) : (
                                <>
                                    <ParetoBars
                                        ariaLabel="Órdenes finalizadas por sucursal"
                                        items={toPareto(data.branchComparison.map((b) => ({ name: b.name, value: b.orders })), 50)}
                                        format={(v) => `${formatNumber(v, 0)} órdenes`}
                                    />
                                    <ParetoBars
                                        ariaLabel="Costo real por sucursal"
                                        items={toPareto(data.branchComparison.map((b) => ({ name: b.name, value: b.realCost })), 50)}
                                        format={(v) => formatMoney(v)}
                                    />
                                </>
                            )}
                        </section>

                        <section className={s.panel} aria-label="Producción por operario">
                            <header className={s.panelHead}><h3>Producción por operario</h3><span>Órdenes finalizadas por usuario</span></header>
                            <DataTable<OperatorRow>
                                ariaLabel="Producción por operario"
                                columns={operatorColumns}
                                rows={data.topOperators}
                                rowKey={(op) => op.userId}
                                minWidth="24rem"
                                empty={<EmptyState icon={Users} title="Sin producción por operario en el período" />}
                            />
                        </section>
                    </div>

                    <section className={s.panel} aria-label="Top insumos consumidos">
                        <header className={s.panelHead}><h3>Top insumos consumidos</h3><span>Por costo total</span></header>
                        <DataTable<ConsumedRow>
                            ariaLabel="Top insumos consumidos"
                            columns={consumedColumns}
                            rows={data.topConsumed}
                            rowKey={(c) => c.componentProductId}
                            minWidth="32rem"
                            empty={<EmptyState title="Sin consumos registrados" />}
                        />
                    </section>

                    <section className={s.panel} aria-label="Órdenes recientes">
                        <header className={s.panelHead}>
                            <h3>Órdenes recientes</h3>
                            <Button size="sm" variant="ghost" onClick={() => navigate('/production-orders')}>Ver todas</Button>
                        </header>
                        <DataTable<RecentRow>
                            ariaLabel="Órdenes recientes"
                            columns={recentColumns}
                            rows={data.recentOrders}
                            rowKey={(o) => o.id}
                            minWidth="40rem"
                            onRowClick={() => navigate('/production-orders')}
                            empty={
                                <EmptyState
                                    icon={Package}
                                    title="No hay órdenes de producción en el período"
                                    action={<Button variant="primary" onClick={() => navigate('/production-orders')}>Crear producción</Button>}
                                />
                            }
                        />
                    </section>
                </>
            )}
        </PageContent>
    );
}
