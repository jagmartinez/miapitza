import { Award, Phone, Star } from 'lucide-react';
import { Button, DataTable, formatNumber, type Column } from '@/ui';
import {
    areaAverages, bestWaiter, detractorAlerts, fmtAvg, fmtNps, ineligibleLabel, monthLabel, npsTone, trendPoints,
    type SurveyRanking, type SurveyRankingItem, type SurveyResponseRow, type SurveyResponsesPage, type SurveySummary,
} from '../../utils/surveyReport';
import './SurveyReport.css';

export interface SurveyReportViewProps {
    summary: SurveySummary;
    ranking: SurveyRanking | null;
    alerts: SurveyResponseRow[];
    responses: SurveyResponsesPage;
    detractorsOnly: boolean;
    onToggleDetractors: (value: boolean) => void;
    onPageChange: (page: number) => void;
    showBranches: boolean;
    responsesError?: string | null;
    onRetryResponses?: () => void;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });

const rankingColumns: Column<SurveyRankingItem>[] = [
    { key: 'rank', header: '#', render: (r) => r.rank },
    { key: 'name', header: 'Mesero', render: (r) => r.name || '—' },
    { key: 'branch', header: 'Sucursal', render: (r) => r.branchName ?? '—' },
    { key: 'responses', header: 'Respuestas', type: 'number', render: (r) => r.responses },
    { key: 'avg', header: 'Atención (1-5)', type: 'number', render: (r) => fmtAvg(r.attentionAvg) },
    { key: 'nps', header: 'NPS', type: 'number', render: (r) => fmtNps(r.nps) },
    { key: 'score', header: 'Puntaje', type: 'number', render: (r) => formatNumber(r.score, 2) },
];

const responseColumns: Column<SurveyResponseRow>[] = [
    { key: 'date', header: 'Fecha', render: (r) => dateTime(r.createdAt) },
    { key: 'branch', header: 'Sucursal', render: (r) => r.branchName },
    { key: 'waiter', header: 'Mesero', render: (r) => r.waiterName },
    { key: 'nps', header: 'NPS', type: 'number', render: (r) => <span className={`survey-nps survey-nps-${r.nps <= 6 ? 'detractor' : r.nps >= 9 ? 'promoter' : 'passive'}`}>{r.nps}</span> },
    { key: 'ratings', header: 'Aten./Comida/Espera/Amb.', render: (r) => [r.waiterRating, r.foodRating, r.waitRating, r.ambienceRating].map((v) => v ?? '–').join(' / ') },
    { key: 'comment', header: 'Comentario', render: (r) => r.comment ?? '' },
    { key: 'phone', header: 'Teléfono', render: (r) => r.contactPhone ?? '' },
];

const CHART_W = 640;
const CHART_H = 220;
const PAD = { left: 40, right: 12, top: 10, bottom: 26 };

/** NPS va de -100 a 100: línea SVG propia con el eje simétrico (los gráficos de @/ui parten de 0). */
function NpsTrendChart({ points }: { points: { label: string; nps: number | null }[] }) {
    if (points.length === 0) return <p className="ui-chart__empty">Sin datos en el periodo</p>;
    const pw = CHART_W - PAD.left - PAD.right;
    const ph = CHART_H - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (points.length === 1 ? pw / 2 : (i * pw) / (points.length - 1));
    const y = (v: number) => PAD.top + ((100 - Math.max(-100, Math.min(100, v))) / 200) * ph;
    const segments: string[] = [];
    let current = '';
    points.forEach((p, i) => {
        if (p.nps === null || !Number.isFinite(p.nps)) return;
        current += `${current ? ' L' : 'M'}${x(i).toFixed(1)} ${y(p.nps).toFixed(1)}`;
    });
    if (current) segments.push(current);
    const step = Math.max(1, Math.ceil(points.length / 6));
    return (
        <svg className="survey-trend-svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} focusable="false" aria-hidden="true">
            {[-100, -50, 0, 50, 100].map((t) => (
                <g key={t}>
                    <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--ui-border)" strokeDasharray={t === 0 ? undefined : '3 3'} />
                    <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--ui-text-muted)">{t}</text>
                </g>
            ))}
            {segments.map((d) => <path key={d} d={d} fill="none" stroke="var(--ui-primary)" strokeWidth={2} />)}
            {points.map((p, i) => (
                <g key={p.label + i}>
                    {p.nps !== null && Number.isFinite(p.nps) && (
                        <circle cx={x(i)} cy={y(p.nps)} r={3} fill="var(--ui-primary)"><title>{`${p.label}: NPS ${p.nps}`}</title></circle>
                    )}
                    {i % step === 0 && <text x={x(i)} y={CHART_H - 6} textAnchor="middle" fontSize="11" fill="var(--ui-text-muted)">{p.label}</text>}
                </g>
            ))}
        </svg>
    );
}

export default function SurveyReportView({
    summary, ranking, alerts, responses, detractorsOnly, onToggleDetractors, onPageChange, showBranches, responsesError, onRetryResponses,
}: SurveyReportViewProps) {
    const tone = npsTone(summary.nps);
    const areas = areaAverages(summary);
    const rated = areas.filter((a) => a.value !== null);
    const weakest = rated.length > 1 ? rated.reduce((min, a) => ((a.value as number) < (min.value as number) ? a : min)) : null;
    const best = bestWaiter(ranking);
    const trend = trendPoints(summary.trend);
    const alertRows = detractorAlerts(alerts);
    const empty = summary.responses === 0;

    return (
        <div className="survey-report">
            {empty && <p className="survey-empty" role="status">Sin respuestas en el período</p>}

            <div className="kpi-grid">
                <div className={`kpi-card kpi-${tone}`}>
                    <div className="kpi-label">NPS</div>
                    <div className="kpi-value">{fmtNps(summary.nps)}</div>
                    <div className="kpi-detail">{summary.promoters} promotores · {summary.detractors} detractores</div>
                </div>
                <div className="kpi-card kpi-neutral">
                    <div className="kpi-label">Respuestas</div>
                    <div className="kpi-value">{summary.responses}</div>
                </div>
                {areas.map((a) => (
                    <div key={a.key} className={`kpi-card ${a === weakest ? 'kpi-warning' : 'kpi-neutral'}`}>
                        <div className="kpi-label">{a.label}</div>
                        <div className="kpi-value">{fmtAvg(a.value)}</div>
                        {a === weakest && <div className="kpi-detail">Punto a mejorar</div>}
                    </div>
                ))}
            </div>

            {!empty && (
                <>
                    <div className="survey-split">
                        <section className="survey-section">
                            <h2>Tendencia semanal de NPS</h2>
                            <div className="survey-chart" role="img" aria-label="Tendencia semanal de NPS">
                                <NpsTrendChart points={trend} />
                            </div>
                        </section>
                        <section className="survey-section">
                            <h2>Calificación por área</h2>
                            <ul className="survey-bars">
                                {areas.map((a) => (
                                    <li key={a.key}>
                                        <span className="survey-bar-label">{a.label}</span>
                                        <span className="survey-bar-track"><span className={`survey-bar-fill${a === weakest ? ' is-weak' : ''}`} style={{ width: `${((a.value ?? 0) / 5) * 100}%` }} /></span>
                                        <span className="survey-bar-value">{fmtAvg(a.value)}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>

                    <section className="survey-section">
                        <h2>Mejor mesero de {ranking ? monthLabel(ranking.month) : 'el mes'}</h2>
                        {best ? (
                            <p className="survey-best">
                                <Award size={22} aria-hidden="true" />
                                <strong>{best.name}</strong>
                                <span><Star size={14} aria-hidden="true" /> {fmtAvg(best.attentionAvg)} en atención · {best.responses} opiniones · NPS {fmtNps(best.nps)}</span>
                            </p>
                        ) : (
                            <p className="survey-muted">Aún no hay meseros con opiniones suficientes este mes.</p>
                        )}
                        {ranking && ranking.items.length > 0 && (
                            <DataTable<SurveyRankingItem> columns={rankingColumns} rows={ranking.items} rowKey={(r) => r.userId} ariaLabel="Ranking de meseros" pagination={{ mode: 'client' }} />
                        )}
                        {ranking && ranking.ineligible.length > 0 && (
                            <ul className="survey-ineligible">
                                {ranking.ineligible.map((w) => (
                                    <li key={w.userId}><strong>{w.name || '—'}</strong> <span>{ineligibleLabel(w, ranking.minResponses)}</span></li>
                                ))}
                            </ul>
                        )}
                    </section>

                    {showBranches && summary.byBranch.length > 1 && (
                        <section className="survey-section">
                            <h2>Comparativo por sucursal</h2>
                            <ul className="survey-branches">
                                {summary.byBranch.map((b) => (
                                    <li key={b.branchId}>
                                        <span>{b.name}</span>
                                        <span>{b.responses} respuestas</span>
                                        <span className={`survey-nps-text kpi-${npsTone(b.nps)}`}>NPS {fmtNps(b.nps)}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    <section className="survey-section">
                        <h2>Alertas de detractores <small className="survey-muted">(últimos con teléfono primero)</small></h2>
                        {alertRows.length === 0 ? (
                            <p className="survey-muted">Sin detractores en el período.</p>
                        ) : (
                            <ul className="survey-alerts">
                                {alertRows.map((r) => (
                                    <li key={r.id}>
                                        <span className="survey-nps survey-nps-detractor">{r.nps}</span>
                                        <span className="survey-alert-main">{r.comment ?? 'Sin comentario'}<small>{r.waiterName} · {r.branchName} · {dateTime(r.createdAt)}</small></span>
                                        {r.contactPhone && <span className="survey-alert-phone"><Phone size={14} aria-hidden="true" /> <a href={`tel:${r.contactPhone}`}>{r.contactPhone}</a></span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}

            <section className="survey-section">
                <div className="survey-section-head">
                    <h2>Respuestas</h2>
                    <label className="survey-toggle">
                        <input type="checkbox" checked={detractorsOnly} onChange={(e) => onToggleDetractors(e.target.checked)} />
                        Solo detractores
                    </label>
                </div>
                {responsesError && (
                    <p className="state-error" role="alert">
                        {responsesError} <Button variant="ghost" size="sm" onClick={onRetryResponses}>Reintentar</Button>
                    </p>
                )}
                <DataTable<SurveyResponseRow>
                    columns={responseColumns}
                    rows={responses.items}
                    rowKey={(r) => r.id}
                    ariaLabel="Respuestas de encuesta"
                    empty="Sin respuestas"
                    pagination={{
                        mode: 'server',
                        page: responses.page,
                        pageSize: responses.pageSize,
                        total: responses.total,
                        onChange: (page) => onPageChange(page),
                    }}
                    pageSizeOptions={[responses.pageSize]}
                />
            </section>
        </div>
    );
}
