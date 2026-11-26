import { formatHrMoney } from '../../utils/hrDisplay';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Gift, RefreshCw } from 'lucide-react';
import { AppSelect, Button, DataTable, EmptyState, Field, Input, LoadErrorState, PageHeader, type Column } from '@/ui';
import HrLoading from '../../components/hr/HrLoading';
import MyHrNav from '../../components/hr/MyHrNav';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollReceiptBreakdown from '../../components/hr/PayrollReceiptBreakdown';
import PayrollStatusPill from '../../components/hr/PayrollStatusPill';
import usePayrollOnline from '../../components/hr/usePayrollOnline';
import { getPayrollErrorMessage, payrollClient } from '../../components/hr/payrollClient';
import { useAppToast } from '../../context/ToastContext';
import type {
  HrPayrollReceiptDetail,
  HrPayrollReceiptSummary,
  HrPayrollRunKind,
} from '../../types/hr-payroll';
import './payroll.css';
import styles from './MyPayroll.module.css';
import './self-service.css';

const currentYear = new Date().getFullYear();

function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium' }).format(parsed);
}

export default function MyPayroll() {
  const online = usePayrollOnline();
  const { error: showError } = useAppToast();
  const [kind, setKind] = useState<'' | HrPayrollRunKind>('');
  const [year, setYear] = useState(String(currentYear));
  const [receipts, setReceipts] = useState<HrPayrollReceiptSummary[]>([]);
  const [selected, setSelected] = useState<HrPayrollReceiptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      kind: kind || undefined,
      year: year ? Number(year) : undefined,
      limit: 100,
    }),
    [kind, year]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await payrollClient.getMyReceipts(filters);
      setReceipts(result.items);
      setSelected((current) =>
        current && result.items.some((receipt) => receipt.id === current.id) ? current : null
      );
    } catch (loadError) {
      setReceipts([]);
      setSelected(null);
      setError(getPayrollErrorMessage(loadError, 'No fue posible cargar tus recibos publicados.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const openReceipt = async (receipt: HrPayrollReceiptSummary) => {
    setDetailLoading(true);
    try {
      setSelected(await payrollClient.getMyReceipt(receipt.id));
    } catch (detailError) {
      showError(
        getPayrollErrorMessage(detailError, 'No fue posible abrir el desglose del recibo.')
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const downloadReceipt = async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      await payrollClient.downloadMyReceipt(selected.id);
    } catch (downloadError) {
      showError(getPayrollErrorMessage(downloadError, 'No fue posible descargar el recibo.'));
    } finally {
      setDownloading(false);
    }
  };

  const columns: Column<HrPayrollReceiptSummary>[] = [
    {
      key: 'runCode',
      header: 'Recibo',
      width: '1.2fr',
      render: (receipt) => (
        <span className={styles.kind}>
          {receipt.runKind === 'AGUINALDO' ? <Gift size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
          <strong>{receipt.runCode}</strong>
        </span>
      ),
    },
    { key: 'periodLabel', header: 'Periodo', width: '1.4fr' },
    { key: 'payDate', header: 'Pago', width: '1fr', render: (receipt) => formatDate(receipt.payDate) },
    {
      key: 'netPay',
      header: 'Neto',
      width: '1fr',
      type: 'number',
      render: (receipt) => formatHrMoney(receipt.currency, receipt.netPay),
    },
    { key: 'status', header: 'Estado', width: '0.9fr', render: (receipt) => <PayrollStatusPill status={receipt.status} /> },
  ];

  return (
    <div className={`page-wrapper hr-payroll-page hr-my-payroll-page my-hr-page ${styles.page}`}>
      <PageHeader
        title="Mis recibos"
        description="Consulta y descarga el desglose exacto publicado por nómina"
        actions={<MyHrNav />}
      />

      {!online && <PayrollOnlineNotice online={false} />}

      <div className={styles.filters} role="group" aria-label="Filtros de recibos">
        <Field label="Tipo" htmlFor="my-payroll-kind">
          <AppSelect<string>
            inputId="my-payroll-kind"
            options={[
              { value: '', label: 'Todos' },
              { value: 'REGULAR', label: 'Nómina ordinaria' },
              { value: 'AGUINALDO', label: 'Aguinaldo' },
            ]}
            value={kind}
            onChange={(next) => setKind((next ?? '') as '' | HrPayrollRunKind)}
            isClearable={false}
          />
        </Field>
        <Field label="Año" htmlFor="my-payroll-year">
          <Input
            id="my-payroll-year"
            type="number"
            min="2000"
            max="2200"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </Field>
        <Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading}>
          Actualizar
        </Button>
      </div>

      {!loading && error ? (
        <LoadErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className={selected || detailLoading ? styles.layout : undefined}>
          <DataTable<HrPayrollReceiptSummary>
            stackOnMobile
            ariaLabel="Recibos publicados"
            columns={columns}
            rows={receipts}
            rowKey={(receipt) => receipt.id}
            loading={loading}
            defaultPageSize={25}
            onRowClick={(receipt) => {
              if (!detailLoading) void openReceipt(receipt);
            }}
            rowTone={(receipt) => (selected?.id === receipt.id ? 'primary' : undefined)}
            empty={
              <EmptyState
                icon={FileText}
                title="No hay recibos publicados para los filtros seleccionados."
                action={
                  kind || year !== String(currentYear) ? (
                    <Button size="sm" variant="ghost" onClick={() => { setKind(''); setYear(String(currentYear)); }}>
                      Ver recibos del año actual
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {detailLoading || selected ? (
            <section className={styles.workspace} aria-live="polite" aria-label="Desglose del recibo">
              {detailLoading || !selected ? (
                <HrLoading text="Abriendo desglose…" />
              ) : (
                <PayrollReceiptBreakdown
                  receipt={selected}
                  online={online}
                  downloading={downloading}
                  onDownload={() => void downloadReceipt()}
                />
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
