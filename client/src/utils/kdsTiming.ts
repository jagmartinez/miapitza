type KitchenTimedOrder = {
    createdAt: string;
    items: Array<{ sentAt?: string }>;
};

export type KdsTimingConfig = { warningMinutes: number; urgentMinutes: number };
export type KdsTimeClass = 'time-normal' | 'time-warning' | 'time-urgent';

/** The KDS SLA starts when the first line reaches kitchen, not when the sale draft was created. */
export function getKitchenReceivedAt(order: KitchenTimedOrder): string {
    const sentTimes = order.items
        .map((item) => item.sentAt ? new Date(item.sentAt).getTime() : null)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    return sentTimes.length > 0 ? new Date(Math.min(...sentTimes)).toISOString() : order.createdAt;
}

export function getKdsWaitMinutes(order: KitchenTimedOrder, nowMs = Date.now()): number {
    return Math.max(0, Math.floor((nowMs - new Date(getKitchenReceivedAt(order)).getTime()) / 60_000));
}

export function getKdsTimeClass(minutes: number, config: KdsTimingConfig): KdsTimeClass {
    if (minutes >= config.urgentMinutes) return 'time-urgent';
    if (minutes >= config.warningMinutes) return 'time-warning';
    return 'time-normal';
}

type SummaryOrder = KitchenTimedOrder & { status: string; kitchenReleasedAt?: string | null };

export type KdsSummary = {
    activeCount: number;
    avgMinutes: number | null;
    lateCount: number | null;
    targetMinutes: number | null;
};

/** Active = still in the kitchen (not READY, not released). Missing data is null, never 0. */
export function summarizeKds(orders: SummaryOrder[], config: KdsTimingConfig | null, nowMs = Date.now()): KdsSummary {
    const active = orders.filter((o) => o.status !== 'READY' && !o.kitchenReleasedAt);
    const waits = active.map((o) => getKdsWaitMinutes(o, nowMs));
    const avgMinutes = waits.length > 0 ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
    return {
        activeCount: active.length,
        avgMinutes,
        lateCount: config ? waits.filter((w) => w >= config.urgentMinutes).length : null,
        targetMinutes: config ? config.warningMinutes : null,
    };
}
