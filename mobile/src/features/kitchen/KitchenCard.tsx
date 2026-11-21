import { getKdsTimeClass, getKdsWaitMinutes } from '@web/utils/kdsTiming';
import { kitchenLabel } from './kitchenLabel';
import type { KitchenBatch, KitchenConfig } from './kitchenTypes';

interface Props {
    batch: KitchenBatch;
    config?: KitchenConfig;
    now: number;
    canManage: boolean;
    starting: boolean;
    onStart: () => void;
    onReady: () => void;
}

export function KitchenCard({ batch, config, now, canManage, starting, onStart, onReady }: Props) {
    const minutes = getKdsWaitMinutes(batch, now);
    const timeClass = config && Number.isFinite(config.warningMinutes) && Number.isFinite(config.urgentMinutes) ? getKdsTimeClass(minutes, config) : 'time-normal';
    const pendingStart = batch.status === 'SENT_TO_KITCHEN';
    const seq = batch.kitchenBatchSequence ?? 0;
    const cls = ['kitchen-card', timeClass, batch.status === 'READY' ? 'is-ready' : ''].filter(Boolean).join(' ');
    return (
        <article className={cls} data-testid="kitchen-card">
            <header className="kitchen-card-head">
                <strong className="kitchen-card-table">{kitchenLabel(batch)}</strong>
                <span className="kitchen-card-waiter">{batch.user?.name ?? ''}</span>
                <span className="kitchen-card-min">{minutes} min</span>
                {seq > 1 && <span className="kitchen-card-badge">Tanda {seq}</span>}
            </header>
            <ul className="kitchen-card-lines">
                {batch.items.map((line) => (
                    <li key={line.id}>
                        <div className="kitchen-line-name">{`${line.quantity}× ${line.menuItem?.name ?? ''}`}</div>
                        {(line.modifiers ?? []).map((m, i) => (
                            <div className="kitchen-line-mod" key={i}>
                                {m.name}
                            </div>
                        ))}
                        {line.notes && <div className="kitchen-line-note">{line.notes}</div>}
                    </li>
                ))}
            </ul>
            <footer className="kitchen-card-foot">
                {pendingStart ? (
                    <button type="button" className="kitchen-action" disabled={!canManage || starting} onClick={onStart}>
                        {starting ? 'Iniciando…' : 'Iniciar'}
                    </button>
                ) : (
                    <button type="button" className="kitchen-action" disabled={!canManage} onClick={onReady}>
                        Listo
                    </button>
                )}
                {!canManage && <span className="kitchen-noperm">Sin permiso para marcar</span>}
            </footer>
        </article>
    );
}
