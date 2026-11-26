import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionOpts, CashApi } from '../../data/cashApi';
import type { ActiveShiftStatus, ClosePayload, MovementInput, ShiftReport } from '../../data/cashTypes';

export const CASH_POLL_MS = 30_000;

interface Slice {
    owner: string | null;
    status: ActiveShiftStatus | null;
    loading: boolean;
    error: unknown;
}

const empty = (owner: string | null): Slice => ({ owner, status: null, loading: owner !== null, error: null });

/**
 * Active cash shift of the signed-in user. `ownerKey` is `companyId:userId` of the live session (null when locked).
 * Session fence: the state is tagged with its owner and read back as empty the moment the owner differs (same render,
 * before any effect), and an epoch counter drops any answer that was requested under a previous owner, so a lock or a
 * PIN switch never shows one user's drawer to the next. cashApi applies the same fence to each call.
 * Re-polls on focus / visibility, every 30 s while mounted, and after each mutation.
 */
export function useCashShift(api: CashApi | null, ownerKey: string | null) {
    const [slice, setSlice] = useState<Slice>(() => empty(ownerKey));
    const epoch = useRef(0);

    // Declared before the polling effect: a new owner bumps the epoch and clears before its first fetch.
    useEffect(() => {
        epoch.current += 1;
        inFlight.current = false;
        setSlice(empty(ownerKey));
        return () => {
            epoch.current += 1; // unmount, lock or switch: late answers are dropped
        };
    }, [ownerKey, api]);

    const inFlight = useRef(false);

    /** Writes only if `mine` (the epoch the caller started under) is still current: a stale owner's answer is dropped. */
    const load = useCallback(
        async (mine: number, poll: boolean): Promise<void> => {
            if (!api || !ownerKey || mine !== epoch.current) return;
            if (poll && inFlight.current) return;
            if (poll) inFlight.current = true;
            try {
                const status = await api.activeStatus();
                if (mine !== epoch.current) return;
                setSlice({ owner: ownerKey, status, loading: false, error: null });
            } catch (error) {
                if (mine !== epoch.current) return;
                // Keep the last known shift (a dropped connection must not look like "no shift"); expose why it is stale.
                setSlice((cur) => ({ ...(cur.owner === ownerKey ? cur : empty(ownerKey)), loading: false, error }));
            } finally {
                if (poll && mine === epoch.current) inFlight.current = false;
            }
        },
        [api, ownerKey],
    );
    const refresh = useCallback(() => load(epoch.current, false), [load]);

    useEffect(() => {
        if (!api || !ownerKey) return undefined;
        const poll = () => void load(epoch.current, true);
        poll();
        const timer = setInterval(poll, CASH_POLL_MS);
        const onFocus = poll;
        const onVisible = () => {
            if (document.visibilityState === 'visible') poll();
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [api, ownerKey, load]);

    const actions = useMemo(() => {
        const need = (): CashApi => {
            if (!api) throw new Error('Caja no disponible');
            return api;
        };
        return {
            async openShift(body: { cashRegisterId: number; startAmount: number }, opts?: ActionOpts) {
                const mine = epoch.current; // the owner the action started under
                const shift = await need().openShift(body, opts);
                await load(mine, false);
                return shift;
            },
            async addMovement(shiftId: number, input: MovementInput, opts?: ActionOpts) {
                const mine = epoch.current;
                const movement = await need().addMovement(shiftId, input, opts);
                await load(mine, false);
                return movement;
            },
            /** Closes the shift and loads its report; a retry that finds it already closed by this user resolves with the report too. */
            async close(shiftId: number, payload: ClosePayload, opts?: ActionOpts): Promise<{ alreadyClosed: boolean; report: ShiftReport | null }> {
                const mine = epoch.current;
                const result = await need().close(shiftId, payload, opts);
                let report: ShiftReport | null = null;
                try {
                    report = await need().report(shiftId);
                } catch {
                    // The shift is closed; the report can be reopened from the history.
                }
                await load(mine, false);
                return { alreadyClosed: result.alreadyClosed, report };
            },
        };
    }, [api, load]);

    const visible = slice.owner === ownerKey ? slice : empty(ownerKey);
    return { status: visible.status, shift: visible.status?.shift ?? null, loading: visible.loading, error: visible.error, refresh, ...actions };
}
