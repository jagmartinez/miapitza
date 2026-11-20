import { useRef, useState } from 'react';
import type { ActionOpts } from '../../data/cashApi';
import type { MovementInput } from '../../data/cashTypes';
import { cashErrorText, isRetryable } from './cashErrors';
import { useOnline } from '../../data/useOnline';
import { money } from '../waiter/order/orderModel';
import { Keypad, parseTyped, typeKey } from '../waiter/payment/controls';
import '../waiter/tables/sheets.css';
import '../waiter/payment/payment.css';
import './cash.css';

export const REASONS = ['Compra menor', 'Retiro a gerencia', 'Pago a proveedor', 'Otro'] as const;
export const DOC_TYPES = [
    { id: 'FACTURA', label: 'Factura' },
    { id: 'RECIBO_GASTO', label: 'Recibo de gasto' },
    { id: 'RECIBO_CAJA', label: 'Recibo de caja' },
] as const;
type DocType = (typeof DOC_TYPES)[number]['id'];

export interface MovementSheetProps {
    shiftId: number;
    type: 'IN' | 'OUT';
    addMovement: (shiftId: number, input: MovementInput, opts?: ActionOpts) => Promise<unknown>;
    onClose: () => void;
    onSaved: () => void;
}

/** Cash in / out of the drawer: amount with keypad, reason chips, document type, description. */
export function MovementSheet({ shiftId, type: initialType, addMovement, onClose, onSaved }: MovementSheetProps) {
    const online = useOnline();
    const [type, setType] = useState(initialType);
    const [typed, setTyped] = useState('');
    const [reason, setReason] = useState<string | null>(null);
    const [doc, setDoc] = useState<DocType | null>(null);
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [pending, setPending] = useState(false);
    const pendingRef = useRef(false);
    const actionId = useRef<string | null>(null);

    /** Any edit makes the next send a new action: only a retry of the failed one keeps its id. */
    const touch = () => {
        actionId.current = null;
        setFailed(false);
        setError(null);
    };

    const amount = typed === '' ? null : parseTyped(typed);
    const detail = description.trim();
    const valid = amount != null && amount > 0 && reason != null && doc != null && (reason !== 'Otro' || detail !== '');
    const canSave = online && valid && !pending;
    const word = type === 'IN' ? 'entrada' : 'salida';

    const save = async () => {
        if (!canSave || pendingRef.current || amount == null || reason == null || doc == null) return;
        pendingRef.current = true;
        setPending(true);
        setError(null);
        actionId.current ??= crypto.randomUUID();
        try {
            await addMovement(shiftId, { type, amount, reason, documentType: doc, description: detail || 'Sin detalle' }, { actionId: actionId.current });
            actionId.current = null;
            onSaved();
        } catch (cause) {
            const again = isRetryable(cause);
            if (!again) actionId.current = null; // a definitive answer ends the action
            setFailed(again);
            setError(cashErrorText(cause, 'No se pudo registrar el movimiento.'));
        } finally {
            pendingRef.current = false;
            setPending(false);
        }
    };

    return (
        <div className="sheet-backdrop" onClick={pending ? undefined : onClose}>
            <div className="sheet cash-sheet" role="dialog" aria-modal="true" aria-label={type === 'IN' ? 'Entrada' : 'Salida'} onClick={(e) => e.stopPropagation()}>
                <div className="cash-sheet-cols">
                    <section className="cash-col" aria-label="Monto">
                        <div className="cash-toggle" role="group" aria-label="Tipo de movimiento">
                            {(['IN', 'OUT'] as const).map((t) => (
                                <button key={t} type="button" className="btn" aria-pressed={type === t} disabled={pending} onClick={() => { setType(t); touch(); }}>
                                    {t === 'IN' ? 'Entrada' : 'Salida'}
                                </button>
                            ))}
                        </div>
                        <div className="cash-amount cash-num" aria-live="polite">
                            {money(amount ?? 0)}
                        </div>
                        <Keypad disabled={pending} onKey={(k) => { setTyped((t) => typeKey(t, k)); touch(); }} />
                    </section>
                    <section className="cash-col" aria-label="Detalle">
                        <h2 className="cash-h">Motivo</h2>
                        <div className="cash-chips" role="group" aria-label="Motivo">
                            {REASONS.map((r) => (
                                <button key={r} type="button" className="btn" aria-pressed={reason === r} disabled={pending} onClick={() => { setReason(r); touch(); }}>
                                    {r}
                                </button>
                            ))}
                        </div>
                        <h2 className="cash-h">Documento</h2>
                        <div className="cash-chips" role="group" aria-label="Tipo de documento">
                            {DOC_TYPES.map((d) => (
                                <button key={d.id} type="button" className="btn" aria-pressed={doc === d.id} disabled={pending} onClick={() => { setDoc(d.id); touch(); }}>
                                    {d.label}
                                </button>
                            ))}
                        </div>
                        <label className="field">
                            Descripción
                            <input value={description} maxLength={200} autoComplete="off" disabled={pending} onChange={(e) => { setDescription(e.target.value); touch(); }} />
                        </label>
                        {!online && (
                            <p className="cash-offline" role="status">
                                Requiere conexión
                            </p>
                        )}
                        {error && (
                            <p className="error" role="alert">
                                {error}{' '}
                                {failed && (
                                    <button type="button" className="btn" disabled={pending} onClick={() => void save()}>
                                        Reintentar
                                    </button>
                                )}
                            </p>
                        )}
                        <div className="cash-sheet-actions">
                            <button type="button" className="btn" disabled={pending} onClick={onClose}>
                                Cancelar
                            </button>
                            <button type="button" className="btn btn-primary cash-main" disabled={!canSave} onClick={() => void save()}>
                                {`Registrar ${word}${amount != null ? ` ${money(amount)}` : ''}`}
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
