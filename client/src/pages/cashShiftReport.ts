import type { CashMovement } from '../types';
import { escapeHtml } from '../utils/escapeHtml';

interface DenomCountRow {
    denomination: number;
    count: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReportData = any;

const formatCurrency = (value: number): string =>
    value.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Documento HTML independiente del reporte de turno (se escribe en una ventana de impresión aparte). */
export function buildCashShiftReportHtml({ shift, amounts, movements, counts, symbol, salesCash }: {
    shift: ReportData;
    amounts: ReportData;
    movements: { in: CashMovement[]; out: CashMovement[] };
    counts: { bills: DenomCountRow[]; coins: DenomCountRow[] };
    symbol: string;
    salesCash: number;
}): string {
    const safeCurrencySymbol = escapeHtml(symbol);
    return `
                    <html>
                        <head>
                            <title>Reporte de Caja - Turno #${shift.id}</title>
                            <style>
                                body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 40px; }
                                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 20px; }
                                .header h1 { margin: 0; font-size: 24px; color: #111; text-transform: uppercase; letter-spacing: 1px; }
                                .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #f8f9fa; padding: 15px; border-radius: 8px; font-size: 14px; }
                                .section-title { font-size: 16px; font-weight: 700; margin: 25px 0 15px 0; padding-bottom: 8px; border-bottom: 1px solid #ddd; text-transform: uppercase; color: #444; }
                                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
                                th { text-align: left; padding: 10px; background: #f1f3f5; border: 1px solid #dee2e6; color: #495057; }
                                td { padding: 8px 10px; border: 1px solid #dee2e6; }
                                .text-right { text-align: right; }
                                .total-row { font-weight: 700; background: #f8f9fa; }
                                .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
                                .amount-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #eee; }
                                .amount-item.grand-total { border-top: 2px solid #111; border-bottom: none; margin-top: 10px; padding-top: 10px; font-size: 16px; font-weight: 800; }
                                .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
                                .badge-in { background: #d4edda; color: #155724; }
                                .badge-out { background: #f8d7da; color: #721c24; }
                                .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #777; }
                                .signature-row { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 80px; }
                                .signature-box { border-top: 1px solid #000; text-align: center; padding-top: 10px; font-size: 13px; }
                                @media print {
                                    body { padding: 0; }
                                    .no-print { display: none; }
                                }
                            </style>
                        </head>
                        <body>
                            <div class="no-print" style="margin-bottom: 20px; text-align: right;">
                                <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">Imprimir</button>
                            </div>

                            <div class="header">
                                <h1>Cierre de Caja</h1>
                                <p style="margin: 5px 0 0 0; color: #666;">Turno #${escapeHtml(shift.id)}</p>
                            </div>

                            <div class="meta">
                                <div>
                                    <strong>Caja:</strong> ${escapeHtml(shift.cashRegister)}<br>
                                    <strong>Cajero:</strong> ${escapeHtml(shift.user)}
                                </div>
                                <div class="text-right">
                                    <strong>Apertura:</strong> ${new Date(shift.startDate).toLocaleString()}<br>
                                    <strong>Cierre:</strong> ${shift.endDate ? new Date(shift.endDate).toLocaleString() : 'Pendiente'}
                                </div>
                            </div>

                            <div class="summary-grid">
                                <div>
                                    <div class="section-title">Resumen de Totales</div>
                                     <div class="amount-item"><span>Monto Inicial:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.startAmount)}</span></div>
                                     <div class="amount-item"><span>Ventas (Efectivo):</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(Number(salesCash || 0))}</span></div>
                                     <div class="amount-item"><span>Otros Ingresos:</span> <span style="color: #28a745;">+ ${safeCurrencySymbol} ${formatCurrency(amounts.totalIn)}</span></div>
                                     <div class="amount-item"><span>Gastos / Retiros:</span> <span style="color: #dc3545;">- ${safeCurrencySymbol} ${formatCurrency(amounts.totalOut)}</span></div>
                                     <div class="amount-item grand-total"><span>Monto Esperado:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.expectedEndAmount)}</span></div>
                                    
                                    <div class="section-title">Resultados del Arqueo</div>
                                     <div class="amount-item"><span>Monto Contado:</span> <span>${safeCurrencySymbol} ${formatCurrency(amounts.actualEndAmount || 0)}</span></div>
                                    <div class="amount-item" style="font-weight: 700; color: ${amounts.difference >= 0 ? '#28a745' : '#dc3545'};">
                                        <span>Diferencia:</span> 
                                         <span>${safeCurrencySymbol} ${formatCurrency(amounts.difference || 0)}</span>
                                    </div>
                                </div>

                                <div>
                                    <div class="section-title">Billetaje (Efectivo)</div>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Denominación</th>
                                                <th class="text-right">Cant.</th>
                                                <th class="text-right">Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${counts.bills.map((b: DenomCountRow) => `
                                                <tr>
                                                     <td>Billete ${safeCurrencySymbol} ${b.denomination}</td>
                                                    <td class="text-right">${b.count}</td>
                                                     <td class="text-right">${safeCurrencySymbol} ${formatCurrency(b.denomination * b.count)}</td>
                                                </tr>
                                            `).join('')}
                                            ${counts.coins.map((c: DenomCountRow) => `
                                                <tr>
                                                     <td>Moneda ${safeCurrencySymbol} ${formatCurrency(c.denomination)}</td>
                                                    <td class="text-right">${c.count}</td>
                                                     <td class="text-right">${safeCurrencySymbol} ${formatCurrency(c.denomination * c.count)}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                        <tfoot>
                                            <tr class="total-row">
                                                <td colspan="2">TOTAL EFECTIVO</td>
                                                 <td class="text-right">${safeCurrencySymbol} ${formatCurrency(amounts.actualEndAmount || 0)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                            <div class="section-title">Detalle de Movimientos (Ingresos y Egresos)</div>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Hora</th>
                                        <th>Tipo</th>
                                        <th>Referencia</th>
                                        <th>Descripción</th>
                                        <th class="text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${[...movements.in, ...movements.out].sort((a: CashMovement, b: CashMovement) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((m: CashMovement) => `
                                        <tr>
                                            <td>${escapeHtml(new Date(m.createdAt).toLocaleTimeString())}</td>
                                            <td><span class="badge ${m.type === 'IN' ? 'badge-in' : 'badge-out'}">${m.type === 'IN' ? 'INGRESO' : 'EGRESO'}</span></td>
                                            <td>${escapeHtml(m.documentNumber || m.reference || '-')}</td>
                                            <td>${escapeHtml(m.description)} ${m.supplier ? `(${escapeHtml(m.supplier.name)})` : ''}</td>
                                            <td class="text-right" style="color: ${m.type === 'IN' ? '#28a745' : '#dc3545'};">
                                                 ${m.type === 'IN' ? '+' : '-'}${safeCurrencySymbol} ${formatCurrency(Number(m.amount))}
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${(movements.in.length === 0 && movements.out.length === 0) ? '<tr><td colspan="5" style="text-align: center;">No se registraron movimientos adicionales</td></tr>' : ''}
                                </tbody>
                            </table>

                            <div class="signature-row">
                                <div class="signature-box">Firma del Cajero</div>
                                <div class="signature-box">Firma del Supervisor</div>
                            </div>

                            <div class="footer">
                                <p>Este documento es un comprobante oficial de arqueo de caja.</p>
                                <p>Generado por Sistema de Restaurante | ${new Date().toLocaleString()}</p>
                            </div>
                        </body>
                    </html>
    `;
}
