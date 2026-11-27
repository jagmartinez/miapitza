import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AppSelect, Badge, Button, EmptyState, FullScreenModal, IconButton, LoadErrorState, PageContent, PageHeader, TableToolbar, type Tone,
} from '@/ui';
import {
    CalendarDays,
    Clock3,
    ChevronLeft,
    ChevronRight,
    Ban,
    ClipboardCopy,
    RefreshCw,
    Send,
    AlertTriangle,
} from 'lucide-react';
import HrLoading from '../../components/hr/HrLoading';
import ScheduleShiftForm from '../../components/hr/ScheduleShiftForm';
import ScheduleWeekView from '../../components/hr/ScheduleWeekView';
import form from '../../components/hr/hrForm.module.css';
import {
    addDaysDateOnly,
    existingShiftApiInput,
    seedDraftFromPublished,
    toScheduledShiftApiInput,
    weekStartFor,
} from '../../components/hr/scheduleDates';
import {
    getScheduleConflicts,
    getScheduleErrorMessage,
    scheduleClient,
} from '../../components/hr/scheduleClient';
import { ROLES, HR_OWNER } from '../../constants/roles';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import type { HrScheduleLookups, HrUserSummary } from '../../types/hr';
import type {
    HrHoliday,
    HrScheduleConflict,
    HrScheduleShift,
    HrScheduleShiftInput,
    HrShiftTemplate,
    HrWeeklySchedule,
} from '../../types/hr-schedule';
import { HrModalFooterSlot } from '../../components/hr/HrModalFormShell';
import { getUserRoleNames, hasPermission } from '../../utils/authz';
import './schedule.css';

type Option = { value: string; label: string };
type MutationKind = 'save' | 'delete' | 'publish' | 'copy' | 'cancel';

const EMPTY_LOOKUPS: HrScheduleLookups = { positions: [], branches: [], users: [] };
const weekFormatter = new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function weekLabel(weekStart: string): string {
    const end = addDaysDateOnly(weekStart, 6);
    return `${weekFormatter.format(new Date(`${weekStart}T00:00:00Z`))} – ${weekFormatter.format(new Date(`${end}T00:00:00Z`))}`;
}

function scheduleStatusMeta(status: HrWeeklySchedule['status'] | undefined): { label: string; hint: string; tone: Tone } {
    switch (status) {
        case 'DRAFT': return { label: 'Borrador', hint: 'Pendiente de publicar', tone: 'primary' };
        case 'PUBLISHED': return { label: 'Publicado', hint: 'Visible para el personal', tone: 'success' };
        case 'CANCELLED': return { label: 'Cancelado', hint: 'Solo histórico', tone: 'danger' };
        case 'SUPERSEDED': return { label: 'Sustituido', hint: 'Versión histórica', tone: 'warning' };
        default: return { label: 'Sin horario', hint: 'Aún no hay borrador', tone: 'neutral' };
    }
}

function filteredSchedules(schedules: HrWeeklySchedule[], branchId: string, userId: string, jobPositionId: string): HrWeeklySchedule[] {
    if (!branchId && !userId && !jobPositionId) return schedules;
    return schedules.map((schedule) => ({
        ...schedule,
        shifts: schedule.shifts.filter((shift) =>
            (!branchId || String(shift.branchId) === branchId) &&
            (!userId || String(shift.userId) === userId) &&
            (!jobPositionId || String(shift.jobPositionId) === jobPositionId)
        ),
    }));
}

// lucide 0.294 icons carry propTypes that do not match the kit's icon prop type.

export default function Schedules() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError } = useAppToast();
    const currentWeek = weekStartFor();
    const [weekStart, setWeekStart] = useState(currentWeek);
    const [branchId, setBranchId] = useState('');
    const [userId, setUserId] = useState('');
    const [jobPositionId, setJobPositionId] = useState('');
    const [lookups, setLookups] = useState<HrScheduleLookups>(EMPTY_LOOKUPS);
    const [lookupsError, setLookupsError] = useState<string | null>(null);
    const [schedules, setSchedules] = useState<HrWeeklySchedule[]>([]);
    const [holidays, setHolidays] = useState<HrHoliday[]>([]);
    const [templates, setTemplates] = useState<HrShiftTemplate[]>([]);
    const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
    const [conflicts, setConflicts] = useState<HrScheduleConflict[]>([]);
    const [loadWarnings, setLoadWarnings] = useState<string[]>([]);
    const [fromCache, setFromCache] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingShift, setEditingShift] = useState<HrScheduleShift | null>(null);
    const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
    const [editingScheduleRevision, setEditingScheduleRevision] = useState<number | null>(null);
    const [newShiftDefaults, setNewShiftDefaults] = useState<{
        userId?: number;
        branchId?: number;
        jobPositionId?: number;
        date?: string;
    } | null>(null);
    const [mutationKind, setMutationKind] = useState<MutationKind | null>(null);
    const requestId = useRef(0);
    const mutationLock = useRef(false);
    const scopeKey = `${weekStart}|${branchId}|${userId}|${jobPositionId}`;
    const scopeRef = useRef(scopeKey);
    scopeRef.current = scopeKey;
    const mutationBusy = mutationKind !== null;
    const saving = mutationKind === 'save';
    const anyEditorOpen = editorOpen;
    const hasActiveFilters = Boolean(branchId || userId || jobPositionId);
    const roleNames = getUserRoleNames(user);
    const hasCompanyWideRole = roleNames.includes(ROLES.SUPERADMIN) || roleNames.includes(ROLES.ADMIN);
    const canManageSchedule = hasCompanyWideRole && hasPermission(user, 'hr.schedule.manage', HR_OWNER);
    const canPublishSchedule = hasCompanyWideRole && hasPermission(user, 'hr.schedule.publish', HR_OWNER);

    const beginMutation = (kind: MutationKind): boolean => {
        if (mutationLock.current || fromCache) return false;
        mutationLock.current = true;
        setMutationKind(kind);
        return true;
    };

    const finishMutation = () => {
        mutationLock.current = false;
        setMutationKind(null);
    };

    const loadLookups = useCallback(async () => {
        setLookupsError(null);
        try {
            setLookups(await scheduleClient.getScheduleLookups(weekStart));
        } catch (lookupError) {
            setLookups(EMPTY_LOOKUPS);
            setLookupsError(getScheduleErrorMessage(lookupError, 'No fue posible cargar usuarios, sucursales y puestos.'));
        }
    }, [weekStart]);

    const loadWeek = useCallback(async () => {
        const activeRequest = ++requestId.current;
        setLoading(true);
        setError(null);
        setLoadWarnings([]);
        try {
            const numericBranchId = branchId ? Number(branchId) : undefined;
            const [scheduleState, holidayState, templateState] = await Promise.allSettled([
                scheduleClient.getSchedules({
                    weekStart,
                    branchId: numericBranchId,
                    userId: userId ? Number(userId) : undefined,
                    jobPositionId: jobPositionId ? Number(jobPositionId) : undefined,
                }),
                scheduleClient.getHolidays(weekStart, numericBranchId),
                scheduleClient.getShiftTemplates(numericBranchId),
            ]);
            if (activeRequest !== requestId.current) return;
            if (scheduleState.status === 'rejected') throw scheduleState.reason;
            const scheduleResult = scheduleState.value;
            const warnings: string[] = [];
            const holidayResult = holidayState.status === 'fulfilled' ? holidayState.value : [];
            const templateResult = templateState.status === 'fulfilled' ? templateState.value : [];
            if (holidayState.status === 'rejected') {
                warnings.push(getScheduleErrorMessage(holidayState.reason, 'No se pudieron actualizar los feriados.'));
            }
            if (templateState.status === 'rejected') {
                const message = getScheduleErrorMessage(templateState.reason, 'No se pudieron cargar las jornadas configuradas.');
                warnings.push(message);
                setTemplateLoadError(message);
            } else {
                setTemplateLoadError(null);
            }
            setSchedules(scheduleResult.schedules);
            setConflicts(scheduleResult.conflicts);
            setHolidays(holidayResult.length > 0 ? holidayResult : scheduleResult.holidays);
            setTemplates(templateResult);
            setFromCache(scheduleResult.fromCache === true);
            setLoadWarnings(warnings);
        } catch (loadError) {
            if (activeRequest !== requestId.current) return;
            setSchedules([]);
            setHolidays([]);
            setTemplates([]);
            setTemplateLoadError(null);
            setConflicts([]);
            setFromCache(false);
            setLoadWarnings([]);
            setError(getScheduleErrorMessage(loadError, 'No fue posible cargar la semana de horarios.'));
        } finally {
            if (activeRequest === requestId.current) setLoading(false);
        }
    }, [branchId, jobPositionId, userId, weekStart]);

    useEffect(() => { void loadLookups(); }, [loadLookups]);
    useEffect(() => { void loadWeek(); }, [loadWeek]);

    const draftSchedule = schedules.find((schedule) => schedule.status === 'DRAFT') ?? null;
    const publishedSchedule = schedules.find((schedule) => schedule.status === 'PUBLISHED') ?? null;
    const historicalSchedules = schedules.filter((schedule) => ['CANCELLED', 'SUPERSEDED'].includes(schedule.status));
    const historicalSchedule = historicalSchedules[0] ?? null;
    const activeSchedule = draftSchedule ?? publishedSchedule;
    const primarySchedule = activeSchedule ?? historicalSchedule;
    const visibleSchedules = useMemo(
        () => filteredSchedules(primarySchedule ? [primarySchedule] : [], branchId, userId, jobPositionId),
        [branchId, jobPositionId, primarySchedule, userId]
    );
    const schedulableWorkers = useMemo(
        () => lookups.users.filter((worker) =>
            worker.status === 'ACTIVE' &&
            worker.accountType === 'INTERNAL' &&
            worker.employee?.status === 'ACTIVE'
        ),
        [lookups.users],
    );
    const visibleWorkers = useMemo(
        () => schedulableWorkers.filter((worker) => {
            const branchIds = new Set([
                worker.branchId,
                ...(worker.allowedBranches ?? []).map((entry) => entry.branch.id),
                ...(worker.employee?.branchAssignments ?? []).map((entry) => entry.branchId),
            ].filter((value): value is number => typeof value === 'number'));
            return (
                (!branchId || branchIds.has(Number(branchId))) &&
                (!userId || worker.id === Number(userId)) &&
                (!jobPositionId || worker.employee?.jobPositionId === Number(jobPositionId))
            );
        }),
        [branchId, jobPositionId, schedulableWorkers, userId],
    );
    const hasShifts = visibleSchedules.some((schedule) => schedule.shifts.length > 0);
    const openCreate = (defaults?: typeof newShiftDefaults) => {
        if (!canManageSchedule || mutationBusy || fromCache) return;
        setEditingShift(null);
        setNewShiftDefaults(defaults ?? null);
        setEditingScheduleId(draftSchedule?.id ?? null);
        setEditingScheduleRevision(draftSchedule?.revision ?? null);
        setConflicts([]);
        setEditorOpen(true);
    };
    const openCreateForCell = (worker: HrUserSummary, date: string) => {
        const assignments = worker.employee?.branchAssignments ?? [];
        const selectedBranchId = branchId ? Number(branchId) : undefined;
        const defaultBranchId = selectedBranchId
            ?? assignments.find((assignment) => assignment.isPrimary)?.branchId
            ?? assignments[0]?.branchId
            ?? worker.branchId
            ?? undefined;
        const defaultJobPositionId = worker.employee?.jobPositionId ?? undefined;
        if (!defaultBranchId || !defaultJobPositionId) {
            const missing = [
                !defaultBranchId ? 'sucursal vigente' : null,
                !defaultJobPositionId ? 'puesto' : null,
            ].filter(Boolean).join(' y ');
            showError(`No se puede agregar un turno para ${worker.name}: falta ${missing} en su expediente laboral.`);
            return;
        }
        openCreate({
            userId: worker.id,
            date,
            branchId: defaultBranchId,
            jobPositionId: defaultJobPositionId,
        });
    };

    const openEdit = (shift: HrScheduleShift, schedule: HrWeeklySchedule) => {
        if (!canManageSchedule || mutationBusy || fromCache) return;
        setEditingShift(shift);
        setNewShiftDefaults(null);
        setEditingScheduleId(schedule.id);
        setEditingScheduleRevision(schedule.revision);
        setConflicts([]);
        setEditorOpen(true);
    };

    const closeEditor = () => {
        if (saving) return;
        setEditorOpen(false);
        setEditingShift(null);
        setNewShiftDefaults(null);
        setEditingScheduleId(null);
        setEditingScheduleRevision(null);
    };

    const configureTemplatesFromShift = () => {
        if (saving) return;
        navigate('/rh/horarios/jornadas');
    };

    const retryTemplates = async () => {
        try {
            const latest = await scheduleClient.getShiftTemplates(branchId ? Number(branchId) : undefined);
            setTemplates(latest);
            setTemplateLoadError(null);
            setLoadWarnings((current) => current.filter((warning) => warning !== templateLoadError));
        } catch (retryError) {
            const message = getScheduleErrorMessage(retryError, 'No se pudieron cargar las jornadas configuradas.');
            setTemplateLoadError(message);
        }
    };

    const fullWeekSchedules = async () => scheduleClient.getSchedules({ weekStart });

    const reloadIfScopeIsCurrent = async (operationScope: string) => {
        if (scopeRef.current === operationScope) await loadWeek();
    };

    const saveShift = async (input: HrScheduleShiftInput) => {
        if (!beginMutation('save')) return;
        const operationScope = scopeKey;
        setConflicts([]);
        try {
            const full = await fullWeekSchedules();
            if (full.fromCache) throw new Error('No se puede modificar un horario cargado desde la caché sin conexión.');
            const target = editingScheduleId
                ? full.schedules.find((schedule) => schedule.id === editingScheduleId)
                : full.schedules.find((schedule) => schedule.status === 'DRAFT');
            if (editingScheduleId && !target) throw new Error('El borrador cambió; recarga la semana.');
            if (editingScheduleId && target?.revision !== editingScheduleRevision) {
                throw new Error('El borrador fue modificado por otro usuario. Recarga la semana antes de guardar.');
            }
            if (!editingScheduleId && target) {
                throw new Error('Otro usuario creó un borrador mientras editabas. Recarga la semana antes de guardar.');
            }
            const changedShift = toScheduledShiftApiInput(input);
            if (target) {
                if (target.status !== 'DRAFT') throw new Error('Sólo se pueden modificar horarios en borrador.');
                if (editingShift && !target.shifts.some((shift) => shift.id === editingShift.id)) {
                    throw new Error('El turno ya no existe en el borrador. Recarga la semana.');
                }
                const shifts = target.shifts.map((shift) =>
                    editingShift && shift.id === editingShift.id ? changedShift : existingShiftApiInput(shift)
                );
                if (!editingShift) shifts.push(changedShift);
                await scheduleClient.updateSchedule(target.id, { expectedRevision: editingScheduleRevision!, shifts });
            } else {
                const published = full.schedules.find((schedule) => schedule.status === 'PUBLISHED');
                await scheduleClient.createSchedule({
                    weekStart,
                    shifts: seedDraftFromPublished(published, changedShift),
                });
            }
            showSuccess(editingShift ? 'Turno actualizado.' : 'Turno agregado al borrador.');
            setEditorOpen(false);
            setEditingShift(null);
            setNewShiftDefaults(null);
            setEditingScheduleId(null);
            setEditingScheduleRevision(null);
            await reloadIfScopeIsCurrent(operationScope);
        } catch (saveError) {
            const serverConflicts = getScheduleConflicts(saveError);
            if (serverConflicts.length > 0) setConflicts(serverConflicts);
            showError(getScheduleErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'No fue posible guardar el turno.'));
        } finally {
            finishMutation();
        }
    };

    const deleteShift = async (shift: HrScheduleShift, schedule: HrWeeklySchedule) => {
        if (!beginMutation('delete')) return;
        const operationScope = scopeKey;
        const accepted = await confirm('¿Eliminar este turno del borrador?', { title: 'Eliminar turno', confirmText: 'Eliminar', variant: 'warning' });
        if (!accepted) {
            finishMutation();
            return;
        }
        try {
            const full = await fullWeekSchedules();
            if (full.fromCache) throw new Error('No se puede modificar un horario cargado desde la caché sin conexión.');
            const target = full.schedules.find((item) => item.id === schedule.id);
            if (!target || target.status !== 'DRAFT') throw new Error('El borrador ya no está disponible para edición.');
            if (target.revision !== schedule.revision) throw new Error('El borrador fue modificado por otro usuario. Recarga la semana antes de eliminar.');
            if (!target.shifts.some((item) => item.id === shift.id)) throw new Error('El turno ya fue eliminado por otro usuario.');
            await scheduleClient.updateSchedule(target.id, {
                expectedRevision: schedule.revision,
                shifts: target.shifts.filter((item) => item.id !== shift.id).map(existingShiftApiInput),
            });
            showSuccess('Turno eliminado del borrador.');
            await reloadIfScopeIsCurrent(operationScope);
        } catch (deleteError) {
            showError(getScheduleErrorMessage(deleteError, deleteError instanceof Error ? deleteError.message : 'No fue posible eliminar el turno.'));
        } finally {
            finishMutation();
        }
    };

    const publish = async () => {
        if (!primarySchedule || primarySchedule.status !== 'DRAFT' || hasActiveFilters || !beginMutation('publish')) return;
        const operationScope = scopeKey;
        const accepted = await confirm(
            'Al publicar, los usuarios podrán consultar esta versión. Los conflictos bloqueantes deben estar resueltos.',
            { title: 'Publicar horario semanal', confirmText: 'Publicar' }
        );
        if (!accepted) {
            finishMutation();
            return;
        }
        try {
            await scheduleClient.publishSchedule(primarySchedule.id, { expectedRevision: primarySchedule.revision });
            setConflicts([]);
            showSuccess('Horario publicado correctamente.');
            await reloadIfScopeIsCurrent(operationScope);
        } catch (publishError) {
            const serverConflicts = getScheduleConflicts(publishError);
            if (serverConflicts.length > 0) setConflicts(serverConflicts);
            showError(getScheduleErrorMessage(publishError, 'No fue posible publicar el horario.'));
        } finally {
            finishMutation();
        }
    };

    const cancelWeek = async () => {
        if (!primarySchedule || !['DRAFT', 'PUBLISHED'].includes(primarySchedule.status) || hasActiveFilters || !beginMutation('cancel')) return;
        const operationScope = scopeKey;
        const accepted = await confirm(
            primarySchedule.status === 'PUBLISHED'
                ? 'Al cancelar, esta versión dejará de estar vigente. Los intercambios abiertos de esta semana también se cancelarán.'
                : 'Se cancelará este borrador. No podrá publicarse ni editarse después.',
            { title: 'Cancelar horario semanal', confirmText: 'Cancelar horario', variant: 'danger' }
        );
        if (!accepted) {
            finishMutation();
            return;
        }
        try {
            await scheduleClient.cancelSchedule(primarySchedule.id, { expectedRevision: primarySchedule.revision });
            setConflicts([]);
            showSuccess('Horario cancelado correctamente.');
            await reloadIfScopeIsCurrent(operationScope);
        } catch (cancelError) {
            showError(getScheduleErrorMessage(cancelError, 'No fue posible cancelar el horario.'));
        } finally {
            finishMutation();
        }
    };

    const copyToNextWeek = async () => {
        if (!primarySchedule || hasActiveFilters || !beginMutation('copy')) return;
        const targetWeekStart = addDaysDateOnly(weekStart, 7);
        const accepted = await confirm(
            `Se creará un borrador para ${weekLabel(targetWeekStart)}.`,
            { title: 'Copiar horario a la semana siguiente', confirmText: 'Copiar' }
        );
        if (!accepted) {
            finishMutation();
            return;
        }
        try {
            await scheduleClient.copySchedule(primarySchedule.id, { targetWeekStart });
            showSuccess('Semana copiada como borrador.');
            setWeekStart(targetWeekStart);
        } catch (copyError) {
            showError(getScheduleErrorMessage(copyError, 'No fue posible copiar la semana.'));
        } finally {
            finishMutation();
        }
    };

    const branchOptions: Option[] = (lookups.branches ?? []).map((branch) => ({ value: String(branch.id), label: branch.name }));
    const userOptions: Option[] = (lookups.users ?? []).map((user) => ({ value: String(user.id), label: `${user.name} · @${user.username}` }));
    const positionOptions: Option[] = lookups.positions.map((position) => ({ value: String(position.id), label: position.name }));

    const statusMeta = scheduleStatusMeta(primarySchedule?.status);
    const ready = !loading && !error;
    const filtersLocked = mutationBusy || anyEditorOpen;
    const statusTone: Tone = ready ? statusMeta.tone : 'neutral';

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Recursos humanos', 'Horarios']}
                title="Horarios semanales"
                description={(
                    <span className={form.actions}>
                        <Badge tone={statusTone} dot>{ready ? statusMeta.label : 'Cargando…'}</Badge>
                        {fromCache && <Badge tone="warning">Sin conexión</Badge>}
                        <span>{ready ? (fromCache ? 'Copia sin conexión' : statusMeta.hint) : 'Planificación por usuario, puesto y sucursal'}</span>
                        {ready && holidays.length > 0 && <span>· {holidays.length} {holidays.length === 1 ? 'feriado' : 'feriados'} en la semana (pago doble)</span>}
                    </span>
                )}
                actions={(
                    <>
                        <Button variant="ghost" icon={Clock3} onClick={configureTemplatesFromShift} disabled={mutationBusy || anyEditorOpen}>Jornadas configuradas</Button>
                        {ready && canManageSchedule && primarySchedule && (
                            <Button icon={ClipboardCopy} disabled={mutationBusy || hasActiveFilters || fromCache} loading={mutationKind === 'copy'} onClick={() => void copyToNextWeek()}>Copiar semana</Button>
                        )}
                        {ready && canPublishSchedule && primarySchedule && ['DRAFT', 'PUBLISHED'].includes(primarySchedule.status) && (
                            <Button variant="ghost" icon={Ban} disabled={mutationBusy || hasActiveFilters || fromCache} loading={mutationKind === 'cancel'} onClick={() => void cancelWeek()}>Cancelar semana</Button>
                        )}
                        {ready && canPublishSchedule && primarySchedule?.status === 'DRAFT' && (
                            <Button variant="primary" icon={Send} disabled={mutationBusy || hasActiveFilters || fromCache} loading={mutationKind === 'publish'} onClick={() => void publish()}>Publicar semana</Button>
                        )}
                    </>
                )}
            />

            {lookupsError && (
                <div className={`${form.alertDanger} ${form.actions}`} role="alert">
                    <AlertTriangle size={16} aria-hidden="true" /><span>{lookupsError}</span>
                    <Button variant="ghost" icon={RefreshCw} onClick={() => void loadLookups()}>Reintentar catálogos</Button>
                </div>
            )}
            {fromCache && (
                <div className={form.alertWarning} role="alert">
                    Mostrando una copia guardada sin conexión. La edición, publicación, cancelación y copia permanecerán bloqueadas hasta recuperar conexión.
                </div>
            )}
            {ready && primarySchedule?.status === 'CANCELLED' && (
                <div className={form.alertDanger} role="status">
                    Esta versión está cancelada y sus turnos se conservan solo como histórico; puede crear un nuevo borrador para reemplazarla.
                </div>
            )}
            {ready && primarySchedule?.status === 'SUPERSEDED' && (
                <p className={form.help} role="status">
                    Mostrando una versión histórica sustituida por una publicación posterior; sus turnos ya no aplican a marcaje.
                </p>
            )}
            {ready && historicalSchedules.length > 1 && (
                <p className={form.help} role="status">
                    Esta semana conserva {historicalSchedules.length} versiones canceladas o sustituidas en el historial de auditoría.
                </p>
            )}
            {loadWarnings.length > 0 && (
                <div className={`${form.alertWarning} ${form.actions}`} role="alert">
                    <span>{loadWarnings.join(' ')}</span>
                    <Button variant="ghost" icon={RefreshCw} disabled={mutationBusy} onClick={() => void loadWeek()}>Reintentar auxiliares</Button>
                </div>
            )}
            {hasActiveFilters && primarySchedule && (
                <p className={form.help} role="status">
                    Limpia los filtros para revisar el horario completo antes de publicarlo o copiarlo.
                </p>
            )}

            {conflicts.length > 0 && (
                <section className={form.alertDanger} role="alert" aria-labelledby="hr-schedule-conflicts-title">
                    <strong id="hr-schedule-conflicts-title">Conflictos por resolver ({conflicts.length}) · bloquean la publicación</strong>
                    <ul className={form.issueList}>
                        {conflicts.map((conflict, index) => <li key={`${conflict.code}-${conflict.shiftId ?? index}`}><strong>{conflict.code}</strong> {conflict.message}</li>)}
                    </ul>
                </section>
            )}

            <TableToolbar
                actions={hasActiveFilters ? (
                    <Button variant="ghost" disabled={filtersLocked} onClick={() => { setBranchId(''); setUserId(''); setJobPositionId(''); }}>Limpiar</Button>
                ) : undefined}
            >
                <div className={form.weekNav} role="group" aria-label="Navegación semanal">
                    <IconButton icon={ChevronLeft} label="Semana anterior" onClick={() => setWeekStart(addDaysDateOnly(weekStart, -7))} disabled={filtersLocked} />
                    <strong>{weekLabel(weekStart)}</strong>
                    <IconButton icon={ChevronRight} label="Semana siguiente" onClick={() => setWeekStart(addDaysDateOnly(weekStart, 7))} disabled={filtersLocked} />
                    <Button variant="ghost" onClick={() => setWeekStart(currentWeek)} disabled={weekStart === currentWeek || filtersLocked}>Hoy</Button>
                </div>
                <AppSelect<string> aria-label="Sucursal" placeholder="Todas las sucursales" isClearable options={branchOptions} value={branchId || null} onChange={(value) => setBranchId(value ?? '')} isDisabled={filtersLocked} />
                <AppSelect<string> aria-label="Usuario" placeholder="Todos los usuarios" isClearable options={userOptions} value={userId || null} onChange={(value) => setUserId(value ?? '')} isDisabled={filtersLocked} />
                <AppSelect<string> aria-label="Puesto" placeholder="Todos los puestos" isClearable options={positionOptions} value={jobPositionId || null} onChange={(value) => setJobPositionId(value ?? '')} isDisabled={filtersLocked} />
            </TableToolbar>

            <section aria-label={`Turnos de la semana ${weekLabel(weekStart)}`}>
                {loading && <HrLoading text="Cargando horarios…" />}
                {!loading && error && <LoadErrorState message={error} onRetry={() => void loadWeek()} />}
                {!loading && !error && visibleWorkers.length === 0 && !hasShifts && (
                    <EmptyState icon={CalendarDays} title="No hay trabajadores activos autorizados para esta semana y filtros." />
                )}
                {!loading && !error && (visibleWorkers.length > 0 || hasShifts) && (
                    <ScheduleWeekView
                        weekStart={weekStart}
                        schedules={visibleSchedules}
                        holidays={holidays}
                        workers={visibleWorkers}
                        readOnly={mutationBusy || fromCache || !canManageSchedule}
                        onCreate={openCreateForCell}
                        onEdit={openEdit}
                        onDelete={(shift, schedule) => void deleteShift(shift, schedule)}
                    />
                )}
            </section>

            <FullScreenModal
                isOpen={editorOpen}
                onClose={closeEditor}
                breadcrumb={['Recursos humanos', 'Horarios']}
                title={editingShift ? 'Editar turno' : newShiftDefaults ? 'Asignar jornada' : 'Nuevo turno'}
                footer={<HrModalFooterSlot />}
            >
                <ScheduleShiftForm
                    weekStart={weekStart}
                    shift={editingShift}
                    users={lookups.users ?? []}
                    branches={lookups.branches ?? []}
                    positions={lookups.positions}
                    templates={templates}
                    templateLoadError={templateLoadError}
                    initialAssignment={newShiftDefaults}
                    conflicts={conflicts}
                    saving={saving}
                    onCancel={closeEditor}
                    onConfigureTemplates={configureTemplatesFromShift}
                    onRetryTemplates={() => void retryTemplates()}
                    onSubmit={saveShift}
                />
            </FullScreenModal>
        </PageContent>
    );
}
