import type { DroppedLine } from './useDroppedLines';

function noticeText(d: DroppedLine): string {
    if (d.superseded) return `Se conservó un valor más reciente de «${d.name}».`;
    if (d.closed) return `«${d.name}» no se guardó: este conteo ya fue cerrado.`;
    return `«${d.name}» no se guardó: hay que contarlo de nuevo.`;
}

/** "This product was not saved, count it again": one dismissable alert per dropped line. */
export function DropNotices({ drops, onDismiss }: { drops: DroppedLine[]; onDismiss: (key: string) => void }) {
    return (
        <>
            {drops.map((d) => (
                <p key={d.key} className="cnt-notice" role="alert">
                    <span>{noticeText(d)}</span>
                    <button type="button" className="btn" onClick={() => onDismiss(d.key)}>
                        Entendido
                    </button>
                </p>
            ))}
        </>
    );
}
