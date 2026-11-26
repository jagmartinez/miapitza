import { act, fireEvent, render, screen } from '@testing-library/react';
import { useKioskExit } from './useKioskExit';

const exitKiosk = vi.hoisted(() => vi.fn());
vi.mock('../../core/kiosk', () => ({ exitKiosk }));

function Title() {
    const { handlers, sheet } = useKioskExit();
    return (
        <>
            <h1 {...handlers}>Cocina</h1>
            {sheet}
        </>
    );
}

const hold = (ms = 5_000) => {
    fireEvent.pointerDown(screen.getByText('Cocina'));
    act(() => { vi.advanceTimersByTime(ms); });
};

describe('useKioskExit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        exitKiosk.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('long-press 5 s opens an in-app confirm sheet, never window.confirm', () => {
        const confirm = vi.spyOn(window, 'confirm');
        render(<Title />);
        hold(4_999);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByRole('dialog')).toHaveTextContent('¿Salir del modo kiosco?');
        expect(confirm).not.toHaveBeenCalled();
        expect(exitKiosk).not.toHaveBeenCalled();
    });

    it('Salir exits the kiosk', () => {
        render(<Title />);
        hold();
        fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
        expect(exitKiosk).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Cancelar keeps the kiosk', () => {
        render(<Title />);
        hold();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(exitKiosk).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('the sheet auto-closes after 10 s without exiting', () => {
        render(<Title />);
        hold();
        act(() => { vi.advanceTimersByTime(9_999); });
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(exitKiosk).not.toHaveBeenCalled();
    });

    it('releasing early cancels the press', () => {
        render(<Title />);
        const title = screen.getByText('Cocina');
        fireEvent.pointerDown(title);
        act(() => { vi.advanceTimersByTime(3_000); });
        fireEvent.pointerUp(title);
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('leaving the element or unmounting cancels the press', () => {
        const { unmount } = render(<Title />);
        const title = screen.getByText('Cocina');
        fireEvent.pointerDown(title);
        fireEvent.pointerLeave(title);
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.pointerDown(title);
        unmount();
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(exitKiosk).not.toHaveBeenCalled();
    });
});
