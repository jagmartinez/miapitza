import type { ToastItemData, ToastType } from '../components/Toast';
import type { AppNotice } from '../services/notify';

/** Visible toasts at once; when full, the least important oldest one is dropped. */
export const MAX_TOASTS = 4;

/** Lower rank is evicted first: confirmations go before warnings, errors last. */
const EVICTION_RANK: Record<ToastType, number> = {
    success: 0,
    info: 0,
    warning: 1,
    error: 2,
};

/** Drop the oldest toast of the lowest rank until the stack fits. */
function trimToasts(toasts: ToastItemData[], max: number): ToastItemData[] {
    const next = toasts.slice();
    while (next.length > max && next.length > 0) {
        let victim = 0;
        for (let i = 1; i < next.length; i += 1) {
            if (EVICTION_RANK[next[i].type] < EVICTION_RANK[next[victim].type]) victim = i;
        }
        next.splice(victim, 1);
    }
    return next;
}

let toastSeq = 0;
const nextToastId = () => `t${Date.now().toString(36)}${(toastSeq++).toString(36)}`;

/** Pure reducer behind ToastProvider: dedupe by key, bump repeat count, cap the stack. */
export function addOrBumpToast(prev: ToastItemData[], notice: AppNotice, max = MAX_TOASTS): ToastItemData[] {
    const key = notice.dedupeKey ?? `${notice.type}:${notice.message}`;
    const existingIndex = prev.findIndex((t) => (t as ToastItemData & { key?: string }).key === key);
    if (existingIndex >= 0) {
        const existing = prev[existingIndex] as ToastItemData & { key?: string };
        const sameText = existing.message === notice.message && existing.type === notice.type;
        const updated = {
            ...existing,
            message: notice.message,
            type: notice.type,
            duration: notice.duration,
            count: sameText ? (existing.count ?? 1) + 1 : 1,
        };
        // Replacing the id remounts the toast so its timer restarts when the text changed.
        if (!sameText) updated.id = nextToastId();
        const next = prev.slice();
        next[existingIndex] = updated;
        return next;
    }
    const added = [...prev, { id: nextToastId(), key, message: notice.message, type: notice.type, duration: notice.duration, count: 1 }];
    return added.length > max ? trimToasts(added, max) : added;
}


const BASE_DURATION: Record<ToastType, number> = {
    success: 3500,
    info: 4500,
    warning: 6500,
    error: 8000,
};

/** Long messages stay longer (≈60 ms per character), capped so they never pile up forever. */
export function toastDuration(type: ToastType, message: string, explicit?: number): number {
    if (explicit && explicit > 0) return explicit;
    return Math.min(Math.max(BASE_DURATION[type], message.length * 60), 15000);
}
