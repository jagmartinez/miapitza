/**
 * Escapes HTML special characters to prevent XSS in template literals
 * used with document.write() or dangerouslySetInnerHTML.
 */
export function escapeHtml(value: string | number | null | undefined): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;')
        .replace(/\//g, '&#47;');
}
