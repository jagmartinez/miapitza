import { useEffect, useMemo, useState } from 'react';
import type { SingleValue } from 'react-select';
import { Clock3, UserRound } from 'lucide-react';
import Button from '../Button';
import Select from '../Select';
import type { HrNamedEntity, HrUserSummary } from '../../types/hr';
import type { HrScheduleShift, HrScheduleShiftInput, HrShiftTemplate } from '../../types/hr-schedule';
import { addDaysDateOnly, isDateInWeek, shiftCrossesMidnight } from './scheduleDates';

type Option = { value: string; label: string };
type FormTab = 'assignment' | 'schedule';

interface ScheduleShiftFormProps {
    weekStart: string;
    shift?: HrScheduleShift | null;
    users: HrUserSummary[];
    branches: HrNamedEntity[];
    positions: HrNamedEntity[];
    templates?: HrShiftTemplate[];
    initialAssignment?: {
        userId?: number;
        branchId?: number;
        jobPositionId?: number;
        date?: string;
    } | null;
    conflicts?: Array<{ code: string; message: string }>;
    templateLoadError?: string | null;
    saving?: boolean;
    onCancel: () => void;
    onConfigureTemplates?: () => void;
    onRetryTemplates?: () => void;
    onSubmit: (shift: HrScheduleShiftInput) => Promise<void> | void;
}

function stateFor(
    weekStart: string,
    shift?: HrScheduleShift | null,
    initialAssignment?: ScheduleShiftFormProps['initialAssignment'],
) {
    return {
        userId: shift ? String(shift.userId) : initialAssignment?.userId ? String(initialAssignment.userId) : '',
        branchId: shift ? String(shift.branchId) : initialAssignment?.branchId ? String(initialAssignment.branchId) : '',
        jobPositionId: shift?.jobPositionId
            ? String(shift.jobPositionId)
            : initialAssignment?.jobPositionId ? String(initialAssignment.jobPositionId) : '',
        date: shift?.date ?? initialAssignment?.date ?? weekStart,
        startTime: shift?.startTime.slice(0, 5) ?? '08:00',
        endTime: shift?.endTime.slice(0, 5) ?? '17:00',
        breakMinutes: String(shift?.breakMinutes ?? 0),
        notes: shift?.notes ?? '',
        templateId: shift?.shiftTemplateId ? String(shift.shiftTemplateId) : '',
    };
}

function optionFor(items: Array<{ id: number; name: string }>, id: string): Option | null {
    const item = items.find((candidate) => String(candidate.id) === id);
    return item ? { value: id, label: item.name } : null;
}

export default function ScheduleShiftForm({
    weekStart,
    shift,
    users,
    branches,
    positions,
    templates = [],
    initialAssignment,
    conflicts = [],
    templateLoadError,
    saving = false,
    onCancel,
    onConfigureTemplates,
    onRetryTemplates,
    onSubmit,
}: ScheduleShiftFormProps) {
    const contextualCreate = !shift && Boolean(initialAssignment);
    const [form, setForm] = useState(() => stateFor(weekStart, shift, initialAssignment));
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<FormTab>(contextualCreate ? 'schedule' : 'assignment');

    useEffect(() => {
        setForm(stateFor(weekStart, shift, initialAssignment));
        setError(null);
        setActiveTab(contextualCreate ? 'schedule' : 'assignment');
    }, [contextualCreate, initialAssignment, shift, weekStart]);

    const activeTemplates = useMemo(() => templates.filter((template) => template.active !== false), [templates]);
    const compatibleTemplates = useMemo(() => {
        if (!contextualCreate) return activeTemplates;
        return activeTemplates.filter((template) =>
            (template.branchId === null || template.branchId === initialAssignment?.branchId) &&
            (!template.jobPositionId || template.jobPositionId === initialAssignment?.jobPositionId)
        );
    }, [activeTemplates, contextualCreate, initialAssignment?.branchId, initialAssignment?.jobPositionId]);
    const overnight = shiftCrossesMidnight({ startTime: form.startTime, endTime: form.endTime });
    const update = (field: keyof typeof form, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
        setError(null);
    };

    const applyTemplate = (option: SingleValue<Option>) => {
        const template = compatibleTemplates.find((item) => String(item.id) === option?.value);
        setForm((current) => ({
            ...current,
            templateId: option?.value ?? '',
            ...(template ? {
                startTime: template.startTime.slice(0, 5),
                endTime: template.endTime.slice(0, 5),
                breakMinutes: String(template.breakMinutes ?? 0),
                ...(!contextualCreate ? {
                    branchId: template.branchId === null ? current.branchId : String(template.branchId),
                    jobPositionId: template.jobPositionId ? String(template.jobPositionId) : current.jobPositionId,
                } : {}),
            } : {}),
        }));
        setError(null);
    };

    useEffect(() => {
        if (!contextualCreate) return;
        setForm((current) => {
            const selected = compatibleTemplates.find((template) => String(template.id) === current.templateId);
            const template = selected ?? (compatibleTemplates.length === 1 ? compatibleTemplates[0] : undefined);
            if (!template) return current.templateId ? { ...current, templateId: '' } : current;
            return {
                ...current,
                templateId: String(template.id),
                startTime: template.startTime.slice(0, 5),
                endTime: template.endTime.slice(0, 5),
                breakMinutes: String(template.breakMinutes ?? 0),
            };
        });
    }, [compatibleTemplates, contextualCreate]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.userId || !form.branchId || !form.jobPositionId) {
            setError(contextualCreate
                ? 'No se puede programar esta celda porque faltan la sucursal o el puesto del trabajador.'
                : 'Selecciona usuario, sucursal y puesto.');
            if (!contextualCreate) setActiveTab('assignment');
            return;
        }
        if (contextualCreate && !form.templateId) {
            setError('Selecciona una jornada configurada.');
            return;
        }
        if (!isDateInWeek(form.date, weekStart)) {
            setError('La fecha debe pertenecer a la semana abierta.');
            setActiveTab('schedule');
            return;
        }
        if (!form.startTime || !form.endTime) {
            setError('Define la hora de inicio y fin.');
            setActiveTab('schedule');
            return;
        }
        if (form.startTime === form.endTime) {
            setError('La hora de inicio y fin no pueden ser iguales.');
            setActiveTab('schedule');
            return;
        }
        const breakMinutes = Number(form.breakMinutes);
        if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720) {
            setError('El descanso debe ser un entero entre 0 y 720 minutos.');
            setActiveTab('schedule');
            return;
        }
        await onSubmit({
            userId: Number(form.userId),
            branchId: Number(form.branchId),
            jobPositionId: Number(form.jobPositionId),
            shiftTemplateId: form.templateId ? Number(form.templateId) : null,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            breakMinutes,
            notes: form.notes.trim() || null,
        });
    };

    return (
        <div className="premium-modal-content hr-shift-modal-content">
            {!contextualCreate && <div className="modal-tabs" role="tablist" aria-label="Secciones del turno">
                <button type="button" role="tab" aria-selected={activeTab === 'assignment'} className={`modal-tab ${activeTab === 'assignment' ? 'active' : ''}`} onClick={() => setActiveTab('assignment')}>
                    <UserRound size={18} aria-hidden="true" /><span>Asignación</span>
                </button>
                <button type="button" role="tab" aria-selected={activeTab === 'schedule'} className={`modal-tab ${activeTab === 'schedule' ? 'active' : ''}`} onClick={() => setActiveTab('schedule')}>
                    <Clock3 size={18} aria-hidden="true" /><span>Jornada</span>
                </button>
            </div>}
            <form className="modal-form-new hr-shift-form" onSubmit={submit}>
              <div className="modal-tab-content">
                {error && <div className="hr-schedule-alert danger" role="alert">{error}</div>}
                {conflicts.length > 0 && (
                    <div className="hr-schedule-form-conflicts" role="alert" aria-label="Conflictos del turno">
                        <strong>Conflictos por resolver</strong>
                        <ul>
                            {conflicts.map((conflict, index) => (
                                <li key={`${conflict.code}-${index}`}><strong>{conflict.code}</strong> {conflict.message}</li>
                            ))}
                        </ul>
                    </div>
                )}
                {!contextualCreate && activeTab === 'assignment' && <section className="modal-content-group" role="tabpanel">
                <div className="modal-section-header"><UserRound size={18} aria-hidden="true" /><h3>Persona y lugar de trabajo</h3></div>
                {activeTemplates.length > 0 && (
                    <Select<Option>
                        variant="modal"
                        label="Plantilla de turno (opcional)"
                        options={activeTemplates.map((template) => ({ value: String(template.id), label: template.name }))}
                        value={activeTemplates.find((template) => String(template.id) === form.templateId)
                            ? { value: form.templateId, label: activeTemplates.find((template) => String(template.id) === form.templateId)!.name }
                            : null}
                        onChange={applyTemplate}
                        isClearable
                    />
                )}
                <Select<Option>
                    variant="modal"
                    label="Usuario"
                    options={users.filter((user) =>
                        user.status !== 'INACTIVE' &&
                        user.employee?.status !== 'INACTIVE' &&
                        user.employee?.status !== 'TERMINATED'
                    ).map((user) => ({ value: String(user.id), label: `${user.name} · @${user.username}` }))}
                    value={users.find((user) => String(user.id) === form.userId)
                        ? { value: form.userId, label: `${users.find((user) => String(user.id) === form.userId)!.name} · @${users.find((user) => String(user.id) === form.userId)!.username}` }
                        : null}
                    onChange={(option: SingleValue<Option>) => update('userId', option?.value ?? '')}
                    isSearchable
                />
                <div className="modal-form-row">
                    <Select<Option>
                        variant="modal"
                        label="Sucursal"
                        options={branches.filter((branch) => branch.status !== 'INACTIVE').map((branch) => ({ value: String(branch.id), label: branch.name }))}
                        value={optionFor(branches, form.branchId)}
                        onChange={(option: SingleValue<Option>) => update('branchId', option?.value ?? '')}
                        isSearchable
                    />
                    <Select<Option>
                        variant="modal"
                        label="Puesto"
                        options={positions.filter((position) => position.active !== false).map((position) => ({ value: String(position.id), label: position.name }))}
                        value={optionFor(positions, form.jobPositionId)}
                        onChange={(option: SingleValue<Option>) => update('jobPositionId', option?.value ?? '')}
                        isSearchable
                    />
                </div>
                </section>}
                {activeTab === 'schedule' && <section className="modal-content-group" role={contextualCreate ? undefined : 'tabpanel'}>
                {contextualCreate ? (
                    templateLoadError ? (
                        <div className="hr-schedule-alert danger" role="alert">
                            <span>{templateLoadError}</span>
                            {onRetryTemplates && (
                                <Button type="button" size="sm" variant="ghost" onClick={onRetryTemplates}>
                                    Reintentar jornadas
                                </Button>
                            )}
                        </div>
                    ) : compatibleTemplates.length > 0 ? (
                        <Select<Option>
                            variant="modal"
                            label="Jornada configurada"
                            options={compatibleTemplates.map((template) => ({
                                value: String(template.id),
                                label: `${template.name} · ${template.startTime.slice(0, 5)}–${template.endTime.slice(0, 5)}`,
                            }))}
                            value={compatibleTemplates.find((template) => String(template.id) === form.templateId)
                                ? {
                                    value: form.templateId,
                                    label: `${compatibleTemplates.find((template) => String(template.id) === form.templateId)!.name} · ${compatibleTemplates.find((template) => String(template.id) === form.templateId)!.startTime.slice(0, 5)}–${compatibleTemplates.find((template) => String(template.id) === form.templateId)!.endTime.slice(0, 5)}`,
                                }
                                : null}
                            onChange={applyTemplate}
                            placeholder="Selecciona una jornada"
                        />
                    ) : (
                        <div className="hr-shift-template-empty" role="status">
                            <Clock3 size={25} aria-hidden="true" />
                            <span>No hay jornadas activas compatibles con la sucursal y el puesto de este trabajador.</span>
                            {onConfigureTemplates && (
                                <Button type="button" size="sm" variant="secondary" onClick={onConfigureTemplates}>
                                    Configurar jornadas
                                </Button>
                            )}
                        </div>
                    )
                ) : <>
                    <div className="modal-section-header"><Clock3 size={18} aria-hidden="true" /><h3>Jornada</h3></div>
                    <div className="modal-input-group">
                        <label htmlFor="hr-shift-date">Fecha</label>
                        <input id="hr-shift-date" className="modal-standard-input" type="date" min={weekStart} max={addDaysDateOnly(weekStart, 6)} value={form.date} onChange={(event) => update('date', event.target.value)} required />
                    </div>
                    <div className="modal-form-row">
                        <div className="modal-input-group">
                            <label htmlFor="hr-shift-start">Inicio</label>
                            <input id="hr-shift-start" className="modal-standard-input" type="time" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} required />
                        </div>
                        <div className="modal-input-group">
                            <label htmlFor="hr-shift-end">Fin</label>
                            <input id="hr-shift-end" className="modal-standard-input" type="time" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} required />
                        </div>
                    </div>
                    {overnight && <p className="hr-shift-overnight-note"><Clock3 size={17} aria-hidden="true" /> El fin ocurre al día siguiente; el turno cruza medianoche.</p>}
                    <div className="modal-input-group">
                        <label htmlFor="hr-shift-break">Descanso no laborado (minutos)</label>
                        <input id="hr-shift-break" className="modal-standard-input" type="number" min="0" max="720" step="1" value={form.breakMinutes} onChange={(event) => update('breakMinutes', event.target.value)} />
                    </div>
                    <div className="modal-input-group">
                        <label htmlFor="hr-shift-notes">Notas</label>
                        <textarea id="hr-shift-notes" className="modal-textarea" rows={3} maxLength={500} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
                    </div>
                </>}
                </section>}
              </div>
              <div className="modal-footer">
                <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
                {!contextualCreate && activeTab === 'assignment'
                    ? <Button type="button" onClick={(event) => {
                        event.preventDefault();
                        setActiveTab('schedule');
                    }}>Continuar</Button>
                    : <Button type="submit" disabled={saving || (contextualCreate && !form.templateId)}>{saving ? 'Guardando…' : shift ? 'Guardar turno' : contextualCreate ? 'Asignar jornada' : 'Agregar turno'}</Button>}
              </div>
            </form>
        </div>
    );
}
