import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PaymentDone, type DoneData } from './PaymentDone';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const DONE: DoneData = { tableLabel: 'Mesa 2', invoiceNumber: 'F-100', invoiceError: null, methods: 'Efectivo', change: 0 };
const PDF = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

function setup(over: { load?: () => Promise<Blob>; data?: Partial<DoneData>; withInvoice?: boolean } = {}) {
    const load = vi.fn(over.load ?? (async () => PDF));
    const printer = { sharePdf: vi.fn().mockResolvedValue(undefined) };
    render(<PaymentDone data={{ ...DONE, ...over.data }} onFinish={vi.fn()} invoice={over.withInvoice === false ? undefined : { load, fileName: 'factura-F-100.pdf' }} printer={printer} />);
    return { load, printer };
}

describe('PaymentDone invoice PDF', () => {
    it('PaymentDone shows Imprimir and Enviar and shares the invoice PDF', async () => {
        const { load, printer } = setup();
        const print = screen.getByRole('button', { name: 'Imprimir' });
        const send = screen.getByRole('button', { name: 'Enviar' });
        // a double tap shares once, and the other action waits too
        fireEvent.click(print);
        fireEvent.click(print);
        expect(print).toBeDisabled();
        expect(send).toBeDisabled();
        await waitFor(() => expect(printer.sharePdf).toHaveBeenCalledTimes(1));
        expect(load).toHaveBeenCalledTimes(1);
        expect(printer.sharePdf).toHaveBeenCalledWith(PDF, 'factura-F-100.pdf');
        await waitFor(() => expect(send).toBeEnabled());
        fireEvent.click(send);
        await waitFor(() => expect(printer.sharePdf).toHaveBeenCalledTimes(2));
    });

    it('pdf download failure shows a retry message', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(PDF);
        const { printer } = setup({ load });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('No se pudo descargar la factura');
        expect(printer.sharePdf).not.toHaveBeenCalled();
        // the buttons are usable again, and "Reintentar" repeats the same action
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
        await waitFor(() => expect(printer.sharePdf).toHaveBeenCalledTimes(1));
        expect(load).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a failure of the share sheet itself is reported too', async () => {
        const printer = { sharePdf: vi.fn().mockRejectedValue(new Error('sin app')) };
        render(<PaymentDone data={DONE} onFinish={vi.fn()} invoice={{ load: async () => PDF, fileName: 'f.pdf' }} printer={printer} />);
        fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo compartir la factura');
    });

    it('has no Imprimir / Enviar without the permission, the invoice or when the fiscal invoice failed', () => {
        setup({ withInvoice: false });
        expect(screen.queryByRole('button', { name: /Imprimir|Enviar/ })).toBeNull();
        cleanup();
        setup({ data: { invoiceError: 'DGI fuera de línea', invoiceNumber: null } });
        expect(screen.queryByRole('button', { name: /Imprimir|Enviar/ })).toBeNull();
    });

    it('is disabled while offline', () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        setup();
        expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled();
        expect(screen.getByText('Requiere conexión')).toBeInTheDocument();
    });
});
