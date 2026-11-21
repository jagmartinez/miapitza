import { fireEvent, render, screen } from '@testing-library/react';
import { useKioskExit } from './useKioskExit';

const exitKiosk = vi.hoisted(() => vi.fn());
vi.mock('../../core/kiosk', () => ({ exitKiosk }));

function Title() {
    const handlers = useKioskExit();
    return <h1 {...handlers}>Cocina</h1>;
}

describe('useKioskExit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        exitKiosk.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('long-press 5 s on title asks to exit', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<Title />);
        fireEvent.pointerDown(screen.getByText('Cocina'));
        vi.advanceTimersByTime(4_999);
        expect(confirm).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(confirm).toHaveBeenCalledWith('¿Salir del modo kiosco?');
        expect(exitKiosk).toHaveBeenCalledTimes(1);
    });

    it('declining the confirm keeps the kiosk', () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<Title />);
        fireEvent.pointerDown(screen.getByText('Cocina'));
        vi.advanceTimersByTime(5_000);
        expect(exitKiosk).not.toHaveBeenCalled();
    });

    it('releasing early cancels the press', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<Title />);
        const title = screen.getByText('Cocina');
        fireEvent.pointerDown(title);
        vi.advanceTimersByTime(3_000);
        fireEvent.pointerUp(title);
        vi.advanceTimersByTime(5_000);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('leaving the element or unmounting cancels the press', () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { unmount } = render(<Title />);
        const title = screen.getByText('Cocina');
        fireEvent.pointerDown(title);
        fireEvent.pointerLeave(title);
        vi.advanceTimersByTime(5_000);
        fireEvent.pointerDown(title);
        unmount();
        vi.advanceTimersByTime(5_000);
        expect(confirm).not.toHaveBeenCalled();
    });
});
