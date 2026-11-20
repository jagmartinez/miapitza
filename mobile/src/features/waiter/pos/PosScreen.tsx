import type { OrderRef } from '../../../data/waiterApi';

/** Placeholder until the order screen (POS v2) lands: shows which order the tables view opened. */
export function PosScreen({ orderId, intent, onBack }: { orderId: OrderRef; intent?: string; onBack: () => void }) {
    return (
        <main className="screen" data-testid="pos-screen" data-order-id={String(orderId)}>
            <button type="button" className="btn" onClick={onBack}>
                Volver a mesas
            </button>
            <p className="muted">Pedido {String(orderId)}{intent && intent !== 'view' ? ` · ${intent}` : ''} (próximamente)</p>
        </main>
    );
}
