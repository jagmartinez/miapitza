/** Shared scheduled-work minute math for attendance derivation and payroll reconciliation. */

export function scheduledWorkMinutes(input: {
    startAt: Date | string;
    endAt: Date | string;
    breakMinutes: number;
    paidBreak?: boolean | null;
}): number {
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    const span = Math.round((endMs - startMs) / 60_000);
    const unpaidBreak = input.paidBreak ? 0 : Math.max(0, Math.trunc(input.breakMinutes) || 0);
    return Math.max(0, span - unpaidBreak);
}
