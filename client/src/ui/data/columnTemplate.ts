import type { ReactNode } from 'react';
import type { ColumnType } from './DataTable';

type ColLike = { width?: string; type?: ColumnType; header?: ReactNode };

/** Ancho mínimo por tipo de columna (px). Los números son compactos; el texto toma el resto con `fr`. */
const TYPE_MIN: Record<ColumnType, number> = {
  text: 96,
  number: 88,
  qty: 88,
  money: 104,
  percent: 88,
  date: 104,
  status: 104,
  actions: 0,
};
/** Peso `fr` por defecto: el texto crece, los números se quedan compactos. */
const TYPE_FR: Record<ColumnType, string> = {
  text: '1.6fr',
  number: '1fr',
  qty: '1fr',
  money: '1fr',
  percent: '1fr',
  date: '1fr',
  status: '1fr',
  actions: '1fr',
};
const CELL_PADDING_X = 32;
/** Encabezado en mayúsculas, 12 px, semibold: ~7.6 px por carácter. */
const HEADER_CHAR_PX = 7.6;
const ACTIONS_DEFAULT = '7.5rem';
const FR = /^\d+(\.\d+)?fr$/;

function headerText(h: ReactNode): string {
  return typeof h === 'string' || typeof h === 'number' ? String(h) : '';
}

let ctx: CanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();
/** Ancho real del encabezado (mayúsculas, 12 px, 600, +0.02em) medido con canvas; en tests sin canvas se estima. */
function textWidth(t: string): number {
  const cached = measured.get(t);
  if (cached !== undefined) return cached;
  if (ctx === undefined) {
    try {
      const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      ctx = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
    } catch {
      ctx = null;
    }
  }
  let w = t.length * HEADER_CHAR_PX;
  if (ctx) {
    const family = (typeof document !== 'undefined' && getComputedStyle(document.body).fontFamily) || 'Inter, system-ui, sans-serif';
    ctx.font = `600 12px ${family}`;
    w = ctx.measureText(t.toUpperCase()).width + t.length * 0.24;
  }
  measured.set(t, w);
  return w;
}

/** Mínimo para que el encabezado quepa en una sola línea (más 4 px de holgura). */
export function headerMinPx(h: ReactNode): number {
  const t = headerText(h).trim();
  return t ? Math.ceil(textWidth(t) + CELL_PADDING_X + 4) : 0;
}

function toPx(len: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(len.trim());
  if (!m) return null;
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
}

function minFor(c: ColLike, index: number): number {
  const type = c.type ?? 'text';
  const base = index === 0 && type === 'text' ? 160 : TYPE_MIN[type];
  return Math.max(base, headerMinPx(c.header));
}

function widthOf(c: ColLike): string {
  return (c.width ?? (c.type === 'actions' ? ACTIONS_DEFAULT : TYPE_FR[c.type ?? 'text'])).trim();
}

/**
 * Convierte cada ancho en una pista de grid:
 * - `Nfr` → `minmax(<mín>px,Nfr)`; el mínimo evita que el encabezado se parta;
 * - sin ancho → peso `fr` según el tipo (texto 1.6fr, números 1fr) con el mismo mínimo;
 * - px, rem y `minmax(...)` se respetan tal cual (acciones y columnas fijas).
 */
export function columnTemplate(cols: ColLike[]): string {
  return cols
    .map((c, i) => {
      const w = widthOf(c);
      return FR.test(w) ? `minmax(${minFor(c, i)}px,${w})` : w;
    })
    .join(' ');
}

/** Suma de los mínimos: desde ahí la tabla se desplaza en horizontal en vez de apretar columnas. */
export function columnsMinWidth(cols: ColLike[]): number {
  return cols.reduce((sum, c, i) => {
    const w = widthOf(c);
    if (FR.test(w)) return sum + minFor(c, i);
    const fixed = toPx(w);
    if (fixed != null) return sum + fixed;
    const mm = /^minmax\(\s*([^,]+),/.exec(w);
    return sum + (mm ? toPx(mm[1]) ?? 0 : 0);
  }, 0);
}
