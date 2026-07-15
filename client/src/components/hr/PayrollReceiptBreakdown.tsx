import { Download, FileText } from 'lucide-react';
import { formatHrMoney } from '../../utils/hrFormat';
import Button from '../Button';
import type { HrPayrollReceiptDetail } from '../../types/hr-payroll';
import PayrollStatusPill from './PayrollStatusPill';

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

  return (
    <div className="hr-receipt-detail">
      <header>
        <div>
          <FileText size={24} aria-hidden="true" />
          <div>
            <strong>{receipt.runCode}</strong>
            <span>
              {receipt.periodLabel} · pago {receipt.payDate}
            </span>
          </div>
        </div>
        <div>
          <PayrollStatusPill status={receipt.status} />
          <Button
            size="sm"
            variant="secondary"
            onClick={onDownload}
            disabled={!online || downloading}
          >
            <Download size={15} /> {downloading ? 'Preparando…' : 'PDF'}
          </Button>
        </div>
      </header>
      <dl className="hr-receipt-totals">
        <div>
          <dt>Ingresos brutos</dt>
          <dd>
            {formatHrMoney(receipt.currency, receipt.grossIncome)}
          </dd>
        </div>
        <div>
          <dt>Deducciones</dt>
          <dd>
            {formatHrMoney(receipt.currency, receipt.totalDeductions)}
          </dd>
        </div>
        <div className="net">
          <dt>Neto pagado</dt>
          <dd>
            {formatHrMoney(receipt.currency, receipt.netPay)}
          </dd>
        </div>
      </dl>
      <div className="hr-receipt-columns">
        <section>
          <h3>Ingresos</h3>
          {incomes.length === 0 ? (
            <p>Sin componentes.</p>
          ) : (
            <dl>
              {incomes.map((component) => (
                <div key={component.id}>
                  <dt>
                    {component.name}
                    <small>
                      {component.code} · {component.source}
                    </small>
                  </dt>
                  <dd>
                    {formatHrMoney(receipt.currency, component.amount)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section>
          <h3>Deducciones</h3>
          {deductions.length === 0 ? (
            <p>Sin componentes.</p>
          ) : (
            <dl>
              {deductions.map((component) => (
                <div key={component.id}>
                  <dt>
                    {component.name}
                    <small>
                      {component.code} · {component.source}
                    </small>
                  </dt>
                  <dd>
                    {formatHrMoney(receipt.currency, component.amount)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
      <section className="hr-receipt-trace">
        <h3>Trazabilidad</h3>
        {receipt.trace.map((entry) => (
          <div key={entry.id}>
            <strong>{entry.event}</strong>
            <span>
              {new Intl.DateTimeFormat('es-NI', { dateStyle: 'short', timeStyle: 'short' }).format(
                new Date(entry.occurredAt)
              )}
            </span>
            <small>
              {entry.actor?.name ?? 'Sistema'}
              {entry.reason ? ` · ${entry.reason}` : ''}
            </small>
          </div>
        ))}
      </section>
    </div>
  );
}
