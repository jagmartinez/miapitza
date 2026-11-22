import type { DroppedLine } from './useDroppedLines';

/** "This product was not saved, count it again": one dismissable alert per dropped line. */
export function DropNotices({ drops, onDismiss }: { drops: DroppedLine[]; onDismiss: (key: string) => void }) {
    return (
        <>
            {drops.map((d) => (
                <p key={d.key} className="cnt-notice" role="alert">
                    <span>{d.superseded ? `Se conservó un valor más reciente de «${d.name}».` : `«${d.name}» no se guardó: hay que contarlo de nuevo.`}</span>
                    <button type="button" className="btn" onClick={() => onDismiss(d.key)}>
                        Entendido
                    </button>
                </p>
            ))}
        </>
    );
}
