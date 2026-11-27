import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Button, DataTable, DateInput, EmptyState, Field, FullScreenModal, IconButton, Input, LoadErrorState, PageContent, PageHeader,
    SegmentedControl, StatCard, TableToolbar, Textarea,
} from '@/ui';
import type { SingleValue } from '../../components/hr/HrOptionSelect';
import { AlertTriangle, ClipboardCheck, Eye, Plus, RefreshCw } from 'lucide-react';
import HrFilterSelect from '../../components/hr/HrFilterSelect';
import Select from '../../components/hr/HrOptionSelect';
import HrModalFormShell, { HrModalFooterSlot } from '../../components/hr/HrModalFormShell';
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
import form from '../../components/hr/hrForm.module.css';

type Option = { value: string; label: string };
type ReviewForm = { decision: HrAttendanceReviewDecision; reason: string };

const EMPTY_LOOKUPS: HrOrganizationCatalogs = { departments: [], positions: [], costCenters: [], branches: [], users: [] };
const ACTION_OPTIONS: Option[] = [{ value: '', label: 'Todas las acciones' }, ...Object.entries(ATTENDANCE_ACTION_LABELS).map(([value, label]) => ({ value, label }))];
/** Etiquetas cortas para el filtro: «Marcaje enviado a revisión» no cabe en el ancho estándar de filtro. */
const DECISION_FILTER_LABELS: Record<keyof typeof ATTENDANCE_DECISION_LABELS, string> = { ACCEPTED: 'Aceptados', REVIEW_REQUIRED: 'En revisión', REJECTED: 'Rechazados' };
const DECISION_OPTIONS: Option[] = [{ value: '', label: 'Todos los resultados' }, ...Object.entries(DECISION_FILTER_LABELS).map(([value, label]) => ({ value, label }))];

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

    const pendingReview = events.filter((item) => item.decision === 'REVIEW_REQUIRED' && !item.reviewedAt).length;

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Recursos humanos', 'Asistencia']}
                title="Revisión de asistencia"
                description="Resuelve incidencias y registra marcajes manuales sin perder trazabilidad"
                actions={<Button variant="primary" icon={Plus} onClick={() => setManualOpen(true)} disabled={!online || Boolean(lookupsError)}>Marcaje manual</Button>}
            />
            <OnlineOnlyNotice online={online} />
            {lookupsError && (
                <div className={`${form.alertDanger} ${form.actions}`} role="alert">
                    <AlertTriangle size={16} aria-hidden="true" /><span>{lookupsError}</span>
                    <Button variant="ghost" icon={RefreshCw} onClick={() => void loadLookups()}>Reintentar catálogos</Button>
                </div>
            )}

            {!loading && !error && pendingReview > 0 && (
                <section className={form.kpis} aria-label="Indicadores de revisión">
                    <StatCard
                        tone="warning"
                        label="Por revisar (página)"
                        value={String(pendingReview)}
                        context="Requieren decisión con razón."
                        action={decision === 'REVIEW_REQUIRED' ? undefined : { label: 'Filtrar por revisar', onClick: () => setDecision('REVIEW_REQUIRED') }}
                    />
                </section>
            )}

            {error ? (
                <LoadErrorState message={error} onRetry={() => void loadEvents()} />
            ) : (
                <DataTable<HrAttendanceEvent>
                    ariaLabel="Eventos de asistencia"
                    rows={events}
                    rowKey={(attendanceEvent) => attendanceEvent.id}
                    loading={loading}
                    pagination={{ mode: 'server', page, pageSize: 25, total, onChange: (nextPage) => setPage(nextPage) }}
                    pageSizeOptions={[25]}
                    minWidth="60rem"
                    toolbar={(
                        <TableToolbar>
                            <DateInput aria-label="Desde" title="Desde" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                            <DateInput aria-label="Hasta" title="Hasta" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                            <HrFilterSelect label="Sucursal" options={branchOptions} value={branchId} onChange={setBranchId} />
                            <HrFilterSelect label="Usuario" options={userOptions} value={userId} onChange={setUserId} />
                            <HrFilterSelect label="Acción" options={ACTION_OPTIONS} value={action} onChange={setAction} />
                            <HrFilterSelect label="Resultado" options={DECISION_OPTIONS} value={decision} onChange={setDecision} />
                        </TableToolbar>
                    )}
                    empty={<EmptyState icon={ClipboardCheck} title="No hay eventos para los filtros seleccionados" description="Amplía el rango o cambia los filtros para consultar otros marcajes." />}
                    columns={[
                        { key: 'employee', header: 'Empleado', width: '1.6fr', render: (attendanceEvent) => <span className={form.cellStack}><span className={form.cellTitle}>{attendanceEvent.user?.name ?? `Usuario #${attendanceEvent.userId}`}</span><span className={form.cellSub}>@{attendanceEvent.user?.username ?? attendanceEvent.userId}</span></span> },
                        { key: 'action', header: 'Evento', width: '1.4fr', render: (attendanceEvent) => <span className={form.cellStack}><span className={form.cellTitle}>{ATTENDANCE_ACTION_LABELS[attendanceEvent.action]}</span>{attendanceEvent.message && <span className={form.cellSub}>{attendanceEvent.message}</span>}</span> },
                        { key: 'branch', header: 'Sucursal', width: '1fr', render: (attendanceEvent) => attendanceEvent.branch?.name ?? `Sucursal #${attendanceEvent.branchId ?? '—'}` },
                        { key: 'occurredAt', header: 'Fecha y hora', width: '1.2fr', render: (attendanceEvent) => <time dateTime={attendanceEvent.occurredAt}>{displayDate(attendanceEvent.occurredAt)}</time> },
                        { key: 'decision', header: 'Resultado', width: '1.2fr', render: (attendanceEvent) => <span className={form.cellStack}><span className={form.cellTitle}>{ATTENDANCE_DECISION_LABELS[attendanceEvent.decision]}</span>{attendanceEvent.reviewedAt && <span className={form.cellSub}>Revisado {displayDate(attendanceEvent.reviewedAt)}</span>}</span> },
                        { key: 'evidence', header: 'Evidencia', width: '1.2fr', render: (attendanceEvent) => <span className={form.cellStack}><span>{attendanceEvent.reasonCode ? <code>{attendanceEvent.reasonCode}</code> : 'Sin código'}</span>{attendanceEvent.locationAccuracyM != null && <span className={form.cellSub}>Precisión ±{Math.round(attendanceEvent.locationAccuracyM)} m</span>}</span> },
                        { key: 'actions', header: 'Acción', width: '100px', type: 'actions', render: (attendanceEvent) => <IconButton icon={Eye} size="sm" tooltip="Revisar" onClick={() => openReview(attendanceEvent)} disabled={!online || attendanceEvent.decision !== 'REVIEW_REQUIRED' || Boolean(attendanceEvent.reviewedAt)} label={!online ? 'Conéctate para revisar' : attendanceEvent.reviewedAt ? 'Evento ya revisado' : `Revisar evento de ${attendanceEvent.user?.name ?? attendanceEvent.userId}`} /> },
                    ]}
                />
            )}

            <FullScreenModal
              footer={<HrModalFooterSlot />}
                isOpen={Boolean(selected)}
                onClose={() => !saving && setSelected(null)}
                breadcrumb={['Recursos humanos', 'Asistencia']}
                title="Revisar incidencia"
            >
                {selected && (
                    <HrModalFormShell
                        ariaLabel="Sección de revisión"
                        tabLabel="Decisión"
                        sectionTitle="Evento observado y resolución"
                        onSubmit={review}
                        footer={<><Button type="button" variant="ghost" onClick={() => setSelected(null)} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" loading={saving} disabled={!online || !reviewForm.reason.trim()}>Registrar decisión</Button></>}
                    >
                        <dl className={`${form.facts} span-full`}>
                            <div><dt>Empleado</dt><dd>{selected.user?.name ?? `Usuario #${selected.userId}`}</dd></div>
                            <div><dt>Evento</dt><dd>{ATTENDANCE_ACTION_LABELS[selected.action]} · {displayDate(selected.occurredAt)}</dd></div>
                            <div><dt>Motivo de la incidencia</dt><dd>{selected.message ?? selected.reasonCode ?? 'Sin explicación adicional.'}</dd></div>
                        </dl>
                        <div className="span-full">
                            <SegmentedControl<'APPROVED' | 'REJECTED'>
                                ariaLabel="Decisión de revisión"
                                options={[{ value: 'APPROVED', label: 'Aprobar' }, { value: 'REJECTED', label: 'Rechazar' }]}
                                value={reviewForm.decision}
                                onChange={(next) => setReviewForm((current) => ({ ...current, decision: next }))}
                            />
                        </div>
                        <div className="span-full">
                            <Field label="Razón de la decisión" htmlFor="attendance-review-reason" required>
                                <Textarea id="attendance-review-reason" rows={5} maxLength={500} value={reviewForm.reason} onChange={(event) => setReviewForm((current) => ({ ...current, reason: event.target.value }))} required />
                            </Field>
                        </div>
                    </HrModalFormShell>
                )}
            </FullScreenModal>

            <FullScreenModal
              footer={<HrModalFooterSlot />}
                isOpen={manualOpen}
                onClose={() => !saving && setManualOpen(false)}
                breadcrumb={['Recursos humanos', 'Asistencia']}
                title="Marcaje manual supervisado"
            >
                <HrModalFormShell
                    ariaLabel="Sección de marcaje manual"
                    tabLabel="Marcaje"
                    sectionTitle="Origen, colaborador y justificación"
                    formClassName="hr-attendance-manual-form"
                    notice={<div className={form.alertWarning}>Este fallback no simula biometría ni GPS: crea un evento manual identificado, con actor y razón para auditoría.</div>}
                    onSubmit={createManual}
                    footer={<><Button type="button" variant="ghost" onClick={() => setManualOpen(false)} disabled={saving}>Cancelar</Button><Button variant="primary" type="submit" loading={saving} disabled={!online}>Registrar marcaje manual</Button></>}
                >
                    <div className="span-full"><Select<Option> label="Evento a compensar (opcional)" options={targetOptions} value={targetOptions.find((option) => option.value === manual.targetEventId)} onChange={(option: SingleValue<Option>) => { const target = events.find((item) => String(item.id) === option?.value); setManual((current) => ({ ...current, targetEventId: option?.value ?? '', ...(target ? { userId: String(target.userId), branchId: String(target.branchId ?? ''), action: target.action } : {}) })); }} isSearchable /></div>
                    <Select<Option> label="Usuario" options={userOptions.filter((option) => option.value)} value={userOptions.find((option) => option.value === manual.userId)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, userId: option?.value ?? '' }))} isSearchable />
                    <Select<Option> label="Sucursal" options={branchOptions.filter((option) => option.value)} value={branchOptions.find((option) => option.value === manual.branchId)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, branchId: option?.value ?? '' }))} isSearchable />
                    <Select<Option> label="Acción" options={ACTION_OPTIONS.filter((option) => option.value)} value={ACTION_OPTIONS.find((option) => option.value === manual.action)} onChange={(option: SingleValue<Option>) => setManual((current) => ({ ...current, action: (option?.value ?? 'CHECK_IN') as HrAttendanceAction }))} />
                    <Field label="Fecha y hora real" htmlFor="attendance-manual-at" required>
                        <Input id="attendance-manual-at" type="datetime-local" value={manual.occurredAt} onChange={(event) => setManual((current) => ({ ...current, occurredAt: event.target.value }))} required />
                    </Field>
                    <div className="span-full">
                        <Field label="Razón del fallback" htmlFor="attendance-manual-reason" required>
                            <Textarea id="attendance-manual-reason" rows={5} maxLength={500} value={manual.reason} onChange={(event) => setManual((current) => ({ ...current, reason: event.target.value }))} required />
                        </Field>
                    </div>
                </HrModalFormShell>
            </FullScreenModal>
        </PageContent>
    );
}
