const LEGACY_CACHE_PREFIX = 'restaurant-';

export async function retireLegacyAppCache(): Promise<void> {
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations
                .filter((registration) => {
                    const scriptUrl = registration.active?.scriptURL
                        ?? registration.waiting?.scriptURL
                        ?? registration.installing?.scriptURL;
                    return scriptUrl?.endsWith('/sw.js') ?? false;
                })
                .map((registration) => registration.unregister()));
        }
        if ('caches' in window) {
            const keys = await window.caches.keys();
            await Promise.all(keys
                .filter((key) => key.startsWith(LEGACY_CACHE_PREFIX))
                .map((key) => window.caches.delete(key)));
        }
    } catch {
        // Cache retirement must never block application startup. The no-store
        // deployment headers still prevent new stale shells from accumulating.
    }
}
