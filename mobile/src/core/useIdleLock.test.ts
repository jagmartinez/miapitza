import { renderHook } from '@testing-library/react';
import { useIdleLock } from './useIdleLock';

describe('useIdleLock', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('fires after 120000 ms without input and resets on pointerdown', () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock));
        vi.advanceTimersByTime(119_000);
        document.dispatchEvent(new Event('pointerdown'));
        vi.advanceTimersByTime(119_000);
        expect(onLock).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1_000);
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it('also resets on scroll and touchmove', () => {
        const onLock = vi.fn();
        renderHook(() => useIdleLock(onLock, 1000));
        for (const name of ['scroll', 'touchmove']) {
            vi.advanceTimersByTime(900);
            document.dispatchEvent(new Event(name));
        }
        vi.advanceTimersByTime(900);
        expect(onLock).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(onLock).toHaveBeenCalledTimes(1);
    });

    it('resets on keydown and stops listening after unmount', () => {
        const onLock = vi.fn();
        const { unmount } = renderHook(() => useIdleLock(onLock, 1000));
        vi.advanceTimersByTime(900);
        document.dispatchEvent(new Event('keydown'));
        vi.advanceTimersByTime(900);
        expect(onLock).not.toHaveBeenCalled();
        unmount();
        vi.advanceTimersByTime(5000);
        expect(onLock).not.toHaveBeenCalled();
    });
});
