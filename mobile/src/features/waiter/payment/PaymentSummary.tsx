import { useState } from 'react';
import { money, type ServerLine } from '../order/orderModel';

const plural = (n: number) => `${n} ${n === 1 ? 'producto' : 'productos'}`;
import type { FiscalCustomer } from './paymentFlow';

export interface SummaryProps {
    lines: ServerLine[];
    subtotal: number;
    discount: number;
    tax: number;
    tip: number;
    total: number;
    customerName: string;
    /** The pre-invoice froze the account: tip and customer can no longer change. */
    frozen: boolean;
    tipRate: number | null;
    tipOn: boolean;
    busy: boolean;
    onToggleTip: () => void;
    onCustomer: (customer: FiscalCustomer) => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CustomerForm({ onSave, onCancel }: { onSave: (c: FiscalCustomer) => void; onCancel: () => void }) {
    const [name, setName] = useState('');
    const [idType, setIdType] = useState('');
    const [taxId, setTaxId] = useState('');
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);
    const save = () => {
        const [n, t, i, e] = [name.trim(), taxId.trim(), idType.trim(), email.trim()];
        if (!n) return setError('Indica el nombre del cliente.');
        if ((t || i) && !(t && i)) return setError('Nombre, identificación y tipo de identificación van juntos.');
        if (e && !EMAIL.test(e)) return setError('El correo no es válido.');
        onSave({ customerName: n, ...(t ? { customerTaxId: t } : {}), ...(i ? { customerTaxIdType: i } : {}), ...(e ? { customerEmail: e } : {}) });
    };
    return (
        <div className="pay-modal-backdrop">
            <div className="pay-modal" role="dialog" aria-modal="true" aria-label="Factura a nombre de">
                <h2 className="sheet-title">Factura a nombre de</h2>
                <label className="field">
                    Nombre
                    <input value={name} maxLength={191} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                    Tipo de identificación
                    <input value={idType} maxLength={50} placeholder="RUC, cédula…" onChange={(e) => setIdType(e.target.value)} />
                </label>
                <label className="field">
                    Identificación
                    <input value={taxId} maxLength={100} onChange={(e) => setTaxId(e.target.value)} />
                </label>
                <label className="field">
                    Correo (opcional)
                    <input type="email" value={email} maxLength={191} onChange={(e) => setEmail(e.target.value)} />
                </label>
                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
                <div className="pay-modal-actions">
                    <button type="button" className="btn" onClick={onCancel}>
                        Cancelar
                    </button>
                    <button type="button" className="btn btn-primary" onClick={save}>
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
}

export function PaymentSummary(p: SummaryProps) {
    const [editing, setEditing] = useState(false);
    return (
        <section className="pay-col pay-summary" aria-label="Resumen">
            <ul className="pay-lines muted" aria-label="Productos">
                {p.lines.map((l) => (
                    <li key={l.id}>
                        <span>{`${l.name} × ${l.quantity}`}</span>
                        <span>{money(l.subtotal)}</span>
                    </li>
                ))}
            </ul>
            <dl className="pay-totals">
                <div>
                    <dt>{plural(p.lines.reduce((n, l) => n + l.quantity, 0))}</dt>
                    <dd>{money(p.subtotal)}</dd>
                </div>
                {p.discount > 0 && (
                    <div>
                        <dt>Descuento</dt>
                        <dd>{`− ${money(p.discount)}`}</dd>
                    </div>
                )}
                <div>
                    <dt>IVA</dt>
                    <dd>{money(p.tax)}</dd>
                </div>
                {p.tip > 0 && (
                    <div>
                        <dt>Propina</dt>
                        <dd>{money(p.tip)}</dd>
                    </div>
                )}
            </dl>
            {p.tipRate != null && p.tipRate > 0 && (
                <button type="button" className="btn btn-outline pay-tip" aria-pressed={p.tipOn} disabled={p.frozen || p.busy} onClick={p.onToggleTip}>
                    {`Propina ${p.tipRate} %`}
                </button>
            )}
            <div className="pay-total">
                <span className="muted">Total</span>
                <strong data-testid="pay-total">{money(p.total)}</strong>
            </div>
            <span className="pay-spacer" />
            <div className="pay-customer-block">
                <span className="pay-cap">Factura a nombre de</span>
                <div className="pay-customer">
                    <strong>{p.customerName}</strong>
                    {!p.frozen && (
                        <button type="button" className="pay-link" onClick={() => setEditing(true)}>
                            Cambiar
                        </button>
                    )}
                </div>
            </div>
            <p className="muted pay-note">La factura se emite al confirmar el pago total.</p>
            {editing && (
                <CustomerForm
                    onCancel={() => setEditing(false)}
                    onSave={(c) => {
                        p.onCustomer(c);
                        setEditing(false);
                    }}
                />
            )}
        </section>
    );
}
