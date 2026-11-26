import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CashError } from '../../data/cashTypes';
import { CashHome } from './CashHome';
import { OpenShiftScreen } from './OpenShiftScreen';
import { BLIND, cashSession, makeCash, SHIFT } from './testkit';

afterEach(cleanup);

const noop = () => undefined;
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pickRegister = async (name: RegExp) => fireEvent.click(await screen.findByRole('button', { name }));

function renderOpen(over: Parameters<typeof makeCash>[0] = {}, extra: { openShift?: ReturnType<typeof vi.fn>; onOpened?: () => void } = {}) {
    const api = makeCash(over);
    const openShift = extra.openShift ?? vi.fn().mockResolvedValue(SHIFT);
    const onOpened = extra.onOpened ?? vi.fn();
    render(<OpenShiftScreen api={api} openShift={openShift as never} onOpened={onOpened} onBack={noop} />);
    return { api, openShift, onOpened };
}

describe('OpenShiftScreen', () => {
    it('occupied register shows who has it and cannot be chosen', async () => {
        renderOpen();
        const busy = await screen.findByRole('button', { name: /Caja 2/ });
        expect(busy).toBeDisabled();
        expect(busy).toHaveTextContent('Luis Gomez');
        expect(screen.getByRole('button', { name: /Caja 1/ })).toBeEnabled();
    });

    it('suggested float chip pre-fills the amount', async () => {
        renderOpen();
        await pickRegister(/Caja 1/);
        const chip = await screen.findByRole('button', { name: /Sugerido/ });
        expect(chip).toHaveTextContent('C$ 800');
        fireEvent.click(chip);
        expect(screen.getByRole('button', { name: /Abrir turno con C\$ 800/ })).toBeEnabled();
    });

    it('keypad amount opens with that float and one action id; the double tap sends once', async () => {
        let resolve!: (v: unknown) => void;
        const openShift = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
        const { onOpened } = renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('1');
        click('5');
        click('0');
        const open = screen.getByRole('button', { name: /Abrir turno con C\$ 150/ });
        fireEvent.click(open);
        fireEvent.click(open);
        expect(openShift).toHaveBeenCalledTimes(1);
        expect(openShift).toHaveBeenCalledWith({ cashRegisterId: 1, startAmount: 150 }, { actionId: expect.any(String) });
        resolve(SHIFT);
        await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    });

    it('a failed open reuses the action id on Reintentar', async () => {
        const openShift = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(SHIFT);
        renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(openShift).toHaveBeenCalledTimes(2));
        expect(openShift.mock.calls[1][1]).toEqual(openShift.mock.calls[0][1]);
    });

    it('a new submit after changing the amount gets a new action id', async () => {
        const openShift = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(SHIFT);
        renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        await screen.findByRole('button', { name: 'Reintentar' });
        click('0');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 50/ }));
        await waitFor(() => expect(openShift).toHaveBeenCalledTimes(2));
        expect(openShift.mock.calls[1][1]).not.toEqual(openShift.mock.calls[0][1]);
    });

    it('Contar billetes sums the NIO denominations into the float', async () => {
        renderOpen();
        await pickRegister(/Caja 1/);
        click('Contar billetes');
        fireEvent.click(screen.getByRole('button', { name: 'Billete C$ 500' }));
        click('2');
        fireEvent.click(screen.getByRole('button', { name: 'Billete C$ 100' }));
        click('3');
        fireEvent.click(screen.getByRole('button', { name: /Usar C\$/ }));
        expect(screen.getByRole('button', { name: /Abrir turno con C\$ 1,?300/ })).toBeEnabled();
    });

    it('occupied conflict from the server names the occupant', async () => {
        const openShift = vi.fn().mockRejectedValue(new CashError('CASH_REGISTER_OCCUPIED', 'Caja ocupada', { occupiedBy: { id: 9, name: 'Luis Gomez' } }));
        renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Luis Gomez');
    });

    it('after OCCUPIED the register is deselected, marked taken and cannot be chosen again', async () => {
        const openShift = vi.fn().mockRejectedValue(new CashError('CASH_REGISTER_OCCUPIED', 'Caja ocupada', { occupiedBy: { id: 9, name: 'Luis Gomez' } }));
        renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        await screen.findByRole('alert');
        const one = screen.getByRole('button', { name: /Caja 1/ });
        expect(one).toBeDisabled();
        expect(one).toHaveTextContent('Luis Gomez');
        expect(screen.getByRole('button', { name: /^Abrir turno/ })).toBeDisabled();
    });

    it('Back is disabled while the open is pending', async () => {
        const openShift = vi.fn().mockImplementation(() => new Promise(() => undefined));
        renderOpen({}, { openShift });
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        expect(screen.getByRole('button', { name: 'Volver' })).toBeDisabled();
    });

    it('offline shows Requiere conexión and does not send', async () => {
        const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const { openShift } = renderOpen();
        await pickRegister(/Caja 1/);
        click('5');
        expect(screen.getByText('Requiere conexión')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ })).toBeDisabled();
        expect(openShift).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('CashHome', () => {
    it('open success lands on the active shift', async () => {
        const api = makeCash();
        api.openShift.mockImplementation(async () => {
            api.activeStatus.mockResolvedValue({ hasActiveShift: true, shift: SHIFT, requiresClose: false, message: null });
            api.summary.mockResolvedValue(BLIND);
            return SHIFT;
        });
        render(<CashHome session={cashSession()} api={api} onBack={noop} onCount={noop} />);
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        expect(await screen.findByRole('button', { name: 'Cerrar turno' })).toBeInTheDocument();
    });

    it('ALREADY_OPEN refreshes the status and lands on the active shift', async () => {
        const api = makeCash();
        api.openShift.mockImplementation(async () => {
            api.activeStatus.mockResolvedValue({ hasActiveShift: true, shift: SHIFT, requiresClose: false, message: null });
            throw new CashError('CASH_SHIFT_ALREADY_OPEN', 'Ya tienes un turno abierto');
        });
        render(<CashHome session={cashSession()} api={api} onBack={noop} onCount={noop} />);
        await pickRegister(/Caja 1/);
        click('5');
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        expect(await screen.findByRole('button', { name: 'Cerrar turno' })).toBeInTheDocument();
    });

    it('a user switch resets the screen so the sheet and input of A are gone for B', async () => {
        const api = makeCash();
        api.activeStatus.mockResolvedValue({ hasActiveShift: true, shift: SHIFT, requiresClose: false, message: null });
        api.summary.mockResolvedValue(BLIND);
        const a = cashSession();
        const b = { ...a, user: { ...a.user, id: 6, name: 'Beto Cajero' } };
        const view = render(<CashHome session={a} api={api} onBack={noop} onCount={noop} />);
        await screen.findByText('Efectivo en caja');
        click('Salida');
        click('7');
        expect(screen.getByRole('dialog')).toHaveTextContent('C$ 7');
        view.rerender(<CashHome session={b} api={api} onBack={noop} onCount={noop} />);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});
