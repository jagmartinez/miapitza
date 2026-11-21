import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountShell } from './AccountShell';
import { appEvents } from '../../core/events';
import type { Services } from '../../core/services';
import type { Session } from '../../core/session';
import { session } from '../../test/helpers';

const other: Session = { ...session, token: 'tok-2', user: { ...session.user, id: 99, name: 'Otro' } };

function build() {
    const accountApi = {
        login: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined),
        changePassword: vi.fn().mockResolvedValue(undefined),
    };
    return { services: { accountApi } as unknown as Services, accountApi };
}

let setOuter: (s: Session | null) => void = () => {};

function Harness({ initial, services }: { initial: Session | null; services: Services }) {
    const [s, setS] = useState<Session | null>(initial);
    setOuter = setS;
    return (
        <AccountShell session={s} services={services} onSession={setS} onSessionEnd={() => setS(null)}>
            {() => <input aria-label="borrador" />}
        </AccountShell>
    );
}
const setSession = (s: Session | null) => act(() => setOuter(s));

describe('AccountShell', () => {
    it('mustChangePassword session shows blocking change screen', () => {
        const { services } = build();
        render(<Harness initial={{ ...session, mustChangePassword: true }} services={services} />);
        expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument();
    });

    it('passwordExpired also blocks', () => {
        const { services } = build();
        render(<Harness initial={{ ...session, passwordExpired: true }} services={services} />);
        expect(screen.getByLabelText('Nueva contraseña')).toBeInTheDocument();
    });

    it('403 PASSWORD_CHANGE_REQUIRED event opens the blocking screen', async () => {
        const { services } = build();
        render(<Harness initial={session} services={services} />);
        expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
        act(() => appEvents.emit('password-change-required'));
        expect(await screen.findByLabelText('Nueva contraseña')).toBeInTheDocument();
    });

    it('change success clears session and shows notice', async () => {
        const { services, accountApi } = build();
        render(<Harness initial={{ ...session, mustChangePassword: true }} services={services} />);
        fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'old' } });
        fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'newpassword1' } });
        fireEvent.change(screen.getByLabelText('Repite la nueva contraseña'), { target: { value: 'newpassword1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
        expect(await screen.findByText('Contraseña cambiada. Inicia sesión de nuevo.')).toBeInTheDocument();
        expect(accountApi.changePassword).toHaveBeenCalledWith('old', 'newpassword1');
        expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    });

    it('session expiry shows login over the kept tree with the expiry notice', async () => {
        const { services } = build();
        render(<Harness initial={session} services={services} />);
        act(() => appEvents.emit('session-expired'));
        await setSession(null);
        expect(await screen.findByText('Tu sesión expiró. Vuelve a iniciar sesión.')).toBeInTheDocument();
        expect(screen.getByLabelText('borrador', { selector: 'input' })).toBeInTheDocument();
    });

    it('same user re-login keeps the mounted screen and the draft', async () => {
        const { services } = build();
        render(<Harness initial={session} services={services} />);
        const input = screen.getByLabelText('borrador') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'mi borrador' } });
        act(() => appEvents.emit('session-expired'));
        await setSession(null);
        await screen.findByRole('button', { name: 'Entrar' });
        await setSession({ ...session, token: 'tok-new' });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Entrar' })).toBeNull());
        const after = screen.getByLabelText('borrador') as HTMLInputElement;
        expect(after).toBe(input);
        expect(after.value).toBe('mi borrador');
    });

    it('different user wipes the tree', async () => {
        const { services } = build();
        render(<Harness initial={session} services={services} />);
        const input = screen.getByLabelText('borrador') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'mi borrador' } });
        await setSession(null);
        await setSession(other);
        const after = screen.getByLabelText('borrador') as HTMLInputElement;
        expect(after).not.toBe(input);
        expect(after.value).toBe('');
    });

    it('explicit logout wipes the tree', async () => {
        const { services, accountApi } = build();
        render(<Harness initial={{ ...session, mustChangePassword: true }} services={services} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
        await screen.findByRole('button', { name: 'Entrar' });
        expect(accountApi.logout).toHaveBeenCalled();
        expect(screen.queryByLabelText('borrador')).toBeNull();
    });
});
