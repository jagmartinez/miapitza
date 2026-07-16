import HrReactSelect from '../../components/hr/HrReactSelect';
import { formatHrMoney } from '../../utils/hrFormat';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileText, Gift, RefreshCw, WalletCards } from 'lucide-react';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
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

  const regularReceiptCount = receipts.filter((receipt) => receipt.runKind === 'REGULAR').length;
  const bonusReceiptCount = receipts.filter((receipt) => receipt.runKind === 'AGUINALDO').length;

  return (
    <div className="page-wrapper hr-payroll-page hr-my-payroll-page my-hr-page">
      <MyHrNav />
      <PageHeader
        className="my-hr-page-header"
        title="Mis recibos"
        subtitle="Consulta y descarga el desglose exacto publicado por nómina"
        icon={WalletCards}
      />

      {!online && <PayrollOnlineNotice online={false} />}

      {!loading && !error && (
        <section className="my-hr-summary-grid" aria-label="Resumen de recibos publicados">
          <article><WalletCards size={19} aria-hidden="true" /><span>Recibos visibles</span><strong>{receipts.length}</strong><small>Según el tipo y año seleccionados</small></article>
          <article><FileText size={19} aria-hidden="true" /><span>Nómina ordinaria</span><strong>{regularReceiptCount}</strong><small>Colillas regulares publicadas</small></article>
          <article><Gift size={19} aria-hidden="true" /><span>Aguinaldo</span><strong>{bonusReceiptCount}</strong><small>Recibos de aguinaldo publicados</small></article>
        </section>
      )}

      <div className="hr-payroll-filterbar my-hr-toolbar" aria-label="Filtros de recibos">
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
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> Actualizar
        </Button>
      </div>

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

      {!loading && !error && (
        <div className="hr-my-payroll-layout">
          <section className="hr-payroll-section" aria-labelledby="my-receipts-heading">
            <div className="hr-payroll-section-heading">
              <div>
                <h2 id="my-receipts-heading">
                  <FileText size={20} aria-hidden="true" /> Recibos publicados
                </h2>
                <p>
                  El servidor limita esta lista a tu usuario y conserva recibos anulados por
                  trazabilidad.
                </p>
              </div>
              <span className="hr-payroll-count">{receipts.length}</span>
            </div>

            {receipts.length === 0 ? (
              <div className="hr-payroll-empty">
                <FileText size={34} aria-hidden="true" />
                <p>No hay recibos publicados para los filtros seleccionados.</p>
                {(kind || year !== String(currentYear)) && (
                  <Button size="sm" variant="ghost" onClick={() => { setKind(''); setYear(String(currentYear)); }}>
                    Ver recibos del año actual
                  </Button>
                )}
              </div>
            ) : (
              <div className="hr-my-receipt-list">
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
          </section>

          <section className="hr-payroll-section hr-my-receipt-workspace" aria-live="polite">
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
              <div className="hr-payroll-empty-workspace">
                <Download size={40} aria-hidden="true" />
                <h2>Selecciona un recibo</h2>
                <p>
                  Verás importes, componentes y trazabilidad exactamente como fueron publicados por
                  el servidor.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
