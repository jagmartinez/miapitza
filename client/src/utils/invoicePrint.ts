import { escapeHtml } from './escapeHtml';

export interface PrintableInvoiceSnapshot {
    orderId: number;
    customerName?: string;
    customerRuc?: string;
    customerTaxIdType?: string;
    customerFiscalAddress?: string;
    customerEmail?: string;
    customerPhone?: string;
    items: Array<{
        orderItemId?: number;
        name: string;
        quantity: number;
        price: number;
        subtotal: number;
    }>;
    grossSubtotal: number;
    discount: number;
    subtotal: number;
    tax: number;
    tipAmount: number;
    tipRatePercent: number;
    total: number;
    branchName: string;
    branchAddress?: string;
    branchPhone?: string;
    companyName: string;
    companyRuc?: string;
    date: string;
    invoiceNumber: string;
    taxRatePercent: number;
    currencySymbol: string;
}

function money(value: number): string {
    return Number(value).toFixed(2);
}

function assertPrintableSnapshot(value: unknown): asserts value is PrintableInvoiceSnapshot {
    const snapshot = value as Partial<PrintableInvoiceSnapshot> | null;
    const amountFields = snapshot
        ? [
            snapshot.grossSubtotal,
            snapshot.discount,
            snapshot.subtotal,
            snapshot.tax,
            snapshot.tipAmount,
            snapshot.tipRatePercent,
            snapshot.total,
            snapshot.taxRatePercent,
        ]
        : [];
    const hasInvalidItem = !snapshot?.items?.every((item) =>
        Boolean(item)
        && typeof item.name === 'string'
        && Boolean(item.name.trim())
        && Number.isFinite(item.quantity)
        && item.quantity > 0
        && Number.isFinite(item.price)
        && item.price >= 0
        && Number.isFinite(item.subtotal)
        && item.subtotal >= 0
    );
    if (
        !snapshot
        || !Number.isInteger(snapshot.orderId)
        || Number(snapshot.orderId) <= 0
        || typeof snapshot.invoiceNumber !== 'string'
        || !snapshot.invoiceNumber.trim()
        || typeof snapshot.companyName !== 'string'
        || !snapshot.companyName.trim()
        || typeof snapshot.branchName !== 'string'
        || !snapshot.branchName.trim()
        || typeof snapshot.currencySymbol !== 'string'
        || !Array.isArray(snapshot.items)
        || snapshot.items.length === 0
        || hasInvalidItem
        || amountFields.some((amount) => !Number.isFinite(amount))
        || Number(snapshot.grossSubtotal) < 0
        || Number(snapshot.discount) < 0
        || Number(snapshot.subtotal) < 0
        || Number(snapshot.tax) < 0
        || Number(snapshot.tipAmount) < 0
        || Number(snapshot.total) < 0
        || Number.isNaN(new Date(String(snapshot.date)).getTime())
    ) {
        throw new Error('La respuesta fiscal emitida no contiene un documento imprimible íntegro.');
    }
}

/**
 * Renders only the immutable snapshot returned by fiscal issuance. It never
 * reads the mutable order/table state to reconstruct an already-issued invoice.
 */
export function renderInvoiceHtml(value: unknown): string {
    assertPrintableSnapshot(value);
    const invoice = value;
    const e = escapeHtml;
    const issuedAt = new Date(invoice.date).toLocaleString('es-NI');

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Factura ${e(invoice.invoiceNumber)}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px; color: #111827; }
        header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 16px; }
        h1, h2, p { margin: 0; }
        h1 { font-size: 24px; }
        h2 { font-size: 18px; text-align: right; }
        .muted { color: #4b5563; margin-top: 4px; }
        .customer { margin: 18px 0; padding: 14px; border: 1px solid #d1d5db; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 18px; }
        th, td { padding: 10px 8px; border-bottom: 1px solid #d1d5db; text-align: left; }
        th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
        .totals { width: min(360px, 100%); margin: 20px 0 0 auto; }
        .totals div { display: flex; justify-content: space-between; padding: 5px 0; }
        .total { margin-top: 6px; padding-top: 10px !important; border-top: 2px solid #111827; font-size: 20px; font-weight: 800; }
        footer { margin-top: 28px; text-align: center; color: #4b5563; }
        @media print { body { padding: 0; } }
    </style>
</head>
<body>
    <header>
        <div>
            <h1>${e(invoice.companyName)}</h1>
            <p class="muted">RUC: ${e(invoice.companyRuc || 'N/A')}</p>
            <p class="muted">${e(invoice.branchName)}</p>
            ${invoice.branchAddress ? `<p class="muted">${e(invoice.branchAddress)}</p>` : ''}
            ${invoice.branchPhone ? `<p class="muted">Tel: ${e(invoice.branchPhone)}</p>` : ''}
        </div>
        <div>
            <h2>FACTURA ${e(invoice.invoiceNumber)}</h2>
            <p class="muted">Orden #${e(invoice.orderId)}</p>
            <p class="muted">${e(issuedAt)}</p>
        </div>
    </header>
    <section class="customer">
        <strong>Cliente: ${e(invoice.customerName || 'Cliente general')}</strong>
        <p class="muted">${e(invoice.customerTaxIdType || 'Identificación')}: ${e(invoice.customerRuc || 'N/A')}</p>
        ${invoice.customerFiscalAddress ? `<p class="muted">Dirección fiscal: ${e(invoice.customerFiscalAddress)}</p>` : ''}
        ${invoice.customerEmail ? `<p class="muted">Correo: ${e(invoice.customerEmail)}</p>` : ''}
        ${invoice.customerPhone ? `<p class="muted">Tel: ${e(invoice.customerPhone)}</p>` : ''}
    </section>
    <table>
        <thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>
            ${invoice.items.map((item) => `<tr>
                <td>${e(item.name)}</td>
                <td>${e(item.quantity)}</td>
                <td>${e(invoice.currencySymbol)} ${e(money(item.price))}</td>
                <td>${e(invoice.currencySymbol)} ${e(money(item.subtotal))}</td>
            </tr>`).join('')}
        </tbody>
    </table>
    <section class="totals">
        <div><span>Subtotal bruto</span><span>${e(invoice.currencySymbol)} ${e(money(invoice.grossSubtotal))}</span></div>
        ${invoice.discount > 0 ? `<div><span>Descuento</span><span>-${e(invoice.currencySymbol)} ${e(money(invoice.discount))}</span></div>` : ''}
        <div><span>Subtotal neto</span><span>${e(invoice.currencySymbol)} ${e(money(invoice.subtotal))}</span></div>
        <div><span>IVA (${e(invoice.taxRatePercent)}%)</span><span>${e(invoice.currencySymbol)} ${e(money(invoice.tax))}</span></div>
        ${invoice.tipAmount > 0 ? `<div><span>Propina (${e(invoice.tipRatePercent)}%)</span><span>${e(invoice.currencySymbol)} ${e(money(invoice.tipAmount))}</span></div>` : ''}
        <div class="total"><span>TOTAL</span><span>${e(invoice.currencySymbol)} ${e(money(invoice.total))}</span></div>
    </section>
    <footer>¡Gracias por su compra!</footer>
</body>
</html>`;
}

export function renderInvoiceLoadingHtml(orderId: number): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Emitiendo factura</title></head><body style="font-family:Arial,sans-serif;padding:24px"><p>Emitiendo factura fiscal de la orden #${escapeHtml(orderId)}…</p></body></html>`;
}
