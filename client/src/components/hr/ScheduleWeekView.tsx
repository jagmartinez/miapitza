import type { CSSProperties } from 'react';
import { Briefcase, Building2, Clock3, Edit2, Plus, Trash2, UserRound } from 'lucide-react';
import type { HrUserSummary } from '../../types/hr';
import type { HrHoliday, HrScheduleShift, HrWeeklySchedule } from '../../types/hr-schedule';
import { shiftCrossesMidnight, sortScheduleShifts, weekDates } from './scheduleDates';

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

const dayFormatter = new Intl.DateTimeFormat('es-NI', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDayFormatter = new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function formatDay(value: string, long = false): string {
    const date = new Date(`${value}T00:00:00Z`);
    return (long ? longDayFormatter : dayFormatter).format(date);
}

function time(value: string): string {
    return value.slice(0, 5);
}

const FALLBACK_SHIFT_COLORS = ['#2563EB', '#0F766E', '#A16207', '#7C3AED', '#BE123C', '#0369A1'] as const;
const HEX_COLOR = /^#[0-9A-F]{6}$/;

function fallbackShiftColor(item: HrScheduleShift): string {
    const key = `${item.shiftTemplateId ?? 'custom'}|${time(item.startTime)}|${time(item.endTime)}`;
    let hash = 0;
    for (const character of key) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    return FALLBACK_SHIFT_COLORS[Math.abs(hash) % FALLBACK_SHIFT_COLORS.length];
}

function shiftColor(item: HrScheduleShift): string {
    const configured = (item.templateColorSnapshot ?? item.shiftTemplate?.color)?.toUpperCase();
    return configured && HEX_COLOR.test(configured) ? configured : fallbackShiftColor(item);
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
    const templateName = item.templateNameSnapshot ?? item.shiftTemplate?.name;

    return (
        <article
            className={`hr-shift-card ${compact ? 'is-compact' : ''}`}
            style={{ '--shift-accent': shiftColor(item) } as CSSProperties}
            aria-label={`${employeeName}, turno de ${time(item.startTime)} a ${time(item.endTime)}${overnight ? ', termina al día siguiente' : ''}`}
        >
            <div className="hr-shift-time"><Clock3 size={15} aria-hidden="true" /><strong>{time(item.startTime)}–{time(item.endTime)}</strong>{overnight && <span>+1 día</span>}</div>
            {templateName && <div className="hr-shift-template-name">{templateName}</div>}
            {!compact && <div className="hr-shift-meta"><UserRound size={14} aria-hidden="true" /><span>{employeeName}</span></div>}
            <div className="hr-shift-meta"><Building2 size={14} aria-hidden="true" /><span>{branchName}</span></div>
            <div className="hr-shift-meta"><Briefcase size={14} aria-hidden="true" /><span>{positionName}</span></div>
            {(item.breakMinutes ?? 0) > 0 && <small>Descanso: {item.breakMinutes} min</small>}
            {item.notes && <p>{item.notes}</p>}
            {editable && (
                <div className="hr-shift-actions">
                    <button type="button" onClick={() => onEdit?.(item, item.parentSchedule)} aria-label={`Editar turno de ${employeeName}`}><Edit2 size={15} aria-hidden="true" /><span>Editar</span></button>
                    <button type="button" className="danger" onClick={() => onDelete?.(item, item.parentSchedule)} aria-label={`Eliminar turno de ${employeeName}`}><Trash2 size={15} aria-hidden="true" /><span>Eliminar</span></button>
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
                worker: user,
                shifts: employeeShifts,
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));
    const legend = Array.from(new Map(shifts.map((shift) => {
        const timeLabel = `${time(shift.startTime)}–${time(shift.endTime)}${shiftCrossesMidnight(shift) ? ' (+1 día)' : ''}`;
        const templateName = shift.templateNameSnapshot ?? shift.shiftTemplate?.name;
        const label = templateName ? `${templateName} · ${timeLabel}` : timeLabel;
        const color = shiftColor(shift);
        return [`${color}|${label}`, { label, color }];
    })).values());

    return (
        <section className="hr-schedule-workspace" aria-label="Planificación semanal por colaborador y día">
            {legend.length > 0 && (
                <div className="hr-shift-color-legend" aria-label="Leyenda de colores por franja de turno">
                    <strong>Colores de turno</strong>
                    {legend.map((entry) => (
                        <span key={entry.label}>
                            <i style={{ '--shift-accent': entry.color } as CSSProperties} aria-hidden="true" />
                            {entry.label}
                        </span>
                    ))}
                </div>
            )}
            <div className="hr-schedule-matrix-wrap" role="region" tabIndex={0} aria-label="Matriz semanal por colaborador">
                <div className="hr-schedule-matrix" role="table" aria-rowcount={employeeRows.length + 1} aria-colcount={8}>
                    <div className="hr-schedule-matrix-row is-header" role="row">
                        <div role="columnheader">Colaborador</div>
                        {days.map((day) => <div key={day} id={`schedule-column-${day}`} role="columnheader"><strong>{formatDay(day)}</strong>{holidayFor(day) && <span>{holidayFor(day)!.name}</span>}</div>)}
                    </div>
                    {employeeRows.map((employee) => (
                        <div key={employee.userId} className="hr-schedule-matrix-row" role="row">
                            <div className="hr-schedule-employee" role="rowheader" id={`schedule-employee-${employee.userId}`}>
                                <span aria-hidden="true">{employee.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                                <div><strong>{employee.name}</strong><small>{employee.code}</small></div>
                            </div>
                            {days.map((day) => {
                                const items = employee.shifts.filter((shift) => shift.date === day);
                                return (
                                    <div key={day} className={`hr-schedule-matrix-cell ${items.length === 0 ? 'is-empty' : ''}`} role="cell" aria-labelledby={`schedule-employee-${employee.userId} schedule-column-${day}`}>
                                        {items.map((item) => <ShiftCard key={`${item.parentSchedule.id}-${item.id}`} item={item} compact readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)}
                                        {items.length === 0 && !readOnly && employee.worker && onCreate
                                            ? (
                                                <button
                                                    type="button"
                                                    className="hr-schedule-empty-cell-button"
                                                    onClick={() => onCreate(employee.worker!, day)}
                                                    aria-label={`Agregar turno para ${employee.name} el ${formatDay(day, true)}`}
                                                >
                                                    <Plus size={16} aria-hidden="true" />
                                                    <span>Agregar</span>
                                                </button>
                                            )
                                            : items.length === 0 && <span className="hr-schedule-no-shift">—</span>}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
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
                                <h2 id={`schedule-mobile-day-${day}`}>{formatDay(day, true)}</h2>
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
