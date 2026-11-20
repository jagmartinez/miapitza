import { useCallback, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import type { TablesApi } from './TablesScreen';
import type { ActiveOrder, PlanTable, TableState } from './tableState';

export type PickMode = 'transfer' | 'group';

const OFFLINE_TEXT: Record<PickMode, string> = {
    transfer: 'Trasladar requiere conexión',
    group: 'Unir requiere conexión',
};

interface Source {
    table: PlanTable;
    order: ActiveOrder;
}

/**
 * "Choose the destination table" mode for Trasladar / Unir: the plan stays on screen and the next
 * tap on a valid table completes the action. Both need a connection (never queued offline).
 */
export function useTablePicking(opts: {
    api: Pick<TablesApi, 'transfer' | 'groupTables'>;
    online: boolean;
    stateOf: (table: PlanTable) => TableState;
    onDone: (message: string) => void;
}) {
    const [mode, setMode] = useState<PickMode | null>(null);
    const [source, setSource] = useState<Source | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inFlight = useRef(false);
    const onlineRef = useRef(opts.online);
    onlineRef.current = opts.online;

    const cancel = useCallback(() => {
        setMode(null);
        setSource(null);
        setError(null);
    }, []);

    const begin = useCallback((next: PickMode, table: PlanTable, order: ActiveOrder) => {
        if (!onlineRef.current) {
            setError(OFFLINE_TEXT[next]);
            return;
        }
        setMode(next);
        setSource({ table, order });
        setError(null);
    }, []);

    /** Free tables that are not already part of a group; never the source itself. */
    const canPick = (table: PlanTable) => !!source && table.id !== source.table.id && !table.activeTableGroupId && opts.stateOf(table) === 'free';

    const choose = async (table: PlanTable) => {
        if (!mode || !source || inFlight.current || !canPick(table)) return;
        if (!onlineRef.current) {
            setError(OFFLINE_TEXT[mode]);
            return;
        }
        inFlight.current = true;
        setBusy(true);
        setError(null);
        try {
            if (mode === 'transfer') {
                await opts.api.transfer({ sourceTableId: source.table.id, destinationTableId: table.id, orderId: source.order.id });
                opts.onDone(`Mesa ${source.table.number} trasladada a la mesa ${table.number}`);
            } else {
                await opts.api.groupTables({ primaryTableId: source.table.id, memberTableIds: [table.id] });
                opts.onDone(`Mesa ${table.number} unida a la mesa ${source.table.number}`);
            }
            setMode(null);
            setSource(null);
        } catch (cause) {
            const notSynced = cause instanceof Error && cause.name === 'OrderNotSyncedError';
            setError(notSynced ? 'El pedido aún no se sincroniza; esta operación requiere conexión' : getApiErrorMessage(cause));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    return { mode, source, busy, error, begin, cancel, canPick, choose };
}
