export type KitchenBatchStatus = 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | string;

export interface KitchenLine {
    id: number;
    quantity: number;
    notes?: string | null;
    status?: 'PENDING' | 'IN_PROGRESS' | 'DONE' | string;
    sentAt?: string;
    voidedQuantity?: number | null;
    voidedAt?: string | null;
    menuItem?: { name?: string; categoryId?: number | null } | null;
    modifiers?: Array<{ name: string; price?: number }>;
}

/** One kitchen batch (tanda): the unit of the KDS. An order can have several. */
export interface KitchenBatch {
    id: number;
    kitchenBatchId: number;
    status: KitchenBatchStatus;
    table?: { number: number | string } | null;
    user?: { id: number; name: string; color?: string | null } | null;
    orderType: string;
    customerName?: string | null;
    createdAt: string;
    items: KitchenLine[];
    kitchenReadyAt?: string | null;
    kitchenReleasedAt?: string | null;
}

export interface KitchenConfig {
    warningMinutes: number;
    urgentMinutes: number;
}

export const batchKey = (b: Pick<KitchenBatch, 'id' | 'kitchenBatchId'>): string => `${b.id}:${b.kitchenBatchId}`;
