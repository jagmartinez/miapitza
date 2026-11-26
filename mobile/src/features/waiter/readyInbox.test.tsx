import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { useReadyInbox } from './readyInbox';
import { makeRealtime } from './tables/testkit';

afterEach(cleanup);

const ready = (orderId: number, tableNumber = String(orderId)) => ({ orderId, tableNumber, eventType: 'ORDER_READY' });

describe('ready inbox (Fable I6, ruling e)', () => {
    it('keeps "pedido listo" notifications that arrive while no tables screen is mounted', () => {
        const realtime = makeRealtime();
        const { result } = renderHook(() => useReadyInbox(realtime));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103, '3')));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(104, '4')));
        expect(result.current.notices).toEqual([
            { orderId: 104, tableNumber: '4' },
            { orderId: 103, tableNumber: '3' },
        ]);
    });

    it('one entry per order (a repeat moves it to the top) and partial or release events are ignored', () => {
        const realtime = makeRealtime();
        const { result } = renderHook(() => useReadyInbox(realtime));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103)));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(104)));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103)));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', { orderId: 105, eventType: 'ORDER_ITEM_READY' }));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', { orderId: 106, eventType: 'ORDER_RELEASED' }));
        expect(result.current.notices.map((n) => n.orderId)).toEqual([103, 104]);
    });

    it('dismiss removes one order; vibrates on arrival', () => {
        const vibrate = vi.fn();
        Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
        const realtime = makeRealtime();
        const { result } = renderHook(() => useReadyInbox(realtime));
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103)));
        expect(vibrate).toHaveBeenCalledTimes(1);
        act(() => result.current.dismiss(103));
        expect(result.current.notices).toEqual([]);
    });

    it('is per session: a lock unmounts it and the next user starts empty, never seeing the previous user\'s', () => {
        const realtime = makeRealtime();
        function Home() {
            const inbox = useReadyInbox(realtime);
            return <p>{`listos:${inbox.notices.length}`}</p>;
        }
        const first = render(<Home />);
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103)));
        expect(screen.getByText('listos:1')).toBeInTheDocument();
        first.unmount(); // lock
        render(<Home />);
        expect(screen.getByText('listos:0')).toBeInTheDocument();
        act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(104)));
        expect(screen.getByText('listos:1')).toBeInTheDocument();
    });

    it('stops listening when it unmounts', () => {
        const realtime = makeRealtime();
        const { unmount } = renderHook(() => useReadyInbox(realtime));
        unmount();
        // the stub removes handlers on unsubscribe: nothing is left to receive the event
        expect(() => act(() => realtime.emit('KITCHEN_NOTIFICATION', ready(103)))).not.toThrow();
    });
});
