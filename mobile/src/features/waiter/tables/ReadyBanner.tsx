export interface ReadyNotice {
    orderId: number;
    tableNumber?: string;
}

/** "Pedido listo" strip above the plan: amber dot, no coloured side border; tapping it opens the order. */
export function ReadyBanner({ notice, onOpen, onDismiss }: { notice: ReadyNotice | null; onOpen: (orderId: number) => void; onDismiss: () => void }) {
    if (!notice) return null;
    const text = notice.tableNumber ? `Pedido listo · Mesa ${notice.tableNumber}` : 'Pedido listo';
    return (
        <div className="ready-banner" role="status">
            <button type="button" className="ready-banner-main" onClick={() => onOpen(notice.orderId)}>
                <span className="ready-dot" aria-hidden="true" />
                <span>{text}</span>
            </button>
            <button type="button" className="ready-banner-close" aria-label="Descartar aviso" onClick={onDismiss}>
                ×
            </button>
        </div>
    );
}
