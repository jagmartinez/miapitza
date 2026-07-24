import { describe, expect, it, vi } from 'vitest';
import { DeliveryAttemptGate, getDeliveryErrorMessage } from './deliveryAttempt';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

describe('delivery attempt coordination', () => {
    it('executes only one request while a delivery attempt is pending', async () => {
        const gate = new DeliveryAttemptGate();
        const pendingRequest = deferred<void>();
        const request = vi.fn(() => pendingRequest.promise);
        const pendingStates: boolean[] = [];
        const onSuccess = vi.fn();
        const onError = vi.fn();
        const options = {
            request,
            onSuccess,
            onError,
            onPendingChange: (pending: boolean) => pendingStates.push(pending),
            fallbackMessage: 'No se pudo entregar la orden.',
        };

        const firstAttempt = gate.execute(options);
        const duplicateAttempt = await gate.execute(options);

        expect(duplicateAttempt).toBe(false);
        expect(request).toHaveBeenCalledTimes(1);
        expect(gate.isActive()).toBe(true);
        expect(pendingStates).toEqual([true]);

        pendingRequest.resolve();
        await expect(firstAttempt).resolves.toBe(true);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(onError).not.toHaveBeenCalled();
        expect(gate.isActive()).toBe(false);
        expect(pendingStates).toEqual([true, false]);
    });

    it('surfaces a backend 400 message and does not run success state cleanup', async () => {
        const gate = new DeliveryAttemptGate();
        const context = { orderId: 36, tableId: 9, warehouseId: 2 };
        const originalContext = { ...context };
        const onError = vi.fn();
        const onSuccessError = vi.fn();
        const onSuccess = vi.fn(() => {
            context.orderId = 0;
            context.tableId = 0;
            context.warehouseId = 0;
        });

        await gate.execute({
            request: async () => {
                throw {
                    response: {
                        status: 400,
                        data: { message: 'Existencia insuficiente de Miel en BOD Bamboo.' },
                    },
                };
            },
            onSuccess,
            onError,
            onSuccessError,
            onPendingChange: vi.fn(),
            fallbackMessage: 'No se pudo entregar la orden.',
        });

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onSuccessError).not.toHaveBeenCalled();
        expect(context).toEqual(originalContext);
        expect(onError).toHaveBeenCalledWith(
            'Existencia insuficiente de Miel en BOD Bamboo.',
            expect.objectContaining({ response: expect.objectContaining({ status: 400 }) }),
        );
        expect(gate.isActive()).toBe(false);
    });

    it('distinguishes an applied delivery from a failed post-success refresh', async () => {
        const gate = new DeliveryAttemptGate();
        const onError = vi.fn();
        const onSuccessError = vi.fn();
        const pendingStates: boolean[] = [];

        await gate.execute({
            request: async () => ({ status: 200 }),
            onSuccess: async () => {
                throw new Error('order list refresh failed');
            },
            onError,
            onSuccessError,
            onPendingChange: (pending) => pendingStates.push(pending),
            fallbackMessage: 'No se pudo entregar la orden.',
        });

        expect(onError).not.toHaveBeenCalled();
        expect(onSuccessError).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'order list refresh failed' }),
        );
        expect(pendingStates).toEqual([true, false]);
        expect(gate.isActive()).toBe(false);
    });

    it('falls back safely when the response has no useful backend message', () => {
        expect(getDeliveryErrorMessage(
            { response: { status: 400, data: { message: '   ' } } },
            'No se pudo entregar la orden.',
        )).toBe('No se pudo entregar la orden.');
        expect(getDeliveryErrorMessage(
            new Error('network unavailable'),
            'No se pudo entregar la orden.',
        )).toBe('No se pudo entregar la orden.');
    });
});
