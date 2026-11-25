/** Geometría pura de los gráficos: sin DOM, sin `NaN`, arreglos vacíos => cadena vacía. */

const r2 = (n: number): number => Math.round(n * 100) / 100;
const num = (n: number): string => String(r2(Number.isFinite(n) ? n : 0));
const safeMax = (max: number): number => (Number.isFinite(max) && max > 0 ? max : 1);

function points(values: number[], w: number, h: number, max: number): [number, number][] {
  const m = safeMax(max);
  const n = values.length;
  return values.map((v, i) => {
    const x = n === 1 ? w / 2 : (i * w) / (n - 1);
    const y = h - (Math.min(Math.max(Number.isFinite(v) ? v : 0, 0), m) / m) * h;
    return [x, y];
  });
}

/** 'M0 h L… ' de una serie dentro de un rectángulo w × h con eje 0..max. */
export function linePath(values: number[], w: number, h: number, max: number): string {
  if (values.length === 0) return '';
  return points(values, w, h, max).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`).join(' ');
}

export function areaPath(values: number[], w: number, h: number, max: number): string {
  const line = linePath(values, w, h, max);
  if (!line) return '';
  const pts = points(values, w, h, max);
  const firstX = pts[0][0];
  const lastX = pts[pts.length - 1][0];
  return `${line} L${num(lastX)} ${num(h)} L${num(firstX)} ${num(h)} Z`;
}

/** 'x,y x,y' para <polyline>; la escala va del mínimo al máximo de la serie. */
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return '';
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const span = hi - lo;
  const n = clean.length;
  return clean
    .map((v, i) => {
      const x = n === 1 ? w / 2 : (i * w) / (n - 1);
      const y = span === 0 ? h / 2 : h - ((v - lo) / span) * h;
      return `${num(x)},${num(y)}`;
    })
    .join(' ');
}

const NICE = [1, 1.5, 2, 2.5, 5, 7.5, 10];

/** Siguiente valor "redondo" (1, 1.5, 2, 2.5, 5, 7.5 × 10^n) que contiene a `v`. */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const f = v / base;
  const step = NICE.find((s) => f <= s + 1e-9) ?? 10;
  return r2(step * base);
}

/**
 * Barras del puente: un `total` arranca en 0; un `negative` flota desde el nivel acumulado
 * hacia abajo. Porcentajes sobre el mayor nivel alcanzado.
 */
export function waterfallBars(
  steps: { amount: number; kind: 'total' | 'negative' }[],
): { bottomPct: number; heightPct: number }[] {
  if (steps.length === 0) return [];
  let running = 0;
  let top = 0;
  const raw = steps.map((s) => {
    const a = Number.isFinite(s.amount) ? s.amount : 0;
    if (s.kind === 'total') {
      running = a;
      top = Math.max(top, Math.abs(a));
      return { bottom: 0, height: Math.abs(a) };
    }
    const bottom = Math.max(running - a, 0);
    const height = Math.max(running - bottom, 0);
    top = Math.max(top, running);
    running -= a;
    return { bottom, height };
  });
  const scale = top > 0 ? top : 1;
  return raw.map((b) => ({ bottomPct: r2((b.bottom / scale) * 100), heightPct: r2((b.height / scale) * 100) }));
}

/** Segmentos de una dona con circunferencia 100 (`pathLength=100`); `shares` en porcentaje. */
export function donutSegments(shares: number[]): { dasharray: string; dashoffset: number }[] {
  let acc = 0;
  return shares.map((s) => {
    const share = Number.isFinite(s) && s > 0 ? s : 0;
    const seg = { dasharray: `${r2(share)} ${r2(100 - share)}`, dashoffset: acc === 0 ? 0 : -r2(acc) };
    acc += share;
    return seg;
  });
}
