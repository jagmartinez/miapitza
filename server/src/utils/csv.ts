/**
 * Simple CSV serializer — replaces json2csv alpha dependency.
 * Handles quoting of values that contain commas, quotes, or newlines, and
 * neutralises spreadsheet formula injection (CWE-1236): text cells starting
 * with = + - @ TAB or CR (other than plain signed decimals) are prefixed with a single quote so Excel/Sheets
 * treat them as literal text. Genuine numbers (typeof number) are untouched.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function neutralizeCsvFormula(value: unknown): string {
    const str = value == null ? '' : String(value);
    if (typeof value === 'number' || typeof value === 'bigint') return str;
    // Plain signed decimals (e.g. "-12.50" from toFixed) are data, not formulas.
    if (/^[+-]?\d+(\.\d+)?$/.test(str)) return str;
    return FORMULA_TRIGGER.test(str) ? `'${str}` : str;
}

export function toCSV(data: Record<string, unknown>[], fields: string[]): string {
    const escapeField = (value: unknown): string => {
        const str = neutralizeCsvFormula(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
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
