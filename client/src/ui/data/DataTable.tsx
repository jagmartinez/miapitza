import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { coerceMoneyAmount } from '../../utils/currency';
import { formatNumber, formatPercent } from '../format/number';
import { Skeleton } from '../primitives/Skeleton';
import type { Tone } from '../primitives/statusTone';
import { columnTemplate, columnsMinWidth } from './columnTemplate';
import { Pagination } from './Pagination';
import { EmptyState } from './EmptyState';
import { LoadErrorState } from './LoadErrorState';
import { getRowsPerPage } from '../prefs/userPrefs';
import { useTablePagination } from './useTablePagination';
import './data.css';

export type ColumnType = 'text' | 'number' | 'money' | 'qty' | 'percent' | 'date' | 'status' | 'actions';
export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Texto completo del encabezado para el tooltip cuando `header` es una abreviatura. */
  headerTitle?: string;
  width?: string;
  type?: ColumnType;
  accessor?: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  decimals?: number;
  total?: boolean;
  sortable?: boolean;
  hideBelow?: 'md' | 'lg';
  /** Alineación explícita; por defecto los tipos numéricos van a la derecha y el resto a la izquierda. */
  align?: 'left' | 'center' | 'right';
}
export type PaginationMode =
  | { mode: 'client' }
  | { mode: 'server'; page: number; pageSize: number; total: number; onChange(page: number, pageSize: number): void };
export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string | number;
  ariaLabel: string;
  pagination?: PaginationMode;
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  resetKey?: unknown;
  loading?: boolean;
  /** Texto (se muestra con EmptyState) o nodo propio cuando no hay filas. */
  empty?: ReactNode;
  /** Mensaje de error de carga: reemplaza las filas por LoadErrorState y oculta totales y paginación. */
  error?: string | null;
  onRetry?(): void;
  /** 'card' (por defecto) dibuja borde y fondo; 'flat' para tablas dentro de un bloque que ya tiene caja. */
  variant?: 'card' | 'flat';
  /** Oculta la paginación cuando todas las filas caben en una página (tablas cortas de detalle). */
  hidePaginationIfSinglePage?: boolean;
  toolbar?: ReactNode;
  footerLabel?: ReactNode;
  onRowClick?(row: T): void;
  rowTone?(row: T): Tone | undefined;
  minWidth?: string;
  /** En teléfonos (< 768 px) cada fila se muestra como tarjeta con la etiqueta de su columna. */
  stackOnMobile?: boolean;
}

const NUMERIC: ColumnType[] = ['number', 'money', 'qty', 'percent'];
const isNumeric = (c: { type?: ColumnType }) => !!c.type && NUMERIC.includes(c.type);

function raw<T>(c: Column<T>, row: T): unknown {
  return c.accessor ? c.accessor(row) : (row as Record<string, unknown>)[c.key];
}

function formatCell<T>(c: Column<T>, row: T): ReactNode {
  if (c.render) return c.render(row);
  const v = raw(c, row);
  if (c.type === 'percent') return formatPercent(v, c.decimals ?? 2);
  if (isNumeric(c)) return formatNumber(v, c.decimals ?? 2);
  if (c.type === 'date') return formatDateCell(v);
  return v == null ? '' : String(v);
}

/** Date o ISO string a dd/mm/aaaa (es-NI); 'YYYY-MM-DD' se toma literal para no correrse por zona horaria. */
function formatDateCell(v: unknown): string {
  if (v == null || v === '') return '';
  const iso = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('es-NI');
}

function useMediaMatch(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

function cellClass<T>(c: Column<T>): string {
  return [
    'ui-cell',
    isNumeric(c) ? 'ui-cell--numeric' : '',
    c.type === 'actions' ? 'ui-cell--actions' : '',
    c.align ? `ui-cell--align-${c.align}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const INTERACTIVE = 'button, a, input, label, select, textarea, [role=switch], [role=checkbox], [role=button]';

export function DataTable<T>({
  columns: allColumns,
  rows,
  rowKey,
  ariaLabel,
  pagination = { mode: 'client' },
  pageSizeOptions,
  defaultPageSize,
  resetKey,
  loading,
  empty,
  error,
  onRetry,
  variant = 'card',
  hidePaginationIfSinglePage = false,
  toolbar,
  footerLabel,
  onRowClick,
  rowTone,
  minWidth = '48rem',
  stackOnMobile = false,
}: DataTableProps<T>) {
  const belowLg = useMediaMatch('(max-width: 1023px)');
  const belowMd = useMediaMatch('(max-width: 767px)');
  // Se quitan las columnas ocultas (no solo display:none) para que el grid conserve sus pistas.
  const columns = allColumns.filter((c) => !(c.hideBelow === 'lg' ? belowLg : c.hideBelow === 'md' ? belowMd : false));
  const local = useTablePagination(rows.length, { defaultPageSize: defaultPageSize ?? getRowsPerPage(), resetKey });

  const visible = pagination.mode === 'server' ? rows : rows.slice(local.range[0], local.range[1]);
  const pg =
    pagination.mode === 'server'
      ? { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, onChange: pagination.onChange }
      : {
          page: local.page,
          pageSize: local.pageSize,
          total: rows.length,
          onChange: (p: number, s: number) => {
            if (s !== local.pageSize) local.setPageSize(s);
            else local.setPage(p);
          },
        };

  const stacked = stackOnMobile && belowMd;
  const gridStyle = stacked ? undefined : { gridTemplateColumns: columnTemplate(columns) };
  // `max()` no acepta números sin unidad: '0' se pasa como '0px'.
  const tableMinWidth = `max(${/^\d+(\.\d+)?$/.test(minWidth) ? `${minWidth}px` : minWidth}, ${columnsMinWidth(columns)}px)`;
  const labelOf = (c: Column<T>) => (stacked && typeof c.header === 'string' ? c.header : undefined);
  const hasTotals = columns.some((c) => c.total) && !error;
  const emptyNode = empty == null || typeof empty === 'string' ? <EmptyState title={(empty as string | undefined) ?? 'Sin resultados'} /> : empty;
  const showPagination = !error && !(hidePaginationIfSinglePage && pg.total <= pg.pageSize && pg.page === 1);

  const activate = (row: T, e: MouseEvent | KeyboardEvent) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick?.(row);
  };

  return (
    <div className={variant === 'flat' ? 'ui-datatable ui-datatable--flat' : 'ui-datatable'}>
      {toolbar}
      <div className="ui-datatable__scroll">
        <table
          className={stacked ? 'ui-table ui-table--stacked' : 'ui-table'}
          aria-label={ariaLabel}
          aria-busy={loading ? 'true' : undefined}
          style={stacked ? undefined : { minWidth: tableMinWidth }}
        >
          <thead>
            <tr style={gridStyle}>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cellClass(c)} title={c.headerTitle ?? (typeof c.header === 'string' ? c.header : undefined)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {error && !loading ? (
              <tr className="ui-table__empty">
                <td>
                  <LoadErrorState message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`sk${i}`} style={gridStyle}>
                  {columns.map((c) => (
                    <td key={c.key} className={cellClass(c)} data-label={labelOf(c)}>
                      <Skeleton height={14} />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr className="ui-table__empty">
                <td>{emptyNode}</td>
              </tr>
            ) : (
              visible.map((row) => {
                const tone = rowTone?.(row);
                const clickable = !!onRowClick;
                return (
                  <tr
                    key={rowKey(row)}
                    style={gridStyle}
                    className={[clickable ? 'ui-row--clickable' : '', tone ? `ui-row--${tone}` : ''].filter(Boolean).join(' ')}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? (e) => activate(row, e) : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget) activate(row, e);
                          }
                        : undefined
                    }
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cellClass(c)} data-label={labelOf(c)}>
                        {formatCell(c, row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {hasTotals && visible.length > 0 ? (
            <tfoot>
              <tr style={gridStyle}>
                {columns.map((c, i) => (
                  <td key={c.key} className={cellClass(c)} data-label={c.total ? labelOf(c) : undefined}>
                    {c.total
                      ? formatNumber(
                          visible.reduce((s, r) => s + coerceMoneyAmount(raw(c, r)), 0),
                          c.decimals ?? 2,
                        )
                      : i === 0
                        ? footerLabel
                        : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {showPagination ? <Pagination {...pg} pageSizeOptions={pageSizeOptions} label={`Paginación de ${ariaLabel}`} /> : null}
    </div>
  );
}
