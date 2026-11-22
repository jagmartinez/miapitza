import { money } from '../waiter/order/orderModel';
import type { CountDisplayStatus, RecentResult } from './inventoryTypes';

export const STATUS_LABEL: Record<CountDisplayStatus, string> = {
    EN_CURSO: 'En curso',
    EN_REVISION: 'En revisión',
    APROBADO: 'Aprobado',
    RECHAZADO: 'Rechazado',
    DEVUELTO: 'Devuelto',
};

/** "Resultado" of a recent sheet: only approved ones show differences (the server sends null otherwise). */
export function resultText(result: RecentResult): string {
    if (!result) return '—';
    if ('recount' in result) return `${result.recount} a recontar`;
    if (result.differences === 0) return 'Sin diferencias';
    return `${result.differences} ${result.differences === 1 ? 'diferencia' : 'diferencias'} · ${money(result.value)}`;
}

export function startedText(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Date only, for the warehouse cards. */
export function dayText(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const initialsOf = (name: string): string =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('');

/** "1 producto", "3 productos": Spanish plural for a count label. */
export function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}
