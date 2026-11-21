import { useCallback, useEffect, useState } from 'react';
import { Building2, Calendar, MessageSquare } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Select from '../components/Select';
import { branchesAPI, surveysAPI } from '../services/api';
import { monthRange, type SurveyRanking, type SurveyResponseRow, type SurveyResponsesPage, type SurveySummary } from '../utils/surveyReport';
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

    // Summary, ranking and alerts follow the filters; the table also follows the toggle and page.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        const base = range();
        const month = (filters.dateTo || filters.dateFrom).slice(0, 7);
        Promise.all([
            surveysAPI.summary(base),
            surveysAPI.ranking({ ...(filters.branchId ? { branchId: filters.branchId } : {}), ...(month ? { month } : {}) }),
            surveysAPI.responses({ ...base, detractorsOnly: true, pageSize: 50 }),
        ]).then(([s, r, a]) => {
            if (cancelled) return;
            setSummary(s.data.data);
            setRanking(r.data.data);
            setAlerts(a.data.data.items);
        }).catch((e: { response?: { data?: { message?: string } }; message?: string }) => {
            if (!cancelled) setError(e.response?.data?.message || e.message || 'Error al cargar las encuestas');
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [range, filters.branchId, filters.dateFrom, filters.dateTo]);

    useEffect(() => {
        let cancelled = false;
        surveysAPI.responses({ ...range(), page, pageSize: PAGE_SIZE, ...(detractorsOnly ? { detractorsOnly: true } : {}) })
            .then((r) => { if (!cancelled) setResponses(r.data.data); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [range, page, detractorsOnly]);

    useEffect(() => { setPage(1); }, [filters, detractorsOnly]);

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
                        <input type="date" className="filter-input" aria-label="Desde" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
                        <span className="filter-range-sep">→</span>
                        <input type="date" className="filter-input" aria-label="Hasta" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
                    </div>
                </div>
                <div className="filter-field">
                    <Select
                        label={<><Building2 size={12} /> Sucursal</>}
                        options={[{ value: '', label: ALL }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
                        value={{ value: filters.branchId, label: filters.branchId ? branches.find((b) => String(b.id) === filters.branchId)?.name || '' : ALL }}
                        onChange={(opt) => opt && setFilters({ ...filters, branchId: opt.value })}
                        isSearchable={false}
                    />
                </div>
            </div>
            {error && <p className="state-error" role="alert">{error}</p>}
            {!summary && loading && <p className="state-placeholder">Cargando...</p>}
            {summary && (
                <SurveyReportView
                    summary={summary}
                    ranking={ranking}
                    alerts={alerts}
                    responses={responses}
                    detractorsOnly={detractorsOnly}
                    onToggleDetractors={setDetractorsOnly}
                    onPageChange={setPage}
                    showBranches={!filters.branchId}
                />
            )}
        </div>
    );
}
