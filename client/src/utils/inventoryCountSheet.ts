import { formatNumber } from '../ui/format/number';
import type { Product } from '../types';

export type CountSheetProduct = Product & { totalStock?: number };

/** HTML imprimible de la hoja de conteo físico (documento aparte, no es JSX). */
export function buildInventoryCountSheetHtml(
    filteredProducts: CountSheetProduct[],
    categories: { id: number; name: string }[],
    lowStock: { id: number }[],
): string {
        const now = new Date();
        const dateStr = now.toLocaleDateString('es-NI', { year: 'numeric', month: 'long', day: 'numeric' });
        const timeStr = now.toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });

        const lowStockCount = filteredProducts.filter(p => lowStock.some(lp => lp.id === p.id)).length;

        const rowsByCategory = new Map<string, typeof filteredProducts>();
        for (const p of filteredProducts) {
            const cat = categories.find(c => c.id === p.categoryId)?.name || 'Sin categoría';
            if (!rowsByCategory.has(cat)) rowsByCategory.set(cat, []);
            rowsByCategory.get(cat)!.push(p);
        }

        const sortedCategories = [...rowsByCategory.keys()].sort((a, b) => a.localeCompare(b, 'es'));

        const bodyRows = sortedCategories.map(cat => {
            const items = rowsByCategory.get(cat)!;
            const categoryHeader = `<tr class="category-row"><td colspan="8">${cat} (${items.length})</td></tr>`;
            const itemRows = items.map(p => {
                const stock = Number(p.totalStock ?? 0);
                const min = Number(p.minStock ?? 0);
                const isLow = stock <= min;
                const unit = p.baseUnit?.abbreviation || p.unit;
                return `<tr class="${isLow ? 'low-row' : ''}">
                    <td>${p.name}</td>
                    <td>${p.sku || '—'}</td>
                    <td>${unit}</td>
                    <td class="num">${formatNumber(stock)}</td>
                    <td class="num">${formatNumber(min)}</td>
                    <td class="count-col"></td>
                    <td class="obs-col"></td>
                    <td class="status-col">${isLow ? '⚠ Bajo' : 'OK'}</td>
                </tr>`;
            }).join('');
            return categoryHeader + itemRows;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reporte de Inventario Físico</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; margin: 0; color: #1a1a1a; }
  .page { padding: 24px 28px; max-width: 1100px; margin: 0 auto; }
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px; }
  .report-header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .report-header .subtitle { margin: 4px 0 0; color: #64748b; font-size: 12px; }
  .report-meta { text-align: right; font-size: 11px; color: #475569; line-height: 1.6; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; }
  .stat { flex: 1; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; background: #f8fafc; }
  .stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
  .stat-value { font-size: 20px; font-weight: 700; margin-top: 4px; color: #0f172a; }
  .stat.warn .stat-value { color: #b45309; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: middle; }
  th { background: #1e293b; color: #fff; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .category-row td { background: #e2e8f0; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-color: #94a3b8; }
  tr:nth-child(even):not(.category-row) { background: #f8fafc; }
  .low-row { background: #fef3c7 !important; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .count-col { min-width: 80px; }
  .obs-col { min-width: 120px; }
  .status-col { text-align: center; font-size: 10px; font-weight: 600; white-space: nowrap; }
  .signatures { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-block { border-top: 1px solid #334155; padding-top: 8px; text-align: center; color: #64748b; font-size: 10px; }
  .footer-note { margin-top: 24px; font-size: 9px; color: #94a3b8; text-align: center; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 12px 16px; }
    @page { margin: 12mm; }
  }
</style></head><body>
<div class="page">
  <div class="report-header">
    <div>
      <h1>Reporte de Inventario F\u00edsico</h1>
      <p class="subtitle">Conteo y verificaci\u00f3n de existencias</p>
    </div>
    <div class="report-meta">
      <div><strong>Fecha:</strong> ${dateStr}</div>
      <div><strong>Hora:</strong> ${timeStr}</div>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="stat-label">Total productos</div><div class="stat-value">${filteredProducts.length}</div></div>
    <div class="stat"><div class="stat-label">Categor\u00edas</div><div class="stat-value">${sortedCategories.length}</div></div>
    <div class="stat warn"><div class="stat-label">Stock bajo</div><div class="stat-value">${lowStockCount}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Producto</th><th>SKU</th><th>Unidad</th>
      <th>Stock sistema</th><th>Stock m\u00edn.</th>
      <th class="count-col">Conteo f\u00edsico</th><th class="obs-col">Observaciones</th><th>Estado</th>
    </tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="signatures">
    <div class="sig-block">Realizado por</div>
    <div class="sig-block">Supervisado por</div>
  </div>
  <div class="footer-note">Documento generado desde el sistema de gesti\u00f3n — ${dateStr} ${timeStr}</div>
</div>
</body></html>`;

    return html;
}
