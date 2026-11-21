import { useState, type FormEvent } from 'react';
import { toHrError } from '../hrApi';
import './profile.css';

interface Props {
    hasPin: boolean;
    onSubmit: (pin: string, currentPassword: string) => Promise<void>;
    onClose: () => void;
}

/** Same rules and message text as the server (pin.service.ts validateFormat). */
export function validatePin(pin: string): string | null {
    if (!/^\d{4,6}$/.test(pin)) return 'El PIN debe tener entre 4 y 6 dígitos';
    const d = pin.split('').map(Number);
    const run = (step: number) => d.every((x, i) => i === 0 || x - d[i - 1] === step);
    if (d.every((x) => x === d[0]) || run(1) || run(-1)) return 'El PIN es demasiado fácil de adivinar';
    return null;
}

export function PinSetupSheet({ hasPin, onSubmit, onClose }: Props) {
    const [pin, setPin] = useState('');
    const [repeat, setRepeat] = useState('');
    const [current, setCurrent] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (busy) return;
        const invalid = validatePin(pin);
        if (invalid) return setError(invalid);
        if (pin !== repeat) return setError('Los PIN no coinciden');
        setBusy(true);
        setError(null);
        try {
            await onSubmit(pin, current);
        } catch (err) {
            setError(toHrError(err).message);
            setBusy(false);
        }
    }

    const digits = (set: (v: string) => void) => (e: { target: { value: string } }) => set(e.target.value.replace(/\D/g, '').slice(0, 6));
    return (
        <div className="pf-sheet-backdrop">
            <form className="pf-sheet" role="dialog" aria-label={hasPin ? 'Cambiar PIN' : 'Definir PIN'} onSubmit={(e) => void submit(e)}>
                <h2>{hasPin ? 'Cambiar PIN' : 'Definir PIN'}</h2>
                <label className="field">PIN
                    <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={digits(setPin)} />
                </label>
                <label className="field">Repite el PIN
                    <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={repeat} onChange={digits(setRepeat)} />
                </label>
                <label className="field">Contraseña actual
                    <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                </label>
                {error && <p className="pf-error" role="alert">{error}</p>}
                <button type="submit" className="btn btn-primary" disabled={busy || !pin || !repeat || !current}>Guardar PIN</button>
                <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
            </form>
        </div>
    );
}
