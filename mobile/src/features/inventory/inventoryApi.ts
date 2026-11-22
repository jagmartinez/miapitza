import type { AxiosInstance } from 'axios';
import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import { isQueuedOffline } from '../../data/waiterApi';
import type { WaiterData } from '../../data/waiterData';
import { COUNTED_AGE_HEADER, INVENTORY_COUNT_URL_RE } from '../../data/queueLabels';
import { appEvents } from '../../core/events';
import { isOnline } from '../../data/useOnline';
import type { SyncItem } from '../../data/types';
import { COUNT_ERROR, type CountLine, type CountSheet, type CountWarehouse, type RecentFilter, type RecentSheet, type StartedSheet, type SubmittedSheet, type WarehouseCategory } from './inventoryTypes';

export const COUNT_URL = '/v1/inventory-counts';
export const COUNT_LINE_LABEL = 'Conteo de inventario';
const SHEET_TTL_MS = 24 * 60 * 60_000;
/** Lists change under the counter's feet (a sheet started or submitted): always the network first, the cache only when it fails. */
const LIVE_TTL_MS = 0;
const CATEGORIES_TTL_MS = 10 * 60_000;

/** The action needs the server's answer and there is no connection. */
export class OfflineError extends Error {
    constructor(message = 'Requiere conexión') {
        super(message);
        this.name = 'OfflineError';
    }
}

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;
const codeOf = (e: unknown): string => String((e as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code ?? '');

export type CountLineInput = { unit: string; countedQuantity: number | null };
export type InventoryApiData = Pick<WaiterData, 'api' | 'queue' | 'db'>;

const lineUrl = (sheetId: number, productId: number) => `${COUNT_URL}/${sheetId}/lines/${productId}`;

/** Every queued save of this sheet, whoever queued it, oldest first (ordered by the moment the count was typed). */
async function queuedSaves(db: InventoryApiData['db'], sheetId: number): Promise<SyncItem[]> {
    const prefix = `${COUNT_URL}/${sheetId}/lines/`;
    const rows = await db.syncQueue.filter((r) => r.url.startsWith(prefix) && INVENTORY_COUNT_URL_RE.test(r.url)).toArray();
    const typedAt = (r: SyncItem) => Date.parse(String((r.data as { clientCountedAt?: unknown } | null)?.clientCountedAt)) || r.timestamp;
    return rows.sort((a, b) => typedAt(a) - typedAt(b) || a.timestamp - b.timestamp);
}

function overlay(sheet: CountSheet, saves: SyncItem[]): CountSheet {
    if (saves.length === 0) return sheet;
    const byProduct = new Map<number, CountLineInput>();
    for (const s of saves) {
        const data = s.data as { unit?: unknown; countedQuantity?: unknown } | null;
        byProduct.set(Number(s.url.split('/').pop()), { unit: String(data?.unit ?? ''), countedQuantity: typeof data?.countedQuantity === 'number' ? data.countedQuantity : null });
    }
    const lines: CountLine[] = sheet.lines.map((l) => {
        const q = byProduct.get(l.productId);
        if (!q) return l;
        return q.countedQuantity === null ? { ...l, unit: null, countedQuantity: null, counted: false } : { ...l, unit: q.unit || l.unit, countedQuantity: q.countedQuantity, counted: true };
    });
    return { ...sheet, lines };
}

export function createInventoryApi(data: InventoryApiData, http: AxiosInstance, online: () => boolean = isOnline) {
    const { api, db } = data;

    /** Online saves still waiting for the server's answer, per sheet: not in the queue yet, but the sheet must not be sent before they settle. */
    const inFlight = new Map<number, Set<Promise<unknown>>>();
    const track = <T>(sheetId: number, p: Promise<T>): Promise<T> => {
        const set = inFlight.get(sheetId) ?? new Set<Promise<unknown>>();
        inFlight.set(sheetId, set);
        const settled = p.then(
            () => undefined,
            () => undefined,
        );
        set.add(settled);
        void settled.then(() => {
            set.delete(settled);
            if (set.size === 0) inFlight.delete(sheetId);
        });
        return p;
    };

    const read = async <T>(url: string, params: Record<string, unknown> | undefined, ttlMs: number): Promise<T> => (await api.cachedRead<T>(url, params, ttlMs)).data;

    /**
     * One save: the count is stamped now; a lost answer is queued with the same stamp and key. The count's AGE (not the device
     * clock) is what the server trusts: it travels in a header measured for this attempt, and the queue measures it again per replay.
     */
    async function send(sheetId: number, productId: number, input: CountLineInput): Promise<'saved' | 'queued' | 'ignored'> {
        const clientCountedAt = new Date().toISOString();
        const typedAt = Date.parse(clientCountedAt);
        const key = `count-${sheetId}-${productId}-${typedAt}`;
        const queue = { operationType: 'GENERIC_MUTATION' as const, meta: { label: COUNT_LINE_LABEL } };
        const spec = { method: 'PUT' as const, url: lineUrl(sheetId, productId), data: { unit: input.unit, countedQuantity: input.countedQuantity, clientCountedAt }, key };
        try {
            const res = await api.mutate({ ...spec, config: { headers: { [COUNTED_AGE_HEADER]: String(Math.max(0, Date.now() - typedAt)) } }, queue });
            if (isQueuedOffline(res)) return 'queued';
            // The server answered but kept a newer value: tell the counter like a dropped line (the sheet reloads and the product is counted again).
            if ((res as { applied?: unknown } | null)?.applied === false) {
                appEvents.emit('inventory-line-dropped', { sheetId, productId, superseded: true });
                return 'ignored';
            }
            return 'saved';
        } catch (error) {
            // The server's own verdict (sheet closed, bad unit...) is for the counter to see; only a lost answer is queued, with the same stamp and key.
            if (codeOf(error).startsWith('INVENTORY_COUNT_') || !isAmbiguousMutationFailure(error)) throw error;
            await api.mutate({ ...spec, queue: { ...queue, forceQueue: true } });
            return 'queued';
        }
    }

    return {
        warehouses: () => read<CountWarehouse[]>(`${COUNT_URL}/warehouses`, undefined, LIVE_TTL_MS),
        categories: (warehouseId: number) => read<WarehouseCategory[]>(`${COUNT_URL}/warehouses/${warehouseId}/categories`, undefined, CATEGORIES_TTL_MS),
        recent: async (status: RecentFilter = 'all'): Promise<RecentSheet[]> => (await read<{ items: RecentSheet[] }>(COUNT_URL, { status }, LIVE_TTL_MS)).items,

        /** Needs the server (it creates the sheet and its lines). A `null` category id is "Sin categoría"; `null` categoryIds is "Todo". */
        async start(input: { warehouseId: number; categoryIds: Array<number | null> | null }): Promise<StartedSheet> {
            if (!online()) throw new OfflineError();
            const body = input.categoryIds === null ? { warehouseId: input.warehouseId } : input;
            return (await api.mutate<StartedSheet>({ method: 'POST', url: COUNT_URL, data: body })) as StartedSheet;
        },

        /** Online: the server's sheet (cached for 24 h). Without a network: the cache. Either way the saves still queued on this device are laid over it. */
        async sheet(id: number): Promise<CountSheet> {
            const fresh = await read<CountSheet>(`${COUNT_URL}/${id}`, undefined, online() ? LIVE_TTL_MS : SHEET_TTL_MS);
            return overlay(fresh, await queuedSaves(db, id));
        },

        /**
         * Saves (or, with `countedQuantity: null`, clears) one line. The count is stamped with the device clock now: a queued save
         * keeps that stamp, so the server keeps the last thing the counter typed and captures expected stock as of that moment.
         */
        saveLine(sheetId: number, productId: number, input: CountLineInput): Promise<'saved' | 'queued' | 'ignored'> {
            return track(sheetId, send(sheetId, productId, input));
        },

        /** Saves of this sheet still on the device (any owner, failed ones included) plus the ones still in flight: the sheet cannot be sent while there are any. */
        async pendingLines(sheetId: number): Promise<number> {
            return (await queuedSaves(db, sheetId)).length + (inFlight.get(sheetId)?.size ?? 0);
        },

        /**
         * Sends the sheet to review. Never queued: it needs the server's answer. A retry after a lost answer finds the sheet already
         * SUBMITTED (409 NOT_EDITABLE): that is success, confirmed against the server.
         */
        async submit(sheetId: number): Promise<SubmittedSheet> {
            if (!online()) throw new OfflineError();
            // A save still on its way would reach the server after the sheet is closed: let those settle first.
            await Promise.all([...(inFlight.get(sheetId) ?? [])]);
            try {
                return (await api.mutate<SubmittedSheet>({ method: 'POST', url: `${COUNT_URL}/${sheetId}/submit` })) as SubmittedSheet;
            } catch (error) {
                if (statusOf(error) !== 409 || codeOf(error) !== COUNT_ERROR.notEditable) throw error;
                const res = await http.get(`${COUNT_URL}/${sheetId}`);
                const sheet = (res.data?.data ?? res.data) as CountSheet;
                if (sheet.status !== 'SUBMITTED') throw error;
                const counted = sheet.lines.filter((l) => l.counted).length;
                return { id: sheet.id, status: 'SUBMITTED', counted, notCounted: sheet.lines.length - counted };
            }
        },
    };
}

export type InventoryApi = ReturnType<typeof createInventoryApi>;
