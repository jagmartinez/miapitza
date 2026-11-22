import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../ui/Toast';
import { AccountNavProvider, useAccountNav } from '../AccountNav';
import type { HrApi, HrLoanPolicy } from '../hrApi';
import { LoanDetail } from './LoanDetail';
import { LoanRequestForm } from './LoanRequestForm';
import { LoansScreen } from './LoansScreen';

function Where() {
    return <span data-testid="where">{useAccountNav().section}</span>;
}
function mount(ui: React.ReactNode) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                {ui}
                <Where />
            </AccountNavProvider>
        </ToastProvider>,
    );
}
const api = (o: Record<string, unknown>) => o as unknown as HrApi;
const policy: HrLoanPolicy = { currency: 'NIO', maxAmount: '5000', maxInstallments: 12, maxPaymentPercent: '30', minTenureMonths: 6, eligible: true, ineligibleReason: null, tenureMonths: 10 };

function fill(amount: string, n: string, purpose = 'Reparación') {
    fireEvent.change(screen.getByLabelText('Monto'), { target: { value: amount } });
    fireEvent.change(screen.getByLabelText('Cuotas'), { target: { value: n } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: purpose } });
}

describe('LoanRequestForm', () => {
    it('form blocks amount above max and installments above max', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue(policy), requestLoan: vi.fn() })} />);
        await screen.findByLabelText('Monto');
        const send = screen.getByRole('button', { name: 'Enviar' });
        fill('5,000.01', '6');
        expect(send).toBeDisabled();
        fill('5000', '13');
        expect(send).toBeDisabled();
        fill('5000', '12');
        expect(send).toBeEnabled();
        expect(screen.getByText(/12 cuotas de .*416\.66.* \(última .*416\.74.*\)/)).toBeTruthy();
        expect(screen.getByText('Máximo 30% de tu salario por cuota')).toBeTruthy();
    });

    it('ineligible shows reason and no form', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, eligible: false, tenureMonths: 2, ineligibleReason: 'x' }), requestLoan: vi.fn() })} />);
        expect(await screen.findByText('Aún no cumples la antigüedad mínima de 6 meses.')).toBeTruthy();
        expect(screen.queryByLabelText('Monto')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    });

    it('maps the disabled-policy code to Spanish and never prints raw codes', async () => {
        const { unmount } = mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, maxAmount: null, maxInstallments: null, minTenureMonths: null, eligible: false, ineligibleReason: 'HR_LOAN_POLICY_DISABLED' }), requestLoan: vi.fn() })} />);
        expect(await screen.findByText('Los préstamos no están habilitados en este momento.')).toBeTruthy();
        expect(screen.queryByText(/HR_LOAN/)).toBeNull();
        unmount();
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, eligible: false, tenureMonths: 6, ineligibleReason: 'HR_LOAN_TENURE_POLICY' }), requestLoan: vi.fn() })} />);
        expect(await screen.findByText('Aún no cumples la antigüedad mínima de 6 meses.')).toBeTruthy();
    });

    it('unknown reason codes fall back to generic Spanish', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, eligible: false, ineligibleReason: 'SOMETHING_NEW' }), requestLoan: vi.fn() })} />);
        expect(await screen.findByText('Por ahora no puedes solicitar un préstamo.')).toBeTruthy();
        expect(screen.queryByText(/SOMETHING_NEW/)).toBeNull();
    });

    it('shows inline messages for amount 0 and installments above max, and singular cuota', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue(policy), requestLoan: vi.fn() })} />);
        await screen.findByLabelText('Monto');
        fill('0', '13');
        expect(screen.getByText('Ingresa un monto mayor que 0.')).toBeTruthy();
        expect(screen.getByText('Máximo 12 cuotas.')).toBeTruthy();
        fill('100', '1');
        expect(screen.getByText(/1 cuota de .*100\.00.* \(última/)).toBeTruthy();
    });

    it('decimal installments get an integer message, not "al menos 1"', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue(policy), requestLoan: vi.fn() })} />);
        await screen.findByLabelText('Monto');
        fill('100', '2.5');
        expect(screen.getByText('Ingresa un número entero de cuotas.')).toBeTruthy();
        expect(screen.queryByText('Ingresa al menos 1 cuota.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    });

    it('presets above the allowed maximum are hidden; pressing one fills the field and submits it', async () => {
        const requestLoan = vi.fn().mockResolvedValue({});
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, maxInstallments: 5 }), requestLoan })} />);
        await screen.findByLabelText('Monto');
        const group = screen.getByRole('group', { name: 'Cuotas frecuentes' });
        expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['2', '4']);
        fireEvent.change(screen.getByLabelText('Monto'), { target: { value: '100' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Reparación' } });
        fireEvent.click(screen.getByRole('button', { name: '4' }));
        expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
        expect((screen.getByLabelText('Cuotas') as HTMLInputElement).value).toBe('4');
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(requestLoan).toHaveBeenCalled());
        expect(requestLoan.mock.calls[0][0]).toMatchObject({ preferredInstallments: 4 });
    });

    it('renders no preset group when fewer than 2 installments are allowed', async () => {
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue({ ...policy, maxInstallments: 1 }), requestLoan: vi.fn() })} />);
        await screen.findByLabelText('Monto');
        expect(screen.queryByRole('group', { name: 'Cuotas frecuentes' })).toBeNull();
    });

    it('double submit sends once with same key', async () => {
        let resolve!: (v: unknown) => void;
        const requestLoan = vi.fn().mockImplementation(() => new Promise((r) => (resolve = r)));
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue(policy), requestLoan })} />);
        await screen.findByLabelText('Monto');
        fill('1000', '3');
        const send = screen.getByRole('button', { name: 'Enviar' });
        fireEvent.click(send);
        fireEvent.click(send);
        fireEvent.submit(send.closest('form')!);
        expect(requestLoan).toHaveBeenCalledTimes(1);
        const [body, opts] = requestLoan.mock.calls[0];
        expect(body).toEqual({ purpose: 'Reparación', currency: 'NIO', requestedAmount: '1000.00', preferredInstallments: 3, payrollDeductionRequested: true });
        expect(opts.actionId).toBeTruthy();
        resolve({ id: 1 });
        await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('home'));
    });

    it('keeps the same actionId on retry after failure', async () => {
        const requestLoan = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ id: 1 });
        mount(<LoanRequestForm hr={api({ loanPolicy: vi.fn().mockResolvedValue(policy), requestLoan })} />);
        await screen.findByLabelText('Monto');
        fill('1000', '3');
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        await waitFor(() => expect(requestLoan).toHaveBeenCalledTimes(2));
        expect(requestLoan.mock.calls[0][1].actionId).toBe(requestLoan.mock.calls[1][1].actionId);
    });
});

const loan = (o: Record<string, unknown>) => ({ id: 1, code: 'P-1', currency: 'NIO', requestedAmount: '1000.00', approvedAmount: null, outstandingBalance: '0.00', installmentCount: 3, status: 'REQUESTED', ...o });

describe('LoansScreen', () => {
    it('cancel only for REQUESTED', async () => {
        const cancelLoanRequest = vi.fn().mockResolvedValue({});
        const hr = api({
            myLoans: vi.fn().mockResolvedValue([loan({ id: 1, status: 'REQUESTED' }), loan({ id: 2, code: 'P-2', status: 'ACTIVE' })]),
            myLoan: vi.fn().mockImplementation(async (id: number) => loan({ id, status: 'ACTIVE', outstandingBalance: '400.00' })),
            cancelLoanRequest,
        });
        mount(<LoansScreen hr={hr} />);
        await screen.findByText(/P-1/);
        expect(screen.getAllByRole('button', { name: 'Cancelar solicitud' })).toHaveLength(1);
        expect(await screen.findByText(/Saldo/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmar cancelación' }));
        await waitFor(() => expect(cancelLoanRequest).toHaveBeenCalledWith(1, undefined, { actionId: 'cancel-loan-1' }));
    });
});

describe('LoansScreen balances', () => {
    it('shows an inline error with retry when a balance fails', async () => {
        const myLoan = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(loan({ status: 'ACTIVE', outstandingBalance: '400.00' }));
        mount(<LoansScreen hr={api({ myLoans: vi.fn().mockResolvedValue([loan({ id: 2, status: 'ACTIVE', installmentCount: 1 })]), myLoan })} />);
        expect(await screen.findByText(/No se pudo cargar el saldo/)).toBeTruthy();
        expect(screen.getByText(/1 cuota ·|1 cuota$/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        expect(await screen.findByText(/Saldo/)).toBeTruthy();
        expect(screen.queryByText(/No se pudo cargar el saldo/)).toBeNull();
    });
});

describe('LoanDetail', () => {
    it('detail shows overdue in soft red', async () => {
        const schedule = [
            { id: 1, number: 1, dueDate: '2026-10-01', scheduledTotal: '333.33', paidAmount: '333.33', outstandingAmount: '0.00', status: 'PAID' },
            { id: 2, number: 2, dueDate: '2026-11-01', scheduledTotal: '333.33', paidAmount: '0.00', outstandingAmount: '333.33', status: 'OVERDUE' },
        ];
        mount(<LoanDetail hr={api({ myLoan: vi.fn().mockResolvedValue(loan({ status: 'ACTIVE', schedule })) })} id={1} />);
        const chip = await screen.findByText('Vencida');
        expect(chip.className).toContain('ui-badge-rejected');
        expect(screen.getByText('Pagada').className).not.toContain('ui-badge-rejected');
    });
});
