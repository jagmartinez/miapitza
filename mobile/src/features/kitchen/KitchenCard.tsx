import { useCallback, useEffect, useRef, useState } from 'react';
import { isVoidedOrderLine } from '@web/utils/orderLineVoid';
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
    const linesRef = useRef<HTMLUListElement>(null);
    const [more, setMore] = useState(false);
    // Lines that do not fit scroll inside the card (the action button stays put): say so, scrollbars auto-hide on tablets.
    const measure = useCallback(() => {
        const el = linesRef.current;
        if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    }, []);
    useEffect(() => {
        measure();
        const el = linesRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure, batch.items]);
    const cls = ['kitchen-card', timeClass, batch.status === 'READY' ? 'is-ready' : ''].filter(Boolean).join(' ');
    return (
        <article className={cls} data-testid="kitchen-card">
            <header className="kitchen-card-head">
                <strong className="kitchen-card-table">{kitchenLabel(batch)}</strong>
                {batch.user?.name && <span className="kitchen-card-sep" aria-hidden="true">·</span>}
                <span className="kitchen-card-waiter">{batch.user?.name ?? ''}</span>
                <span className="kitchen-card-min">{minutes} min</span>
                {seq > 1 && <span className="kitchen-card-badge">Tanda {seq}</span>}
            </header>
            <div className={`kitchen-card-body${more ? ' has-more' : ''}`}>
            <ul className="kitchen-card-lines" ref={linesRef} onScroll={measure}>
                {batch.items.map((line) => {
                    const voided = isVoidedOrderLine(line as Parameters<typeof isVoidedOrderLine>[0]);
                    return (
                    <li key={line.id} className={voided ? 'is-void' : undefined}>
                        <div className="kitchen-line-name">
                            {`${voided ? Number(line.voidedQuantity) || line.quantity : line.quantity} × ${line.menuItem?.name ?? ''}`}
                            {voided && <span className="kitchen-line-void"> Anulado</span>}
                        </div>
                        {(line.modifiers ?? []).map((m, i) => (
                            <div className="kitchen-line-mod" key={i}>
                                {m.name}
                            </div>
                        ))}
                        {line.notes && <div className="kitchen-line-note">{line.notes}</div>}
                    </li>
                    );
                })}
            </ul>
            {more && <span className="kitchen-card-more" data-testid="kitchen-more">Más abajo ↓</span>}
            </div>
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
