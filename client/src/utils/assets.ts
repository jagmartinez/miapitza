export const resolveAssetUrl = (value?: string | null): string => {
    if (!value) return '';
    if (/^(?:https?:|data:|blob:)/i.test(value)) return value;
    if (!value.startsWith('/')) return value;
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '';
    if (/^https?:\/\//i.test(apiBase)) {
        return new URL(value, new URL(apiBase).origin).toString();
    }
    return value;
};
