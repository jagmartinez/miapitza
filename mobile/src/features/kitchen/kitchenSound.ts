let ctx: AudioContext | null = null;

const BEEP_S = 0.25;
const GAP_S = 0.15;

/** Two 800 Hz sine beeps (0.25 s, 0.15 s apart). No-op when Web Audio is unavailable; reuses one context. */
export function playKitchenChime(): void {
    try {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctor) return;
        ctx ??= new Ctor();
        if (ctx.state === 'suspended') void ctx.resume();
        const start = ctx.currentTime;
        for (let i = 0; i < 2; i++) {
            const at = start + i * (BEEP_S + GAP_S);
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.25, at);
            gain.gain.exponentialRampToValueAtTime(0.001, at + BEEP_S);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(at);
            osc.stop(at + BEEP_S);
        }
    } catch {
        /* sound is best-effort */
    }
}
