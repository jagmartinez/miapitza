const EXTERNAL_TABLES = new Set(['face_templates']);

export function containsOnlyKnownExternalTableRemovals(output: string): boolean {
    const lines = output
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines[0] !== '[-] Removed tables' || lines.length < 2) return false;

    const removedTables = lines.slice(1).map((line) => {
        const match = /^-\s+(.+)$/.exec(line);
        return match?.[1];
    });

    return removedTables.every(
        (table) => table !== undefined && EXTERNAL_TABLES.has(table)
    );
}
