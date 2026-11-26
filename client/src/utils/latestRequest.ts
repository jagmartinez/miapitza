export interface LatestRequestGuard {
    begin: () => number;
    isCurrent: (requestId: number) => boolean;
}

/**
 * Monotonic guard for async UI loads whose scope can change before an older
 * response arrives.
 */
export function createLatestRequestGuard(): LatestRequestGuard {
    let latestRequestId = 0;
    return {
        begin: () => {
            latestRequestId += 1;
            return latestRequestId;
        },
        isCurrent: (requestId) => requestId === latestRequestId,
    };
}
