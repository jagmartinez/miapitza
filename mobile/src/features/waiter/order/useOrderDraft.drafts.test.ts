import { act, renderHook, waitFor } from '@testing-library/react';
import { MobileDB } from '../../../data/cache';
import { createDrafts } from '../../../data/drafts';
import { useOrderDraft, type DraftApi } from './useOrderDraft';
import type { Product } from './orderModel';

let n = 0;
const pizza: Product = { id: 1, name: 'Pizza', price: 100, categoryId: 1, modifierGroups: 0 };
const api = { addItem: vi.fn(), sendToKitchen: vi.fn(), createOrder: vi.fn() } as unknown as DraftApi;
const items = (menuItemId: number) => ({ items: [{ menuItemId, quantity: 1, name: 'X', unitPrice: 1 }] });
const newDrafts = (now?: () => number) => createDrafts(new MobileDB(`draft-order-${++n}-${Date.now()}`), now);

describe('drafts follow the order, not the table (Fable I7, ruling d)', () => {
    it('a new order on a table never inherits the unsent lines left on it by the previous order', async () => {
        const drafts = newDrafts();
        await drafts.set('1:7', { orderId: 55 }, items(1)); // order 55's own draft
        const next = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 56, orderCreatedAt: Date.now() }));
        await waitFor(() => expect(next.result.current.loaded).toBe(true));
        expect(next.result.current.lines).toHaveLength(0);
        const same = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 55, orderCreatedAt: Date.now() }));
        await waitFor(() => expect(same.result.current.lines).toHaveLength(1));
    });

    it('adds are stored under the order', async () => {
        const drafts = newDrafts();
        const { result } = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 55 }));
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await waitFor(async () => expect((await drafts.get('1:7', { orderId: 55 }))?.items).toHaveLength(1));
        expect(await drafts.get('1:7', { tableId: 3 })).toBeNull();
    });

    it('a table-keyed draft written before the order existed is not adopted; one written after it opened is', async () => {
        const drafts = newDrafts();
        await drafts.set('1:7', { tableId: 3 }, items(1)); // legacy / fallback draft, written now
        const old = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 70, orderCreatedAt: Date.now() + 60_000 }));
        await waitFor(() => expect(old.result.current.loaded).toBe(true));
        await new Promise((r) => setTimeout(r, 30));
        expect(old.result.current.lines).toHaveLength(0); // the order is newer than the draft: not its draft
        const mine = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 71, orderCreatedAt: Date.now() - 60_000 }));
        await waitFor(() => expect(mine.result.current.lines).toHaveLength(1));
        expect(await drafts.get('1:7', { orderId: 71 })).not.toBeNull();
        expect(await drafts.get('1:7', { tableId: 3 })).toBeNull();
    });

    it('an order opened offline keeps its lines when its create syncs and it becomes the real order', async () => {
        const drafts = newDrafts();
        const hook = renderHook((p: { orderId: number | string }) => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: p.orderId }), {
            initialProps: { orderId: 'order-1700-abcd1234' as number | string },
        });
        await waitFor(() => expect(hook.result.current.loaded).toBe(true));
        act(() => hook.result.current.add(pizza));
        await waitFor(async () => expect((await drafts.get('1:7', { tableId: 3 }))?.items).toHaveLength(1));
        hook.rerender({ orderId: 900 }); // the queue synced the create
        await waitFor(async () => expect((await drafts.get('1:7', { orderId: 900 }))?.items).toHaveLength(1));
        expect(hook.result.current.lines).toHaveLength(1);
        expect(await drafts.get('1:7', { tableId: 3 })).toBeNull();
    });

    it('a draft older than 24 h is not offered', async () => {
        let t = Date.now();
        const drafts = newDrafts(() => t);
        await drafts.set('1:7', { orderId: 55 }, items(1));
        t += 25 * 3_600_000;
        const hook = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 55 }));
        await waitFor(() => expect(hook.result.current.loaded).toBe(true));
        expect(hook.result.current.lines).toHaveLength(0);
    });
});

describe('follow-up M2: the create syncs while a send is in flight', () => {
    it('lines already sent leave the draft even though the scope flipped from table to order', async () => {
        const drafts = newDrafts();
        const cola: Product = { id: 2, name: 'Cola', price: 30, categoryId: 1, modifierGroups: 0 };
        const holder: { flip: () => void } = { flip: () => undefined };
        let calls = 0;
        const slowApi = {
            addItem: vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    holder.flip();
                    await new Promise((r) => setTimeout(r, 30));
                }
                return { id: 1 };
            }),
            sendToKitchen: vi.fn().mockResolvedValue({}),
            createOrder: vi.fn(),
        } as unknown as DraftApi;
        const hook = renderHook((p: { orderId: number | string }) => useOrderDraft({ drafts, api: slowApi, ownerKey: '1:7', tableId: 3, orderId: p.orderId }), {
            initialProps: { orderId: 'order-1700-abcd1234' as number | string },
        });
        holder.flip = () => act(() => hook.rerender({ orderId: 900 }));
        await waitFor(() => expect(hook.result.current.loaded).toBe(true));
        act(() => hook.result.current.add(pizza));
        act(() => hook.result.current.add(cola));
        // not inside act(): a nested act would defer the scope flip until the send is over
        await hook.result.current.send();
        await waitFor(() => expect(hook.result.current.loaded).toBe(true));
        expect(hook.result.current.lines).toHaveLength(0);
        await waitFor(async () => expect(await drafts.get('1:7', { orderId: 900 })).toBeNull());
    });
});
