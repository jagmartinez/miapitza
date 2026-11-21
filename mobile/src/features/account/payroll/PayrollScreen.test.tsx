import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { AccountNavProvider, useAccountNav } from '../AccountNav';
import { HrError } from '../hrApi';
import { ToastProvider } from '../../../ui/Toast';
import { markReceiptsSeen, seenReceipts } from '../useAccountSummary';
import type { HrApi } from '../hrApi';

const sharePdf = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../print/printOut', () => ({ printOut: { sharePdf } }));
import { PayrollScreen } from './PayrollScreen';

const receipt = (id: number, over = {}) => ({
    id, runId: 1, userId: 7, runKind: 'REGULAR', runCode: `R${id}`, periodLabel: `Quincena ${id}`, payDate: '2026-11-15', currency: 'NIO',
    grossIncome: '12000', totalDeductions: '1500', netPay: '10500', status: 'PUBLISHED', ...over,
});
const detail = (id: number) => ({
    ...receipt(id),
    components: [
        { id: 1, name: 'Salario base', type: 'INCOME', amount: '12000' },
        { id: 2, name: 'INSS laboral', type: 'DEDUCTION', amount: '1500' },
    ],
    trace: [{ id: 1, event: 'CALC', occurredAt: 'x', reason: 'secreto-interno' }],
});

function Open({ refId }: { refId: number }) {
    const { navigate } = useAccountNav();
    useEffect(() => navigate('payroll', { refId }), [navigate, refId]);
    return null;
}

function mount(hr: Record<string, unknown>, refId?: number) {
    return render(
        <ToastProvider>
            <AccountNavProvider>
                {refId !== undefined && <Open refId={refId} />}
                <PayrollScreen hr={hr as unknown as HrApi} userId={7} />
            </AccountNavProvider>
        </ToastProvider>,
    );
}

describe('PayrollScreen', () => {
    beforeEach(() => {
        localStorage.clear();
        sharePdf.mockClear();
    });

    it('receipts show Nuevo until opened', async () => {
        markReceiptsSeen(7, [1]);
        const hr = { myReceipts: vi.fn(async () => [receipt(2), receipt(1)]), myReceipt: vi.fn(async (id: number) => detail(id)) };
        mount(hr);
        expect(await screen.findByText('Quincena 2')).toBeInTheDocument();
        expect(screen.getAllByText('Nuevo')).toHaveLength(1);
        fireEvent.click(screen.getByText('Quincena 2'));
        expect(await screen.findByText('Salario base')).toBeInTheDocument();
        expect(screen.queryByText('secreto-interno')).toBeNull();
        expect(seenReceipts(7)?.has(2)).toBe(true);
        fireEvent.click(screen.getByLabelText('Volver'));
        expect(await screen.findByText('Quincena 2')).toBeInTheDocument();
        expect(screen.queryByText('Nuevo')).toBeNull();
    });

    it('download shares PDF blob', async () => {
        const blob = new Blob(['%PDF']);
        const hr = { myReceipts: vi.fn(async () => [receipt(5)]), myReceipt: vi.fn(async () => detail(5)), receiptPdf: vi.fn(async () => blob) };
        mount(hr);
        fireEvent.click(await screen.findByText('Quincena 5'));
        fireEvent.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
        await waitFor(() => expect(sharePdf).toHaveBeenCalledTimes(1));
        expect(hr.receiptPdf).toHaveBeenCalledWith(5);
        expect(sharePdf).toHaveBeenCalledWith(blob, 'recibo-Quincena 5.pdf');
    });

    it('a failed download shows the server message and shares nothing', async () => {
        const hr = { myReceipts: vi.fn(async () => [receipt(5)]), myReceipt: vi.fn(async () => detail(5)), receiptPdf: vi.fn().mockRejectedValue(new HrError('Recibo no disponible', { isAmbiguous: false })) };
        mount(hr);
        fireEvent.click(await screen.findByText('Quincena 5'));
        fireEvent.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
        expect(await screen.findByText('Recibo no disponible')).toBeInTheDocument();
        expect(sharePdf).not.toHaveBeenCalled();
    });

    it('opening one receipt with an uninitialised seen set does not mark the others Nuevo', async () => {
        const hr = { myReceipts: vi.fn(async () => [receipt(2), receipt(1)]), myReceipt: vi.fn(async (id: number) => detail(id)) };
        mount(hr);
        fireEvent.click(await screen.findByText('Quincena 2'));
        await screen.findByText('Salario base');
        fireEvent.click(screen.getByLabelText('Volver'));
        await screen.findByText('Quincena 1');
        expect(screen.queryByText('Nuevo')).toBeNull();
        expect(seenReceipts(7)?.has(1)).toBe(true);
    });

    it('opens the receipt named by refId directly', async () => {
        markReceiptsSeen(7, [1]);
        const hr = { myReceipts: vi.fn(async () => [receipt(2), receipt(1)]), myReceipt: vi.fn(async (id: number) => detail(id)) };
        mount(hr, 2);
        expect(await screen.findByText('Salario base')).toBeInTheDocument();
        expect(hr.myReceipt).toHaveBeenCalledWith(2);
        expect(seenReceipts(7)?.has(2)).toBe(true);
    });

    it('shows an empty message', async () => {
        mount({ myReceipts: vi.fn(async () => []) });
        expect(await screen.findByText('Aún no tienes recibos publicados')).toBeInTheDocument();
    });
});
