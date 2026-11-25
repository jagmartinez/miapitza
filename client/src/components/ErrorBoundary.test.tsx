// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
    throw new Error('boom');
}

describe('ErrorBoundary', () => {
    it('muestra una alerta con acción de recarga cuando un hijo falla', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<ErrorBoundary><Boom /></ErrorBoundary>);
        expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal');
        expect(screen.getByRole('button', { name: /Recargar página/ })).toBeInTheDocument();
    });

    it('renderiza a los hijos cuando no hay error', () => {
        render(<ErrorBoundary><p>todo bien</p></ErrorBoundary>);
        expect(screen.getByText('todo bien')).toBeInTheDocument();
    });
});
