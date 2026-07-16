import { Briefcase, Building2, Clock3, Edit2, Trash2, UserRound } from 'lucide-react';
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

    return (
        <article className={`hr-shift-card ${compact ? 'is-compact' : ''}`} aria-label={`${employeeName}, ${time(item.startTime)} a ${time(item.endTime)}`}>
            <div className="hr-shift-time"><Clock3 size={15} aria-hidden="true" /><strong>{time(item.startTime)}–{time(item.endTime)}</strong>{overnight && <span>+1 día</span>}</div>
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
    onEdit,
    onDelete,
}: ScheduleWeekViewProps) {
    const days = weekDates(weekStart);
    const shifts = sortScheduleShifts(schedules.flatMap((schedule) =>
        (schedule.shifts ?? []).map((shift) => ({ ...shift, parentSchedule: schedule }))
    ));
    const groupedByDay = new Map(days.map((day) => [day, shifts.filter((shift) => shift.date === day)]));
    const holidayFor = (day: string) => holidays.find((holiday) => holiday.date.slice(0, 10) === day);
    const employeeRows = Array.from(new Set(shifts.map((shift) => shift.userId)))
        .map((userId) => {
            const employeeShifts = shifts.filter((shift) => shift.userId === userId);
            const user = employeeShifts[0]?.user;
            return {
                userId,
                name: user?.name ?? `Usuario #${userId}`,
                code: user?.employee?.employeeCode ?? user?.username ?? 'Sin código',
                shifts: employeeShifts,
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name, 'es'));

    return (
        <section className="hr-schedule-workspace" aria-label="Planificación semanal por colaborador y día">
            <div className="hr-schedule-coverage" aria-labelledby="hr-schedule-coverage-title">
                <header><div><span>Cobertura diaria</span><h2 id="hr-schedule-coverage-title">Lectura rápida de la semana</h2></div><small>Personas y turnos asignados por día</small></header>
                <div className="hr-schedule-coverage-grid">
                    {days.map((day) => {
                        const items = groupedByDay.get(day) ?? [];
                        const people = new Set(items.map((item) => item.userId)).size;
                        const holiday = holidayFor(day);
                        return (
                            <article key={day} className={items.length === 0 ? 'is-empty' : undefined}>
                                <span>{formatDay(day)}</span>
                                <strong>{people}</strong>
                                <small>{people === 1 ? 'persona' : 'personas'} · {items.length} {items.length === 1 ? 'turno' : 'turnos'}</small>
                                {holiday && <em>{holiday.name}</em>}
                            </article>
                        );
                    })}
                </div>
            </div>

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
                                        {items.length === 0 && <span className="hr-schedule-no-shift">—</span>}
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
