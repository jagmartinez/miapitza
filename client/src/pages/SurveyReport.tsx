import { useCallback, useEffect, useState } from 'react';
import { Building2, Calendar, MessageSquare } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Select from '../components/Select';
import { branchesAPI, surveysAPI } from '../services/api';
import { monthRange, rankingMonth, type SurveyRanking, type SurveyResponseRow, type SurveyResponsesPage, type SurveySummary } from '../utils/surveyReport';
import type { Branch } from '../types';
import SurveyReportView from './survey/SurveyReportView';

const PAGE_SIZE = 20;
const ALL = 'Todas las Sucursales';

export default function SurveyReport() {
    const [filters, setFilters] = useState({ ...monthRange(), branchId: '' });
    const [branches, setBranches] = useState<Branch[]>([]);
    const [summary, setSummary] = useState<SurveySummary | null>(null);
    const [ranking, setRanking] = useState<SurveyRanking | null>(null);
    const [alerts, setAlerts] = useState<SurveyResponseRow[]>([]);
    const [responses, setResponses] = useState<SurveyResponsesPage>({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE });
    const [detractorsOnly, setDetractorsOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [responsesError, setResponsesError] = useState<string | null>(null);
    const [retryTick, setRetryTick] = useState(0);

    useEffect(() => {
        branchesAPI.getAll().then((r) => setBranches(r.data.data || [])).catch(() => setBranches([]));
    }, []);

    const range = useCallback(() => {
        const p: Record<string, string> = {};
        if (filters.dateFrom) p.dateFrom = filters.dateFrom;
        if (filters.dateTo) p.dateTo = filters.dateTo;
        if (filters.branchId) p.branchId = filters.branchId;
        return p;
    }, [filters]);

    const messageOf = (e: unknown, fallback: string) =>
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error)?.message || fallback;

    // Summary, ranking and alerts follow the filters only. The `cancelled` flag drops out-of-order responses.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const month = rankingMonth(filters);
        Promise.all([
            surveysAPI.summary(range()),
            surveysAPI.ranking({ ...(filters.branchId ? { branchId: filters.branchId } : {}), ...(month ? { month } : {}) }),
            surveysAPI.responses({ ...range(), detractorsOnly: true, pageSize: 50 }),
        ]).then(([s, r, a]) => {
            if (cancelled) return;
            setSummary(s.data.data);
            setRanking(r.data.data);
            setAlerts(a.data.data.items);
        }).catch((e) => {
            if (cancelled) return;
            setSummary(null);
            setRanking(null);
            setAlerts([]);
            setError(messageOf(e, 'Error al cargar las encuestas'));
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [range, filters]);

    useEffect(() => {
        let cancelled = false;
        setResponsesError(null);
        surveysAPI.responses({ ...range(), page, pageSize: PAGE_SIZE, ...(detractorsOnly ? { detractorsOnly: true } : {}) })
            .then((r) => { if (!cancelled) setResponses(r.data.data); })
            .catch((e) => {
                if (cancelled) return;
                setResponses({ items: [], total: 0, page, pageSize: PAGE_SIZE });
                setResponsesError(messageOf(e, 'Error al cargar las respuestas'));
            });
        return () => { cancelled = true; };
    }, [range, page, detractorsOnly, retryTick]);

    const changeFilters = (next: typeof filters) => { setPage(1); setFilters(next); };
    const toggleDetractors = (value: boolean) => { setPage(1); setDetractorsOnly(value); };

    return (
        <div className="page-wrapper">
            <PageHeader
                title="Encuestas NPS"
                subtitle="Qué opinan tus clientes: indicadores para ajustar el servicio y reconocer a tus meseros."
                icon={MessageSquare}
            />
            <div className="survey-filters">
                <div className="filter-field filter-field-wide">
                    <label className="filter-field-label"><Calendar size={12} /> Rango de Fechas</label>
                    <div className="filter-field-date-range">
                        <input type="date" className="filter-input" aria-label="Desde" value={filters.dateFrom} onChange={(e) => changeFilters({ ...filters, dateFrom: e.target.value })} />
                        <span className="filter-range-sep">→</span>
                        <input type="date" className="filter-input" aria-label="Hasta" value={filters.dateTo} onChange={(e) => changeFilters({ ...filters, dateTo: e.target.value })} />
                    </div>
                </div>
                <div className="filter-field">
                    <Select
                        label={<><Building2 size={12} /> Sucursal</>}
                        options={[{ value: '', label: ALL }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
                        value={{ value: filters.branchId, label: filters.branchId ? branches.find((b) => String(b.id) === filters.branchId)?.name || '' : ALL }}
                        onChange={(opt) => opt && changeFilters({ ...filters, branchId: opt.value })}
                        isSearchable={false}
                    />
                </div>
            </div>
            {error && <p className="state-error" role="alert">{error}</p>}
            {loading && <p className="state-placeholder" role="status">Cargando...</p>}
            {summary && !error && (
                <div className={loading ? 'survey-loading' : undefined}>
                <SurveyReportView
                    summary={summary}
                    ranking={ranking}
                    alerts={alerts}
                    responses={responses}
                    detractorsOnly={detractorsOnly}
                    onToggleDetractors={toggleDetractors}
                    onPageChange={setPage}
                    showBranches={!filters.branchId}
                    responsesError={responsesError}
                    onRetryResponses={() => setRetryTick((t) => t + 1)}
                />
                </div>
            )}
        </div>
    );
}
