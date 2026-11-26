import { useCallback } from 'react';

export type LocationErrorKind = 'denied' | 'timeout' | 'unavailable';

export class LocationError extends Error {
    kind: LocationErrorKind;
    constructor(kind: LocationErrorKind) {
        super(kind);
        this.name = 'LocationError';
        this.kind = kind;
    }
}

export interface LocationFix {
    latitude: number;
    longitude: number;
    accuracyM: number;
    capturedAt: string;
}

const WATCHDOG_MS = 20_000;

export function useLocation(): { get: () => Promise<LocationFix> } {
    const get = useCallback(
        () =>
            new Promise<LocationFix>((resolveRaw, rejectRaw) => {
                // The browser timeout does not count the permission prompt: a JS watchdog guarantees an end.
                const timer = setTimeout(() => rejectRaw(new LocationError('timeout')), WATCHDOG_MS);
                const resolve = (v: LocationFix) => (clearTimeout(timer), resolveRaw(v));
                const reject = (e: LocationError) => (clearTimeout(timer), rejectRaw(e));
                if (!navigator.geolocation) return reject(new LocationError('unavailable'));
                navigator.geolocation.getCurrentPosition(
                    (p) =>
                        resolve({
                            latitude: p.coords.latitude,
                            longitude: p.coords.longitude,
                            accuracyM: p.coords.accuracy,
                            capturedAt: new Date(p.timestamp || Date.now()).toISOString(),
                        }),
                    (e) => reject(new LocationError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
                );
            }),
        [],
    );
    return { get };
}
