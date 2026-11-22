/** "1 producto", "3 productos": Spanish count label with the singular only for exactly one. */
export function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}
