import { appEvents } from '../../core/events';
import { createCache } from '../../data/cache';
import { createOfflineQueue, MAX_RETRIES, STALE_AFTER_MS } from '../../data/offlineQueue';
import { makeEnv, sessionFor } from '../../data/testkit';
import { createWaiterApi } from '../../data/waiterApi';
import { COUNT_URL, createInventoryApi, OfflineError } from './inventoryApi';
import type { CountSheet } from './inventoryTypes';

const sheet: CountSheet = {
    id: 9,
    status: 'DRAFT',
    displayStatus: 'EN_CURSO',
    warehouse: { id: 2, name: 'Bodega' },
    startedAt: '2026-11-24T10:00:00.000Z',
    startedByName: 'Beto',
    scopeLabel: 'Todo',
    returnNote: null,
    categories: [{ categoryId: null, name: 'Sin categoría' }],
    lines: [
        { productId: 11, name: 'Leche', sku: null, categoryId: null, baseUnit: 'L', units: [{ abbreviation: 'L', name: 'Litro', factor: 1 }], unit: null, countedQuantity: null, counted: false, recountRequested: false },
        { productId: 12, name: 'Azucar', sku: null, categoryId: null, baseUnit: 'kg', units: [{ abbreviation: 'kg', name: 'Kilo', factor: 1 }], unit: null, countedQuantity: null, counted: false, recountRequested: false },
    ],
};

async function setup() {
    const env = makeEnv();
    await env.sessions.save(sessionFor(1));
    let clock = 1_000_000;
    const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline, now: () => clock });
    const cache = createCache(env.db);
    const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache, queue, isOnline: env.isOnline });
    const inventory = createInventoryApi({ api, queue, db: env.db }, env.http, env.isOnline);
    return { ...env, queue, api, inventory, advance: (ms: number) => (clock += ms) };
}

const lineUrl = `${COUNT_URL}/9/lines/11`;
const sheetReply = (data: unknown = sheet) => ({ data: { success: true, data } });

describe('inventory data layer', () => {
    it('saveLine queues offline with count label and stable key', async () => {
        const env = await setup();
        env.setOnline(false);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-24T10:05:00.000Z'));
        try {
            expect(await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 })).toBe('queued');
        } finally {
            vi.useRealTimers();
        }
        const [row] = await env.db.syncQueue.toArray();
        expect(row.url).toBe(lineUrl);
        expect(row.method).toBe('PUT');
        expect(row.meta?.label).toBe('Conteo de inventario');
        expect(row.idempotencyKey).toBe(`count-9-11-${Date.parse('2026-11-24T10:05:00.000Z')}`);
        expect(row.data).toEqual({ unit: 'L', countedQuantity: 8, clientCountedAt: '2026-11-24T10:05:00.000Z' });
        // Replayed later, the original stamp goes out, not the sync time.
        env.setOnline(true);
        await env.queue.process();
        expect(env.seen[0].data).toEqual({ unit: 'L', countedQuantity: 8, clientCountedAt: '2026-11-24T10:05:00.000Z' });
        expect(env.seen[0].key).toBe(row.idempotencyKey);
    });

    it('saveLine online answers saved, and a lost answer is queued with the same stamp and key', async () => {
        const env = await setup();
        expect(await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 1 })).toBe('saved');
        env.reply(() => ({ network: true }));
        expect(await env.inventory.saveLine(9, 12, { unit: 'kg', countedQuantity: 2 })).toBe('queued');
        const [row] = await env.db.syncQueue.toArray();
        const sent = env.seen[1];
        expect(row.idempotencyKey).toBe(sent.key);
        expect((row.data as { clientCountedAt: string }).clientCountedAt).toBe((sent.data as { clientCountedAt: string }).clientCountedAt);
    });

    it('saveLine rethrows the server verdict instead of queueing it', async () => {
        const env = await setup();
        env.reply(() => ({ status: 409, code: 'INVENTORY_COUNT_NOT_EDITABLE' }));
        await expect(env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 1 })).rejects.toMatchObject({ response: { status: 409 } });
        expect(await env.db.syncQueue.count()).toBe(0);
    });

    it('count items never go stale after 12h', async () => {
        const env = await setup();
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.advance(STALE_AFTER_MS * 3);
        const items = await env.queue.listItems();
        expect(items.map((i) => i.status)).toEqual(['pending']);
        env.setOnline(true);
        await env.queue.process();
        expect(env.seen.map((s) => s.url)).toEqual([lineUrl]);
        expect(await env.queue.listFailed()).toHaveLength(0);
    });

    it.each([
        [409, 'INVENTORY_COUNT_NOT_EDITABLE'],
        [404, 'INVENTORY_COUNT_NOT_FOUND'],
        [400, 'INVENTORY_COUNT_UNIT_INVALID'],
        [403, undefined],
    ])('definitive INVENTORY_COUNT_ rejection (%s %s) drops the queued line', async (status, code) => {
        const env = await setup();
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.setOnline(true);
        env.reply(() => ({ status, code }));
        await env.queue.process();
        expect(await env.db.syncQueue.count()).toBe(0);
        expect(env.queue.getSnapshot()).toEqual({ pending: 0, failed: 0 });
    });

    it('a plain 404 or a 5xx keeps the queued line', async () => {
        const env = await setup();
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.setOnline(true);
        env.reply(() => ({ status: 404, code: 'ROUTE_NOT_FOUND' }));
        await env.queue.process();
        expect((await env.db.syncQueue.toArray())[0].status).toBe('pending');
        env.reply(() => ({ status: 503 }));
        await env.db.syncQueue.toCollection().modify({ nextAttemptAt: null });
        await env.queue.process();
        expect((await env.db.syncQueue.toArray())[0].status).toBe('pending');
    });

    it('sheet offline uses cache and overlays queued values', async () => {
        const env = await setup();
        env.reply(() => sheetReply());
        expect((await env.inventory.sheet(9)).lines[0].counted).toBe(false);
        env.setOnline(false);
        env.reply(() => ({ network: true }));
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 7.5 });
        await env.inventory.saveLine(9, 12, { unit: 'kg', countedQuantity: null });
        const offline = await env.inventory.sheet(9);
        expect(offline.lines[0]).toMatchObject({ counted: true, countedQuantity: 7.5, unit: 'L' });
        expect(offline.lines[1]).toMatchObject({ counted: false, countedQuantity: null });
        // The same overlay applies when the network answers but the queue has not drained.
        env.setOnline(true);
        env.reply((req) => (req.url.endsWith('/inventory-counts/9') ? sheetReply() : { network: true }));
        expect((await env.inventory.sheet(9)).lines[0].countedQuantity).toBe(7.5);
    });

    it('submit blocked while sheet lines are queued', async () => {
        const env = await setup();
        env.setOnline(false);
        expect(await env.inventory.pendingLines(9)).toBe(0);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        await env.inventory.saveLine(9, 12, { unit: 'kg', countedQuantity: 2 });
        expect(await env.inventory.pendingLines(9)).toBe(2);
        expect(await env.inventory.pendingLines(10)).toBe(0);
        await expect(env.inventory.submit(9)).rejects.toBeInstanceOf(OfflineError);
        expect(env.seen).toHaveLength(0);
    });

    it('pendingLines counts the lines of any owner', async () => {
        const env = await setup();
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        await env.sessions.save(sessionFor(2));
        await env.inventory.saveLine(9, 12, { unit: 'kg', countedQuantity: 2 });
        expect(await env.inventory.pendingLines(9)).toBe(2);
    });

    it('submit treats an already SUBMITTED sheet as success after a retry', async () => {
        const env = await setup();
        env.reply((req) => (req.method === 'POST' ? { status: 409, code: 'INVENTORY_COUNT_NOT_EDITABLE' } : sheetReply({ ...sheet, status: 'SUBMITTED', lines: [{ ...sheet.lines[0], counted: true }, sheet.lines[1]] })));
        expect(await env.inventory.submit(9)).toEqual({ id: 9, status: 'SUBMITTED', counted: 1, notCounted: 1 });
    });

    it('submit still fails when the sheet is not SUBMITTED, and other errors pass through', async () => {
        const env = await setup();
        env.reply((req) => (req.method === 'POST' ? { status: 409, code: 'INVENTORY_COUNT_NOT_EDITABLE' } : sheetReply({ ...sheet, status: 'APPROVED' })));
        await expect(env.inventory.submit(9)).rejects.toMatchObject({ response: { status: 409 } });
        env.reply(() => ({ status: 409, code: 'INVENTORY_COUNT_RECOUNT_PENDING' }));
        await expect(env.inventory.submit(9)).rejects.toMatchObject({ response: { data: { code: 'INVENTORY_COUNT_RECOUNT_PENDING' } } });
    });

    it('submit online returns the server answer; start needs the network', async () => {
        const env = await setup();
        env.reply(() => sheetReply({ id: 9, status: 'SUBMITTED', counted: 2, notCounted: 0 }));
        expect(await env.inventory.submit(9)).toEqual({ id: 9, status: 'SUBMITTED', counted: 2, notCounted: 0 });
        env.setOnline(false);
        await expect(env.inventory.start({ warehouseId: 2, categoryIds: null })).rejects.toBeInstanceOf(OfflineError);
    });

    it('start sends the scope and lists unwrap the server envelope', async () => {
        const env = await setup();
        env.reply((req) => {
            if (req.method === 'POST') return sheetReply({ id: 9, status: 'DRAFT', warehouseId: 2, productCount: 2 });
            if (req.url === COUNT_URL) return sheetReply({ items: [{ id: 9 }], total: 1 });
            return sheetReply([{ id: 2 }]);
        });
        expect(await env.inventory.start({ warehouseId: 2, categoryIds: [null, 4] })).toMatchObject({ id: 9 });
        expect(env.seen[0].data).toEqual({ warehouseId: 2, categoryIds: [null, 4] });
        await env.inventory.start({ warehouseId: 2, categoryIds: null });
        expect(env.seen[1].data).toEqual({ warehouseId: 2 });
        expect(await env.inventory.recent('review')).toEqual([{ id: 9 }]);
        expect(await env.inventory.warehouses()).toEqual([{ id: 2 }]);
    });
});

describe('count lines are never left failed', () => {
    async function queued() {
        const env = await setup();
        const dropped: unknown[] = [];
        const off = appEvents.on('inventory-line-dropped', (p) => dropped.push(p));
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.setOnline(true);
        return { env, dropped, off };
    }

    it.each([[400], [422]])('a codeless %s is dropped with an event and pendingLines goes to 0', async (status) => {
        const { env, dropped, off } = await queued();
        env.reply(() => ({ status }));
        await env.queue.process();
        off();
        expect(await env.db.syncQueue.count()).toBe(0);
        expect(await env.inventory.pendingLines(9)).toBe(0);
        expect(dropped).toEqual([{ sheetId: 9, productId: 11 }]);
    });

    it('a plain 404 retries and is dropped (with the event) after MAX_RETRIES', async () => {
        const { env, dropped, off } = await queued();
        env.reply(() => ({ status: 404, code: 'ROUTE_NOT_FOUND' }));
        await env.queue.process();
        expect(await env.db.syncQueue.count()).toBe(1);
        expect(dropped).toEqual([]);
        await env.db.syncQueue.toCollection().modify({ retryCount: MAX_RETRIES - 1, nextAttemptAt: null });
        await env.queue.process();
        off();
        expect(await env.db.syncQueue.count()).toBe(0);
        expect(await env.inventory.pendingLines(9)).toBe(0);
        expect(dropped).toEqual([{ sheetId: 9, productId: 11 }]);
    });
});

describe('fix round 1: in-flight saves and outages', () => {
    it('pendingLines counts a save still in flight and submit waits for it', async () => {
        const env = await setup();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((r) => (release = r));
        env.reply(async (req) => {
            if (req.method === 'PUT') await gate;
            return sheetReply({ id: 9, status: 'SUBMITTED', counted: 1, notCounted: 1 });
        });
        const saving = env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 3 });
        await vi.waitFor(() => expect(env.seen).toHaveLength(1));
        expect(await env.inventory.pendingLines(9)).toBe(1);
        expect(await env.inventory.pendingLines(10)).toBe(0);
        const submitting = env.inventory.submit(9);
        await new Promise((r) => setTimeout(r, 20));
        expect(env.seen.filter((s) => s.method === 'POST')).toHaveLength(0);
        release();
        await saving;
        await submitting;
        expect(env.seen.map((s) => s.method)).toEqual(['PUT', 'POST']);
        expect(await env.inventory.pendingLines(9)).toBe(0);
    });

    it.each([[500], [502], [503], [408], [429]])('a %s never drops a queued count line, however many times it repeats', async (status) => {
        const env = await setup();
        const dropped: unknown[] = [];
        const off = appEvents.on('inventory-line-dropped', (p) => dropped.push(p));
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.setOnline(true);
        env.reply(() => ({ status }));
        for (let i = 0; i < MAX_RETRIES + 3; i++) {
            await env.db.syncQueue.toCollection().modify({ nextAttemptAt: null });
            await env.queue.process();
        }
        off();
        expect(await env.db.syncQueue.count()).toBe(1);
        const [row] = await env.db.syncQueue.toArray();
        expect(row.status).toBe('pending');
        expect(dropped).toEqual([]);
    });
});

describe('R13: count age instead of the device clock', () => {
    const ageOf = (config: { headers: { get: (n: string) => unknown } }) => config.headers.get('X-Counted-Age-Ms');

    it('a live save sends the age of the count in a header, outside the body', async () => {
        const env = await setup();
        let age: unknown = null;
        env.reply((_req, config) => {
            age = ageOf(config);
            return {};
        });
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 1 });
        expect(Number(age)).toBeGreaterThanOrEqual(0);
        expect(Number(age)).toBeLessThan(2000);
        expect(Object.keys(env.seen[0].data as object).sort()).toEqual(['clientCountedAt', 'countedQuantity', 'unit']);
    });

    it('each replay measures the age again, so a queued count is as old as it really is when it is sent', async () => {
        const env = await setup();
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-24T10:00:00.000Z'));
            const queue = createOfflineQueue({ db: env.db, http: env.http, sessions: env.sessions, isOnline: env.isOnline });
            const api = createWaiterApi({ http: env.http, sessions: env.sessions, cache: createCache(env.db), queue, isOnline: env.isOnline });
            const inventory = createInventoryApi({ api, queue, db: env.db }, env.http, env.isOnline);
            env.setOnline(false);
            await inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
            env.setOnline(true);
            const ages: unknown[] = [];
            env.reply((_req, config) => {
                ages.push(ageOf(config));
                return ages.length === 1 ? { network: true } : {};
            });
            vi.setSystemTime(new Date('2026-11-24T10:01:30.000Z'));
            await queue.process();
            expect(ages).toEqual(['90000']);
            await env.db.syncQueue.toCollection().modify({ nextAttemptAt: null });
            vi.setSystemTime(new Date('2026-11-24T10:05:00.000Z'));
            await queue.process();
            expect(ages).toEqual(['90000', '300000']);
            expect(await env.db.syncQueue.count()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('applied:false on a live save reloads through the dropped-line path and is not reported as saved', async () => {
        const env = await setup();
        const dropped: unknown[] = [];
        const off = appEvents.on('inventory-line-dropped', (p) => dropped.push(p));
        env.reply(() => ({ data: { success: true, data: { productId: 11, counted: true, applied: false } } }));
        const result = await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 1 });
        off();
        expect(result).toBe('ignored');
        expect(dropped).toEqual([{ sheetId: 9, productId: 11 }]);
    });

    it('applied:false on a replayed save emits the same event and clears the row', async () => {
        const env = await setup();
        const dropped: unknown[] = [];
        const off = appEvents.on('inventory-line-dropped', (p) => dropped.push(p));
        env.setOnline(false);
        await env.inventory.saveLine(9, 11, { unit: 'L', countedQuantity: 8 });
        env.setOnline(true);
        env.reply(() => ({ data: { success: true, data: { productId: 11, counted: true, applied: false } } }));
        await env.queue.process();
        off();
        expect(await env.db.syncQueue.count()).toBe(0);
        expect(dropped).toEqual([{ sheetId: 9, productId: 11 }]);
    });
});
