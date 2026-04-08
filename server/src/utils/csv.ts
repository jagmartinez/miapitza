/**
 * Simple CSV serializer — replaces json2csv alpha dependency.
 * Handles quoting of values that contain commas, quotes, or newlines.
 */
export function toCSV(data: Record<string, unknown>[], fields: string[]): string {
    const escapeField = (value: unknown): string => {
        const str = value == null ? '' : String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const header = fields.map(escapeField).join(',');
    const rows = data.map(row =>
        fields.map(field => escapeField(row[field])).join(',')
    );

    return [header, ...rows].join('\n');
}
