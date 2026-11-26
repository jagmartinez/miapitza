import { useRef, useState } from 'react';
import { getApiErrorMessage } from '@web/utils/apiError';
import { isAmbiguousMutationFailure } from '@web/utils/idempotency';
import { useOnline } from '../../../data/useOnline';
import { printOut, type PrintOut } from '../../print/printOut';
import { money } from '../order/orderModel';

export interface DoneData {
    tableLabel: string;
    invoiceNumber: string | null;
    /** Server text when the payment is committed but the fiscal invoice must be retried. */
    invoiceError: string | null;
    methods: string;
    change: number;
}

/** How to get the fiscal invoice PDF of this payment (present only for a user who may view invoices). */
export interface InvoiceSource {
    load: () => Promise<Blob>;
    fileName: string;
}

type Share = 'print' | 'send';

export function PaymentDone({ data, onFinish, onSurvey, invoice, printer = printOut }: { data: DoneData; onFinish: () => void; /** Hands the tablet to the customer for the locked survey. */ onSurvey?: () => void; invoice?: InvoiceSource; printer?: Pick<PrintOut, 'sharePdf'> }) {
    const online = useOnline();
    const [busy, setBusy] = useState<Share | null>(null);
    const [failure, setFailure] = useState<{ text: string; retry: Share | null } | null>(null);
    const busyRef = useRef(false);
    const canShare = !!invoice && !!data.invoiceNumber && !data.invoiceError;

    /** One action at a time: a double tap shares once. Download and share failures are told apart so the cashier knows what to retry. */
    const share = async (kind: Share) => {
        if (!invoice || busyRef.current) return;
        busyRef.current = true;
        setBusy(kind);
        setFailure(null);
        let blob: Blob;
        try {
            blob = await invoice.load();
        } catch (cause) {
            // Network / timeout / 5xx: try again. A definitive answer (403, 404...) says why in Spanish and offers nothing to retry.
            const again = isAmbiguousMutationFailure(cause);
            setFailure({ text: again ? 'No se pudo descargar la factura. Revisa la conexión e inténtalo de nuevo.' : `No se pudo descargar la factura. ${getApiErrorMessage(cause)}`, retry: again ? kind : null });
            busyRef.current = false;
            setBusy(null);
            return;
        }
        try {
            await printer.sharePdf(blob, invoice.fileName);
        } catch {
            setFailure({ text: 'No se pudo compartir la factura. Inténtalo de nuevo.', retry: kind });
        } finally {
            busyRef.current = false;
            setBusy(null);
        }
    };

    return (
        <main className="pay-done" data-testid="payment-done" aria-label="Cobro confirmado">
            <div className="pay-done-check" aria-hidden="true">
                ✓
            </div>
            <h1>{`${data.tableLabel} cobrada`}</h1>
            {data.invoiceError ? (
                <p className="pay-done-notice" role="status">
                    {`Pago confirmado, pero la factura fiscal debe reintentarse: ${data.invoiceError}`}
                </p>
            ) : data.invoiceNumber ? (
                <p className="muted">{`Factura ${data.invoiceNumber}`}</p>
            ) : null}
            {data.methods && <p className="muted">{data.methods}</p>}
            {data.change > 0 && (
                <div className="pay-done-change">
                    <span className="muted">Cambio a entregar</span>
                    <strong>{money(data.change)}</strong>
                </div>
            )}
            {canShare && (
                <div className="pay-done-share">
                    <button type="button" className="btn" disabled={busy !== null || !online} onClick={() => void share('print')}>
                        Imprimir
                    </button>
                    <button type="button" className="btn" disabled={busy !== null || !online} onClick={() => void share('send')}>
                        Enviar
                    </button>
                    {!online && <span className="muted">Requiere conexión</span>}
                </div>
            )}
            {failure && (
                <p className="error" role="alert">
                    {failure.text}{' '}
                    {failure.retry && (
                        <button type="button" className="btn" disabled={busy !== null || !online} onClick={() => void share(failure.retry!)}>
                            Reintentar
                        </button>
                    )}
                </p>
            )}
            {onSurvey && (
                <button type="button" className="btn pay-survey" onClick={onSurvey}>
                    Pedir opinión
                </button>
            )}
            <button type="button" className="btn btn-primary pay-charge" onClick={onFinish}>
                Liberar mesa y volver
            </button>
        </main>
    );
}
