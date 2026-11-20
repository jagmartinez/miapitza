import HrReactSelect from '../../components/hr/HrReactSelect';
import { formatHrMoney } from '../../utils/hrFormat';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileText, Gift, RefreshCw, WalletCards } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import MyHrNav from '../../components/hr/MyHrNav';
import PayrollOnlineNotice from '../../components/hr/PayrollOnlineNotice';
import PayrollReceiptBreakdown from '../../components/hr/PayrollReceiptBreakdown';
import PayrollStatusPill from '../../components/hr/PayrollStatusPill';
import usePayrollOnline from '../../components/hr/usePayrollOnline';
import { getPayrollErrorMessage, payrollClient } from '../../components/hr/payrollClient';
import { HrHero, HrPage, HrSection, HrSplit, HrToolbar, type HrFact } from '../../components/hr/layout/HrWorkspace';
import { useAppToast } from '../../context/ToastContext';
import type {
  HrPayrollReceiptDetail,
  HrPayrollReceiptSummary,
  HrPayrollRunKind,
} from '../../types/hr-payroll';
import './payroll.css';
import './self-service.css';
import './layouts/autoservicio.css';

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


  const regularReceiptCount = receipts.filter((receipt) => receipt.runKind === 'REGULAR').length;
  const bonusReceiptCount = receipts.filter((receipt) => receipt.runKind === 'AGUINALDO').length;
  const latestReceipt = [...receipts].sort((a, b) => b.payDate.localeCompare(a.payDate))[0] ?? null;
  const ready = !loading && !error;

  const facts: HrFact[] = [
    {
      label: 'Último pago',
      value: ready ? (latestReceipt ? formatDate(latestReceipt.payDate) : 'Sin pagos') : '—',
      hint: latestReceipt ? latestReceipt.periodLabel : 'En el año y tipo seleccionados',
      tone: ready && latestReceipt ? 'accent' : 'default',
    },
    {
      label: 'Neto del último recibo',
      value: ready && latestReceipt ? formatHrMoney(latestReceipt.currency, latestReceipt.netPay) : '—',
      hint: latestReceipt ? latestReceipt.runCode : 'Importe publicado por nómina',
    },
    {
      label: 'Recibos visibles',
      value: ready ? receipts.length : '—',
      hint: 'Según el tipo y año seleccionados',
    },
  ];

  return (
    <HrPage className="hr-payroll-page hr-my-payroll-page my-hr-page ss-page ss-payroll">
      <MyHrNav />
      <HrHero
        eyebrow="Mi RH"
        icon={WalletCards}
        title="Mis recibos"
        subtitle="Consulta y descarga el desglose exacto publicado por nómina"
        facts={facts}
        aside={ready ? (
          <section className="my-hr-summary-grid" aria-label="Resumen de recibos publicados">
            <article><FileText size={19} aria-hidden="true" /><span>Nómina ordinaria</span><strong>{regularReceiptCount}</strong><small>Colillas regulares publicadas</small></article>
            <article><Gift size={19} aria-hidden="true" /><span>Aguinaldo</span><strong>{bonusReceiptCount}</strong><small>Recibos de aguinaldo publicados</small></article>
          </section>
        ) : undefined}
      />

      {!online && <PayrollOnlineNotice online={false} />}

      <HrToolbar ariaLabel="Filtros de recibos">
        <label>
          Tipo
          <HrReactSelect
            value={kind}
            onChange={(event) => setKind(event.target.value as '' | HrPayrollRunKind)}
          >
            <option value="">Todos</option>
            <option value="REGULAR">Nómina ordinaria</option>
            <option value="AGUINALDO">Aguinaldo</option>
          </HrReactSelect>
        </label>
        <label>
          Año
          <input
            type="number"
            min="2000"
            max="2200"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          />
        </label>
        <div className="hr-ws-toolbar-actions">
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" /> Actualizar
          </Button>
        </div>
      </HrToolbar>

      {loading && <LoadingSpinner text="Cargando tus recibos…" />}

      {!loading && error && (
        <div className="state-placeholder" role="alert">
          <AlertTriangle size={42} aria-hidden="true" />
          <p className="state-error">{error}</p>
          <Button variant="ghost" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      )}

      {ready && (
        <HrSplit
          main={
            <HrSection
              eyebrow="Historial"
              title={<span id="my-receipts-heading">Recibos publicados</span>}
              count={receipts.length}
              description="El servidor limita esta lista a tu usuario y conserva recibos anulados por trazabilidad."
              aria-labelledby="my-receipts-heading"
            >
              {receipts.length === 0 ? (
                <div className="ss-empty">
                  <FileText size={34} aria-hidden="true" />
                  <p>No hay recibos publicados para los filtros seleccionados.</p>
                  {(kind || year !== String(currentYear)) && (
                    <Button size="sm" variant="ghost" onClick={() => { setKind(''); setYear(String(currentYear)); }}>
                      Ver recibos del año actual
                    </Button>
                  )}
                </div>
              ) : (
                <div className="hr-my-receipt-list ss-receipt-list">
                  {receipts.map((receipt) => (
                    <button
                      key={receipt.id}
                      type="button"
                      className={selected?.id === receipt.id ? 'selected' : ''}
                      onClick={() => void openReceipt(receipt)}
                      disabled={detailLoading}
                      aria-current={selected?.id === receipt.id ? 'true' : undefined}
                    >
                      <span className="hr-receipt-kind-icon" aria-hidden="true">
                        {receipt.runKind === 'AGUINALDO' ? (
                          <Gift size={19} />
                        ) : (
                          <FileText size={19} />
                        )}
                      </span>
                      <span>
                        <strong>{receipt.runCode}</strong>
                        <small>
                          {receipt.periodLabel} · pago {formatDate(receipt.payDate)}
                        </small>
                      </span>
                      <span className="hr-my-receipt-amount">
                        <strong>
                          {formatHrMoney(receipt.currency, receipt.netPay)}
                        </strong>
                        <PayrollStatusPill status={receipt.status} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </HrSection>
          }
          aside={
            <HrSection eyebrow="Desglose" title="Detalle del recibo">
              <div aria-live="polite">
                {detailLoading ? (
                  <LoadingSpinner text="Abriendo desglose…" />
                ) : selected ? (
                  <PayrollReceiptBreakdown
                    receipt={selected}
                    online={online}
                    downloading={downloading}
                    onDownload={() => void downloadReceipt()}
                  />
                ) : (
                  <div className="ss-empty">
                    <Download size={40} aria-hidden="true" />
                    <h2>Selecciona un recibo</h2>
                    <p>
                      Verás importes, componentes y trazabilidad exactamente como fueron publicados por
                      el servidor.
                    </p>
                  </div>
                )}
              </div>
            </HrSection>
          }
        />
      )}
    </HrPage>
  );
}
