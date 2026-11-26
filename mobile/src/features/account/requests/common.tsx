import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { newIdempotencyKey } from '@web/utils/idempotency';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import { useAccountNav } from '../AccountNav';
import { toHrError, type ActionOpts, type HrApi } from '../hrApi';
import type { RequestCardModel } from '../useAccountSummary';
import '../profile/profile.css';
import './requests.css';

export const AMBIGUOUS_SWAP = 'No se pudo confirmar el envío; revisa Mis solicitudes antes de reintentar.';
export const REASON_MIN = 3;
export const REASON_MAX = 2000;
/** The server caps a loan-request cancel reason at 500. */
export const LOAN_CANCEL_REASON_MAX = 500;

export const validReason = (s: string) => s.trim().length >= REASON_MIN && s.trim().length <= REASON_MAX;

/**
 * One form submission at a time. The actionId is created when the form opens and reused by every retry,
 * so a retry after an ambiguous failure carries the same idempotency key.
 */
export function useRequestSubmit(opts: { onAmbiguous?: string } = {}) {
    const toast = useToast();
    const { back } = useAccountNav();
    const [actionId] = useState(() => newIdempotencyKey());
    const inFlight = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // After an ambiguous failure with a custom message the form stays locked: the user must check first.
    const [locked, setLocked] = useState(false);

    const submit = useCallback(
        async (run: (action: ActionOpts) => Promise<unknown>) => {
            if (inFlight.current) return;
            inFlight.current = true;
            setBusy(true);
            setError(null);
            try {
                await run({ actionId });
                toast.show('Solicitud enviada');
                back();
            } catch (e) {
                const err = toHrError(e);
                // Only "no answer" (network, 408, 5xx) may have been applied; any other server answer is definitive.
                const noAnswer = err.status === undefined || err.status === 408 || err.status >= 500;
                const lock = err.isAmbiguous && noAnswer && !!opts.onAmbiguous;
                setLocked(lock);
                setError(lock ? opts.onAmbiguous! : err.message);
            } finally {
                inFlight.current = false;
                setBusy(false);
            }
        },
        [actionId, back, toast, opts.onAmbiguous],
    );
    return { busy, error, locked, submit };
}

interface FormProps {
    title: string;
    canSubmit: boolean;
    busy: boolean;
    error: string | null;
    onSubmit: () => void;
    children: ReactNode;
}

/** A single screen with one primary "Enviar", disabled while a submit is in flight. */
export function FormScreen({ title, canSubmit, busy, error, onSubmit, children }: FormProps) {
    const { back } = useAccountNav();
    const handle = (e: FormEvent) => {
        e.preventDefault();
        if (canSubmit && !busy) onSubmit();
    };
    return (
        <main className="rq">
            <ScreenHeader title={title} onBack={back} />
            <form className="rq-form" onSubmit={handle}>
                {children}
                {error && (
                    <p className="pf-error" role="alert">
                        {error}
                    </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={!canSubmit || busy}>
                    Enviar
                </button>
            </form>
        </main>
    );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="field">
            {label}
            {children}
        </label>
    );
}

// ---- cancel with a reason ----

const NEEDS_REASON: Record<RequestCardModel['kind'], boolean> = { leave: true, overtime: true, correction: true, swap: false, loan: false };

export async function cancelRequest(hr: HrApi, r: RequestCardModel, reason: string): Promise<void> {
    const opts = { actionId: `cancel-${r.id}` };
    if (r.kind === 'leave') await hr.cancelLeave(r.refId, reason, opts);
    else if (r.kind === 'overtime') await hr.cancelOvertime(r.refId, reason, opts);
    else if (r.kind === 'correction') await hr.cancelCorrection(r.refId, reason, opts);
    else if (r.kind === 'swap') await hr.cancelSwap(r.refId);
    else await hr.cancelLoanRequest(r.refId, reason || undefined, opts);
}

function CancelSheet({ target, onConfirm, onClose }: { target: RequestCardModel; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
    const required = NEEDS_REASON[target.kind];
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const max = target.kind === 'loan' ? LOAN_CANCEL_REASON_MAX : REASON_MAX;
    const ok = (!required || validReason(reason)) && reason.trim().length <= max;

    async function confirm(e: FormEvent) {
        e.preventDefault();
        if (inFlight.current || !ok) return;
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            await onConfirm(reason.trim());
        } catch (err) {
            setError(toHrError(err).message);
            inFlight.current = false;
            setBusy(false);
        }
    }

    return (
        <div className="pf-sheet-backdrop">
            <form className="pf-sheet" role="dialog" aria-label="Cancelar solicitud" onSubmit={(e) => void confirm(e)}>
                <h2>Cancelar solicitud</h2>
                <p className="muted">{target.title}</p>
                {(required || target.kind === 'loan') && (
                    <label className="field">
                        Motivo
                        <textarea className="rq-text" rows={3} maxLength={max} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                )}
                {target.kind === 'loan' && (
                    <p className="muted" aria-live="polite">{`${reason.length}/${max}`}</p>
                )}
                {error && (
                    <p className="pf-error" role="alert">
                        {error}
                    </p>
                )}
                <button type="submit" className="btn btn-primary" disabled={busy || !ok}>
                    Confirmar cancelación
                </button>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>
                    Volver
                </button>
            </form>
        </div>
    );
}

/** Opens a reason prompt for a pending request and cancels it on confirm. */
export function useCancelFlow(hr: HrApi, onDone: () => void) {
    const toast = useToast();
    const [target, setTarget] = useState<RequestCardModel | null>(null);
    const sheet = target ? (
        <CancelSheet
            target={target}
            onClose={() => setTarget(null)}
            onConfirm={async (reason) => {
                await cancelRequest(hr, target, reason);
                setTarget(null);
                toast.show('Solicitud cancelada');
                onDone();
            }}
        />
    ) : null;
    return { ask: setTarget, sheet };
}
