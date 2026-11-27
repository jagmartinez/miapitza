import type { CSSProperties } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { IconButton, formatNumber } from '@/ui';
import type { HrUserSummary } from '../../types/hr';
import type { HrHoliday, HrScheduleShift, HrWeeklySchedule } from '../../types/hr-schedule';
import { shiftCrossesMidnight, sortScheduleShifts, timeToMinutes, weekDates } from './scheduleDates';

interface ShiftWithSchedule extends HrScheduleShift {
    parentSchedule: HrWeeklySchedule;
}

interface ScheduleWeekViewProps {
    weekStart: string;
    schedules: HrWeeklySchedule[];
    holidays?: HrHoliday[];
    readOnly?: boolean;
    workers?: HrUserSummary[];
    onCreate?: (worker: HrUserSummary, date: string) => void;
    onEdit?: (shift: HrScheduleShift, schedule: HrWeeklySchedule) => void;
    onDelete?: (shift: HrScheduleShift, schedule: HrWeeklySchedule) => void;
}

/** Jornada ordinaria semanal (Código del Trabajo de Nicaragua, art. 51): por encima son horas extra. */
const WEEKLY_ORDINARY_HOURS = 48;

const weekdayFormatter = new Intl.DateTimeFormat('es-NI', { weekday: 'short', timeZone: 'UTC' });
const dayNumberFormatter = new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormatter = new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const formatDay = (value: string) => longDayFormatter.format(asDate(value));
const time = (value: string) => value.slice(0, 5);

/** Colores de respaldo (turnos sin color guardado) con tokens del design system; el color de la jornada es dato del usuario. */
const FALLBACK_SHIFT_COLORS = [
    'var(--ui-primary)',
    'color-mix(in srgb, var(--ui-primary) 50%, var(--ui-success))',
    'var(--ui-warning)',
    'color-mix(in srgb, var(--ui-primary) 50%, var(--ui-danger))',
    'var(--ui-danger)',
    'var(--ui-success)',
] as const;
const UNCONFIGURED_SHIFT_COLOR = 'var(--ui-text-muted)';
const HEX_COLOR = /^#[0-9A-F]{6}$/;

function shiftTemplateName(item: HrScheduleShift): string | null {
    return item.templateNameSnapshot?.trim() || item.shiftTemplate?.name?.trim() || null;
}

function fallbackShiftColor(item: HrScheduleShift): string {
    const key = `${item.shiftTemplateId ?? 'custom'}|${time(item.startTime)}|${time(item.endTime)}`;
    let hash = 0;
    for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return FALLBACK_SHIFT_COLORS[Math.abs(hash) % FALLBACK_SHIFT_COLORS.length];
}

function shiftColor(item: HrScheduleShift): string {
    const configured = (item.templateColorSnapshot ?? item.shiftTemplate?.color)?.toUpperCase();
    if (configured && HEX_COLOR.test(configured)) return configured;
    return shiftTemplateName(item) ? fallbackShiftColor(item) : UNCONFIGURED_SHIFT_COLOR;
}

/** Horas trabajadas del turno: duración (cruzando medianoche si aplica) menos el descanso. */
function shiftHours(item: HrScheduleShift): number {
    const start = timeToMinutes(item.startTime);
    let end = timeToMinutes(item.endTime);
    if (end <= start) end += 24 * 60;
    return Math.max(0, end - start - (item.breakMinutes ?? 0)) / 60;
}

function initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function ShiftCard({ item, compact = false, readOnly, onEdit, onDelete }: {
    item: ShiftWithSchedule;
    compact?: boolean;
    readOnly: boolean;
    onEdit?: ScheduleWeekViewProps['onEdit'];
    onDelete?: ScheduleWeekViewProps['onDelete'];
}) {
    const editable = !readOnly && item.parentSchedule.status === 'DRAFT';
    const overnight = item.crossesMidnight ?? shiftCrossesMidnight(item);
    const employeeName = item.user?.name ?? `Usuario #${item.userId}`;
    const branchName = item.branch?.name ?? `Sucursal #${item.branchId}`;
    const positionName = item.jobPosition?.name ?? (item.jobPositionId ? `Puesto #${item.jobPositionId}` : 'Sin puesto');
    const templateName = shiftTemplateName(item);
    const details = [
        templateName ?? 'Sin jornada configurada',
        positionName,
        branchName,
        (item.breakMinutes ?? 0) > 0 ? `Descanso ${item.breakMinutes} min` : null,
        item.notes || null,
    ].filter(Boolean).join(' · ');

    return (
        <article
            className={`hr-shift-card ${compact ? 'is-compact' : ''} ${templateName ? '' : 'is-unconfigured'}`}
            style={{ '--shift-accent': shiftColor(item) } as CSSProperties}
            title={details}
            aria-label={`${employeeName}, turno de ${time(item.startTime)} a ${time(item.endTime)}${overnight ? ', termina al día siguiente' : ''}. ${details}`}
        >
            <div className="hr-shift-time">
                <strong>{time(item.startTime)}–{time(item.endTime)}</strong>
                {overnight && <span className="hr-shift-overnight">+1</span>}
            </div>
            <div className="hr-shift-template-name">{templateName ?? 'Sin jornada'}</div>
            {!compact && <div className="hr-shift-meta">{employeeName}</div>}
            <div className="hr-shift-meta">{positionName} · {branchName}</div>
            {!compact && item.notes && <p className="hr-shift-notes">{item.notes}</p>}
            {editable && (
                <div className="hr-shift-actions">
                    <IconButton icon={Pencil} size="sm" tooltip="Editar turno" label={`Editar turno de ${employeeName}`} onClick={() => onEdit?.(item, item.parentSchedule)} />
                    <IconButton icon={Trash2} size="sm" tone="danger" tooltip="Eliminar turno" label={`Eliminar turno de ${employeeName}`} onClick={() => onDelete?.(item, item.parentSchedule)} />
                </div>
            )}
        </article>
    );
}

export default function ScheduleWeekView({
    weekStart,
    schedules,
    holidays = [],
    readOnly = false,
    workers = [],
    onCreate,
    onEdit,
    onDelete,
}: ScheduleWeekViewProps) {
    const days = weekDates(weekStart);
    const shifts = sortScheduleShifts(schedules.flatMap((schedule) =>
        (schedule.shifts ?? []).map((shift) => ({ ...shift, parentSchedule: schedule }))
    ));
    const groupedByDay = new Map(days.map((day) => [day, shifts.filter((shift) => shift.date === day)]));
    const holidayFor = (day: string) => holidays.find((holiday) => holiday.date.slice(0, 10) === day);
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    for (const shift of shifts) {
        if (shift.user && !workersById.has(shift.userId)) workersById.set(shift.userId, shift.user);
    }
    const employeeRows = Array.from(new Set([...workersById.keys(), ...shifts.map((shift) => shift.userId)]))
        .map((userId) => {
            const employeeShifts = shifts.filter((shift) => shift.userId === userId);
            const user = workersById.get(userId) ?? employeeShifts[0]?.user;
            return {
                userId,
                name: user?.name ?? `Usuario #${userId}`,
                code: user?.employee?.employeeCode ?? user?.username ?? 'Sin código',
                position: employeeShifts[0]?.jobPosition?.name,
                worker: user,
                shifts: employeeShifts,
                hours: employeeShifts.reduce((sum, shift) => sum + shiftHours(shift), 0),
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));
    const staffByDay = new Map(days.map((day) => [day, new Set((groupedByDay.get(day) ?? []).map((shift) => shift.userId)).size]));
    const legend = Array.from(new Map(shifts.flatMap((shift) => {
        const templateName = shiftTemplateName(shift);
        if (!templateName) return [];
        const timeLabel = `${time(shift.startTime)}–${time(shift.endTime)}${shiftCrossesMidnight(shift) ? ' (+1 día)' : ''}`;
        const label = `${templateName} · ${timeLabel}`;
        const color = shiftColor(shift);
        return [[`${color}|${label}`, { label, color }] as const];
    })).values());
    const hasUnconfiguredShifts = shifts.some((shift) => !shiftTemplateName(shift));
    const canCreate = !readOnly && Boolean(onCreate);

    return (
        <section className="hr-schedule-workspace" aria-label="Planificación semanal por colaborador y día">
            {(legend.length > 0 || hasUnconfiguredShifts) && (
                <ul className="hr-shift-color-legend" aria-label="Leyenda de colores por jornada">
                    {legend.map((entry) => (
                        <li key={`${entry.color}|${entry.label}`}>
                            <i style={{ '--shift-accent': entry.color } as CSSProperties} aria-hidden="true" />
                            {entry.label}
                        </li>
                    ))}
                    {hasUnconfiguredShifts && (
                        <li className="is-unconfigured">
                            <i style={{ '--shift-accent': UNCONFIGURED_SHIFT_COLOR } as CSSProperties} aria-hidden="true" />
                            Turno sin jornada configurada
                        </li>
                    )}
                </ul>
            )}
            <div className="hr-schedule-matrix-wrap" role="region" tabIndex={0} aria-label="Matriz semanal por colaborador">
                <div className="hr-schedule-matrix" role="table" aria-rowcount={employeeRows.length + 1} aria-colcount={9}>
                    <div className="hr-schedule-matrix-row is-header" role="row">
                        <div role="columnheader" className="hr-schedule-head-employee">Colaborador</div>
                        {days.map((day) => {
                            const holiday = holidayFor(day);
                            const staff = staffByDay.get(day) ?? 0;
                            return (
                                <div key={day} id={`schedule-column-${day}`} role="columnheader" className={holiday ? 'is-holiday' : undefined}>
                                    <span className="hr-schedule-weekday">{weekdayFormatter.format(asDate(day))}</span>
                                    <strong>{dayNumberFormatter.format(asDate(day))}</strong>
                                    <span className="hr-schedule-day-staff">{holiday ? `Feriado · ${holiday.name}` : `${staff} en turno`}</span>
                                </div>
                            );
                        })}
                        <div role="columnheader" className="hr-schedule-head-hours" title={`Horas programadas; más de ${WEEKLY_ORDINARY_HOURS} h son horas extra`}>Horas</div>
                    </div>
                    {employeeRows.map((employee) => {
                        const overtime = employee.hours > WEEKLY_ORDINARY_HOURS;
                        return (
                            <div key={employee.userId} className="hr-schedule-matrix-row" role="row">
                                <div className="hr-schedule-employee" role="rowheader" id={`schedule-employee-${employee.userId}`}>
                                    <span className="hr-schedule-avatar" aria-hidden="true">{initials(employee.name)}</span>
                                    <div>
                                        <strong title={employee.name}>{employee.name}</strong>
                                        <small>{employee.position ?? employee.code}</small>
                                    </div>
                                </div>
                                {days.map((day) => {
                                    const items = employee.shifts.filter((shift) => shift.date === day);
                                    return (
                                        <div key={day} className={`hr-schedule-matrix-cell ${items.length === 0 ? 'is-empty' : ''}`} role="cell" aria-labelledby={`schedule-employee-${employee.userId} schedule-column-${day}`}>
                                            {items.map((item) => <ShiftCard key={`${item.parentSchedule.id}-${item.id}`} item={item} compact readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)}
                                            {items.length === 0 && canCreate && employee.worker && (
                                                <button
                                                    type="button"
                                                    className="hr-schedule-add"
                                                    onClick={() => onCreate!(employee.worker!, day)}
                                                    aria-label={`Agregar turno para ${employee.name} el ${formatDay(day)}`}
                                                >
                                                    <Plus size={16} aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                                <div role="cell" className={`hr-schedule-hours ${overtime ? 'is-overtime' : ''}`} title={overtime ? `${formatNumber(employee.hours - WEEKLY_ORDINARY_HOURS)} h extra sobre la jornada de ${WEEKLY_ORDINARY_HOURS} h` : undefined}>
                                    {formatNumber(employee.hours)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="hr-schedule-mobile-list" aria-label="Turnos en orden cronológico">
                {days.map((day) => {
                    const items = groupedByDay.get(day) ?? [];
                    const holiday = holidayFor(day);
                    if (items.length === 0 && !holiday) return null;
                    return (
                        <section key={day} aria-labelledby={`schedule-mobile-day-${day}`}>
                            <header>
                                <h2 id={`schedule-mobile-day-${day}`}>{formatDay(day)}</h2>
                                <span>{items.length} {items.length === 1 ? 'turno' : 'turnos'}</span>
                                {holiday && <strong className="hr-holiday-chip">{holiday.name}</strong>}
                            </header>
                            {items.length > 0
                                ? items.map((item) => <ShiftCard key={`${item.parentSchedule.id}-${item.id}`} item={item} readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)
                                : <p className="hr-schedule-day-empty">Sin turnos</p>}
                        </section>
                    );
                })}
                {shifts.length === 0 && holidays.length === 0 && <p className="hr-schedule-empty">No hay turnos en esta semana.</p>}
            </div>
        </section>
    );
}
