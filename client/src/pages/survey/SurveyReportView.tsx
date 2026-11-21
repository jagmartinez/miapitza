import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, Phone, Star } from 'lucide-react';
import CatalogTable, { type CatalogColumn } from '../../components/CatalogTable';
import {
    areaAverages, bestWaiter, detractorAlerts, fmtAvg, fmtNps, ineligibleLabel, npsTone, sortByResponses, trendPoints,
    type SurveyRanking, type SurveyRankingItem, type SurveyResponseRow, type SurveyResponsesPage, type SurveySummary, type SurveyWaiterRow,
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
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });

const waiterColumns: CatalogColumn<SurveyWaiterRow>[] = [
    { key: 'name', header: 'Mesero', render: (r) => r.name || '—' },
    { key: 'responses', header: 'Respuestas', align: 'right', render: (r) => r.responses },
    { key: 'avg', header: 'Atención (1-5)', align: 'right', render: (r) => fmtAvg(r.avgWaiter) },
    { key: 'nps', header: 'NPS', align: 'right', render: (r) => fmtNps(r.nps) },
];

const rankingColumns: CatalogColumn<SurveyRankingItem>[] = [
    { key: 'rank', header: '#', render: (r) => r.rank },
    { key: 'name', header: 'Mesero', render: (r) => r.name || '—' },
    { key: 'branch', header: 'Sucursal', render: (r) => r.branchName ?? '—' },
    { key: 'responses', header: 'Respuestas', align: 'right', render: (r) => r.responses },
    { key: 'avg', header: 'Atención (1-5)', align: 'right', render: (r) => fmtAvg(r.attentionAvg) },
    { key: 'score', header: 'Puntaje', align: 'right', render: (r) => r.score.toFixed(2) },
];

const responseColumns: CatalogColumn<SurveyResponseRow>[] = [
    { key: 'date', header: 'Fecha', render: (r) => dateTime(r.createdAt) },
    { key: 'branch', header: 'Sucursal', render: (r) => r.branchName },
    { key: 'waiter', header: 'Mesero', render: (r) => r.waiterName },
    { key: 'nps', header: 'NPS', align: 'right', render: (r) => <span className={`survey-nps survey-nps-${r.nps <= 6 ? 'detractor' : r.nps >= 9 ? 'promoter' : 'passive'}`}>{r.nps}</span> },
    { key: 'ratings', header: 'Aten./Comida/Espera/Amb.', render: (r) => [r.waiterRating, r.foodRating, r.waitRating, r.ambienceRating].map((v) => v ?? '–').join(' / ') },
    { key: 'comment', header: 'Comentario', render: (r) => r.comment ?? '' },
    { key: 'phone', header: 'Teléfono', render: (r) => r.contactPhone ?? '' },
];

export default function SurveyReportView({
    summary, ranking, alerts, responses, detractorsOnly, onToggleDetractors, onPageChange, showBranches,
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
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart data={trend}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="label" />
                                        <YAxis domain={[-100, 100]} />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="nps" name="NPS" stroke="var(--color-primary)" strokeWidth={2} connectNulls />
                                    </LineChart>
                                </ResponsiveContainer>
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
                        <h2>Mejor mesero del mes</h2>
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
                            <CatalogTable<SurveyRankingItem> columns={rankingColumns} rows={ranking.items} rowKey={(r) => r.userId} ariaLabel="Ranking de meseros" />
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
                        <h2>Alertas de detractores</h2>
                        {alertRows.length === 0 ? (
                            <p className="survey-muted">Sin detractores en el período.</p>
                        ) : (
                            <ul className="survey-alerts">
                                {alertRows.map((r) => (
                                    <li key={r.id}>
                                        <span className="survey-nps survey-nps-detractor">{r.nps}</span>
                                        <span className="survey-alert-main">{r.comment ?? 'Sin comentario'}<small>{r.waiterName} · {r.branchName} · {dateTime(r.createdAt)}</small></span>
                                        {r.contactPhone && <span className="survey-alert-phone"><Phone size={14} aria-hidden="true" /> {r.contactPhone}</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section className="survey-section">
                        <h2>Resultados por mesero</h2>
                        <CatalogTable<SurveyWaiterRow> columns={waiterColumns} rows={sortByResponses(summary.byWaiter)} rowKey={(r) => r.userId} ariaLabel="Resultados por mesero" />
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
                <CatalogTable<SurveyResponseRow>
                    columns={responseColumns}
                    rows={responses.items}
                    rowKey={(r) => r.id}
                    ariaLabel="Respuestas de encuesta"
                    emptyLabel="Sin respuestas"
                    pagination={{
                        page: responses.page,
                        totalPages: Math.max(1, Math.ceil(responses.total / responses.pageSize)),
                        totalItems: responses.total,
                        pageSize: responses.pageSize,
                        onPageChange,
                    }}
                />
            </section>
        </div>
    );
}
