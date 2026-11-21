export type AppEvent = 'session-expired' | 'realtime-status' | 'storage-error' | 'kitchen-auth-status' | 'password-change-required' | 'account-user-changed';

type Listener = (payload?: unknown) => void;

const listeners = new Map<AppEvent, Set<Listener>>();

export const appEvents = {
    on(event: AppEvent, fn: Listener): () => void {
        let set = listeners.get(event);
        if (!set) {
            set = new Set();
            listeners.set(event, set);
        }
        const mine = set;
        mine.add(fn);
        return () => {
            mine.delete(fn);
        };
    },
    emit(event: AppEvent, payload?: unknown): void {
        // Copy so listeners may unsubscribe while being notified.
        for (const fn of [...(listeners.get(event) ?? [])]) fn(payload);
    },
};
