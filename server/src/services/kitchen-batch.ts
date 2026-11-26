type KitchenBatchItem = {
    sentAt?: Date | string | null;
};

/**
 * Selects the latest persisted kitchen send. Legacy orders without sentAt keep
 * all their lines so remediation remains visible instead of silently dropping
 * work.
 */
export function selectLatestKitchenBatch<T extends KitchenBatchItem>(items: T[]): T[] {
    const sentTimes = items
        .map((item) => item.sentAt ? new Date(item.sentAt).getTime() : null)
        .filter((value): value is number => value !== null && Number.isFinite(value));
    if (sentTimes.length === 0) return items;

    const latestSentAt = Math.max(...sentTimes);
    return items.filter((item) =>
        item.sentAt && new Date(item.sentAt).getTime() === latestSentAt
    );
}
