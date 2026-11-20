import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { newIdempotencyKey } from '@web/utils/idempotency';
import type { DraftRef, Drafts } from '../../../data/drafts';
import type { DraftData } from '../../../data/types';
import { isQueuedOffline, type NewOrderLine, type OrderRef, type WaiterApi } from '../../../data/waiterApi';
import type { Product } from './orderModel';

export type DraftApi = Pick<WaiterApi, 'addItem' | 'sendToKitchen' | 'createOrder'>;

/** A local "Nuevo" line: not on the server yet. Equal product + modifiers + note share one line. */
export interface DraftTicketLine {
    key: string;
    /** Identity of this line as a user action: its retry key never serves another line (new line = new uid). */
    uid: string;
    menuItemId: number;
    name: string;
    /** Unit price already including modifiers. */
    unitPrice: number;
    quantity: number;
    notes: string;
    modifierIds: number[];
    modifierNames: string[];
}

export interface AddOptions {
    notes?: string;
    modifierIds?: number[];
    modifierNames?: string[];
    /** Sum of the chosen modifiers' prices (per unit). */
    modifierTotal?: number;
}

export interface UseOrderDraftOptions {
    drafts: Pick<Drafts, 'get' | 'set' | 'clear' | 'adopt'>;
    api: DraftApi;
    /** `companyId:userId`: a draft belongs to its waiter. */
    ownerKey: string | null;
    tableId: number | null;
    /** The server order (or the temp id of one created offline); null when the table has none yet. */
    orderId: OrderRef | null;
    guests?: number;
    /** When the order was opened (ms). undefined = not known yet; null = unknown. Only a draft written after it can be that order's. */
    orderCreatedAt?: number | null;
    /** Lines the server holds that were never sent to the kitchen. */
    serverUnsent?: number;
    onSent?: (orderId: OrderRef) => void;
    /** Something reached the server (or the queue) even though the send failed: reload the order. */
    onChanged?: () => void;
}

export type SendOutcome = 'sent' | 'nothing' | 'busy' | 'failed';

const normNote = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');

export function lineKey(menuItemId: number, modifierIds: number[], notes: string): string {
    return `${menuItemId}|${[...modifierIds].sort((a, b) => a - b).join(',')}|${normNote(notes).toLowerCase()}`;
}

/** Stored shape: DraftLine plus the display fields (extras pass through the drafts store). */
interface StoredLine {
    menuItemId: number;
    quantity: number;
    notes?: string;
    modifierIds?: number[];
    name?: string;
    unitPrice?: number;
    modifierNames?: string[];
    uid?: string;
}

const newUid = () => newIdempotencyKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 16);

function fromStored(data: DraftData | null): DraftTicketLine[] {
    const out: DraftTicketLine[] = [];
    for (const raw of (data?.items ?? []) as StoredLine[]) {
        if (!raw || typeof raw.menuItemId !== 'number' || !(raw.quantity > 0)) continue;
        const notes = normNote(raw.notes);
        const modifierIds = Array.isArray(raw.modifierIds) ? raw.modifierIds : [];
        out.push({
            key: lineKey(raw.menuItemId, modifierIds, notes),
            uid: typeof raw.uid === 'string' && raw.uid ? raw.uid : newUid(),
            menuItemId: raw.menuItemId,
            name: raw.name ?? 'Producto',
            unitPrice: Number(raw.unitPrice) || 0,
            quantity: Math.floor(raw.quantity),
            notes,
            modifierIds,
            modifierNames: raw.modifierNames ?? [],
        });
    }
    return out;
}

const toStored = (lines: DraftTicketLine[]): DraftData => ({
    items: lines.map(
        (l): StoredLine => ({ menuItemId: l.menuItemId, quantity: l.quantity, notes: l.notes || undefined, modifierIds: l.modifierIds, name: l.name, unitPrice: l.unitPrice, modifierNames: l.modifierNames, uid: l.uid }),
    ),
});

export const toOrderLine = (l: DraftTicketLine): NewOrderLine => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    ...(l.notes ? { notes: l.notes } : {}),
    ...(l.modifierIds.length ? { modifierIds: l.modifierIds } : {}),
});

const realOrderId = (orderId: OrderRef | null): number | null => (typeof orderId === 'number' ? orderId : typeof orderId === 'string' && /^\d+$/.test(orderId) ? Number(orderId) : null);

/** A draft belongs to its order once the server has one; until then (no order, or one that only lives in the queue) to the table. */
function draftRefOf(orderId: OrderRef | null, tableId: number | null): DraftRef | null {
    const order = realOrderId(orderId);
    if (order != null) return { orderId: order };
    return tableId != null ? { tableId } : null;
}

const scopeOf = (ownerKey: string | null, ref: DraftRef | null): string | null => {
    if (ownerKey == null || ref == null) return null;
    if (typeof ref === 'number') return `${ownerKey}|t${ref}`;
    return 'orderId' in ref ? `${ownerKey}|o${ref.orderId}` : `${ownerKey}|t${ref.tableId}`;
};

/** An order created offline has its creation time in its temp id (`order-<ms>-<suffix>`). */
const tempCreatedAt = (orderId: OrderRef | null): number | undefined => {
    const ms = typeof orderId === 'string' ? Number(/^order-(\d+)-/.exec(orderId)?.[1]) : NaN;
    return Number.isFinite(ms) ? ms : undefined;
};

/**
 * "Nuevo · sin enviar" lines of one waiter, persisted per owner and ORDER (per table only while the table has no server
 * order), and dropped after 24 h. Switching user or order swaps to that scope's own draft; nothing is carried over.
 */
export function useOrderDraft(opts: UseOrderDraftOptions) {
    const { drafts, api, ownerKey, tableId, orderId, orderCreatedAt, guests, serverUnsent = 0, onSent, onChanged } = opts;
    const ref = draftRefOf(orderId, tableId);
    const scope = scopeOf(ownerKey, ref);

    const [state, setState] = useState<{ scope: string | null; lines: DraftTicketLine[] }>({ scope: null, lines: [] });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [highlightKey, setHighlightKey] = useState<string | null>(null);
    const [highlightSeq, setHighlightSeq] = useState(0);
    const [createdUnits, setCreatedUnits] = useState(0);
    const created = useRef<{ scope: string; id: OrderRef; units: number } | null>(null);
    const nonce = useRef<string | null>(null);

    // Always the lines of `scope.current`; mutations compute from here so two taps in a row never lose one.
    const live = useRef<{ scope: string | null; lines: DraftTicketLine[] }>({ scope: null, lines: [] });
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const sendingRef = useRef(false);
    const writes = useRef<Promise<unknown>>(Promise.resolve());
    const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latest = useRef({ orderId, guests, serverUnsent, tableId, ownerKey });
    latest.current = { orderId, guests, serverUnsent, tableId, ownerKey };
    const adopted = useRef<string | null>(null);

    useEffect(() => {
        const prev = live.current;
        // The order opened offline just became the real one: its lines move from the table fallback to the order, intact.
        if (scope != null && ownerKey != null && ref != null && typeof ref === 'object' && 'orderId' in ref && tableId != null && prev.scope === scopeOf(ownerKey, { tableId }) && prev.lines.length > 0) {
            live.current = { scope, lines: prev.lines };
            setState(live.current);
            const carried = toStored(prev.lines);
            writes.current = writes.current
                .then(() => drafts.set(ownerKey, ref, carried, tableId))
                .then(() => drafts.clear(ownerKey, { tableId }))
                .catch(() => setError('No se pudo guardar el borrador en este equipo.'));
            adopted.current = scope;
            return undefined;
        }
        live.current = { scope: null, lines: [] };
        setState({ scope: null, lines: [] });
        setError(null);
        created.current = null;
        nonce.current = null;
        setCreatedUnits(0);
        if (scope == null || ownerKey == null || ref == null) return undefined;
        let alive = true;
        // An order that only lives in the queue is new: a leftover table draft older than it is not its draft.
        const notBefore = typeof ref === 'object' && 'tableId' in ref ? tempCreatedAt(latest.current.orderId) : undefined;
        drafts.get(ownerKey, ref, notBefore !== undefined ? { notBefore } : {}).then(
            (data) => {
                if (!alive) return;
                live.current = { scope, lines: fromStored(data) };
                setState(live.current);
            },
            () => {
                if (!alive) return;
                live.current = { scope, lines: [] };
                setState(live.current);
            },
        );
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, drafts]);

    // A draft written for this table after this order was opened (e.g. one saved before drafts followed orders) is its draft.
    useEffect(() => {
        if (scope == null || ownerKey == null || tableId == null || ref == null || !('orderId' in (ref as object)) || typeof orderCreatedAt !== 'number') return;
        if (state.scope !== scope || adopted.current === scope) return;
        adopted.current = scope;
        if (live.current.lines.length > 0) return;
        const order = (ref as { orderId: number }).orderId;
        void drafts.adopt(ownerKey, tableId, order, orderCreatedAt).then(
            (data) => {
                if (!data || scopeRef.current !== scope || live.current.scope !== scope) return;
                const merged = [...live.current.lines];
                for (const l of fromStored(data)) {
                    const at = merged.findIndex((m) => m.key === l.key);
                    if (at >= 0) merged[at] = { ...merged[at], quantity: merged[at].quantity + l.quantity };
                    else merged.push(l);
                }
                live.current = { scope, lines: merged };
                setState(live.current);
            },
            () => undefined,
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, orderCreatedAt, state.scope]);

    useEffect(
        () => () => {
            if (highlightTimer.current) clearTimeout(highlightTimer.current);
        },
        [],
    );

    const loaded = scope != null && state.scope === scope;
    const lines = loaded ? state.lines : [];

    const commit = useCallback(
        (next: DraftTicketLine[]) => {
            const current = scopeRef.current;
            const { ownerKey: owner, tableId: table, orderId: order } = latest.current;
            const target = draftRefOf(order, table);
            if (current == null || owner == null || target == null || live.current.scope !== current) return;
            live.current = { scope: current, lines: next };
            setState(live.current);
            // Writes are serialised so an older snapshot never lands after a newer one.
            writes.current = writes.current
                .then(() => (next.length ? drafts.set(owner, target, toStored(next), table ?? undefined) : drafts.clear(owner, target)))
                .catch(() => setError('No se pudo guardar el borrador en este equipo.'));
        },
        [drafts],
    );

    const flash = (key: string) => {
        setHighlightKey(key);
        setHighlightSeq((n) => n + 1);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightKey(null), 1200);
    };

    const add = useCallback(
        (product: Pick<Product, 'id' | 'name' | 'price'>, extra: AddOptions = {}) => {
            // Edits are locked while a send is in flight: the snapshot being sent must match what the draft holds afterwards.
            if (sendingRef.current || live.current.scope == null || live.current.scope !== scopeRef.current) return;
            const notes = normNote(extra.notes);
            const modifierIds = extra.modifierIds ?? [];
            const key = lineKey(product.id, modifierIds, notes);
            const current = live.current.lines;
            const found = current.find((l) => l.key === key);
            const next = found
                ? current.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l))
                : [...current, { key, uid: newUid(), menuItemId: product.id, name: product.name, unitPrice: product.price + (extra.modifierTotal ?? 0), quantity: 1, notes, modifierIds, modifierNames: extra.modifierNames ?? [] }];
            commit(next);
            flash(key);
        },
        [commit],
    );

    const setQuantity = useCallback(
        (key: string, quantity: number) => {
            if (sendingRef.current) return;
            const current = live.current.lines;
            commit(quantity <= 0 ? current.filter((l) => l.key !== key) : current.map((l) => (l.key === key ? { ...l, quantity: Math.floor(quantity) } : l)));
        },
        [commit],
    );

    /** Changing the note can make the line identical to another one: they merge. */
    const setNote = useCallback(
        (key: string, note: string) => {
            if (sendingRef.current) return;
            const current = live.current.lines;
            const target = current.find((l) => l.key === key);
            if (!target) return;
            const notes = normNote(note);
            const newKey = lineKey(target.menuItemId, target.modifierIds, notes);
            const twin = newKey !== key ? current.find((l) => l.key === newKey) : undefined;
            const next = twin
                ? current.filter((l) => l.key !== key).map((l) => (l.key === newKey ? { ...l, quantity: l.quantity + target.quantity } : l))
                : current.map((l) => (l.key === key ? { ...l, notes, key: newKey } : l));
            commit(next);
            return newKey;
        },
        [commit],
    );

    const remove = useCallback(
        (key: string) => {
            if (sendingRef.current) return;
            commit(live.current.lines.filter((l) => l.key !== key));
        },
        [commit],
    );

    /** The sent quantity leaves the draft; whatever was added meanwhile stays. */
    const subtractSent = (start: string, sent: DraftTicketLine) => {
        if (live.current.scope !== start) return;
        commit(
            live.current.lines.flatMap((l) => {
                if (l.key !== sent.key) return [l];
                const rest = l.quantity - sent.quantity;
                return rest > 0 ? [{ ...l, quantity: rest }] : [];
            }),
        );
    };

    const send = useCallback(async (): Promise<SendOutcome> => {
        if (sendingRef.current) return 'busy';
        const start = scopeRef.current;
        if (start == null || live.current.scope !== start) return 'nothing';
        const pending = live.current.lines;
        if (created.current?.scope !== start) created.current = null;
        const known = created.current;
        if (pending.length === 0 && latest.current.serverUnsent === 0 && !known) return 'nothing';
        sendingRef.current = true;
        setSending(true);
        setError(null);
        // Every line of this send queues under one group, and the kitchen batch waits behind that group.
        const owner = latest.current.ownerKey ?? undefined; // the session this send belongs to: it never continues under another
        const group = `kitchen-${newIdempotencyKey().replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
        // One nonce per batch: kept while a send keeps failing (so the retry reuses its idempotency key), renewed after a success.
        nonce.current ??= newIdempotencyKey();
        let touched = false; // something reached the server (or the queue): the screen must reload even on failure
        try {
            let target: OrderRef | null = latest.current.orderId ?? known?.id ?? null;
            let anyQueued = false;
            if (target == null) {
                // The table has no order on the server: create it with every line (web contract), then send.
                const { tableId: table, guests: people } = latest.current;
                const res = (await api.createOrder({ tableId: table ?? undefined, orderType: 'DINE_IN', ...(people ? { guests: people } : {}), items: pending.map(toOrderLine) }, { owner, actionId: group })) as { id?: number; entityTempId?: string | null };
                target = isQueuedOffline(res) ? res.entityTempId : (res.id ?? null);
                if (target == null) throw new Error('No se pudo crear el pedido.');
                touched = true;
                anyQueued = isQueuedOffline(res);
                created.current = { scope: start, id: target, units: pending.reduce((n, l) => n + l.quantity, 0) };
                setCreatedUnits(created.current.units);
                pending.forEach((l) => subtractSent(start, l));
            } else {
                for (const line of pending) {
                    const res = await api.addItem(target, toOrderLine(line), { entityTempId: group, owner, actionId: line.uid, meta: { label: `${line.quantity} × ${line.name}`, name: line.name, unitPrice: line.unitPrice, modifierNames: line.modifierNames } });
                    touched = true;
                    anyQueued = anyQueued || isQueuedOffline(res);
                    // Applied (or safely queued): that quantity is no longer a draft, so a retry never repeats it.
                    subtractSent(start, line);
                }
            }
            await api.sendToKitchen(target, { dependencyKey: anyQueued ? group : undefined, forceQueue: anyQueued, nonce: nonce.current, owner });
            nonce.current = null;
            created.current = null;
            setCreatedUnits(0);
            onSent?.(target);
            return 'sent';
        } catch (cause) {
            // Locked or switched user: the screen is gone and what was left stays in A's draft; B must not see an error for it.
            if (cause instanceof Error && cause.name === 'SessionChangedError') return 'failed';
            setError(getApiErrorMessage(cause));
            if (touched) onChanged?.();
            return 'failed';
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [api, commit, onSent, onChanged]);

    const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
    const count = lines.reduce((n, l) => n + l.quantity, 0);

    return { lines, loaded, total, count, sendCount: count + serverUnsent + createdUnits, add, setQuantity, setNote, remove, send, sending, error, clearError: () => setError(null), highlightKey, highlightSeq };
}
