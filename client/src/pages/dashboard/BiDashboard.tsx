import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    AppSelect, Badge, Button, DataTable, DateInput, EmptyState, Field, LoadErrorState, PageContent, PageHeader,
    SegmentedControl, Skeleton, StatCard, Tabs, formatMoney, formatNumber, formatPercent, type Column, type Opt, type Tone,
} from '@/ui';
import { DonutChart, Heatmap, InsightList, ParetoBars, Sparkline, TrendChart, WaterfallChart } from '@/ui/charts';
import { branchesAPI } from '../../services/api';
import {
    biAPI, type BiCompare, type BiParams, type BiPeriod, type BiSummary, type BiTrendMetric, type BranchRow, type Money, type TrafficLight,
} from '../../services/bi';
import { LiveOperations } from './LiveOperations';
import { loadSavedViews, saveView, useBiFilters, type SavedView } from './useBiFilters';
import { useSection } from './useSection';
import './bi-dashboard.css';

const PERIOD_OPTIONS: { value: BiPeriod; label: string }[] = [
    { value: 'today', label: 'Hoy' },
    { value: '7d', label: '7 días' },
    { value: '30d', label: '30 días' },
    { value: '12m', label: '12 meses' },
    { value: 'custom', label: 'Personalizado' },
];
const COMPARE_OPTIONS: Opt<BiCompare>[] = [
    { value: 'previous', label: 'Periodo anterior' },
    { value: 'year', label: 'Mismo periodo del año anterior' },
];
const METRIC_OPTIONS: Opt<BiTrendMetric>[] = [
    { value: 'netSales', label: 'Venta neta' },
    { value: 'grossMargin', label: 'Margen bruto' },
    { value: 'orders', label: 'Órdenes' },
    { value: 'avgTicket', label: 'Ticket promedio' },
];
const CHANNEL_TONES = ['var(--ui-primary)', 'var(--ui-warning)', 'var(--ui-success)', 'var(--ui-danger)'];
const WEEKDAYS: Record<number, string> = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };
const LIGHT_TONE: Record<TrafficLight, Tone> = { ok: 'success', warn: 'warning', bad: 'danger' };
const LIGHT_LABEL: Record<TrafficLight, string> = { ok: 'En meta', warn: 'Atención', bad: 'Fuera de meta' };

const money0 = (v: number) => formatMoney(v, 'C$', 0);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Section({ id, title, description, actions, children }: {
    id: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
    return (
        <section className="bi-section" aria-labelledby={id}>
            <header className="bi-section__head">
                <div className="bi-section__text">
                    <h2 id={id} className="bi-section__title">{title}</h2>
                    {description ? <p className="bi-muted">{description}</p> : null}
                </div>
                {actions ? <div className="bi-section__actions">{actions}</div> : null}
            </header>
            {children}
        </section>
    );
}

/** Cuerpo de una sección: esqueleto al cargar, error recuperable o contenido. */
function Body<T>({ state, height = 180, children }: {
    state: { data: T | null; loading: boolean; error: string | null; reload(): void };
    height?: number;
    children(data: T): ReactNode;
}) {
    if (state.error && !state.data) return <LoadErrorState message={state.error} onRetry={state.reload} />;
    if (!state.data) return <Skeleton height={height} />;
    return (
        <div className={state.loading ? 'bi-body is-refreshing' : 'bi-body'} aria-busy={state.loading || undefined}>
            {state.error ? <LoadErrorState message={`${state.error} Se muestran los últimos datos.`} onRetry={state.reload} /> : null}
            {children(state.data)}
        </div>
    );
}

function deltaText(m: Money, compare: BiCompare): string {
    if (m.deltaPct === null) return 'Sin comparación';
    const sign = m.deltaPct > 0 ? '+' : '';
    return `${sign}${formatPercent(m.deltaPct)} vs ${compare === 'year' ? 'año anterior' : 'periodo anterior'}`;
}

/** Semáforo de una meta de "más es mejor": verde en meta, ámbar hasta 10 % por debajo. */
function atLeast(value: number, goal: number): Tone {
    if (!(goal > 0)) return 'neutral';
    return value >= goal ? 'success' : value >= goal * 0.9 ? 'warning' : 'danger';
}
/** Semáforo de una meta "menos es mejor" en puntos porcentuales (misma regla del servidor: +2 pts). */
function atMost(value: number, goal: number): Tone {
    if (!(goal > 0)) return 'neutral';
    return value <= goal ? 'success' : value <= goal + 2 ? 'warning' : 'danger';
}

function KpiContext({ lines, spark, tone }: { lines: string[]; spark?: number[]; tone?: Tone }) {
    return (
        <span className="bi-kpi__context">
            <span className="bi-kpi__lines">{lines.map((l) => <span key={l}>{l}</span>)}</span>
            {spark && spark.length > 1 ? <Sparkline values={spark} tone={tone ?? 'primary'} /> : null}
        </span>
    );
}

function Kpis({ s, compare }: { s: BiSummary; compare: BiCompare }) {
    const g = s.goals;
    const laborQ = s.dataQuality.labor;
    const coveragePct = formatPercent(s.dataQuality.laborCoverage * 100);
    const gapPts = s.foodCostRealPct.current - s.foodCostTheoreticalPct.current;
    const sparkGap = s.spark.foodCostGapPts.filter((v): v is number => v !== null);
    const salesTone = atLeast(s.netSales.current, g.periodSales);
    const marginTone = atLeast(s.grossMarginPct.current, g.grossMarginPct);
    const ticketTone = atLeast(s.avgTicket.current, g.avgTicket);

    return (
        <div className="bi-kpis">
            <StatCard
                label="Venta neta"
                value={formatMoney(s.netSales.current)}
                tone={salesTone}
                context={<KpiContext tone={salesTone} spark={s.spark.netSales} lines={[
                    deltaText(s.netSales, compare),
                    g.periodSales > 0 ? `Meta ${formatMoney(g.periodSales)} · avance ${formatPercent((s.netSales.current / g.periodSales) * 100)}` : 'Sin meta configurada',
                ]} />}
                action={g.periodSales > 0 ? undefined : { label: 'Configurar metas', to: '/settings' }}
            />
            <StatCard
                label="Margen bruto"
                value={formatPercent(s.grossMarginPct.current)}
                tone={marginTone}
                context={<KpiContext tone={marginTone} spark={s.spark.grossMarginPct} lines={[
                    deltaText(s.grossMarginPct, compare),
                    g.grossMarginPct > 0 ? `Meta ${formatPercent(g.grossMarginPct)}` : 'Sin meta configurada',
                ]} />}
            />
            <StatCard
                label="Ticket promedio"
                value={formatMoney(s.avgTicket.current)}
                tone={ticketTone}
                context={<KpiContext tone={ticketTone} spark={s.spark.avgTicket} lines={[
                    deltaText(s.avgTicket, compare),
                    g.avgTicket > 0 ? `Meta ${formatMoney(g.avgTicket)}` : 'Sin meta configurada',
                ]} />}
            />
            {laborQ === 'unavailable' ? (
                <StatCard
                    label="Costo de personal"
                    value="N/D"
                    context="Sin nómina aprobada que cubra el periodo; se excluye de la utilidad."
                    action={{ label: 'Ver nómina', to: '/rh/nomina' }}
                />
            ) : (
                <StatCard
                    label="Costo de personal"
                    value={formatPercent(s.laborCostPct.current)}
                    tone={laborQ === 'partial' ? 'warning' : atMost(s.laborCostPct.current, g.laborCostMaxPct)}
                    context={<KpiContext
                        tone={laborQ === 'partial' ? 'warning' : atMost(s.laborCostPct.current, g.laborCostMaxPct)}
                        spark={s.spark.laborCostPct}
                        lines={[
                            laborQ === 'partial' ? `Parcial: la nómina cubre ${coveragePct} del periodo` : deltaText(s.laborCostPct, compare),
                            g.laborCostMaxPct > 0 ? `Tope ${formatPercent(g.laborCostMaxPct)}` : 'Sin tope configurado',
                        ]}
                    />}
                />
            )}
            {s.foodCostGapAmount === null ? (
                <StatCard
                    label="Costo real vs teórico"
                    value="N/D"
                    context="Hay platos vendidos con receta sin costo calculable; la brecha no es comparable."
                    action={{ label: 'Revisar recetas', to: '/cost-report' }}
                />
            ) : (
                <StatCard
                    label="Costo real vs teórico"
                    value={formatMoney(s.foodCostGapAmount)}
                    tone={atMost(gapPts, g.foodCostGapPts)}
                    context={<KpiContext tone={atMost(gapPts, g.foodCostGapPts)} spark={sparkGap} lines={[
                        `Real ${formatPercent(s.foodCostRealPct.current)} · teórico ${formatPercent(s.foodCostTheoreticalPct.current)}`,
                        g.foodCostGapPts > 0 ? `Brecha ${formatNumber(gapPts)} pts · meta ${formatNumber(g.foodCostGapPts)} pts` : `Brecha ${formatNumber(gapPts)} pts`,
                    ]} />}
                    action={{ label: 'Ver costos', to: '/cost-report' }}
                />
            )}
            {laborQ === 'unavailable' ? (
                <StatCard
                    label="Utilidad operativa"
                    value="N/D"
                    context="Requiere el costo de personal del periodo."
                    action={{ label: 'Ver nómina', to: '/rh/nomina' }}
                />
            ) : (
                <StatCard
                    label="Utilidad operativa"
                    value={formatMoney(s.operatingProfit.current)}
                    tone={laborQ === 'partial' ? 'warning' : s.operatingProfit.current < 0 ? 'danger' : atLeast(s.operatingMarginPct.current, g.operatingMarginPct)}
                    context={<KpiContext
                        tone={s.operatingProfit.current < 0 ? 'danger' : 'primary'}
                        spark={s.spark.operatingProfit}
                        lines={[
                            laborQ === 'partial' ? `Parcial: nómina cubre ${coveragePct} del periodo` : deltaText(s.operatingProfit, compare),
                            g.operatingMarginPct > 0
                                ? `Margen ${formatPercent(s.operatingMarginPct.current)} · meta ${formatPercent(g.operatingMarginPct)}`
                                : `Margen ${formatPercent(s.operatingMarginPct.current)}`,
                        ]}
                    />}
                />
            )}
        </div>
    );
}

export default function BiDashboard() {
    const filters = useBiFilters();
    const navigate = useNavigate();
    const location = useLocation();
    const [tab, setTab] = useState<'resumen' | 'live'>('resumen');
    const [metric, setMetric] = useState<BiTrendMetric>('netSales');
    const [views, setViews] = useState<SavedView[]>(() => loadSavedViews());
    const [branches, setBranches] = useState<Opt<number>[]>([]);
    const [branchesFailed, setBranchesFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        branchesAPI.getAll()
            .then((res: { data: { data: { id: number; name: string }[] } }) => {
                if (alive) setBranches((res.data.data ?? []).map((b) => ({ value: b.id, label: b.name })));
            })
            .catch(() => { if (alive) setBranchesFailed(true); });
        return () => { alive = false; };
    }, []);

    const branchKey = filters.branchIds.join(',');
    const params: BiParams = useMemo(
        () => ({ period: filters.period, compare: filters.compare, branchIds: filters.branchIds, from: filters.from, to: filters.to }),
        // branchKey representa el contenido de branchIds.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filters.period, filters.compare, branchKey, filters.from, filters.to],
    );
    const key = [params.period, params.compare, branchKey, params.from ?? '', params.to ?? ''];
    const on = filters.ready && tab === 'resumen';

    const summary = useSection((s) => biAPI.summary(params, s), key, 'No se pudieron cargar los indicadores.', on);
    const trend = useSection((s) => biAPI.trend(params, metric, s), [...key, metric], 'No se pudo cargar la tendencia.', on);
    const insights = useSection((s) => biAPI.insights(params, s), key, 'No se pudieron cargar los hallazgos.', on);
    const bridge = useSection((s) => biAPI.bridge(params, s), key, 'No se pudo cargar el puente de utilidad.', on);
    const channels = useSection((s) => biAPI.channels(params, s), key, 'No se pudo cargar la mezcla por canal.', on);
    const heatmap = useSection((s) => biAPI.heatmap(params, s), key, 'No se pudo cargar el mapa de calor.', on);
    const pareto = useSection((s) => biAPI.pareto(params, 10, s), key, 'No se pudo cargar el Pareto de margen.', on);
    const branchRows = useSection((s) => biAPI.branches(params, s), key, 'No se pudo cargar el comparativo de sucursales.', on);

    const previousLabel = params.compare === 'year' ? 'Mismo periodo del año anterior' : 'Periodo anterior';
    const metricLabel = METRIC_OPTIONS.find((m) => m.value === metric)?.label ?? 'Venta neta';

    const currentQuery = useMemo(() => {
        const q = new URLSearchParams({ period: params.period, compare: params.compare });
        if (branchKey) q.set('branches', branchKey);
        if (params.period === 'custom' && params.from) { q.set('from', params.from); if (params.to) q.set('to', params.to); }
        return q.toString();
    }, [params.period, params.compare, params.from, params.to, branchKey]);

    const viewName = () => {
        const period = PERIOD_OPTIONS.find((p) => p.value === params.period)?.label ?? params.period;
        const cmp = params.compare === 'year' ? 'vs año anterior' : 'vs periodo anterior';
        const names = branches.filter((b) => params.branchIds.includes(b.value)).map((b) => b.label).join(', ');
        return `${period} · ${cmp} · ${names || 'Todas las sucursales'}`;
    };

    const branchColumns: Column<BranchRow>[] = [
        { key: 'name', header: 'Sucursal', width: '2fr' },
        { key: 'netSales', header: 'Venta neta', type: 'money', width: '1.5fr' },
        {
            key: 'deltaPct', header: 'Vs comparación', type: 'percent', width: '1.3fr',
            render: (r) => (r.deltaPct === null ? 'Sin comparación' : formatPercent(r.deltaPct)),
        },
        { key: 'avgTicket', header: 'Ticket promedio', type: 'money', width: '1.3fr', hideBelow: 'md' },
        {
            key: 'foodCostPct', header: 'Costo de alimentos', type: 'percent', width: '1.6fr',
            render: (r) => (
                <span className="bi-cell-light">
                    {formatPercent(r.foodCostPct)}
                    <Badge tone={LIGHT_TONE[r.status.foodCost]} dot>{LIGHT_LABEL[r.status.foodCost]}</Badge>
                </span>
            ),
        },
        {
            key: 'laborCostPct', header: 'Personal', type: 'percent', width: '1.6fr',
            render: (r) => (r.laborCostPct === null || r.status.labor === 'nd' ? (
                <span className="bi-cell-light">N/D<Badge tone="neutral">Sin nómina</Badge></span>
            ) : (
                <span className="bi-cell-light">
                    {formatPercent(r.laborCostPct)}{r.laborQuality === 'partial' ? ' (parcial)' : ''}
                    <Badge tone={LIGHT_TONE[r.status.labor]} dot>{LIGHT_LABEL[r.status.labor]}</Badge>
                </span>
            )),
        },
        {
            key: 'operatingMarginPct', header: 'Margen operativo', type: 'percent', width: '1.4fr', hideBelow: 'lg',
            render: (r) => (r.operatingMarginPct === null ? 'N/D' : formatPercent(r.operatingMarginPct)),
        },
        {
            key: 'salesPerSqm', header: 'Venta por m²', type: 'money', width: '1.3fr', hideBelow: 'lg',
            render: (r) => (r.salesPerSqm === null ? 'N/D' : formatMoney(r.salesPerSqm)),
        },
    ];

    return (
        <PageContent>
            <PageHeader
                title="Dashboard"
                description="Indicadores del negocio contra metas, con comparación y hallazgos por impacto en C$."
                actions={(
                    <>
                        {views.length > 0 ? (
                            <div className="bi-views">
                                <AppSelect<string>
                                    aria-label="Vistas guardadas"
                                    placeholder="Vistas guardadas"
                                    isClearable
                                    size="sm"
                                    options={views.map((v) => ({ value: v.query, label: v.name }))}
                                    value={views.find((v) => v.query === currentQuery)?.query ?? null}
                                    onChange={(q) => { if (q) navigate({ pathname: location.pathname, search: `?${q}` }, { replace: true }); }}
                                />
                            </div>
                        ) : null}
                        <Button onClick={() => setViews(saveView(viewName(), currentQuery))}>Guardar vista</Button>
                    </>
                )}
            />

            <div className="bi-filters" role="group" aria-label="Filtros del dashboard">
                <SegmentedControl<BiPeriod>
                    ariaLabel="Periodo"
                    size="sm"
                    options={PERIOD_OPTIONS}
                    value={filters.period}
                    onChange={(period) => filters.set({ period })}
                />
                {filters.period === 'custom' ? (
                    <>
                        <Field label="Desde" htmlFor="bi-from">
                            <DateInput id="bi-from" value={filters.from ?? ''} max={filters.to || undefined} onChange={(e) => filters.set({ from: e.target.value })} />
                        </Field>
                        <Field label="Hasta" htmlFor="bi-to">
                            <DateInput id="bi-to" value={filters.to ?? ''} min={filters.from || undefined} onChange={(e) => filters.set({ to: e.target.value })} />
                        </Field>
                    </>
                ) : null}
                <div className="bi-filters__select">
                    <AppSelect<BiCompare>
                        aria-label="Comparar con"
                        size="sm"
                        options={COMPARE_OPTIONS}
                        value={filters.compare}
                        onChange={(compare) => { if (compare) filters.set({ compare }); }}
                    />
                </div>
                <div className="bi-filters__select bi-filters__select--wide">
                    <AppSelect<number>
                        kind="multi"
                        aria-label="Sucursales"
                        size="sm"
                        placeholder={branchesFailed ? 'Sucursales no disponibles' : 'Todas las sucursales'}
                        isDisabled={branchesFailed}
                        options={branches}
                        value={filters.branchIds}
                        onChange={(branchIds) => filters.set({ branchIds })}
                    />
                </div>
            </div>

            <Tabs
                ariaLabel="Secciones del dashboard"
                active={tab}
                onChange={(id) => setTab(id as 'resumen' | 'live')}
                tabs={[{ id: 'resumen', label: 'Resumen' }, { id: 'live', label: 'Operación en vivo' }]}
            />

            {tab === 'live' ? <LiveOperations /> : !filters.ready ? (
                <EmptyState title="Elige la fecha inicial" description="El periodo personalizado necesita al menos la fecha desde." />
            ) : (
                <>
                    <div aria-label="Indicadores" role="region">
                        {summary.error && !summary.data ? (
                            <section className="bi-section"><LoadErrorState message={summary.error} onRetry={summary.reload} /></section>
                        ) : !summary.data ? (
                            <div className="bi-kpis">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={132} />)}</div>
                        ) : (
                            <div className={summary.loading ? 'bi-body is-refreshing' : 'bi-body'}>
                                {summary.error ? <LoadErrorState message={`${summary.error} Se muestran los últimos datos.`} onRetry={summary.reload} /> : null}
                                {summary.data.warnings.length > 0 ? (
                                    <ul className="bi-notice" role="status">
                                        {summary.data.warnings.map((w) => <li key={w}>{w}</li>)}
                                    </ul>
                                ) : null}
                                <Kpis s={summary.data} compare={params.compare} />
                            </div>
                        )}
                    </div>

                    <div className="bi-grid">
                        <Section
                            id="bi-trend"
                            title="Tendencia"
                            actions={(
                                <div className="bi-section__select">
                                    <AppSelect<BiTrendMetric>
                                        aria-label="Métrica de la tendencia"
                                        size="sm"
                                        options={METRIC_OPTIONS}
                                        value={metric}
                                        onChange={(m) => { if (m) setMetric(m); }}
                                    />
                                </div>
                            )}
                        >
                            <Body state={trend} height={240}>
                                {(t) => (
                                    <TrendChart
                                        buckets={t.buckets}
                                        current={t.current}
                                        previous={t.previous}
                                        goal={t.goal}
                                        format={metric === 'orders' ? (v) => formatNumber(v, 0) : money0}
                                        ariaLabel={`${metricLabel} por periodo`}
                                        previousLabel={previousLabel}
                                    />
                                )}
                            </Body>
                        </Section>

                        <Section id="bi-insights" title="Hallazgos" description="Ordenados por impacto en C$.">
                            <Body state={insights} height={240}>{(items) => <InsightList items={items} />}</Body>
                        </Section>
                    </div>

                    <div className="bi-grid">
                        <Section id="bi-bridge" title="De la venta a la utilidad" description="Puente de la venta bruta a la utilidad operativa.">
                            <Body state={bridge} height={240}>{(steps) => <WaterfallChart steps={steps} />}</Body>
                        </Section>

                        <Section id="bi-channels" title="Mezcla por canal">
                            <Body state={channels}>
                                {(rows) => (
                                    <div className="bi-stack">
                                        <DonutChart
                                            ariaLabel="Mezcla de venta neta por canal"
                                            segments={rows.map((c, i) => ({ label: c.label, share: c.sharePct, tone: CHANNEL_TONES[i % CHANNEL_TONES.length] }))}
                                        />
                                        {rows.length > 0 ? (
                                            <DataTable
                                                ariaLabel="Margen por canal"
                                                rows={rows}
                                                rowKey={(r) => r.channel}
                                                minWidth="0"
                                                columns={[
                                                    { key: 'label', header: 'Canal', width: '2fr' },
                                                    { key: 'netSales', header: 'Venta neta', type: 'money', width: '2fr' },
                                                    { key: 'netMarginPct', header: 'Margen neto', type: 'percent', width: '1.5fr' },
                                                ] satisfies Column<(typeof rows)[number]>[]}
                                            />
                                        ) : null}
                                    </div>
                                )}
                            </Body>
                        </Section>
                    </div>

                    <div className="bi-grid">
                        <Section id="bi-heatmap" title="Ventas por día y hora" description="Promedio de venta por ocurrencia de cada día.">
                            <Body state={heatmap} height={240}>
                                {(h) => (
                                    <Heatmap
                                        rows={h.days.map((d) => ({ label: d.label, values: d.values }))}
                                        columns={h.hours.map(hourLabel)}
                                        format={(v) => formatMoney(v)}
                                        caption={h.days.some((d) => d.values.some((v) => v > 0))
                                            ? `Pico: ${WEEKDAYS[h.peak.weekday] ?? ''} ${hourLabel(h.peak.hour)} · Valle: ${WEEKDAYS[h.valley.weekday] ?? ''} ${hourLabel(h.valley.hour)}`
                                            : undefined}
                                    />
                                )}
                            </Body>
                        </Section>

                        <Section id="bi-pareto" title="Pareto de margen por plato">
                            <Body state={pareto} height={240}>
                                {(p) => (
                                    <div className="bi-stack">
                                        {p.totalItems > 0 ? (
                                            <p className="bi-muted">
                                                {formatNumber(p.itemsFor80Pct, 0)} de {formatNumber(p.totalItems, 0)} platos generan el 80 % del margen.
                                            </p>
                                        ) : null}
                                        {p.unavailableItems > 0 ? (
                                            <p className="bi-notice" role="status">
                                                {formatNumber(p.unavailableItems, 0)} platos vendidos no tienen costo de receta (N/D) y quedan fuera del ranking.
                                            </p>
                                        ) : null}
                                        <ParetoBars
                                            items={p.items.map((i) => ({ name: i.name, value: i.margin, cumulativePct: i.cumulativePct }))}
                                            format={(v) => formatMoney(v)}
                                        />
                                    </div>
                                )}
                            </Body>
                        </Section>
                    </div>

                    <Section id="bi-branches" title="Comparativo de sucursales" description="El semáforo usa la meta de cada sucursal.">
                        {branchRows.error && !branchRows.data ? (
                            <LoadErrorState message={branchRows.error} onRetry={branchRows.reload} />
                        ) : (
                            <DataTable
                                ariaLabel="Comparativo de sucursales"
                                columns={branchColumns}
                                rows={branchRows.data ?? []}
                                rowKey={(r) => r.branchId}
                                loading={branchRows.loading && !branchRows.data}
                                resetKey={key.join('|')}
                                minWidth="0"
                                empty={<EmptyState title="Sin sucursales en el periodo" />}
                            />
                        )}
                    </Section>
                </>
            )}
        </PageContent>
    );
}
