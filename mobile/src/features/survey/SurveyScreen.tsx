import { useEffect, useRef, useState } from 'react';
import { useIdleLock } from '../../core/useIdleLock';
import { surveyKey, type SurveyInput } from './surveyApi';
import { useBackBlock } from './useBackBlock';
import './survey.css';

const IDLE_MS = 60_000;
const THANKS_MS = 5_000;
/** The lock waits for a slow submit this long at most: the customer is never held. */
const SETTLE_MAX_MS = 12_000;
/** Taps this soon after the step changes are the tail of a double tap. */
const SETTLE_TAP_MS = 400;

/** Only what the server accepts (digits, + ( ) - and spaces, 6-30 chars); otherwise nothing: a bad phone must not cost the whole survey. */
export function cleanPhone(v: string): string | null {
    const p = v.replace(/[^0-9+()\-\s]/g, '').trim().slice(0, 30).trim();
    return p.length >= 6 ? p : null;
}

type Rating = number | null;
type Area = 'waiterRating' | 'foodRating' | 'waitRating' | 'ambienceRating';

export interface SurveyScreenProps {
    orderId: number;
    waiterName: string;
    submit: (input: SurveyInput, idempotencyKey: string) => Promise<unknown>;
    /** Ends the survey: the caller locks and revokes the session. */
    onDone: () => void;
}

const clean = (v: string): string | null => v.trim() || null;

function Stars({ label, value, onChange }: { label: string; value: Rating; onChange: (v: Rating) => void }) {
    return (
        <div className="sv-area" role="group" aria-label={label}>
            <span className="sv-area-label">{label}</span>
            <div className="sv-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className={`sv-star${value !== null && n <= value ? ' on' : ''}`} aria-label={`${label}: ${n} de 5`} aria-pressed={value === n} onClick={() => onChange(n)}>
                        ★
                    </button>
                ))}
            </div>
        </div>
    );
}

/** Customer survey on the waiter's tablet: locked (no Back, no exit) until it is sent or 60 s pass untouched. */
export default function SurveyScreen({ orderId, waiterName, submit, onDone }: SurveyScreenProps) {
    const [step, setStep] = useState<'nps' | 'details' | 'thanks'>('nps');
    const [nps, setNps] = useState<number | null>(null);
    const [ratings, setRatings] = useState<Record<Area, Rating>>({ waiterRating: null, foodRating: null, waitRating: null, ambienceRating: null });
    const [comment, setComment] = useState('');
    const [phone, setPhone] = useState('');
    const [settling, setSettling] = useState(false);
    useEffect(() => {
        if (!settling) return undefined;
        const t = setTimeout(() => setSettling(false), SETTLE_TAP_MS);
        return () => clearTimeout(t);
    }, [settling]);
    const sent = useRef<Promise<void> | null>(null);
    const closing = useRef(false);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useBackBlock(true);

    const first = waiterName.trim().split(/\s+/)[0];
    const waiterLabel = first ? `Atención de ${first}` : 'Atención del mesero';

    /** Starts the one submit (a double tap or idle after Enviar reuses it). Failures never reach the customer. */
    const send = (): void => {
        if (sent.current || nps === null) return;
        const input: SurveyInput = { orderId, nps, ...ratings, comment: clean(comment), contactPhone: cleanPhone(phone) };
        sent.current = Promise.resolve()
            .then(() => submit(input, surveyKey(orderId)))
            .then(
                () => undefined,
                () => undefined,
            );
    };

    /** The submit goes out while the session token still exists: lock only after it settles (bounded). */
    const finish = async () => {
        if (closing.current) return;
        closing.current = true;
        const pending = sent.current;
        if (pending) {
            let timer: ReturnType<typeof setTimeout>;
            await Promise.race([pending, new Promise<void>((r) => (timer = setTimeout(r, SETTLE_MAX_MS)))]);
            clearTimeout(timer!);
        }
        if (alive.current) onDone();
    };

    useIdleLock(() => {
        if (step === 'thanks' || closing.current) return;
        send(); // partial answers still count; without an NPS there is nothing to send
        void finish();
    }, IDLE_MS);

    useEffect(() => {
        if (step !== 'thanks') return undefined;
        const t = setTimeout(() => void finish(), THANKS_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    const submitNow = () => {
        if (sent.current) return;
        send();
        setStep('thanks');
    };

    if (step === 'thanks') {
        return (
            <main className="sv" data-testid="survey" aria-label="Encuesta">
                <h1 className="sv-thanks">¡Gracias por tu opinión!</h1>
            </main>
        );
    }

    if (step === 'nps') {
        return (
            <main className="sv" data-testid="survey" aria-label="Encuesta">
                <h1 className="sv-q">¿Qué tan probable es que nos recomiendes a un amigo?</h1>
                <div className="sv-nps">
                    {Array.from({ length: 11 }, (_, n) => (
                        <button
                            key={n}
                            type="button"
                            className="sv-key"
                            onClick={() => {
                                setNps(n);
                                setSettling(true);
                                setStep('details');
                            }}
                        >
                            {n}
                        </button>
                    ))}
                </div>
                <div className="sv-legend">
                    <span>Nada probable</span>
                    <span>Muy probable</span>
                </div>
            </main>
        );
    }

    return (
        <main className={`sv sv-details${settling ? ' sv-settling' : ''}`} data-testid="survey" aria-label="Encuesta">
            <section className="sv-col">
                <Stars label={waiterLabel} value={ratings.waiterRating} onChange={(v) => setRatings((r) => ({ ...r, waiterRating: v }))} />
                <Stars label="Comida" value={ratings.foodRating} onChange={(v) => setRatings((r) => ({ ...r, foodRating: v }))} />
                <Stars label="Tiempo de espera" value={ratings.waitRating} onChange={(v) => setRatings((r) => ({ ...r, waitRating: v }))} />
                <Stars label="Ambiente y limpieza" value={ratings.ambienceRating} onChange={(v) => setRatings((r) => ({ ...r, ambienceRating: v }))} />
            </section>
            <section className="sv-col">
                <label className="sv-field" htmlFor="sv-comment">
                    Comentario (opcional)
                </label>
                <textarea id="sv-comment" className="sv-input" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
                <label className="sv-field" htmlFor="sv-phone">
                    Teléfono (opcional, si quieres que te contactemos)
                </label>
                <input id="sv-phone" className="sv-input" type="tel" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
                <button type="button" className="btn btn-primary sv-send" onClick={submitNow}>
                    Enviar
                </button>
            </section>
        </main>
    );
}
