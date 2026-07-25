import { useEffect, useMemo, useState } from 'react';
import type { SingleValue } from 'react-select';
import { Briefcase, Building2, Clock3, Edit2, Palette, Plus, Power, RotateCcw } from 'lucide-react';
import Button from '../Button';
import Select from '../Select';
import type { HrNamedEntity } from '../../types/hr';
import type {
    HrShiftTemplate,
    HrShiftTemplateCreatePayload,
} from '../../types/hr-schedule';
import { shiftCrossesMidnight } from './scheduleDates';

type Option = { value: string; label: string };

interface ShiftTemplateCatalogProps {
    templates: HrShiftTemplate[];
    branches: HrNamedEntity[];
    canManage: boolean;
    disabled?: boolean;
    error?: string | null;
    onCreate: () => void;
    onEdit: (template: HrShiftTemplate) => void;
    onRetry?: () => void;
    onToggleActive: (template: HrShiftTemplate) => void;
}

interface ShiftTemplateFormProps {
    template?: HrShiftTemplate | null;
    initialBranchId?: number;
    initialJobPositionId?: number;
    branches: HrNamedEntity[];
    positions: HrNamedEntity[];
    saving?: boolean;
    error?: string | null;
    onCancel: () => void;
    onSubmit: (payload: HrShiftTemplateCreatePayload) => Promise<void> | void;
}

const COLOR_OPTIONS = [
    { value: '#2563EB', label: 'Azul' },
    { value: '#0F766E', label: 'Verde azulado' },
    { value: '#A16207', label: 'Ámbar' },
    { value: '#7C3AED', label: 'Violeta' },
    { value: '#BE123C', label: 'Carmesí' },
    { value: '#0369A1', label: 'Celeste oscuro' },
] as const;
const HEX_COLOR = /^#[0-9A-F]{6}$/;

function templateColor(color: string | undefined): string {
    const normalized = color?.toUpperCase();
    return normalized && HEX_COLOR.test(normalized) ? normalized : COLOR_OPTIONS[0].value;
}

function templateState(
    template?: HrShiftTemplate | null,
    initialBranchId?: number,
    initialJobPositionId?: number,
) {
    return {
        name: template?.name ?? '',
        code: template?.code ?? '',
        branchId: template ? String(template.branchId) : initialBranchId ? String(initialBranchId) : '',
        jobPositionId: template?.jobPositionId
            ? String(template.jobPositionId)
            : initialJobPositionId ? String(initialJobPositionId) : '',
        startTime: template?.startTime.slice(0, 5) ?? '08:00',
        endTime: template?.endTime.slice(0, 5) ?? '17:00',
        breakMinutes: String(template?.breakMinutes ?? 0),
        paidBreak: template?.paidBreak ?? false,
        notes: template?.notes ?? '',
        color: templateColor(template?.color),
    };
}

function optionFor(items: Array<{ id: number; name: string }>, id: string): Option | null {
    const item = items.find((candidate) => String(candidate.id) === id);
    return item ? { value: id, label: item.name } : null;
}

export function ShiftTemplateCatalog({
    templates,
    branches,
    canManage,
    disabled = false,
    error,
    onCreate,
    onEdit,
    onRetry,
    onToggleActive,
}: ShiftTemplateCatalogProps) {
    const branchNames = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.name])), [branches]);

    return (
        <section className="hr-template-catalog" aria-labelledby="hr-template-catalog-title">
            <header>
                <div>
                    <h2 id="hr-template-catalog-title">Jornadas configuradas</h2>
                    <p>Reutiliza horarios consistentes y distingue cada jornada por su color.</p>
                </div>
                {canManage && (
                    <Button size="sm" variant="secondary" onClick={onCreate} disabled={disabled}>
                        <Plus size={16} aria-hidden="true" /> Nueva jornada
                    </Button>
                )}
            </header>

            {error ? (
                <div className="hr-schedule-alert danger hr-template-load-error" role="alert">
                    <span>{error}</span>
                    {onRetry && <Button size="sm" variant="ghost" onClick={onRetry} disabled={disabled}>Reintentar jornadas</Button>}
                </div>
            ) : templates.length === 0 ? (
                <div className="hr-template-empty" role="status">
                    <Palette size={25} aria-hidden="true" />
                    <span>No hay jornadas configuradas para el alcance seleccionado.</span>
                    {canManage && <Button size="sm" variant="ghost" onClick={onCreate} disabled={disabled}>Crear la primera</Button>}
                </div>
            ) : (
                <div className="hr-template-list" aria-label={`${templates.length} jornadas configuradas`}>
                    {templates.map((template) => {
                        const color = templateColor(template.color);
                        const branchName = template.branch?.name ?? branchNames.get(template.branchId) ?? `Sucursal #${template.branchId}`;
                        return (
                            <article
                                key={template.id}
                                className={`hr-template-card ${template.active === false ? 'is-inactive' : ''}`}
                                style={{ '--template-color': color } as React.CSSProperties}
                            >
                                <div className="hr-template-card-heading">
                                    <span className="hr-template-swatch" aria-hidden="true" />
                                    <div>
                                        <strong>{template.name}</strong>
                                        <small>{template.active === false ? 'Inactiva' : 'Activa'} · {template.code}</small>
                                    </div>
                                </div>
                                <div className="hr-template-card-detail"><Clock3 size={14} aria-hidden="true" /><span>{template.startTime.slice(0, 5)}–{template.endTime.slice(0, 5)}{template.crossesMidnight ? ' (+1 día)' : ''}</span></div>
                                <div className="hr-template-card-detail"><Building2 size={14} aria-hidden="true" /><span>{branchName}</span></div>
                                {template.jobPosition?.name && <div className="hr-template-card-detail"><Briefcase size={14} aria-hidden="true" /><span>{template.jobPosition.name}</span></div>}
                                {canManage && (
                                    <div className="hr-template-card-actions">
                                        <button type="button" onClick={() => onEdit(template)} disabled={disabled} aria-label={`Editar jornada ${template.name}`}>
                                            <Edit2 size={15} aria-hidden="true" /> Editar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onToggleActive(template)}
                                            disabled={disabled}
                                            aria-label={`${template.active === false ? 'Reactivar' : 'Desactivar'} jornada ${template.name}`}
                                        >
                                            {template.active === false ? <RotateCcw size={15} aria-hidden="true" /> : <Power size={15} aria-hidden="true" />}
                                            {template.active === false ? 'Reactivar' : 'Desactivar'}
                                        </button>
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

export function ShiftTemplateForm({
    template,
    initialBranchId,
    initialJobPositionId,
    branches,
    positions,
    saving = false,
    error,
    onCancel,
    onSubmit,
}: ShiftTemplateFormProps) {
    const [form, setForm] = useState(() => templateState(template, initialBranchId, initialJobPositionId));
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        setForm(templateState(template, initialBranchId, initialJobPositionId));
        setValidationError(null);
    }, [initialBranchId, initialJobPositionId, template]);

    const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
        setForm((current) => ({ ...current, [field]: value }));
        setValidationError(null);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim() || !form.code.trim() || !form.branchId) {
            setValidationError('Completa nombre, código y sucursal.');
            return;
        }
        if (form.startTime === form.endTime) {
            setValidationError('La hora de inicio y fin no pueden ser iguales.');
            return;
        }
        const breakMinutes = Number(form.breakMinutes);
        if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 2880) {
            setValidationError('El descanso debe ser un entero entre 0 y 2880 minutos.');
            return;
        }
        const [startHour, startMinute] = form.startTime.split(':').map(Number);
        const [endHour, endMinute] = form.endTime.split(':').map(Number);
        const start = startHour * 60 + startMinute;
        const end = endHour * 60 + endMinute;
        const duration = end > start ? end - start : 1440 - start + end;
        if (breakMinutes >= duration) {
            setValidationError('El descanso debe ser menor que la duración de la jornada.');
            return;
        }
        if (!HEX_COLOR.test(form.color.toUpperCase())) {
            setValidationError('Selecciona un color válido.');
            return;
        }
        await onSubmit({
            branchId: Number(form.branchId),
            jobPositionId: form.jobPositionId ? Number(form.jobPositionId) : null,
            name: form.name.trim(),
            code: form.code.trim().toUpperCase(),
            startTime: form.startTime,
            endTime: form.endTime,
            breakMinutes,
            paidBreak: form.paidBreak,
            notes: form.notes.trim() || null,
            color: form.color.toUpperCase(),
        });
    };

    const overnight = shiftCrossesMidnight({ startTime: form.startTime, endTime: form.endTime });
    const visibleError = validationError ?? error;

    return (
        <form className="modal-form-new hr-template-form" onSubmit={submit}>
            {visibleError && <div className="hr-schedule-alert danger" role="alert">{visibleError}</div>}
            <div className="modal-form-row">
                <div className="modal-input-group">
                    <label htmlFor="hr-template-name">Nombre</label>
                    <input id="hr-template-name" className="modal-standard-input" value={form.name} maxLength={100} onChange={(event) => update('name', event.target.value)} required />
                </div>
                <div className="modal-input-group">
                    <label htmlFor="hr-template-code">Código</label>
                    <input id="hr-template-code" className="modal-standard-input" value={form.code} maxLength={30} onChange={(event) => update('code', event.target.value)} placeholder="APERTURA" required />
                </div>
            </div>
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
                    label="Puesto (opcional)"
                    options={positions.filter((position) => position.active !== false).map((position) => ({ value: String(position.id), label: position.name }))}
                    value={optionFor(positions, form.jobPositionId)}
                    onChange={(option: SingleValue<Option>) => update('jobPositionId', option?.value ?? '')}
                    isClearable
                    isSearchable
                />
            </div>
            <div className="modal-form-row">
                <div className="modal-input-group">
                    <label htmlFor="hr-template-start">Inicio</label>
                    <input id="hr-template-start" className="modal-standard-input" type="time" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} required />
                </div>
                <div className="modal-input-group">
                    <label htmlFor="hr-template-end">Fin</label>
                    <input id="hr-template-end" className="modal-standard-input" type="time" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} required />
                </div>
            </div>
            {overnight && <p className="hr-shift-overnight-note"><Clock3 size={17} aria-hidden="true" /> El fin ocurre al día siguiente.</p>}
            <div className="modal-form-row">
                <div className="modal-input-group">
                    <label htmlFor="hr-template-break">Descanso (minutos)</label>
                    <input id="hr-template-break" className="modal-standard-input" type="number" min="0" max="2880" step="1" value={form.breakMinutes} onChange={(event) => update('breakMinutes', event.target.value)} />
                </div>
                <label className="hr-template-checkbox">
                    <input type="checkbox" checked={form.paidBreak} onChange={(event) => update('paidBreak', event.target.checked)} />
                    <span>Descanso pagado</span>
                </label>
            </div>
            <fieldset className="hr-template-colors">
                <legend>Color de la jornada</legend>
                <div>
                    {COLOR_OPTIONS.map((color) => (
                        <label key={color.value} title={color.label}>
                            <input
                                type="radio"
                                name="template-color"
                                value={color.value}
                                checked={form.color === color.value}
                                onChange={() => update('color', color.value)}
                            />
                            <span style={{ '--template-color': color.value } as React.CSSProperties} aria-hidden="true" />
                            <span className="sr-only">{color.label}</span>
                        </label>
                    ))}
                    <label className="hr-template-custom-color">
                        <span>Personalizado</span>
                        <input aria-label="Color personalizado de la jornada" type="color" value={form.color} onChange={(event) => update('color', event.target.value.toUpperCase())} />
                    </label>
                </div>
            </fieldset>
            <div className="modal-input-group">
                <label htmlFor="hr-template-notes">Notas</label>
                <textarea id="hr-template-notes" className="modal-textarea" rows={3} maxLength={5000} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
            </div>
            {template && (
                <p className="hr-schedule-context-note">
                    Los cambios aplican a asignaciones nuevas; los turnos ya guardados conservan sus horas y descanso.
                </p>
            )}
            <div className="modal-footer">
                <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : template ? 'Guardar cambios' : 'Crear jornada'}</Button>
            </div>
        </form>
    );
}
