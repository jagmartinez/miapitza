import { act, renderHook, waitFor } from '@testing-library/react';
import { MobileDB } from '../../../data/cache';
import { createDrafts } from '../../../data/drafts';
import { useOrderDraft, type DraftApi } from './useOrderDraft';
import type { Product } from './orderModel';

let n = 0;
const pizza: Product = { id: 1, name: 'Pizza', price: 100, categoryId: 1, modifierGroups: 0 };
const cola: Product = { id: 2, name: 'Cola', price: 30, categoryId: 1, modifierGroups: 0 };

function makeApi(over: Partial<DraftApi> = {}) {
    return {
        addItem: vi.fn().mockResolvedValue({ id: 1 }),
        sendToKitchen: vi.fn().mockResolvedValue({ kitchenBatchSent: true }),
        createOrder: vi.fn().mockResolvedValue({ id: 900 }),
        ...over,
    } as unknown as DraftApi & { addItem: ReturnType<typeof vi.fn>; sendToKitchen: ReturnType<typeof vi.fn>; createOrder: ReturnType<typeof vi.fn> };
}

function setup(over: { api?: ReturnType<typeof makeApi>; ownerKey?: string | null; tableId?: number | null; orderId?: number | string | null; serverUnsent?: number } = {}) {
    const drafts = createDrafts(new MobileDB(`draft-${++n}-${Date.now()}`));
    const api = over.api ?? makeApi();
    const onSent = vi.fn();
    const onChanged = vi.fn();
    const hook = renderHook(
        (p: { ownerKey: string | null; tableId: number | null }) =>
            useOrderDraft({ drafts, api, ownerKey: p.ownerKey, tableId: p.tableId, orderId: over.orderId === undefined ? 55 : over.orderId, serverUnsent: over.serverUnsent, onSent, onChanged }),
        { initialProps: { ownerKey: over.ownerKey === undefined ? '1:7' : over.ownerKey, tableId: over.tableId === undefined ? 3 : over.tableId } },
    );
    return { drafts, api, onSent, onChanged, ...hook };
}

describe('useOrderDraft', () => {
    it('identical lines group, different notes do not', async () => {
        const { result } = setup();
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(pizza));
        expect(result.current.lines).toHaveLength(1);
        expect(result.current.lines[0].quantity).toBe(2);
        act(() => result.current.add(pizza, { notes: 'sin cebolla' }));
        act(() => result.current.add(pizza, { notes: 'sin cebolla' }));
        act(() => result.current.add(pizza, { notes: 'sin queso' }));
        expect(result.current.lines.map((l) => [l.notes, l.quantity])).toEqual([
            ['', 2],
            ['sin cebolla', 2],
            ['sin queso', 1],
        ]);
        // same modifiers in another order still group
        act(() => result.current.add(cola, { modifierIds: [2, 1], modifierNames: ['b', 'a'], modifierTotal: 5 }));
        act(() => result.current.add(cola, { modifierIds: [1, 2], modifierNames: ['a', 'b'], modifierTotal: 5 }));
        expect(result.current.lines.filter((l) => l.menuItemId === 2)).toHaveLength(1);
        expect(result.current.total).toBe(2 * 100 + 2 * 100 + 100 + 2 * 35);
    });

    it('send posts lines then one send-to-kitchen; double tap sends once', async () => {
        const gate: { release: () => void } = { release: () => undefined };
        const api = makeApi({
            addItem: vi.fn().mockImplementation(() => new Promise((resolve) => (gate.release = () => resolve({ id: 1 })))),
        });
        const { result, onSent } = setup({ api });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(cola, { notes: 'sin hielo' }));
        let first!: Promise<unknown>;
        let second!: Promise<unknown>;
        act(() => {
            first = result.current.send();
            second = result.current.send();
        });
        await waitFor(() => expect(api.addItem).toHaveBeenCalledTimes(1));
        expect(result.current.sending).toBe(true);
        await act(async () => {
            gate.release();
        });
        await waitFor(() => expect(api.addItem).toHaveBeenCalledTimes(2));
        await act(async () => {
            gate.release();
            await first;
            await second;
        });
        expect(api.addItem).toHaveBeenCalledTimes(2);
        expect(api.addItem.mock.calls[0][0]).toBe(55);
        expect(api.addItem.mock.calls[0][1]).toEqual({ menuItemId: 1, quantity: 1 });
        expect(api.addItem.mock.calls[1][1]).toEqual({ menuItemId: 2, quantity: 1, notes: 'sin hielo' });
        expect(api.sendToKitchen).toHaveBeenCalledTimes(1);
        expect(api.sendToKitchen.mock.invocationCallOrder[0]).toBeGreaterThan(api.addItem.mock.invocationCallOrder[1]);
        // everything applied online: nothing to wait behind
        expect(api.sendToKitchen.mock.calls[0][1]).toEqual({ dependencyKey: undefined, forceQueue: false, nonce: expect.any(String), owner: '1:7' });
        expect(result.current.lines).toHaveLength(0);
        expect(onSent).toHaveBeenCalledTimes(1);
        expect(result.current.sending).toBe(false);
    });

    it('a failed line keeps the unsent ones in the draft and a retry does not repeat the sent one', async () => {
        const api = makeApi();
        api.addItem.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500, data: { message: 'Servidor ocupado' } } })).mockResolvedValue({ id: 3 });
        const { result } = setup({ api });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(cola));
        await act(async () => {
            await result.current.send();
        });
        expect(result.current.lines.map((l) => l.menuItemId)).toEqual([2]);
        expect(result.current.error).toBeTruthy();
        expect(api.sendToKitchen).not.toHaveBeenCalled();
        await act(async () => {
            await result.current.send();
        });
        expect(api.addItem).toHaveBeenCalledTimes(3);
        expect(api.sendToKitchen).toHaveBeenCalledTimes(1);
        expect(result.current.lines).toHaveLength(0);
    });

    it('queued lines: the kitchen batch is queued behind the same group', async () => {
        const queued = { success: true, _offline: true, entityTempId: null, queueId: 1 };
        const api = makeApi({ addItem: vi.fn().mockResolvedValue(queued) });
        const { result } = setup({ api });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(cola));
        await act(async () => {
            await result.current.send();
        });
        const group = api.addItem.mock.calls[0][2].entityTempId;
        expect(group).toBeTruthy();
        expect(api.addItem.mock.calls[1][2].entityTempId).toBe(group);
        expect(api.sendToKitchen.mock.calls[0][1]).toEqual({ dependencyKey: group, forceQueue: true, nonce: expect.any(String), owner: '1:7' });
    });

    it('lines the server already holds unsent are sent without adding again', async () => {
        const { result, api } = setup({ serverUnsent: 2 });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.sendCount).toBe(2);
        await act(async () => {
            await result.current.send();
        });
        expect(api.addItem).not.toHaveBeenCalled();
        expect(api.sendToKitchen).toHaveBeenCalledTimes(1);
    });

    it('a table without server order is created with all lines, then sent', async () => {
        const { result, api } = setup({ orderId: null });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(pizza));
        await act(async () => {
            await result.current.send();
        });
        expect(api.createOrder).toHaveBeenCalledWith({ tableId: 3, orderType: 'DINE_IN', items: [{ menuItemId: 1, quantity: 2 }] }, { owner: '1:7', actionId: expect.any(String) });
        expect(api.addItem).not.toHaveBeenCalled();
        expect(api.sendToKitchen.mock.calls[0][0]).toBe(900);
    });

    it('draft survives a user switch and is not visible to another user', async () => {
        const { result, rerender, drafts } = setup();
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await waitFor(async () => expect((await drafts.get('1:7', 3))?.items).toHaveLength(1));

        rerender({ ownerKey: '1:8', tableId: 3 });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.lines).toHaveLength(0);
        act(() => result.current.add(cola));
        await waitFor(async () => expect((await drafts.get('1:8', 3))?.items).toHaveLength(1));
        expect((await drafts.get('1:7', 3))?.items.map((i) => i.menuItemId)).toEqual([1]);

        rerender({ ownerKey: '1:7', tableId: 3 });
        await waitFor(() => expect(result.current.lines.map((l) => l.menuItemId)).toEqual([1]));
        // another table of the same user is a different draft
        rerender({ ownerKey: '1:7', tableId: 4 });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.lines).toHaveLength(0);
    });
});

describe('useOrderDraft fix round 1', () => {
    it('C1: a failed kitchen send after applied lines tells the screen to reload', async () => {
        const api = makeApi({ sendToKitchen: vi.fn().mockRejectedValue(new Error('red')) });
        const { result, onChanged, onSent } = setup({ api });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => {
            await result.current.send();
        });
        expect(result.current.error).toBeTruthy();
        expect(onChanged).toHaveBeenCalledTimes(1);
        expect(onSent).not.toHaveBeenCalled();
    });

    it('C1: a line failing mid-way also reloads, so the applied ones show', async () => {
        const api = makeApi();
        api.addItem.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(new Error('red'));
        const { result, onChanged } = setup({ api });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(cola));
        await act(async () => {
            await result.current.send();
        });
        expect(onChanged).toHaveBeenCalledTimes(1);
    });

    /** Starts a send of 1 x pizza (x2 when `twice`) and holds addItem open. */
    async function sendInFlight(twice = false) {
        const gate: { release: () => void } = { release: () => undefined };
        const api = makeApi({ addItem: vi.fn().mockImplementation(() => new Promise((resolve) => (gate.release = () => resolve({ id: 1 })))) });
        const view = setup({ api });
        await waitFor(() => expect(view.result.current.loaded).toBe(true));
        act(() => view.result.current.add(pizza));
        if (twice) act(() => view.result.current.add(pizza));
        let p!: Promise<unknown>;
        act(() => {
            p = view.result.current.send();
        });
        await waitFor(() => expect(api.addItem).toHaveBeenCalledTimes(1));
        const finish = () =>
            act(async () => {
                gate.release();
                await p;
            });
        return { ...view, api, finish };
    }

    it('N1: adding while a send is in flight is ignored (no swallowed or duplicated unit)', async () => {
        const { result, api, finish } = await sendInFlight();
        act(() => result.current.add(pizza));
        expect(result.current.lines[0].quantity).toBe(1);
        await finish();
        expect(api.addItem.mock.calls[0][1]).toEqual({ menuItemId: 1, quantity: 1 });
        expect(result.current.lines).toHaveLength(0);
    });

    it('N1: a note edit during a send does not duplicate the line', async () => {
        const { result, finish } = await sendInFlight();
        const key = result.current.lines[0].key;
        act(() => {
            result.current.setNote(key, 'sin cebolla');
        });
        expect(result.current.lines[0].notes).toBe('');
        await finish();
        expect(result.current.lines).toHaveLength(0);
    });

    it('N1: a decrement or a removal during a send is ignored, not half applied', async () => {
        const { result, api, finish } = await sendInFlight(true);
        const key = result.current.lines[0].key;
        act(() => result.current.setQuantity(key, 1));
        act(() => result.current.remove(key));
        expect(result.current.lines[0].quantity).toBe(2);
        await finish();
        expect(api.addItem.mock.calls[0][1]).toEqual({ menuItemId: 1, quantity: 2 });
        expect(result.current.lines).toHaveLength(0);
    });

    it('N1: remove then re-add during a send cannot swallow the new unit', async () => {
        const { result, finish } = await sendInFlight(true);
        const key = result.current.lines[0].key;
        act(() => result.current.remove(key));
        act(() => result.current.add(pizza));
        expect(result.current.lines[0].quantity).toBe(2);
        await finish();
        expect(result.current.lines).toHaveLength(0);
        // once the send is over, edits work again
        act(() => result.current.add(cola));
        expect(result.current.lines).toHaveLength(1);
    });

    it('I1: create-with-lines removes only the lines that were sent', async () => {
        const api = makeApi({ createOrder: vi.fn().mockResolvedValue({ id: 900 }) });
        const { result } = setup({ api, orderId: null });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => {
            await result.current.send();
        });
        expect(result.current.lines).toHaveLength(0);
        expect(api.createOrder).toHaveBeenCalledWith({ tableId: 3, orderType: 'DINE_IN', items: [{ menuItemId: 1, quantity: 1 }] }, { owner: '1:7', actionId: expect.any(String) });
    });

    it('Minor 1: after create then a failed send, a retry reuses the created order', async () => {
        const api = makeApi();
        api.sendToKitchen.mockRejectedValueOnce(new Error('red')).mockResolvedValue({});
        const { result } = setup({ api, orderId: null });
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => {
            await result.current.send();
        });
        expect(result.current.sendCount).toBeGreaterThan(0); // the order holds unsent lines: still sendable
        await act(async () => {
            await result.current.send();
        });
        expect(api.createOrder).toHaveBeenCalledTimes(1);
        expect(api.sendToKitchen).toHaveBeenCalledTimes(2);
        expect(api.sendToKitchen.mock.calls[1][0]).toBe(900);
        expect(api.addItem).not.toHaveBeenCalled();
    });

    it('Minor 8: each batch carries a nonce, reused on retry and renewed after a success', async () => {
        const api = makeApi();
        api.sendToKitchen.mockRejectedValueOnce(new Error('red')).mockResolvedValue({});
        const { result } = setup({ api, serverUnsent: 1 }); // the screen reloads and reports the line the server now holds
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => {
            await result.current.send();
        });
        await act(async () => {
            await result.current.send();
        });
        const [first, retry] = api.sendToKitchen.mock.calls.map((c) => c[1].nonce);
        expect(first).toBeTruthy();
        expect(retry).toBe(first);
        act(() => result.current.add(cola));
        await act(async () => {
            await result.current.send();
        });
        expect(api.sendToKitchen.mock.calls[2][1].nonce).not.toBe(first);
    });
});
