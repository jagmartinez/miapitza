import { useEffect, useState, type ReactNode } from 'react';
import { Clock3, Edit2, Palette, Power, RotateCcw } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, Field, IconButton, Input, Textarea, type Column } from '@/ui';
import styles from './hrForm.module.css';
import HrModalFormShell from './HrModalFormShell';
import type { HrShiftTemplate } from '../../types/hr-schedule';
import { shiftCrossesMidnight } from './scheduleDates';

interface ShiftTemplateCatalogProps {
    templates: HrShiftTemplate[];
    canManage: boolean;
    disabled?: boolean;
    loading?: boolean;
    toolbar?: ReactNode;
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
    loading = false,
    toolbar,
    onCreate,
    onEdit,
    onToggleActive,
}: ShiftTemplateCatalogProps) {
    const columns: Column<HrShiftTemplate>[] = [
        {
            key: 'name',
            header: 'Jornada',
            accessor: (template) => template.name,
            sortable: true,
            render: (template) => (
                <span className={styles.nameCell}>
                    <span className={styles.swatch} style={{ background: templateColor(template.color) }} aria-hidden="true" />
                    {template.name}
                </span>
            ),
        },
        {
            key: 'hours',
            header: 'Horario',
            render: (template) => `${template.startTime.slice(0, 5)}–${template.endTime.slice(0, 5)}${template.crossesMidnight ? ' (+1 día)' : ''}`,
        },
        { key: 'break', header: 'Descanso', type: 'number', render: (template) => ((template.breakMinutes ?? 0) > 0 ? `${template.breakMinutes} min` : '—') },
        {
            key: 'scope',
            header: 'Sucursal',
            render: (template) => (template.branchId === null ? 'Todas las sucursales' : template.branch?.name ?? `Sucursal #${template.branchId}`),
        },
        { key: 'position', header: 'Puesto', hideBelow: 'md', render: (template) => template.jobPosition?.name ?? '—' },
        {
            key: 'status',
            header: 'Estado',
            render: (template) => <Badge tone={template.active === false ? 'neutral' : 'success'} dot>{template.active === false ? 'Inactiva' : 'Activa'}</Badge>,
        },
        ...(canManage ? [{
            key: 'actions',
            header: 'Acciones',
            type: 'actions' as const,
            render: (template: HrShiftTemplate) => (
                <div className={styles.rowActions}>
                    <IconButton icon={Edit2} size="sm" label={`Editar jornada ${template.name}`} onClick={() => onEdit(template)} disabled={disabled} />
                    <IconButton
                        icon={template.active === false ? RotateCcw : Power}
                        size="sm"
                        label={`${template.active === false ? 'Reactivar' : 'Desactivar'} jornada ${template.name}`}
                        onClick={() => onToggleActive(template)}
                        disabled={disabled}
                    />
                </div>
            ),
        }] : []),
    ];

    return (
        <DataTable<HrShiftTemplate>
            ariaLabel={`${templates.length} jornadas configuradas`}
            rows={templates}
            rowKey={(template) => template.id}
            columns={columns}
            loading={loading}
            toolbar={toolbar}
            onRowClick={canManage && !disabled ? onEdit : undefined}
            empty={(
                <EmptyState
                    icon={Palette}
                    title="No hay jornadas configuradas."
                    description="Crea una jornada reutilizable para comenzar a asignar horarios."
                    action={canManage ? <Button variant="primary" size="sm" onClick={onCreate} disabled={disabled}>Crear la primera jornada</Button> : undefined}
                />
            )}
        />
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
            notice={visibleError ? <div className={styles.alertDanger} role="alert">{visibleError}</div> : undefined}
            footer={(
                <>
                    <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancelar</Button>
                    <Button variant="primary" type="submit" loading={saving}>{template ? 'Guardar cambios' : 'Crear jornada'}</Button>
                </>
            )}
        >
            <div className="span-full">
                <Field label="Nombre" htmlFor="hr-template-name" required>
                    <Input id="hr-template-name" value={form.name} maxLength={100} onChange={(event) => update('name', event.target.value)} required />
                </Field>
            </div>
            <Field label="Entrada" htmlFor="hr-template-start" required>
                <Input id="hr-template-start" type="time" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} required />
            </Field>
            <Field label="Salida" htmlFor="hr-template-end" required hint={overnight ? 'La salida ocurre al día siguiente.' : undefined}>
                <Input id="hr-template-end" type="time" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} required />
            </Field>
            <Field label="Descanso (minutos)" htmlFor="hr-template-break">
                <Input id="hr-template-break" type="number" min="0" max="2880" step="1" value={form.breakMinutes} onChange={(event) => update('breakMinutes', event.target.value)} />
            </Field>
            <fieldset className={`${styles.fieldset} span-full`}>
                <legend>Color</legend>
                <div className={styles.checkRow} role="radiogroup" aria-label="Color de la jornada">
                    {COLOR_OPTIONS.map((color) => (
                        <label key={color.value} title={color.label} className={styles.colorOption}>
                            <input
                                type="radio"
                                name="template-color"
                                value={color.value}
                                checked={form.color === color.value}
                                onChange={() => update('color', color.value)}
                            />
                            <span className={styles.swatch} style={{ background: color.value }} aria-hidden="true" />
                            <span className="sr-only">{color.label}</span>
                        </label>
                    ))}
                    <label className={styles.colorOption}>
                        <span>Personalizado</span>
                        <input aria-label="Color personalizado" type="color" className={styles.colorInput} value={form.color} onChange={(event) => update('color', event.target.value.toUpperCase())} />
                    </label>
                </div>
            </fieldset>
            <div className="span-full">
                <Field label="Notas" htmlFor="hr-template-notes" hint={template ? 'Los cambios aplican a asignaciones nuevas; los turnos guardados conservan sus datos históricos.' : undefined}>
                    <Textarea id="hr-template-notes" rows={3} maxLength={5000} value={form.notes} onChange={(event) => update('notes', event.target.value)} />
                </Field>
            </div>
        </HrModalFormShell>
    );
}
