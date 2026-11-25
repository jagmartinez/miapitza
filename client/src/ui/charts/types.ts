/** Espejo de los contratos de `server/src/services/bi/*` que consumen los gráficos. */
export type BiQuality = 'complete' | 'partial' | 'unavailable';

export interface BridgeStep {
  key: 'gross' | 'discounts' | 'net' | 'cogs' | 'grossMargin' | 'labor' | 'opex' | 'commissions' | 'operating';
  label: string;
  amount: number;
  kind: 'total' | 'negative';
  /** Solo en `labor`: la nómina no cubre el rango y el monto la excluye (no es un 0 real). */
  quality?: BiQuality;
}

export interface Insight {
  id: string;
  kind: 'cost' | 'branch' | 'opportunity' | 'channel';
  severity: 'danger' | 'warning' | 'success';
  impactAmount: number;
  message: string;
  action: { label: string; route: string };
}
