import type { HrLeaveCalendarEntry } from '../../types/hr-workforce';
import './LeaveCalendarGrid.css';

/** Longest range rendered as columns; wider ranges would be unreadable. */
const MAX_DAYS = 62;
const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Stable palette per leave type, readable on light and dark themes. */
const TYPE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#84cc16'];

const FRACTION_VALUE: Record<string, number> = { FULL_DAY: 1, HALF_DAY: 0.5 };

type Props = {
  entries: HrLeaveCalendarEntry[];
  dateFrom: string;
  dateTo: string;
  onOpenRequest?: (leaveRequestId: number) => void;
};

type Day = { key: string; day: number; weekday: number; monthStart: boolean; month: number; year: number };

function buildDays(from: string, to: string): Day[] {
  const days: Day[] = [];
  const cursor = new Date(`${from.slice(0, 10)}T12:00:00`);
  const end = new Date(`${to.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return days;
  while (cursor <= end && days.length < MAX_DAYS) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    days.push({
      key,
      day: cursor.getDate(),
      weekday: cursor.getDay(),
      monthStart: days.length === 0 || cursor.getDate() === 1,
      month: cursor.getMonth(),
      year: cursor.getFullYear(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function cellValue(entries: HrLeaveCalendarEntry[]): string {
  const total = entries.reduce((sum, entry) => sum + (FRACTION_VALUE[entry.fraction] ?? 0), 0);
  if (total === 0) return 'h';
  return total === 0.5 ? '½' : String(Number(total.toFixed(1)));
}

/**
 * Employee × day grid of approved absences (the layout HR already uses on
 * paper). Each cell shows the day fraction taken and is coloured by leave type.
 */
export default function LeaveCalendarGrid({ entries, dateFrom, dateTo, onOpenRequest }: Props) {
  const days = buildDays(dateFrom, dateTo);
  const truncated = days.length === MAX_DAYS && days[days.length - 1]?.key < dateTo.slice(0, 10);

  const typeIds = Array.from(new Set(entries.map((entry) => entry.leaveTypeId)));
  const colorOf = (leaveTypeId: number) => TYPE_COLORS[Math.max(0, typeIds.indexOf(leaveTypeId)) % TYPE_COLORS.length];

  const people = new Map<number, { name: string; byDay: Map<string, HrLeaveCalendarEntry[]>; total: number }>();
  for (const entry of entries) {
    const row = people.get(entry.userId) ?? { name: entry.user?.name ?? `Usuario #${entry.userId}`, byDay: new Map(), total: 0 };
    const key = entry.date.slice(0, 10);
    row.byDay.set(key, [...(row.byDay.get(key) ?? []), entry]);
    row.total += FRACTION_VALUE[entry.fraction] ?? 0;
    people.set(entry.userId, row);
  }
  const rows = Array.from(people.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));

  if (days.length === 0) {
    return <div className="hr-admin-empty"><strong>Rango de fechas inválido</strong><span>Revisa las fechas Desde y Hasta.</span></div>;
  }

  return (
    <div className="leave-calendar-grid-wrap">
      {typeIds.length > 0 && (
        <div className="leave-calendar-legend" aria-label="Tipos de ausencia">
          {typeIds.map((id) => {
            const name = entries.find((entry) => entry.leaveTypeId === id)?.leaveType?.name ?? `Tipo #${id}`;
            return <span key={id}><i style={{ background: colorOf(id) }} />{name}</span>;
          })}
        </div>
      )}
      {truncated && <p className="leave-calendar-note">Se muestran los primeros {MAX_DAYS} días del rango.</p>}
      <div className="leave-calendar-scroll">
        <table className="leave-calendar-grid" aria-label="Calendario de ausencias por colaborador">
          <thead>
            <tr>
              <th className="leave-calendar-name" rowSpan={2} scope="col">Colaborador</th>
              {days.map((day) => (
                <th key={`m-${day.key}`} scope="col" className={`leave-calendar-month${day.monthStart ? ' is-start' : ''}`}>
                  {day.monthStart ? `${MONTHS[day.month]} ${day.year}` : ''}
                </th>
              ))}
              <th className="leave-calendar-total" rowSpan={2} scope="col">Días</th>
            </tr>
            <tr>
              {days.map((day) => (
                <th key={`d-${day.key}`} scope="col" className={day.weekday === 0 ? 'is-sunday' : day.weekday === 6 ? 'is-saturday' : ''}>
                  <span>{WEEKDAYS[day.weekday]}</span>
                  <strong>{day.day}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={days.length + 2}><div className="hr-admin-empty"><strong>No hay ausencias aprobadas</strong><span>Amplía el rango de fechas o revisa las solicitudes pendientes.</span></div></td></tr>
            ) : rows.map(([userId, row]) => (
              <tr key={userId}>
                <th scope="row" className="leave-calendar-name">{row.name}</th>
                {days.map((day) => {
                  const cell = row.byDay.get(day.key);
                  const weekendClass = day.weekday === 0 ? ' is-sunday' : day.weekday === 6 ? ' is-saturday' : '';
                  if (!cell) return <td key={day.key} className={`leave-calendar-cell${weekendClass}`} />;
                  const first = cell[0];
                  const label = `${row.name} · ${first.leaveType?.name ?? 'Ausencia'} · ${day.key}`;
                  return (
                    <td key={day.key} className={`leave-calendar-cell has-leave${weekendClass}`} style={{ ['--leave-color' as string]: colorOf(first.leaveTypeId) }}>
                      {onOpenRequest ? (
                        <button type="button" title={label} aria-label={label} onClick={() => onOpenRequest(first.leaveRequestId)}>{cellValue(cell)}</button>
                      ) : <span title={label}>{cellValue(cell)}</span>}
                    </td>
                  );
                })}
                <td className="leave-calendar-total"><strong>{Number(row.total.toFixed(1))}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
