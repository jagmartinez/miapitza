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
        expect(await screen.findByText('Aún no cumples la antigüedad mínima de 6 meses')).toBeTruthy();
        expect(screen.queryByLabelText('Monto')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
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
