/** Local calendar day [00:00:00.000, 23:59:59.999] of `day` as UTC instants. `offsetMin` is Date#getTimezoneOffset (360 for UTC-6). */
export function localDayBoundsIso(day: Date, offsetMin: number = day.getTimezoneOffset()): { start: string; end: string } {
    const y = day.getFullYear();
    const m = day.getMonth();
    const d = day.getDate();
    return {
        start: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) + offsetMin * 60_000).toISOString(),
        end: new Date(Date.UTC(y, m, d, 23, 59, 59, 999) + offsetMin * 60_000).toISOString(),
    };
}
