import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeCash, SHIFT as OPENED } from '../../cash/testkit';
import { orderOf, serverItem, userSession } from '../order/testkit';
import PaymentScreen, { type PaymentApi } from './PaymentScreen';

const PERMS = ['orders.view', 'payments.process', 'invoices.issue'];
const METHODS = [
    { id: 1, name: 'Efectivo', type: 'CASH', active: true },
    { id: 2, name: 'Tarjeta', type: 'CARD', active: true },
];
const NO_SHIFT = { hasActiveShift: false, requiresClose: false, shift: null };
const MY_SHIFT = { hasActiveShift: true, requiresClose: false, shift: { cashRegister: { branch: { id: 1 } } } };

function makeApi(cashShiftStatus: ReturnType<typeof vi.fn>) {
    return {
        orderDetail: vi.fn().mockResolvedValue(orderOf([serverItem(1, 1, 'Pizza', { price: '100.00', subtotal: '100.00' })], { branchId: 1, tax: '0', total: '100.00', discount: '0.00', tipAmount: '0.00' })),
        paymentMethods: vi.fn().mockResolvedValue(METHODS),
        paymentSummary: vi.fn().mockResolvedValue({ remaining: 100 }),
        cashShiftStatus,
        settings: vi.fn().mockResolvedValue({}),
        pricing: vi.fn().mockResolvedValue({}),
    } as unknown as PaymentApi;
}

function setup(role: 'CAJERO' | 'MESERO', withLoader = true, initial: Record<string, unknown> | 'fail' = NO_SHIFT, onOpenCash?: () => void) {
    const user = userSession(PERMS).user;
    const cash = makeCash();
    const status = initial === 'fail' ? vi.fn().mockRejectedValue(new Error('sin red')) : vi.fn().mockResolvedValue(initial);
    cash.openShift.mockImplementation(async () => {
        status.mockResolvedValue(MY_SHIFT);
        return OPENED;
    });
    const loadCash = vi.fn().mockResolvedValue(cash);
    render(<PaymentScreen api={makeApi(status)} user={{ ...user, role: { id: 2, name: role }, roles: [role] }} orderId={102} onClose={vi.fn()} onFinished={vi.fn()} loadCash={withLoader ? loadCash : undefined} onOpenCash={onOpenCash} />);
    return { cash, status };
}

afterEach(cleanup);

describe('payment without a cash shift', () => {
    it('offers Abrir turno and returns to the payment once it is open', async () => {
        const { cash } = setup('CAJERO');
        await screen.findByText('Cobrar · Mesa 2');
        fireEvent.click(screen.getByRole('button', { name: 'Efectivo' }));
        expect(await screen.findByText('Abre tu turno de caja')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Abrir turno' }));
        fireEvent.click(await screen.findByRole('button', { name: /Caja 1/ }));
        fireEvent.click(screen.getByRole('button', { name: '5' }));
        fireEvent.click(screen.getByRole('button', { name: /Abrir turno con C\$ 5/ }));
        await waitFor(() => expect(cash.openShift).toHaveBeenCalledTimes(1));
        // back on the payment, cash is usable now
        await screen.findByText('Cobrar · Mesa 2');
        await waitFor(() => expect(screen.queryByText('Abre tu turno de caja')).toBeNull());
        // the method picked before opening the shift is still the selected one
        expect(screen.queryByText('Abre tu turno de caja')).toBeNull();
        expect(screen.getByRole('button', { name: 'Efectivo' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('a non-cashier user is not offered Abrir turno', async () => {
        setup('MESERO');
        await screen.findByText('Cobrar · Mesa 2');
        fireEvent.click(screen.getByRole('button', { name: 'Efectivo' }));
        expect(await screen.findByText('Abre tu turno de caja')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir turno' })).toBeNull();
    });
});

describe('payment with a shift that cannot take cash (W5)', () => {
    const pickCash = async () => {
        await screen.findByText('Cobrar · Mesa 2');
        fireEvent.click(screen.getByRole('button', { name: 'Efectivo' }));
    };

    it('a shift from another day shows the real reason and a way to Caja, never Abrir turno', async () => {
        const onOpenCash = vi.fn();
        setup('CAJERO', true, { hasActiveShift: true, requiresClose: true, message: 'Tienes un turno abierto de otro día: ciérralo', shift: { cashRegister: { branch: { id: 1 } } } }, onOpenCash);
        await pickCash();
        expect(await screen.findByText('Tienes un turno abierto de otro día: ciérralo')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir turno' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Ir a Caja' }));
        expect(onOpenCash).toHaveBeenCalledTimes(1);
    });

    it('a shift of another branch says so', async () => {
        setup('CAJERO', true, { hasActiveShift: true, requiresClose: false, shift: { cashRegister: { branch: { id: 9 } } } }, vi.fn());
        await pickCash();
        expect(await screen.findByText(/otra sucursal/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir turno' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Ir a Caja' })).toBeInTheDocument();
    });

    it('an unreadable status offers Reintentar instead of Abrir turno', async () => {
        setup('CAJERO', true, 'fail');
        await pickCash();
        expect(await screen.findByText(/No se pudo verificar tu turno/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abrir turno' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    });
});
