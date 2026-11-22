import { useCallback, useEffect, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import type { InventoryApi } from './inventoryApi';

export interface DroppedLine {
    key: string;
    sheetId: number;
    productId: number;
    name: string;
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
            const p = payload as { sheetId?: unknown; productId?: unknown } | undefined;
            const sheetId = Number(p?.sheetId);
            const productId = Number(p?.productId);
            if (!Number.isInteger(sheetId) || !Number.isInteger(productId)) return;
            setTick((t) => t + 1);
            const key = `${sheetId}-${productId}`;
            api.sheet(sheetId)
                .then(
                    (s) => s.lines.find((l) => l.productId === productId)?.name ?? 'Un producto',
                    () => 'Un producto',
                )
                .then((name) => {
                    if (alive.current) setDrops((prev) => (prev.some((d) => d.key === key) ? prev : [...prev, { key, sheetId, productId, name }]));
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
