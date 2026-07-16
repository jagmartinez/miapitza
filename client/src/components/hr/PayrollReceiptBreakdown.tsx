import { CalendarDays, Download, FileText, UserRound } from 'lucide-react';
import { formatHrMoney } from '../../utils/hrFormat';
import Button from '../Button';
import type { HrPayrollComponent, HrPayrollReceiptDetail } from '../../types/hr-payroll';
import PayrollStatusPill from './PayrollStatusPill';

const SOURCE_LABELS: Record<string, string> = {
  RULE: 'Salario y reglas de pago',
  ATTENDANCE: 'Asistencia',
  OVERTIME: 'Horas extra',
  LEAVE: 'Permisos y vacaciones',
  MANUAL: 'Ajuste autorizado',
  LOAN: 'Préstamo',
};

function formatDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(date);
}

function componentTotal(items: HrPayrollComponent[]) {
  let total = 0;
  for (const item of items) total += Number(item.amount);
  return total;
}

function ReceiptLines({ title, empty, items, currency }: { title: string; empty: string; items: HrPayrollComponent[]; currency: string }) {
  return <section>
    <header><h3>{title}</h3><strong>{formatHrMoney(currency, componentTotal(items))}</strong></header>
    {items.length === 0 ? <p>{empty}</p> : <dl>{items.map((component) => <div key={component.id}>
      <dt>{component.name}<small>{SOURCE_LABELS[component.source] ?? component.source}</small></dt>
      <dd>{formatHrMoney(currency, component.amount)}</dd>
    </div>)}</dl>}
  </section>;
}

export default function PayrollReceiptBreakdown({
  receipt,
  online,
  downloading,
  onDownload,
}: {
  receipt: HrPayrollReceiptDetail;
  online: boolean;
  downloading: boolean;
  onDownload: () => void;
}) {
  const incomes = receipt.components.filter((component) => component.type === 'INCOME');
  const deductions = receipt.components.filter((component) => component.type === 'DEDUCTION');
  const employeeName = receipt.legalName || receipt.user?.name || receipt.user?.username || `Empleado #${receipt.userId}`;

  return (
    <article className="hr-receipt-detail" aria-labelledby="receipt-employee-name">
      <header className="hr-receipt-header">
        <div className="hr-receipt-employee">
          <span className="hr-receipt-avatar" aria-hidden="true"><UserRound size={22} /></span>
          <div>
            <span className="hr-receipt-kicker">Colilla de pago</span>
            <h2 id="receipt-employee-name">{employeeName}</h2>
            <span>{receipt.employeeCode ? `Código ${receipt.employeeCode}` : 'Expediente laboral'} · {receipt.runKind === 'AGUINALDO' ? 'Aguinaldo' : 'Nómina ordinaria'}</span>
          </div>
        </div>
        <div className="hr-receipt-header-actions">
          <PayrollStatusPill status={receipt.status} />
          <Button onClick={onDownload} disabled={!online || downloading}>
            <Download size={16} /> {downloading ? 'Preparando PDF…' : 'Descargar PDF'}
          </Button>
        </div>
      </header>

      <div className="hr-receipt-period">
        <span><FileText size={17} /> <strong>{receipt.runCode}</strong></span>
        <span><CalendarDays size={17} /> Periodo: <strong>{receipt.periodLabel}</strong></span>
        <span>Fecha de pago: <strong>{formatDate(receipt.payDate)}</strong></span>
      </div>

      <dl className="hr-receipt-totals" aria-label="Resumen de la colilla">
        <div><dt>Total de ingresos</dt><dd>{formatHrMoney(receipt.currency, receipt.grossIncome)}</dd></div>
        <div><dt>Total de deducciones</dt><dd>{formatHrMoney(receipt.currency, receipt.totalDeductions)}</dd></div>
        <div className="net"><dt>Neto pagado</dt><dd>{formatHrMoney(receipt.currency, receipt.netPay)}</dd></div>
      </dl>

      <div className="hr-receipt-columns">
        <ReceiptLines title="Ingresos" empty="No hay ingresos en esta colilla." items={incomes} currency={receipt.currency} />
        <ReceiptLines title="Deducciones" empty="No hay deducciones en esta colilla." items={deductions} currency={receipt.currency} />
      </div>

      <details className="hr-receipt-trace">
        <summary>Información técnica de publicación</summary>
        <p>Este historial sirve para soporte o auditoría; no cambia los importes de la colilla.</p>
        <div className="hr-receipt-trace-list">{receipt.trace.map((entry) => (
          <div key={entry.id}>
            <strong>{entry.event}</strong>
            <span>{new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.occurredAt))}</span>
            <small>{entry.actor?.name ?? 'Sistema'}{entry.reason ? ` · ${entry.reason}` : ''}</small>
          </div>
        ))}</div>
      </details>
    </article>
  );
}
