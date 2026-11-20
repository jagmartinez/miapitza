export interface ReadyNotice {
    orderId: number;
    tableNumber?: string;
}

/** "Pedido listo" strips above the plan, one per ready order, newest first: amber dot, no coloured side border; tapping one opens the order. */
export function ReadyBanner({ notices, onOpen, onDismiss }: { notices: ReadyNotice[]; onOpen: (orderId: number) => void; onDismiss: (orderId: number) => void }) {
    return (
        <>
            {notices.map((notice) => (
                <div key={notice.orderId} className="ready-banner" role="status">
                    <button type="button" className="ready-banner-main" onClick={() => onOpen(notice.orderId)}>
                        <span className="ready-dot" aria-hidden="true" />
                        <span>{notice.tableNumber ? `Pedido listo · Mesa ${notice.tableNumber}` : 'Pedido listo'}</span>
                    </button>
                    <button type="button" className="ready-banner-close" aria-label="Descartar aviso" onClick={() => onDismiss(notice.orderId)}>
                        ×
                    </button>
                </div>
            ))}
        </>
    );
}
