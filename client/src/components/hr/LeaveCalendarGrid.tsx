import { EmptyState } from '@/ui';
import type { HrLeaveCalendarEntry } from '../../types/hr-workforce';
import './LeaveCalendarGrid.css';

/** Longest range rendered as columns; wider ranges would be unreadable. */
const MAX_DAYS = 62;
const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Paleta estable por tipo de ausencia, armada con tokens para que funcione en tema claro y oscuro. */
const TYPE_COLORS = [
  'var(--ui-success)',
  'var(--ui-primary)',
  'var(--ui-warning)',
  'color-mix(in srgb, var(--ui-primary) 50%, var(--ui-danger))',
  'color-mix(in srgb, var(--ui-primary) 50%, var(--ui-success))',
  'var(--ui-danger)',
  'color-mix(in srgb, var(--ui-warning) 50%, var(--ui-danger))',
  'var(--ui-text-muted)',
];

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
function formatDays(total: number): string {
  return String(Number(total.toFixed(1)));
}

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

  const months: { key: string; month: number; year: number; span: number }[] = [];
  for (const day of days) {
    const last = months[months.length - 1];
    if (last && last.month === day.month && last.year === day.year) last.span += 1;
    else months.push({ key: day.key, month: day.month, year: day.year, span: 1 });
  }

  if (days.length === 0) {
    return <EmptyState title="Rango de fechas inválido" description="Revisa las fechas Desde y Hasta." />;
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
        {/* Employee × day matrix: CSS grid with ARIA table roles (a data list would use DataTable). */}
        <div
          className="leave-calendar-grid"
          role="table"
          aria-label="Calendario de ausencias por colaborador"
          aria-colcount={days.length + 2}
          style={{ gridTemplateColumns: `minmax(180px, 220px) repeat(${days.length}, minmax(26px, 1fr)) 56px` }}
        >
          <div role="rowgroup" className="leave-calendar-rowgroup">
            <div role="row" className="leave-calendar-row">
              <div role="columnheader" className="leave-calendar-head leave-calendar-name" style={{ gridRow: 'span 2' }}>Colaborador</div>
              {months.map((month) => (
                <div
                  key={`m-${month.key}`}
                  role="columnheader"
                  aria-colspan={month.span}
                  className="leave-calendar-head leave-calendar-month is-start"
                  style={{ gridColumn: `span ${month.span}` }}
                >
                  {`${MONTHS[month.month]} ${month.year}`}
                </div>
              ))}
              <div role="columnheader" className="leave-calendar-head leave-calendar-total" style={{ gridRow: 'span 2' }}>Días</div>
            </div>
            <div role="row" className="leave-calendar-row">
              {days.map((day) => (
                <div key={`d-${day.key}`} role="columnheader" className={`leave-calendar-head leave-calendar-day${day.weekday === 0 ? ' is-sunday' : day.weekday === 6 ? ' is-saturday' : ''}`}>
                  <span>{WEEKDAYS[day.weekday]}</span>
                  <strong>{day.day}</strong>
                </div>
              ))}
            </div>
          </div>
          <div role="rowgroup" className="leave-calendar-rowgroup">
            {rows.length === 0 ? (
              <div role="row" className="leave-calendar-row">
                <div role="cell" className="leave-calendar-empty" style={{ gridColumn: '1 / -1' }}>
                  <EmptyState title="No hay ausencias aprobadas" description="Amplía el rango de fechas o revisa las solicitudes pendientes." />
                </div>
              </div>
            ) : rows.map(([userId, row]) => (
              <div key={userId} role="row" className="leave-calendar-row">
                <div role="rowheader" className="leave-calendar-name">{row.name}</div>
                {days.map((day) => {
                  const cell = row.byDay.get(day.key);
                  const weekendClass = day.weekday === 0 ? ' is-sunday' : day.weekday === 6 ? ' is-saturday' : '';
                  if (!cell) return <div key={day.key} role="cell" className={`leave-calendar-cell${weekendClass}`} />;
                  const first = cell[0];
                  const label = `${row.name} · ${first.leaveType?.name ?? 'Ausencia'} · ${day.key}`;
                  return (
                    <div key={day.key} role="cell" className={`leave-calendar-cell has-leave${weekendClass}`} style={{ ['--leave-color' as string]: colorOf(first.leaveTypeId) }}>
                      {onOpenRequest ? (
                        <button type="button" title={label} aria-label={label} onClick={() => onOpenRequest(first.leaveRequestId)}>{cellValue(cell)}</button>
                      ) : <span title={label}>{cellValue(cell)}</span>}
                    </div>
                  );
                })}
                <div role="cell" className="leave-calendar-total"><strong>{formatDays(row.total)}</strong></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
