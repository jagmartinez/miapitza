import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useAccountNav } from '../AccountNav';
import type { HrApi } from '../hrApi';
import { PART_LABELS, useAccountSummary } from '../useAccountSummary';
import { useCancelFlow } from './common';
import './requests.css';

const MAX = 100;

/** All my requests (leave, overtime, corrections, swaps, loan requests) with their status. */
export function MyRequests({ hr, userId }: { hr: HrApi; userId: number }) {
    const { back } = useAccountNav();
    const summary = useAccountSummary(hr, { userId, maxRequests: MAX });
    const cancel = useCancelFlow(hr, summary.reload);

    return (
        <main className="rq">
            <ScreenHeader title="Mis solicitudes" onBack={back} />
            <div className="rq-form">
                {summary.failed
                    .filter((p) => p === 'workforce' || p === 'swaps' || p === 'loans')
                    .map((p) => (
                        <p key={p} className="error" role="alert">
                            No se pudo cargar {PART_LABELS[p]}. <button type="button" className="ah-link" onClick={summary.reload}>Reintentar</button>
                        </p>
                    ))}
                {summary.status === 'loading' && <p className="muted">Cargando…</p>}
                {summary.status === 'ready' && !summary.myRequests.length && <p className="muted">Aún no tienes solicitudes.</p>}
                {summary.myRequests.map((r) => (
                    <Card key={r.id} title={r.title} badge={r.statusLabel} badgeTone={r.tone}>
                        <span>{r.detail}</span>
                        {r.cancellable && (
                            <button type="button" className="btn ah-cancel" onClick={() => cancel.ask(r)}>
                                Cancelar solicitud
                            </button>
                        )}
                    </Card>
                ))}
            </div>
            {cancel.sheet}
        </main>
    );
}
