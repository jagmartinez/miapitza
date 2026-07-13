export function shouldQueueOfflineMutation(
    method: string | undefined,
    isOnline: boolean,
    isAuthRequest: boolean,
    hasOfflineContract: boolean,
): boolean {
    const normalizedMethod = method?.toLowerCase();
    return !isOnline
        && !isAuthRequest
        && normalizedMethod !== 'get'
        && normalizedMethod !== 'head'
        && hasOfflineContract;
}
