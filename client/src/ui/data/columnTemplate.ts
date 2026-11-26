import type { Column } from './DataTable';

/** Convierte anchos `Nfr` en `minmax(0,Nfr)`; deja px, rem y minmax(...) tal cual. */
export function columnTemplate(cols: Pick<Column<unknown>, 'width'>[]): string {
  return cols
    .map((c) => {
      const w = (c.width ?? '1fr').trim();
      return /^\d+(\.\d+)?fr$/.test(w) ? `minmax(0,${w})` : w;
    })
    .join(' ');
}
