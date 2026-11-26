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

function setup(api = makeApi(), drafts = createDrafts(new MobileDB(`draft-final-${++n}-${Date.now()}`))) {
    const hook = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 55 }));
    return { api, drafts, ...hook };
}

describe('final review: lock fences the send (I2, ruling f)', () => {
    it('every call carries the owner the send started under', async () => {
        const { result, api } = setup();
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => void (await result.current.send()));
        expect(api.addItem).toHaveBeenCalledWith(55, expect.any(Object), expect.objectContaining({ owner: '1:7' }));
        expect(api.sendToKitchen).toHaveBeenCalledWith(55, expect.objectContaining({ owner: '1:7' }));
    });

    it('when the session changes mid-send the remaining lines and the kitchen batch are never sent', async () => {
        const changed = Object.assign(new Error('x'), { name: 'SessionChangedError' });
        const api = makeApi({ addItem: vi.fn().mockResolvedValueOnce({ id: 1 }).mockRejectedValue(changed) as never });
        const { result } = setup(api);
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        act(() => result.current.add(cola));
        act(() => result.current.add(cola, { notes: 'sin hielo' }));
        let outcome = '';
        await act(async () => void (outcome = await result.current.send()));
        expect(outcome).toBe('failed');
        expect(api.addItem).toHaveBeenCalledTimes(2); // stopped at the refusal
        expect(api.sendToKitchen).not.toHaveBeenCalled();
        expect(result.current.error).toBeNull(); // nobody is looking at this screen any more
    });
});

describe('final review: a retry key belongs to one draft line (Fable I1)', () => {
    it('a line keeps its action id for the retry and across a reload; a line added again later has a new one', async () => {
        const api = makeApi({ addItem: vi.fn().mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })).mockResolvedValue({ id: 1 }) as never });
        const { result, drafts } = setup(api);
        await waitFor(() => expect(result.current.loaded).toBe(true));
        act(() => result.current.add(pizza));
        await act(async () => void (await result.current.send())); // fails: the line stays
        const firstId = api.addItem.mock.calls[0][2].actionId as string;
        expect(firstId).toBeTruthy();
        // reopened screen: same draft, same action id
        const again = renderHook(() => useOrderDraft({ drafts, api, ownerKey: '1:7', tableId: 3, orderId: 55 }));
        await waitFor(() => expect(again.result.current.loaded).toBe(true));
        await act(async () => void (await again.result.current.send()));
        expect(api.addItem.mock.calls[1][2].actionId).toBe(firstId);
        // sent: gone. The same product ordered again is a new action.
        act(() => again.result.current.add(pizza));
        await act(async () => void (await again.result.current.send()));
        expect(api.addItem.mock.calls[2][2].actionId).not.toBe(firstId);
    });
});
