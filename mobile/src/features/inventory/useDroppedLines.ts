import { useCallback, useEffect, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import type { InventoryApi } from './inventoryApi';

export interface DroppedLine {
    key: string;
    sheetId: number;
    productId: number;
    name: string;
    /** The server kept a newer value (applied:false): not a loss, a neutral notice. */
    superseded?: boolean;
    /** The sheet is no longer a draft (submitted, approved or cancelled): counting again is not possible. */
    closed?: boolean;
}

/**
 * Lines the queue dropped for good (`inventory-line-dropped`), seen from the entry so they show on any inventory route.
 * `tick` goes up on each drop: screens showing the sheet reload when it changes.
 */
export function useDroppedLines(api: Pick<InventoryApi, 'sheet'> | null) {
    const [drops, setDrops] = useState<DroppedLine[]>([]);
    const [tick, setTick] = useState(0);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        if (!api) return undefined;
        const off = appEvents.on('inventory-line-dropped', (payload) => {
            const p = payload as { sheetId?: unknown; productId?: unknown; superseded?: unknown } | undefined;
            const sheetId = Number(p?.sheetId);
            const productId = Number(p?.productId);
            if (!Number.isInteger(sheetId) || !Number.isInteger(productId)) return;
            setTick((t) => t + 1);
            const key = `${sheetId}-${productId}`;
            const superseded = p?.superseded === true;
            api.sheet(sheetId)
                .then(
                    (s) => ({ name: s.lines.find((l) => l.productId === productId)?.name ?? 'Un producto', closed: s.status !== 'DRAFT' }),
                    () => ({ name: 'Un producto', closed: false }),
                )
                .then(({ name, closed }) => {
                    if (!alive.current) return;
                    const drop: DroppedLine = { key, sheetId, productId, name, ...(superseded && { superseded: true }), ...(closed && { closed: true }) };
                    setDrops((prev) => {
                        const existing = prev.find((d) => d.key === key);
                        if (!existing) return [...prev, drop];
                        // A real loss outranks a neutral "newer value kept" notice for the same product; never the other way round.
                        if (existing.superseded && !superseded) return prev.map((d) => (d.key === key ? drop : d));
                        return prev;
                    });
                });
        });
        return () => {
            alive.current = false;
            off();
        };
    }, [api]);
    const dismiss = useCallback((key: string) => setDrops((prev) => prev.filter((d) => d.key !== key)), []);
    return { drops, tick, dismiss };
}
