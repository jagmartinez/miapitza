import { useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { Sheet } from './Sheet';
import type { PlanTable } from './tableState';

const BASE = [1, 2, 3, 4, 5, 6, 7];
const MORE = [8, 9, 10, 11, 12, 13, 14];

export interface OpenTableSheetProps {
    table: PlanTable;
    areaName: string;
    /** `orders.create`: without it the sheet only explains. */
    canOpen: boolean;
    onClose: () => void;
    /** Creates the order for this party size; the caller navigates to it. */
    onOpen: (guests: number) => Promise<void>;
}

export function OpenTableSheet({ table, areaName, canOpen, onClose, onOpen }: OpenTableSheetProps) {
    const [guests, setGuests] = useState<number | null>(null);
    const [more, setMore] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const numbers = more ? [...BASE, ...MORE] : BASE;
    const tooSmall = table.capacity > 0 && table.capacity < (more ? 14 : 7);

    const submit = async () => {
        if (guests === null || inFlight.current) return; // a second tap must not create a second order
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            await onOpen(guests);
        } catch (cause) {
            setError(getApiErrorMessage(cause));
            inFlight.current = false;
            setBusy(false);
        }
    };

    return (
        <Sheet label={`Abrir mesa ${table.number}`} title={`Mesa ${table.number}`} subtitle={`${areaName} · capacidad ${table.capacity}`} onClose={onClose}>
            {canOpen ? (
                <>
                    <p className="muted sheet-cap">Personas</p>
                    <div className="guest-grid">
                        {numbers.map((n) => (
                            <button
                                key={n}
                                type="button"
                                className="btn-ghost guest"
                                aria-pressed={guests === n}
                                data-over-capacity={n > table.capacity ? 'true' : undefined}
                                onClick={() => setGuests(n)}
                            >
                                {n}
                            </button>
                        ))}
                        {!more && (
                            <button type="button" className="btn-ghost guest guest-more" onClick={() => setMore(true)}>
                                Más
                            </button>
                        )}
                    </div>
                    {guests !== null && table.capacity > 0 && guests > table.capacity && <p className="error sheet-hint">{`Supera la capacidad de la mesa (${table.capacity})`}</p>}
                    {tooSmall && <p className="muted sheet-hint">Más de {table.capacity} sugiere unir con otra mesa</p>}
                    {error && <p className="error">{error}</p>}
                    <button type="button" className="btn btn-primary sheet-main" disabled={guests === null || busy} onClick={() => void submit()}>
                        Abrir y tomar pedido
                    </button>
                </>
            ) : (
                <p className="muted sheet-sub">No tienes permiso para abrir mesas.</p>
            )}
        </Sheet>
    );
}
