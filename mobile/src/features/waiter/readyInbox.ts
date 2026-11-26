import { useCallback, useEffect, useState } from 'react';
import type { Realtime } from '../../core/realtime';
import type { ReadyNotice } from './tables/ReadyBanner';

/**
 * "Pedido listo" notices of this waiter's session, kept in memory only. It lives in WaiterHome (above the tables/order
 * switch), so a notice that arrives while the waiter is on another order is still there when they return to the tables;
 * the lock unmounts WaiterHome, so the next user starts empty and nothing is persisted.
 * KITCHEN_NOTIFICATION only reaches the waiter who created the order. The inbox is for a fully ready order (ORDER_READY),
 * not for single ready items (ORDER_ITEM_READY) nor releases (ORDER_RELEASED).
 */
export function useReadyInbox(realtime: Pick<Realtime, 'subscribe'>) {
    const [notices, setNotices] = useState<ReadyNotice[]>([]);

    useEffect(() => {
        const off = realtime.subscribe('KITCHEN_NOTIFICATION', (payload: unknown) => {
            const p = (payload ?? {}) as { orderId?: unknown; tableNumber?: unknown; eventType?: unknown };
            if (typeof p.orderId !== 'number' || p.eventType !== 'ORDER_READY') return;
            const orderId = p.orderId;
            const notice: ReadyNotice = { orderId, tableNumber: p.tableNumber == null ? undefined : String(p.tableNumber) };
            setNotices((cur) => [notice, ...cur.filter((n) => n.orderId !== orderId)]);
            try {
                navigator.vibrate?.([200, 100, 200]);
            } catch {
                // no vibrator: the banner is enough
            }
        });
        return () => off?.();
    }, [realtime]);

    const dismiss = useCallback((orderId: number) => setNotices((cur) => cur.filter((n) => n.orderId !== orderId)), []);
    return { notices, dismiss };
}
