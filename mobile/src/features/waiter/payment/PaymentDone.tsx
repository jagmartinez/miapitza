import { money } from '../order/orderModel';

export interface DoneData {
    tableLabel: string;
    invoiceNumber: string | null;
    /** Server text when the payment is committed but the fiscal invoice must be retried. */
    invoiceError: string | null;
    methods: string;
    change: number;
}

export function PaymentDone({ data, onFinish }: { data: DoneData; onFinish: () => void }) {
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
            <button type="button" className="btn btn-primary pay-charge" onClick={onFinish}>
                Liberar mesa y volver
            </button>
        </main>
    );
}
