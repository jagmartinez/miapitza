import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';
import { ScreenHeader } from './ScreenHeader';

function Trigger() {
    const t = useToast();
    return <button onClick={() => t.show('Listo')}>go</button>;
}

afterEach(() => vi.useRealTimers());

describe('ui kit', () => {
    it('toast shows then disappears', () => {
        vi.useFakeTimers();
        render(<ToastProvider><Trigger /></ToastProvider>);
        fireEvent.click(screen.getByText('go'));
        expect(screen.getByText('Listo')).toBeInTheDocument();
        act(() => void vi.advanceTimersByTime(4100));
        expect(screen.queryByText('Listo')).toBeNull();
    });

    it('useToast outside a provider is a no-op', () => {
        render(<Trigger />);
        fireEvent.click(screen.getByText('go'));
    });

    it('ScreenHeader back button only with onBack', () => {
        const back = vi.fn();
        const { rerender } = render(<ScreenHeader title="Horario" onBack={back} />);
        fireEvent.click(screen.getByLabelText('Volver'));
        expect(back).toHaveBeenCalled();
        rerender(<ScreenHeader title="Horario" />);
        expect(screen.queryByLabelText('Volver')).toBeNull();
    });
});
