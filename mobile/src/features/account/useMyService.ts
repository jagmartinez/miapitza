import { useCallback, useEffect, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import type { HrApi, MyServiceScore } from './hrApi';
import { useSessionRestored } from './useSessionRestored';

/** Waiter's monthly service score for the Mi cuenta card. Separate from useAccountSummary on purpose. */
export function useMyService(api: Pick<HrApi, 'myService'>, enabled: boolean) {
    const [data, setData] = useState<MyServiceScore | null>(null);
    const [error, setError] = useState(false);
    const seq = useRef(0);

    const reload = useCallback(() => {
        const mine = ++seq.current;
        setError(false);
        if (!enabled) {
            setData(null);
            return;
        }
        Promise.resolve()
            .then(() => api.myService())
            .then((d) => {
                if (mine === seq.current) setData(d);
            })
            .catch(() => {
                if (mine === seq.current) setError(true);
            });
    }, [api, enabled]);

    useEffect(() => {
        reload();
        return () => {
            seq.current++;
        };
    }, [reload]);
    useEffect(
        () =>
            appEvents.on('account-user-changed', () => {
                setData(null);
                reload();
            }),
        [reload],
    );
    useSessionRestored(reload);

    return { data, error, reload };
}
