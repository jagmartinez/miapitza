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
  time: 88,
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
  time: '1fr',
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

/* ------------------------------------------------------------------------------------------------
 * Distribución por contenido (después de medir en el navegador).
 * ---------------------------------------------------------------------------------------------- */

/** Medición de una columna: ancho max-content (con padding) del encabezado y de la celda más ancha. */
export interface ColumnMeasure {
  type?: ColumnType;
  width?: string;
  header?: ReactNode;
  /** Ancho max-content del encabezado en px (0 si no se pudo medir). */
  headerPx: number;
  /** Ancho max-content de la celda más ancha (cuerpo y totales) en px. */
  contentPx: number;
}

/** Tipos que nunca se parten: su mínimo es su contenido. */
const SHORT_TYPES: ColumnType[] = ['date', 'time', 'number', 'money', 'qty', 'percent', 'status', 'actions'];
/** Texto cuyo contenido (sin padding) mide hasta esto se trata como corto. */
export const SHORT_TEXT_PX = 140;
/** Mínimo de una columna de texto largo (se parte en varias líneas por debajo de su contenido). */
export const LONG_TEXT_MIN_PX = 160;
/** Tope del contenido que cuenta para el peso: un texto de 2000 px no se lleva todo el sobrante. */
export const LONG_TEXT_CAP_PX = 480;
const LONG_WEIGHT_UNIT = 120;

function fmtFr(n: number): string {
  return `${Number(n.toFixed(2))}fr`;
}

/** Un ancho explícito que no es `Nfr` (px, rem, minmax, max-content…) se respeta tal cual. */
function fixedWidth(w: string | undefined): string | null {
  const t = w?.trim();
  return t && !FR.test(t) ? t : null;
}

function fixedMinPx(w: string): number {
  const px = toPx(w);
  if (px != null) return px;
  const mm = /^minmax\(\s*([^,]+),/.exec(w);
  return mm ? toPx(mm[1]) ?? 0 : 0;
}

/**
 * Plantilla de grid a partir de lo medido. Función pura:
 * - ancho explícito no-fr → tal cual;
 * - `actions` sin ancho → su contenido en px (no crece);
 * - columnas cortas (fecha, hora, números, estado o texto ≤ 140 px) → `minmax(<contenido>px, 1fr)`: no se parten;
 * - texto largo → `minmax(max(160, encabezado)px, <peso>fr)` con peso ∝ contenido (tope 480 px), siempre ≥ 1;
 * - los mínimos nunca bajan del mínimo por tipo ni del encabezado (celdas con inputs al 100 % miden ~0).
 * Los pesos `Nfr` explícitos solo sirven para la primera pinta (estimada); aquí se ignoran.
 * Devuelve también la suma de mínimos: por debajo de ella la tabla se desplaza en horizontal.
 */
/** Fracción del crecimiento que reciben las columnas cortas frente al texto largo. */
const SHORT_GROWTH = 0.25;

export function measuredTemplate(cols: ColumnMeasure[]): { template: string; minWidth: number } {
  let minWidth = 0;
  const tracks = cols.map((c, i) => {
    const type = c.type ?? 'text';
    const fixed = fixedWidth(c.width);
    if (fixed) {
      minWidth += fixedMinPx(fixed);
      return fixed;
    }
    const header = Math.ceil(Math.max(c.headerPx, headerMinPx(c.header)));
    const content = Math.ceil(Math.max(c.contentPx, header));
    const typeFloor = i === 0 && type === 'text' ? 0 : TYPE_MIN[type];
    if (type === 'actions') {
      const w = Math.max(content, 48);
      minWidth += w;
      return `${w}px`;
    }
    const short = SHORT_TYPES.includes(type) || content - CELL_PADDING_X <= SHORT_TEXT_PX;
    if (short) {
      const min = Math.max(content, typeFloor);
      minWidth += min;
      // Las columnas cortas casi no crecen: el espacio sobrante va al texto largo.
      return `minmax(${min}px,${fmtFr(Math.max(0.1, (content / LONG_WEIGHT_UNIT) * SHORT_GROWTH))})`;
    }
    const min = Math.min(content, Math.max(LONG_TEXT_MIN_PX, header));
    const weight = Math.max(1, Math.min(content, LONG_TEXT_CAP_PX) / LONG_WEIGHT_UNIT);
    minWidth += min;
    return `minmax(${min}px,${fmtFr(weight)})`;
  });
  // Con suma de fr < 1 la fila no llena el ancho: se normaliza a 1 manteniendo las proporciones.
  const frOf = (t: string) => /([\d.]+)fr\)?$/.exec(t);
  const sum = tracks.reduce((acc, t) => acc + (frOf(t) ? parseFloat(frOf(t)![1]) : 0), 0);
  const out = sum > 0 && sum < 1
    ? tracks.map((t) => t.replace(/([\d.]+)fr(\)?)$/, (_m, n: string, close: string) => `${fmtFr(parseFloat(n) / sum)}${close}`))
    : tracks;
  return { template: out.join(' '), minWidth };
}
