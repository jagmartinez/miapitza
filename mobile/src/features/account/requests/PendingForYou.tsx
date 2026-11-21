import { useRef, useState } from 'react';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import { useAccountNav } from '../AccountNav';
import { toHrError, type HrApi } from '../hrApi';
import { PART_LABELS, useAccountSummary } from '../useAccountSummary';
import './requests.css';

/** Things waiting on the employee: confirm schedule, new receipt, swap to answer. */
export function PendingForYou({ hr, userId }: { hr: HrApi; userId: number }) {
    const { back, navigate } = useAccountNav();
    const toast = useToast();
    const summary = useAccountSummary(hr, { userId });
    const busy = useRef(new Set<number>());
    const [, force] = useState(0);
    const tick = () => force((n) => n + 1);

    async function respond(id: number, decision: 'ACCEPT' | 'REJECT') {
        if (busy.current.has(id)) return;
        busy.current.add(id);
        tick();
        try {
            await hr.respondSwap(id, decision);
            toast.show(decision === 'ACCEPT' ? 'Cambio aceptado' : 'Cambio rechazado');
            summary.reload();
        } catch (e) {
            toast.show(toHrError(e).message, 'error');
        } finally {
            busy.current.delete(id);
            tick();
        }
    }

    return (
        <main className="rq">
            <ScreenHeader title="Pendiente para ti" onBack={back} />
            <div className="rq-form">
                {summary.failed
                    .filter((p) => p === 'schedule' || p === 'receipts' || p === 'swaps')
                    .map((p) => (
                        <p key={p} className="error" role="alert">
                            No se pudo cargar {PART_LABELS[p]}. <button type="button" className="ah-link" onClick={summary.reload}>Reintentar</button>
                        </p>
                    ))}
                {summary.status === 'loading' && <p className="muted">Cargando…</p>}
                {summary.status === 'ready' && !summary.failed.length && !summary.pendingForYou.length && <p className="muted">No tienes nada pendiente.</p>}
                {summary.pendingForYou.map((p) =>
                    p.kind === 'swap' ? (
                        <Card key={p.id} title={p.title} badge="Pendiente" badgeTone="pending">
                            <span>{p.detail}</span>
                            {p.lines?.map((l) => (
                                <span key={l} className="muted rq-line">{l}</span>
                            ))}
                            <div className="rq-actions">
                                <button type="button" className="btn btn-primary" disabled={busy.current.has(p.refId)} onClick={() => void respond(p.refId, 'ACCEPT')}>
                                    Aceptar
                                </button>
                                <button type="button" className="btn" disabled={busy.current.has(p.refId)} onClick={() => void respond(p.refId, 'REJECT')}>
                                    Rechazar
                                </button>
                            </div>
                        </Card>
                    ) : (
                        <Card key={p.id} title={p.title} badge="Pendiente" badgeTone="pending" onClick={() => navigate(p.kind === 'schedule' ? 'schedule' : 'payroll', { refId: p.refId })}>
                            {p.detail}
                        </Card>
                    ),
                )}
            </div>
        </main>
    );
}
