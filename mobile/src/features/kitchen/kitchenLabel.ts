import type { KitchenBatch } from './kitchenTypes';

/** Short card label: table (M5), else customer name, else takeaway number. */
export function kitchenLabel(b: Pick<KitchenBatch, 'id' | 'table' | 'customerName'>): string {
    const n = b.table?.number;
    if (n !== undefined && n !== null && String(n).trim() !== '') {
        const t = String(n).trim();
        // Numeric tables read "M5"; named tables (e.g. "FDC", "Terraza 2") are shown as-is.
        return /^\d+$/.test(t) ? `M${t}` : t;
    }
    const name = b.customerName?.trim();
    if (name) return name;
    return `Llevar #${b.id}`;
}
