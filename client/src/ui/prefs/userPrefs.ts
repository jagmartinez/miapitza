export type Density = 'comfortable' | 'compact';
export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

import { setNumberLocale } from '../format/number';

export type NumberFormatPref = 'es-NI' | 'en-US';

export interface UiPrefs {
  density: Density;
  rowsPerPage: number;
  numberFormat: NumberFormatPref;
  /** Sucursal con la que abren los filtros que lo permiten (Reportería). */
  defaultBranchId: number | null;
}

const DEFAULTS: UiPrefs = { density: 'comfortable', rowsPerPage: 25, numberFormat: 'es-NI', defaultBranchId: null };
let current: UiPrefs = { ...DEFAULTS };
const listeners = new Set<() => void>();

function applyDensity(density: Density) {
  if (typeof document !== 'undefined') document.documentElement.dataset.density = density;
}

/** Filas por página del usuario: valor inicial de todo DataTable que no fije el suyo. */
export function getRowsPerPage(): number {
  return current.rowsPerPage;
}

export function getUiPrefs(): UiPrefs {
  return current;
}

/** Aplica preferencias recibidas del servidor o guardadas; valores fuera de catálogo se ignoran. */
export function setUiPrefs(next: Partial<UiPrefs> | null | undefined): void {
  const merged: UiPrefs = { ...current };
  if (next?.density === 'comfortable' || next?.density === 'compact') merged.density = next.density;
  if (next && (ROWS_PER_PAGE_OPTIONS as readonly number[]).includes(next.rowsPerPage as number)) {
    merged.rowsPerPage = next.rowsPerPage as number;
  }
  if (next?.numberFormat === 'es-NI' || next?.numberFormat === 'en-US') merged.numberFormat = next.numberFormat;
  if (next && 'defaultBranchId' in next) {
    merged.defaultBranchId = Number.isInteger(next.defaultBranchId) && (next.defaultBranchId as number) > 0 ? (next.defaultBranchId as number) : null;
  }
  current = merged;
  setNumberLocale(merged.numberFormat);
  applyDensity(merged.density);
  listeners.forEach((l) => l());
}

export function resetUiPrefs(): void {
  setUiPrefs(DEFAULTS);
}

export function subscribeUiPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
