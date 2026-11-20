import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { PinScreen } from './PinScreen';
import type { PinApi } from './pinApi';
import { session } from '../../test/helpers';

const roster = [
    { id: 1, name: 'Ana Perez', initials: 'AP', color: '#d4a84b' },
    { id: 2, name: 'Luis Gomez', initials: 'LG', color: null },
];

function status(code: number) {
    return new AxiosError('x', String(code), undefined, null, { status: code, data: {}, statusText: '', headers: {}, config: {} as never });
}

function makeApi(over: Partial<PinApi> = {}): PinApi {
    return {
        roster: vi.fn().mockResolvedValue(roster),
        login: vi.fn().mockResolvedValue(session),
        logout: vi.fn().mockResolvedValue(undefined),
        ...over,
    };
}

const press = (...digits: string[]) => digits.forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

async function ready(api: PinApi) {
    const onRevoked = vi.fn();
    const onLoggedIn = vi.fn();
    render(<PinScreen api={api} onLoggedIn={onLoggedIn} onRevoked={onRevoked} />);
    await screen.findByText('AP');
    return { onRevoked, onLoggedIn };
}

describe('PinScreen', () => {
    it('lists roster users as initials avatars', async () => {
        await ready(makeApi());
        expect(screen.getByRole('button', { name: /Ana Perez/ })).toHaveTextContent('AP');
        expect(screen.getByText('LG')).toBeInTheDocument();
    });

    it('submits on Entrar with at least 4 digits; Entrar is disabled below 4 and never auto-submits', async () => {
        const api = makeApi();
        const { onLoggedIn } = await ready(api);
        fireEvent.click(screen.getByRole('button', { name: /Ana Perez/ }));
        const enter = screen.getByRole('button', { name: 'Entrar' });
        press('1', '2', '3');
        expect(enter).toBeDisabled();
        press('4');
        expect(api.login).not.toHaveBeenCalled(); // no auto-submit at the 4th digit
        expect(enter).toBeEnabled();
        fireEvent.click(enter);
        await waitFor(() => expect(api.login).toHaveBeenCalledWith(1, '1234'));
        await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith(session));
        expect(screen.getByTestId('pin-dots').getAttribute('data-filled')).toBe('0');
    });

    it('accepts up to 6 digits and ignores the 7th', async () => {
        const api = makeApi();
        await ready(api);
        fireEvent.click(screen.getByRole('button', { name: /Ana Perez/ }));
        press('1', '2', '3', '4', '5', '6', '7');
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        await waitFor(() => expect(api.login).toHaveBeenCalledWith(1, '123456'));
    });

    it('shows one generic error on failure and clears the digits', async () => {
        const api = makeApi({ login: vi.fn().mockRejectedValue(status(401)) });
        const { onLoggedIn, onRevoked } = await ready(api);
        fireEvent.click(screen.getByRole('button', { name: /Ana Perez/ }));
        press('9', '9', '9', '9');
        fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo iniciar sesión');
        expect(screen.getByRole('button', { name: 'Entrar' })).toBeDisabled();
        expect(screen.getByTestId('pin-dots').getAttribute('data-filled')).toBe('0');
        expect(onLoggedIn).not.toHaveBeenCalled();
        expect(onRevoked).not.toHaveBeenCalled();
    });

    it('goes back to setup when the roster rejects the device token', async () => {
        const onRevoked = vi.fn();
        render(<PinScreen api={makeApi({ roster: vi.fn().mockRejectedValue(status(401)) })} onLoggedIn={vi.fn()} onRevoked={onRevoked} />);
        await waitFor(() => expect(onRevoked).toHaveBeenCalled());
    });

    it('offers a retry when the roster cannot be loaded for another reason', async () => {
        const rosterFn = vi.fn().mockRejectedValueOnce(status(500)).mockResolvedValueOnce(roster);
        const onRevoked = vi.fn();
        render(<PinScreen api={makeApi({ roster: rosterFn })} onLoggedIn={vi.fn()} onRevoked={onRevoked} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
        await screen.findByText('AP');
        expect(onRevoked).not.toHaveBeenCalled();
    });
});
