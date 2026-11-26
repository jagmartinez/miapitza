import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, DataTable, DateInput, FullScreenModal, Input, PageHeader, StatCard, Textarea } from '@/ui';
import type { SingleValue } from '../../components/hr/HrOptionSelect';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Eye, Plus, RefreshCw, XCircle } from 'lucide-react';
import HrLoading from '../../components/hr/HrLoading';
import HrFilterSelect from '../../components/hr/HrFilterSelect';
import Select from '../../components/hr/HrOptionSelect';
import HrModalFormShell from '../../components/hr/HrModalFormShell';
import OnlineOnlyNotice from '../../components/hr/OnlineOnlyNotice';
import useWorkforceOnline from '../../components/hr/useWorkforceOnline';
import { attendanceClient, createAttendanceIdempotencyKey, getAttendanceErrorMessage } from '../../components/hr/attendanceClient';
import { ATTENDANCE_ACTION_LABELS, ATTENDANCE_DECISION_LABELS } from '../../components/hr/attendanceRules';
import { hrClient } from '../../components/hr/hrClient';
import { useAppToast } from '../../context/ToastContext';
import type { HrOrganizationCatalogs } from '../../types/hr';
import type {
    HrAttendanceAction,
    HrAttendanceDecision,
    HrAttendanceEvent,
    HrAttendanceManualPayload,
    HrAttendanceReviewDecision,
} from '../../types/hr-attendance';
import './attendance.css';
import './admin-tables.css';
import './hr-admin-operations.css';
import '../Inventory.css';

type Option = { value: string; label: string };
type ReviewForm = { decision: HrAttendanceReviewDecision; reason: string };

const EMPTY_LOOKUPS: HrOrganizationCatalogs = { departments: [], positions: [], costCenters: [], branches: [], users: [] };
const ACTION_OPTIONS: Option[] = [{ value: '', label: 'Todas las acciones' }, ...Object.entries(ATTENDANCE_ACTION_LABELS).map(([value, label]) => ({ value, label }))];
const DECISION_OPTIONS: Option[] = [{ value: '', label: 'Todos los resultados' }, ...Object.entries(ATTENDANCE_DECISION_LABELS).map(([value, label]) => ({ value, label }))];

function todayDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function displayDate(value: string): string {
    return new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function AttendanceReview() {
    const online = useWorkforceOnline();
    const { success: showSuccess, error: showError } = useAppToast();
    const [lookups, setLookups] = useState<HrOrganizationCatalogs>(EMPTY_LOOKUPS);
    const [lookupsError, setLookupsError] = useState<string | null>(null);
    const [events, setEvents] = useState<HrAttendanceEvent[]>([]);
    const [dateFrom, setDateFrom] = useState(todayDate());
    const [dateTo, setDateTo] = useState(todayDate());
    const [branchId, setBranchId] = useState('');
    const [userId, setUserId] = useState('');
    const [action, setAction] = useState('');
    const [decision, setDecision] = useState('REVIEW_REQUIRED');
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<HrAttendanceEvent | null>(null);
    const [reviewForm, setReviewForm] = useState<ReviewForm>({ decision: 'APPROVED', reason: '' });
    const [manualOpen, setManualOpen] = useState(false);
    const [manual, setManual] = useState({ targetEventId: '', userId: '', branchId: '', action: 'CHECK_IN' as HrAttendanceAction, occurredAt: '', reason: '' });
    const [saving, setSaving] = useState(false);

    const loadLookups = useCallback(async () => {
        try {
            setLookups(await hrClient.getOrganization());
            setLookupsError(null);
        } catch (lookupError) {
            setLookups(EMPTY_LOOKUPS);
            setLookupsError(getAttendanceErrorMessage(lookupError, 'No fue posible cargar sucursales y usuarios para filtrar o crear marcajes manuales.'));
        }
    }, []);

    const loadEvents = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await attendanceClient.getEvents({
                dateFrom,
                dateTo,
                branchId: branchId ? Number(branchId) : undefined,
                userId: userId ? Number(userId) : undefined,
                action: action ? action as HrAttendanceAction : undefined,
                decision: decision ? decision as HrAttendanceDecision : undefined,
                page,
                limit: 25,
            });
            setEvents(result.items);
            setTotal(result.pagination?.total ?? result.items.length);
        } catch (loadError) {
            setEvents([]);
            setError(getAttendanceErrorMessage(loadError, 'No fue posible cargar los eventos de asistencia.'));
        } finally {
            setLoading(false);
        }
    }, [action, branchId, dateFrom, dateTo, decision, page, userId]);

    useEffect(() => { void loadLookups(); }, [loadLookups]);
    useEffect(() => { void loadEvents(); }, [loadEvents]);
    useEffect(() => { setPage(1); }, [action, branchId, dateFrom, dateTo, decision, userId]);

    const branchOptions = useMemo<Option[]>(() => [{ value: '', label: 'Todas las sucursales' }, ...(lookups.branches ?? []).map((branch) => ({ value: String(branch.id), label: branch.name }))], [lookups.branches]);
    const userOptions = useMemo<Option[]>(() => [{ value: '', label: 'Todos los usuarios' }, ...(lookups.users ?? []).map((user) => ({ value: String(user.id), label: `${user.name} · @${user.username}` }))], [lookups.users]);

    const targetOptions = useMemo<Option[]>(() => [
        { value: '', label: 'Sin evento previo (requiere turno publicado)' },
        ...events
            .filter((event) => event.decision === 'REVIEW_REQUIRED' || event.decision === 'REJECTED')
            .map((event) => ({
                value: String(event.id),
                label: `#${event.id} · ${event.user?.name ?? `Usuario ${event.userId}`} · ${ATTENDANCE_ACTION_LABELS[event.action]} · ${displayDate(event.occurredAt)}`,
            })),
    ], [events]);
    const openReview = (event: HrAttendanceEvent) => {
        if (event.decision !== 'REVIEW_REQUIRED' || event.reviewedAt) return;
        setSelected(event);
        setReviewForm({ decision: 'APPROVED', reason: '' });
    };

    const review = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!online) {
            showError('Conéctate para registrar una decisión de asistencia.');
            return;
        }
        if (!selected || !reviewForm.reason.trim()) {
            showError('La decisión de revisión requiere una razón.');
            return;
        }
        setSaving(true);
        try {
            await attendanceClient.reviewEvent(selected.id, { decision: reviewForm.decision, reason: reviewForm.reason.trim() });
            showSuccess('Evento revisado con trazabilidad.');
            setSelected(null);
            await loadEvents();
        } catch (reviewError) {
            showError(getAttendanceErrorMessage(reviewError, 'No fue posible revisar el evento.'));
        } finally {
            setSaving(false);
        }
    };

    const createManual = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!online) {
            showError('Conéctate para registrar un marcaje manual.');
            return;
        }
        if (!manual.userId || !manual.branchId || !manual.occurredAt || !manual.reason.trim()) {
            showError('Usuario, sucursal, fecha/hora y razón son obligatorios.');
            return;
        }
        const payload: HrAttendanceManualPayload = {
            userId: Number(manual.userId),
            branchId: Number(manual.branchId),
            action: manual.action,
            occurredAt: new Date(manual.occurredAt).toISOString(),
            reason: manual.reason.trim(),
            targetEventId: manual.targetEventId ? Number(manual.targetEventId) : undefined,
        };
        setSaving(true);
        try {
            await attendanceClient.createManualEvent(payload, createAttendanceIdempotencyKey());
            showSuccess('Marcaje manual registrado para auditoría.');
            setManualOpen(false);
            setManual({ targetEventId: '', userId: '', branchId: '', action: 'CHECK_IN', occurredAt: '', reason: '' });
            await loadEvents();
        } catch (manualError) {
            showError(getAttendanceErrorMessage(manualError, 'No fue posible crear el marcaje manual.'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="page-wrapper inventory-page hr-attendance-review-page hr-admin-catalog-page hr-operation-page">
            <PageHeader
        title="Revisión de asistencia"
        description="Resuelve incidencias y registra marcajes manuales sin perder trazabilidad"
        actions={<Button variant="primary" onClick={() => setManualOpen(true)} disabled={!online || Boolean(lookupsError)}><Plus size={18} /> Marcaje manual</Button>}
      />
            <OnlineOnlyNotice online={online} />
            {lookupsError && (
                <div className="hr-attendance-alert danger" role="alert">
                    <AlertTriangle size={18} aria-hidden="true" /><span>{lookupsError}</span>
                    <Button size="sm" variant="ghost" onClick={() => void loadLookups()}><RefreshCw size={15} /> Reintentar catálogos</Button>
                </div>
            )}

            {!loading && !error && events.some((item) => item.decision === 'REVIEW_REQUIRED' && !item.reviewedAt) && (
                <section className="hr-kpi-row" aria-label="Indicadores de revisión">
                    <StatCard
                        tone="warning"
                        label="Por revisar (página)"
                        value={String(events.filter((item) => item.decision === 'REVIEW_REQUIRED' && !item.reviewedAt).length)}
                        context="Requieren decisión con razón."
                        action={decision === 'REVIEW_REQUIRED' ? undefined : { label: 'Filtrar por revisar', onClick: () => setDecision('REVIEW_REQUIRED') }}
                    />
                </section>
            )}

            <div className="hr-filters hr-attendance-filters">
                <div className="filter-field"><label className="filter-field-label" htmlFor="attendance-from">Desde</label><DateInput id="attendance-from" className="filter-input" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
                <div className="filter-field"><label className="filter-field-label" htmlFor="attendance-to">Hasta</label><DateInput id="attendance-to" className="filter-input" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
                <HrFilterSelect label="Sucursal" options={branchOptions} value={branchId} onChange={setBranchId} />
                <HrFilterSelect label="Usuario" options={userOptions} value={userId} onChange={setUserId} />
                <HrFilterSelect label="Acción" options={ACTION_OPTIONS} value={action} onChange={setAction} />
                <HrFilterSelect label="Resultado" options={DECISION_OPTIONS} value={decision} onChange={setDecision} />
            </div>

            {loading && <HrLoading text="Cargando eventos…" />}
            {!loading && error && <div className="state-placeholder" role="alert"><AlertTriangle size={44} /><p className="state-error">{error}</p><Button variant="ghost" onClick={() => void loadEvents()}><RefreshCw size={16} /> Reintentar</Button></div>}
            {!loading && !error && (
                <DataTable<HrAttendanceEvent>
                    ariaLabel="Eventos de asistencia"
                    rows={events}
                    rowKey={(attendanceEvent) => attendanceEvent.id}
                    pagination={{ mode: 'server', page, pageSize: 25, total, onChange: (nextPage) => setPage(nextPage) }}
                    pageSizeOptions={[25]}
                    minWidth="60rem"
                    empty={<div className="hr-admin-empty"><ClipboardCheck size={34} /><strong>No hay eventos para los filtros seleccionados</strong><span>Amplía el rango o cambia los filtros para consultar otros marcajes.</span></div>}
                    columns={[
                        { key: 'employee', header: 'Empleado', width: '1.6fr', render: (attendanceEvent) => <><strong>{attendanceEvent.user?.name ?? `Usuario #${attendanceEvent.userId}`}</strong><small>@{attendanceEvent.user?.username ?? attendanceEvent.userId}</small></> },
                        { key: 'action', header: 'Evento', width: '1.4fr', render: (attendanceEvent) => <><strong>{ATTENDANCE_ACTION_LABELS[attendanceEvent.action]}</strong>{attendanceEvent.message && <small>{attendanceEvent.message}</small>}</> },
                        { key: 'branch', header: 'Sucursal', width: '1fr', render: (attendanceEvent) => attendanceEvent.branch?.name ?? `Sucursal #${attendanceEvent.branchId ?? '—'}` },
                        { key: 'occurredAt', header: 'Fecha y hora', width: '1.2fr', render: (attendanceEvent) => <time dateTime={attendanceEvent.occurredAt}>{displayDate(attendanceEvent.occurredAt)}</time> },
                        { key: 'decision', header: 'Resultado', width: '1.2fr', render: (attendanceEvent) => <><strong>{ATTENDANCE_DECISION_LABELS[attendanceEvent.decision]}</strong>{attendanceEvent.reviewedAt && <small>Revisado {displayDate(attendanceEvent.reviewedAt)}</small>}</> },
                        { key: 'evidence', header: 'Evidencia', width: '1.2fr', render: (attendanceEvent) => <>{attendanceEvent.reasonCode ? <code>{attendanceEvent.reasonCode}</code> : 'Sin código'}{attendanceEvent.locationAccuracyM != null && <small>Precisión ±{Math.round(attendanceEvent.locationAccuracyM)} m</small>}</> },
                        { key: 'actions', header: 'Acción', width: '5rem', type: 'actions', render: (attendanceEvent) => <Button className="table-action-btn" size="sm" variant="ghost" onClick={() => openReview(attendanceEvent)} disabled={!online || attendanceEvent.decision !== 'REVIEW_REQUIRED' || Boolean(attendanceEvent.reviewedAt)} title={!online ? 'Conéctate para revisar' : attendanceEvent.reviewedAt ? 'Evento ya revisado' : 'Revisar evento'} aria-label={`Revisar evento de ${attendanceEvent.user?.name ?? attendanceEvent.userId}`}><Eye size={16} /></Button> },
                    ]}
                />
            )}

            <FullScreenModal
        isOpen={Boolean(selected)}
        onClose={() => !saving && setSelected(null)}
        title="Revisar incidencia"
      >
                {selected && (
                    <HrModalFormShell
                        ariaLabel="Sección de revisión"
                        tabLabel="Decisión"
                        sectionTitle="Evento observado y resolución"
                        icon={<ClipboardCheck size={18} aria-hidden="true" />}
                        formClassName="hr-attendance-review-form"
                        onSubmit={review}
                        footer={<><Button type="button" variant="ghost" onClick={() => setSelected(null)} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" disabled={!online || saving || !reviewForm.reason.trim()}>{saving ? 'Guardando…' : 'Registrar decisión'}</Button></>}
                    >
                        <div className="hr-review-summary span-full"><strong>{selected.user?.name ?? `Usuario #${selected.userId}`}</strong><span>{ATTENDANCE_ACTION_LABELS[selected.action]} · {displayDate(selected.occurredAt)}</span><p>{selected.message ?? selected.reasonCode ?? 'Sin explicación adicional.'}</p></div>
                        <div className="hr-review-decisions span-full" role="radiogroup" aria-label="Decisión de revisión"><label className={`hr-inline-choice ${reviewForm.decision === 'APPROVED' ? 'selected' : ''}`}><input type="radio" name="review-decision" checked={reviewForm.decision === 'APPROVED'} onChange={() => setReviewForm((current) => ({ ...current, decision: 'APPROVED' }))} /><CheckCircle2 size={18} /> Aprobar</label><label className={`hr-inline-choice danger ${reviewForm.decision === 'REJECTED' ? 'selected' : ''}`}><input type="radio" name="review-decision" checked={reviewForm.decision === 'REJECTED'} onChange={() => setReviewForm((current) => ({ ...current, decision: 'REJECTED' }))} /><XCircle size={18} /> Rechazar</label></div>
                        <label className="span-full" htmlFor="attendance-review-reason">Razón de la decisión<Textarea id="attendance-review-reason" rows={5} maxLength={500} value={reviewForm.reason} onChange={(event) => setReviewForm((current) => ({ ...current, reason: event.target.value }))} required /></label>
                    </HrModalFormShell>
                )}
            </FullScreenModal>

            <FullScreenModal
        isOpen={manualOpen}
        onClose={() => !saving && setManualOpen(false)}
        title="Marcaje manual supervisado"
      >
                <HrModalFormShell
                    ariaLabel="Sección de marcaje manual"
                    tabLabel="Marcaje"
                    sectionTitle="Origen, colaborador y justificación"
                    icon={<Plus size={18} aria-hidden="true" />}
                    formClassName="hr-attendance-manual-form"
                    notice={<div className="hr-attendance-alert warning"><AlertTriangle size={18} /><span>Este fallback no simula biometría ni GPS: crea un evento manual identificado, con actor y razón para auditoría.</span></div>}
                    onSubmit={createManual}
                    footer={<><Button type="button" variant="ghost" onClick={() => setManualOpen(false)} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" disabled={!online || saving}>{saving ? 'Registrando…' : 'Registrar marcaje manual'}</Button></>}
                >
                    <div className="span-full"><Select<Option> variant="modal" label="Evento a compensar (opcional)" options={targetOptions} value={targetOptions.find((option) => option.value === manual.targetEventId)} onChange={(option: SingleValue<Option>) => { const target = events.find((item) => String(item.id) === option?.value); setManual((current) => ({ ...current, targetEventId: option?.value ?? '', ...(target ? { userId: String(target.userId), branchId: String(target.branchId ?? ''), action: target.action } : {}) })); }} isSearchable /></div>
                    <Select<Option> variant="modal" label="Usuario" options={userOptions.filter((option) => option.value)} value={userOptions.find((option) => option.value === manual.userId)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, userId: option?.value ?? '' }))} isSearchable />
                    <Select<Option> variant="modal" label="Sucursal" options={branchOptions.filter((option) => option.value)} value={branchOptions.find((option) => option.value === manual.branchId)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, branchId: option?.value ?? '' }))} isSearchable />
                    <Select<Option> variant="modal" label="Acción" options={ACTION_OPTIONS.filter((option) => option.value)} value={ACTION_OPTIONS.find((option) => option.value === manual.action)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, action: (option?.value ?? 'CHECK_IN') as HrAttendanceAction }))} />
                    <label htmlFor="attendance-manual-at">Fecha y hora real<Input id="attendance-manual-at" type="datetime-local" value={manual.occurredAt} onChange={(event) => setManual((current) => ({ ...current, occurredAt: event.target.value }))} required /></label>
                    <label className="span-full" htmlFor="attendance-manual-reason">Razón del fallback<Textarea id="attendance-manual-reason" rows={5} maxLength={500} value={manual.reason} onChange={(event) => setManual((current) => ({ ...current, reason: event.target.value }))} required /></label>
                </HrModalFormShell>
            </FullScreenModal>
        </div>
    );
}
