import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MobileDB } from '../../../data/cache';
import { createPaymentPlans } from '../../../data/paymentPlans';
import { ownerKeyOf } from '../../../data/types';
import { userSession } from '../order/testkit';
import { makeServer } from './payment.fake';
import PaymentScreen from './PaymentScreen';

const session = userSession(['orders.view', 'payments.process', 'invoices.issue', 'bills.split']);
const OWNER = ownerKeyOf(session)!;
let n = 0;

function world(opts: Parameters<typeof makeServer>[0] = {}) {
    const server = makeServer(opts);
    const plans = createPaymentPlans(new MobileDB(`recovery-${++n}-${Date.now()}`));
    const onFinished = vi.fn();
    const mount = (mode: 'single' | 'split' = 'single') =>
        render(<PaymentScreen api={server.api} user={session.user} orderId={102} ownerKey={OWNER} plans={plans} initialMode={mode} onClose={vi.fn()} onFinished={onFinished} />);
    return { ...server, plans, mount, onFinished };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const ready = () => screen.findByText('Cobrar · Mesa 2');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('lost response on a leg (I1)', () => {
    it('single: the retry replays the same key and shows the invoice, never "total cambió"', async () => {
        const w = world();
        w.mount();
        await ready();
        click('Tarjeta');
        w.state.loseNext = 1;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 230' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('no se duplicará al reintentar');
        expect(w.remainingCents()).toBe(0); // the server did apply it
        fireEvent.click(await screen.findByRole('button', { name: 'Cobrar C$ 230' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(screen.getByText('Factura F-1')).toBeInTheDocument();
        expect(screen.queryByText(/El total cambió/)).toBeNull();
        expect(w.api.payLeg).toHaveBeenCalledTimes(2);
        expect(w.api.payLeg.mock.calls[1][1]).toBe(w.api.payLeg.mock.calls[0][1]);
        expect(w.state.payments).toHaveLength(1); // charged once
    });

    it('mixed: first leg applied and answer lost; the retry replays it, then charges the second leg', async () => {
        const w = world();
        w.mount();
        await ready();
        click('Varios métodos');
        await screen.findByRole('region', { name: 'Tramos' });
        w.state.loseNext = 1;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 230' }));
        await screen.findByRole('alert');
        fireEvent.click(await screen.findByRole('button', { name: 'Cobrar C$ 230' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(screen.queryByText(/El total cambió/)).toBeNull();
        expect(w.state.payments.map((p) => p.amount)).toEqual(['115.00', '115.00']);
    });
});

describe('resuming a plan (I2)', () => {
    it('iguales: leaving after a lost response and coming back never charges the same person twice', async () => {
        const w = world();
        const first = w.mount('split');
        await ready();
        click('Iguales');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        w.state.loseNext = 1;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await screen.findByRole('alert');
        first.unmount(); // leaves; the keys only survive in the store

        w.mount();
        expect(await screen.findByText(/Cobro en curso retomado/)).toBeInTheDocument();
        const p1 = await screen.findByRole('article', { name: 'Persona 1' });
        // Not guessed from payer + amount: the leg stays pending and replays with its own key (the server returns the stored receipt).
        expect(within(p1).queryByText('Pagado')).toBeNull();
        const firstKey = w.api.payLeg.mock.calls[0][1];
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await within(p1).findByText('Pagado');
        expect(w.api.payLeg.mock.calls[1][1]).toBe(firstKey);
        expect(w.state.payments).toHaveLength(1); // charged once
        const calls = w.api.payLeg.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 2' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(w.api.payLeg).toHaveBeenCalledTimes(calls + 1);
        expect(w.state.payments.map((p) => [p.payerName, p.amount])).toEqual([['Persona 1', '115.00'], ['Persona 2', '115.00']]);
        expect(await w.plans.load(OWNER, 102)).toBeNull(); // fully paid: the plan is gone
    });

    it('por productos: resumes with the paid person marked Pagado and the assignments kept', async () => {
        const w = world();
        const first = w.mount('split');
        await ready();
        await screen.findByRole('region', { name: 'Dividir cuenta' });
        click('Pizza Margarita');
        click('Asignar a Persona 1');
        click('Cola');
        click('Asignar a Persona 2');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await screen.findByText('Pagado');
        first.unmount();

        w.mount();
        const p1 = await screen.findByRole('article', { name: 'Persona 1' });
        expect(within(p1).getByText('Pagado')).toBeInTheDocument();
        expect(within(p1).getByText('Pizza Margarita')).toBeInTheDocument();
        const p2 = screen.getByRole('article', { name: 'Persona 2' });
        expect(within(p2).getByText('Cola')).toBeInTheDocument();
        expect(within(p2).getByText('C$ 115')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 2' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(w.state.payments).toHaveLength(2);
    });

    it('single: everything applied but the answer lost, then re-entry goes straight to the receipt', async () => {
        const w = world();
        const first = w.mount();
        await ready();
        click('Tarjeta');
        w.state.loseNext = 1;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 230' }));
        await screen.findByRole('alert');
        first.unmount();
        w.mount();
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(screen.getByText('Factura F-1')).toBeInTheDocument();
        expect(w.state.payments).toHaveLength(1);
        expect(await w.plans.load(OWNER, 102)).toBeNull();
    });

    it('the cashier can discard a plan in progress and start over from what is left', async () => {
        const w = world();
        const first = w.mount('split');
        await ready();
        click('Iguales');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar a Persona 1' }));
        await screen.findByText('Pagado');
        first.unmount();
        w.mount();
        await screen.findByText(/Cobro en curso retomado/);
        click('Descartar plan');
        await waitFor(() => expect(screen.queryByText(/Cobro en curso retomado/)).toBeNull());
        expect(await w.plans.load(OWNER, 102)).toBeNull();
        expect(screen.getByTestId('pay-total')).toHaveTextContent('C$ 115'); // what is left
        expect(screen.getByRole('button', { name: 'Un pago' })).toBeEnabled();
    });

    it('another cashier does not see the plan of the first one', async () => {
        const w = world();
        const first = w.mount();
        await ready();
        click('Tarjeta');
        w.state.loseNext = 1;
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 230' }));
        await screen.findByRole('alert');
        expect(await w.plans.load('1:99', 102)).toBeNull();
        first.unmount();
    });
});

describe('mixed: cash received and rounding', () => {
    it('a cash leg takes received money and reports its change on the receipt', async () => {
        const w = world();
        w.mount();
        await ready();
        click('Varios métodos');
        await screen.findByRole('region', { name: 'Tramos' });
        fireEvent.change(screen.getByLabelText('Recibido del tramo 1'), { target: { value: '200' } });
        expect(screen.getByText('Cambio C$ 85')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Recibido del tramo 1'), { target: { value: '100' } });
        expect(screen.getByRole('button', { name: 'Cobrar C$ 230' })).toBeDisabled(); // less than the leg
        fireEvent.change(screen.getByLabelText('Recibido del tramo 1'), { target: { value: '200' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 230' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(screen.getByText('Cambio a entregar').nextSibling).toHaveTextContent('C$ 85');
        expect(w.state.payments.map((p) => p.amount)).toEqual(['115.00', '115.00']); // the leg is charged, not what was handed over
    });

    it('C$ 100.00 in three legs: the last one takes the remainder and the server gets exactly the total', async () => {
        const w = world({ lines: [{ id: 1, name: 'Pizza Margarita', price: 100 }], taxRate: 0 });
        w.mount();
        await ready();
        click('Varios métodos');
        await screen.findByRole('region', { name: 'Tramos' });
        click('+ Agregar método');
        const type = (leg: number, digits: string) => {
            click(`Monto del tramo ${leg}`);
            for (let i = 0; i < 6; i++) click('Borrar');
            for (const d of digits) click(d);
        };
        type(1, '33.33');
        type(2, '33.33');
        expect(screen.getByRole('button', { name: 'Monto del tramo 3' })).toHaveTextContent('C$ 33.34');
        fireEvent.click(screen.getByRole('button', { name: 'Cobrar C$ 100' }));
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(w.state.payments.map((p) => p.amount)).toEqual(['33.33', '33.33', '33.34']);
        expect(w.remainingCents()).toBe(0);
    });

    it('split in three of C$ 100: parts that do not add up to the total in cents keep Cobrar disabled', async () => {
        const w = world({ lines: [{ id: 1, name: 'Pizza Margarita', price: 100 }], taxRate: 0 });
        w.api.splitEvenly.mockResolvedValue({ splits: [{ amount: 33.33 }, { amount: 33.33 }, { amount: 33.33 }] });
        w.mount('split');
        await ready();
        click('Iguales');
        click('+ Persona');
        await waitFor(() => expect(w.api.splitEvenly).toHaveBeenCalledWith(102, 3));
        await screen.findAllByText('C$ 33.33');
        expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeDisabled();
        w.api.splitEvenly.mockResolvedValue({ splits: [{ amount: 33.34 }, { amount: 33.33 }, { amount: 33.33 }] });
        click('+ Persona');
        click('Quitar a Persona 4');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cobrar a Persona 1' })).toBeEnabled());
    });
});

describe('final review I1: an unrelated payment never marks a leg as paid', () => {
    const lines = [
        { id: 1, name: 'Pizza Margarita', price: 100 },
        { id: 2, name: 'Cola', price: 200 },
    ];
    const seedPending = async (w: ReturnType<typeof world>) =>
        w.plans.save(OWNER, {
            orderId: 102,
            mode: 'single',
            payable: 100,
            plan: { methodId: 1, typed: '', reference: '' },
            allIds: ['single'],
            changeOf: { single: 0 },
            methodOf: { single: 'Efectivo' },
            legs: { single: { key: 'k-single', fingerprint: 'f', spec: { paymentMethodId: 1, amount: 100 } } },
            confirmed: [],
        });

    it('an earlier payment with the same amount and method does not turn the pending leg into "Mesa cobrada"', async () => {
        const w = world({ lines, taxRate: 0 });
        w.state.payments.push({ id: 1, amount: '100.00', status: 'ACTIVE', paymentMethodId: 1, payerName: null }); // e.g. paid on the web earlier
        await seedPending(w);
        w.mount();
        await screen.findByText(/Cobro en curso retomado/);
        expect(screen.queryByText('Mesa 2 cobrada')).toBeNull();
        expect(w.remainingCents()).toBe(20000); // C$ 200 still owed
        expect(w.api.payLeg).not.toHaveBeenCalled();
        expect(await w.plans.load(OWNER, 102)).not.toBeNull(); // the leg keeps its key
    });

    it('when the server really owes nothing, the plan is complete and shows the receipt', async () => {
        const w = world({ lines, taxRate: 0 });
        w.state.payments.push({ id: 1, amount: '300.00', status: 'ACTIVE', paymentMethodId: 1, payerName: null });
        await seedPending(w);
        w.mount();
        expect(await screen.findByText('Mesa 2 cobrada')).toBeInTheDocument();
        expect(await w.plans.load(OWNER, 102)).toBeNull();
    });
});
