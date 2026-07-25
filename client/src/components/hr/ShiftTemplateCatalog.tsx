import { useEffect, useState, type CSSProperties } from 'react';
import { Briefcase, Building2, Clock3, Edit2, Palette, Power, RotateCcw } from 'lucide-react';
import Button from '../Button';
import HrModalFormShell from './HrModalFormShell';
import type { HrShiftTemplate } from '../../types/hr-schedule';
import { shiftCrossesMidnight } from './scheduleDates';

interface ShiftTemplateCatalogProps {
    templates: HrShiftTemplate[];
    canManage: boolean;
    disabled?: boolean;
    onCreate: () => void;
    onEdit: (template: HrShiftTemplate) => void;
    onToggleActive: (template: HrShiftTemplate) => void;
}

interface ShiftTemplateFormProps {
    template?: HrShiftTemplate | null;
    saving?: boolean;
    error?: string | null;
    onCancel: () => void;
    onSubmit: (values: ShiftTemplateFormValues) => Promise<void> | void;
}

export interface ShiftTemplateFormValues {
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    notes: string | null;
    color: string;
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

function templateState(template?: HrShiftTemplate | null) {
    return {
        name: template?.name ?? '',
        startTime: template?.startTime.slice(0, 5) ?? '08:00',
        endTime: template?.endTime.slice(0, 5) ?? '17:00',
        breakMinutes: String(template?.breakMinutes ?? 0),
        notes: template?.notes ?? '',
        color: templateColor(template?.color),
    };
}

export function ShiftTemplateCatalog({
    templates,
    canManage,
    disabled = false,
    onCreate,
    onEdit,
    onToggleActive,
}: ShiftTemplateCatalogProps) {
    if (templates.length === 0) {
        return (
            <div className="hr-template-empty" role="status">
                <Palette size={32} aria-hidden="true" />
                <strong>No hay jornadas configuradas.</strong>
                <span>Crea una jornada reutilizable para comenzar a asignar horarios.</span>
                {canManage && <Button size="sm" onClick={onCreate} disabled={disabled}>Crear la primera jornada</Button>}
            </div>
        );
    }

    return (
        <section className="hr-template-list" aria-label={`${templates.length} jornadas configuradas`}>
            {templates.map((template) => {
                const color = templateColor(template.color);
                const scopeName = template.branchId === null
                    ? 'Todas las sucursales'
                    : template.branch?.name ?? `Sucursal #${template.branchId}`;
                return (
                    <article
                        key={template.id}
                        className={`hr-template-card ${template.active === false ? 'is-inactive' : ''}`}
                        style={{ '--template-color': color } as CSSProperties}
                    >
                        <div className="hr-template-card-heading">
                            <span className="hr-template-swatch" aria-hidden="true" />
                            <div>
                                <strong>{template.name}</strong>
                                <small>{template.active === false ? 'Inactiva' : 'Activa'}</small>
                            </div>
                        </div>
                        <div className="hr-template-card-detail">
                            <Clock3 size={14} aria-hidden="true" />
                            <span>{template.startTime.slice(0, 5)}–{template.endTime.slice(0, 5)}{template.crossesMidnight ? ' (+1 día)' : ''}</span>
                        </div>
                        <div className="hr-template-card-detail"><Building2 size={14} aria-hidden="true" /><span>{scopeName}</span></div>
                        {template.jobPosition?.name && <div className="hr-template-card-detail"><Briefcase size={14} aria-hidden="true" /><span>{template.jobPosition.name}</span></div>}
                        {(template.breakMinutes ?? 0) > 0 && <small className="hr-template-break">Descanso: {template.breakMinutes} min</small>}
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
        </section>
    );
}

export function ShiftTemplateForm({
    template,
    saving = false,
    error,
    onCancel,
    onSubmit,
}: ShiftTemplateFormProps) {
    const [form, setForm] = useState(() => templateState(template));
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        setForm(templateState(template));
        setValidationError(null);
    }, [template]);

    const update = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
        setForm((current) => ({ ...current, [field]: value }));
        setValidationError(null);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim()) {
            setValidationError('El nombre es obligatorio.');
            return;
        }
        if (!form.startTime || !form.endTime || form.startTime === form.endTime) {
            setValidationError('La hora de entrada y salida deben ser diferentes.');
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
            name: form.name.trim(),
            startTime: form.startTime,
            endTime: form.endTime,
            breakMinutes,
            notes: form.notes.trim() || null,
            color: form.color.toUpperCase(),
        });
    };

    const overnight = shiftCrossesMidnight({ startTime: form.startTime, endTime: form.endTime });
    const visibleError = validationError ?? error;

    return (
        <HrModalFormShell
            ariaLabel="Formulario de jornada"
            tabLabel="Jornada"
            sectionTitle={template ? 'Editar jornada configurada' : 'Nueva jornada configurada'}
            icon={<Clock3 size={18} aria-hidden="true" />}
            onSubmit={submit}
            formClassName="hr-template-form"
            notice={visibleError ? <div className="hr-template-alert danger" role="alert">{visibleError}</div> : undefined}
            footer={(
                <>
                    <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
                    <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : template ? 'Guardar cambios' : 'Crear jornada'}</Button>
                </>
            )}
        >
            <div className="modal-input-group hr-modal-form-grid-full">
                <label htmlFor="hr-template-name">Nombre</label>
                <input id="hr-template-name" className="modal-standard-input" value={form.name} maxLength={100} onChange={(event) => update('name', event.target.value)} required />
            </div>
            <div className="modal-input-group">
                <label htmlFor="hr-template-start">Entrada</label>
                <input id="hr-template-start" className="modal-standard-input" type="time" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} required />
            </div>
            <div className="modal-input-group">
                <label htmlFor="hr-template-end">Salida</label>
                <input id="hr-template-end" className="modal-standard-input" type="time" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} required />
            </div>
            {overnight && <p className="hr-template-overnight hr-modal-form-grid-full"><Clock3 size={17} aria-hidden="true" /> La salida ocurre al día siguiente.</p>}
            <div className="modal-input-group hr-modal-form-grid-full">
                <label htmlFor="hr-template-break">Descanso (minutos)</label>
                <input id="hr-template-break" className="modal-standard-input" type="number" min="0" max="2880" step="1" value={form.breakMinutes} onChange={(event) => update('breakMinutes', event.target.value)} />
            </div>
            <fieldset className="hr-template-colors hr-modal-form-grid-full">
                <legend>Color</legend>
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
                            <span style={{ '--template-color': color.value } as CSSProperties} aria-hidden="true" />
                            <span className="sr-only">{color.label}</span>
                        </label>
                    ))}
                    <label className="hr-template-custom-color">
                        <span>Personalizado</span>
                        <input aria-label="Color personalizado" type="color" value={form.color} onChange={(event) => update('color', event.target.value.toUpperCase())} />
                    </label>
                </div>
            </fieldset>
            <div className="modal-input-group hr-modal-form-grid-full">
                <label htmlFor="hr-template-notes">Notas</label>
                <textarea id="hr-template-notes" className="modal-textarea" rows={3} maxLength={5000} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
            </div>
            {template && (
                <p className="hr-template-context hr-modal-form-grid-full">
                    Los cambios aplican a asignaciones nuevas; los turnos guardados conservan sus datos históricos.
                </p>
            )}
        </HrModalFormShell>
    );
}
