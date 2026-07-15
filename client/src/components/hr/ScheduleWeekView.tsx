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

function ShiftCard({ item, readOnly, onEdit, onDelete }: {
    item: ShiftWithSchedule;
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
        <article className="hr-shift-card" aria-label={`${employeeName}, ${time(item.startTime)} a ${time(item.endTime)}`}>
            <div className="hr-shift-time"><Clock3 size={15} aria-hidden="true" /><strong>{time(item.startTime)}–{time(item.endTime)}</strong>{overnight && <span>+1 día</span>}</div>
            <div className="hr-shift-meta"><UserRound size={14} aria-hidden="true" /><span>{employeeName}</span></div>
            <div className="hr-shift-meta"><Building2 size={14} aria-hidden="true" /><span>{branchName}</span></div>
            <div className="hr-shift-meta"><Briefcase size={14} aria-hidden="true" /><span>{positionName}</span></div>
            {(item.breakMinutes ?? 0) > 0 && <small>Descanso: {item.breakMinutes} min</small>}
            {item.notes && <p>{item.notes}</p>}
            {editable && (
                <div className="hr-shift-actions">
                    <button type="button" onClick={() => onEdit?.(item, item.parentSchedule)} aria-label={`Editar turno de ${employeeName}`}><Edit2 size={15} aria-hidden="true" /> Editar</button>
                    <button type="button" className="danger" onClick={() => onDelete?.(item, item.parentSchedule)} aria-label={`Eliminar turno de ${employeeName}`}><Trash2 size={15} aria-hidden="true" /> Eliminar</button>
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
    const grouped = new Map(days.map((day) => [day, shifts.filter((shift) => shift.date === day)]));
    const holidayFor = (day: string) => holidays.find((holiday) => holiday.date.slice(0, 10) === day);

    return (
        <>
            <div className="hr-schedule-week-grid" role="region" tabIndex={0} aria-label="Horario semanal; desplázate horizontalmente para consultar los siete días">
                {days.map((day) => {
                    const holiday = holidayFor(day);
                    const items = grouped.get(day) ?? [];
                    return (
                        <section key={day} className="hr-schedule-day" aria-labelledby={`schedule-day-${day}`}>
                            <header>
                                <h2 id={`schedule-day-${day}`}>{formatDay(day)}</h2>
                                <span>{items.length} {items.length === 1 ? 'turno' : 'turnos'}</span>
                                {holiday && <strong className="hr-holiday-chip">{holiday.name}</strong>}
                            </header>
                            <div className="hr-schedule-day-shifts">
                                {items.map((item) => <ShiftCard key={`${item.parentSchedule.id}-${item.id}`} item={item} readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)}
                                {items.length === 0 && <p className="hr-schedule-day-empty">Sin turnos</p>}
                            </div>
                        </section>
                    );
                })}
            </div>

            <div className="hr-schedule-mobile-list" aria-label="Turnos en orden cronológico">
                {days.map((day) => {
                    const items = grouped.get(day) ?? [];
                    const holiday = holidayFor(day);
                    if (items.length === 0 && !holiday) return null;
                    return (
                        <section key={day} aria-labelledby={`schedule-mobile-day-${day}`}>
                            <header>
                                <h2 id={`schedule-mobile-day-${day}`}>{formatDay(day, true)}</h2>
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
        </>
    );
}
