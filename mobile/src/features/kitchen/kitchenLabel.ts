import type { KitchenBatch } from './kitchenTypes';

/** Short card label: table (M5), else customer name, else takeaway number. */
export function kitchenLabel(b: Pick<KitchenBatch, 'id' | 'table' | 'customerName'>): string {
    const n = b.table?.number;
    if (n !== undefined && n !== null && n !== '') return `M${n}`;
    const name = b.customerName?.trim();
    if (name) return name;
    return `Llevar #${b.id}`;
}
