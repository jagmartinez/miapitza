/** Transformaciones puras para los gráficos del panel personal (sin dependencias de UI). */

export interface ParetoItem { name: string; value: number; cumulativePct: number }

/** Ordena de mayor a menor, acumula el porcentaje sobre el total completo y recorta a `limit`. */
export function toPareto(items: { name: string; value: number }[], limit = 12): ParetoItem[] {
    const clean = items
        .map((i) => ({ name: i.name, value: Number.isFinite(Number(i.value)) ? Math.max(0, Number(i.value)) : 0 }))
        .sort((a, b) => b.value - a.value);
    const total = clean.reduce((sum, i) => sum + i.value, 0);
    let acc = 0;
    return clean.slice(0, limit).map((i) => {
        acc += i.value;
        return { ...i, cumulativePct: total > 0 ? (acc / total) * 100 : 0 };
    });
}

export interface BinnedScatter { columns: string[]; rows: { label: string; values: number[] }[] }

/** Agrupa puntos (x, y) en una malla `bins` × `bins` de conteos; la fila superior es el valor más alto de y. */
export function binScatter(
    points: Array<Record<string, number | undefined>>,
    xKey: string,
    yKey: string,
    fmt: (n: number) => string,
    bins = 6,
): BinnedScatter {
    const valid = points
        .map((p) => ({ x: Number(p[xKey]), y: Number(p[yKey]) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (valid.length === 0) return { columns: [], rows: [] };
    const range = (vals: number[]) => {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        return { min, step: max > min ? (max - min) / bins : 1 };
    };
    const rx = range(valid.map((p) => p.x));
    const ry = range(valid.map((p) => p.y));
    const grid = Array.from({ length: bins }, () => Array.from({ length: bins }, () => 0));
    for (const p of valid) {
        const xi = Math.min(bins - 1, Math.floor((p.x - rx.min) / rx.step));
        const yi = Math.min(bins - 1, Math.floor((p.y - ry.min) / ry.step));
        grid[yi][xi] += 1;
    }
    const columns = Array.from({ length: bins }, (_, i) => `${fmt(rx.min + i * rx.step)}–${fmt(rx.min + (i + 1) * rx.step)}`);
    const rows = grid
        .map((values, yi) => ({ label: `${fmt(ry.min + yi * ry.step)}–${fmt(ry.min + (ry.step * (yi + 1)))}`, values }))
        .reverse();
    return { columns, rows };
}
