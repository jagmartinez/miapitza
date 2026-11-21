import { useCallback, useEffect, useRef, useState } from 'react';
import { formatHrMoney } from '@web/utils/hrFormat';
import type { HrPayrollReceiptDetail, HrPayrollReceiptSummary } from '@web/types/hr-payroll';
import { Card } from '../../../ui/Card';
import { ScreenHeader } from '../../../ui/ScreenHeader';
import { useToast } from '../../../ui/Toast';
import { printOut } from '../../print/printOut';
import { toHrError, type HrApi } from '../hrApi';
import { useAccountNav } from '../AccountNav';
import { markReceiptsSeen, seenReceipts } from '../useAccountSummary';
import '../profile/profile.css';

const dateLabel = (v: string) => {
    const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-NI');
};

/** Self-safe fields only: the trace and employer-side contributions are not shown. */
function ReceiptDetail({ hr, receipt, onBack }: { hr: HrApi; receipt: HrPayrollReceiptSummary; onBack: () => void }) {
    const toast = useToast();
    const [detail, setDetail] = useState<HrPayrollReceiptDetail | null>(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            setDetail(await hr.myReceipt(receipt.id));
        } catch {
            setFailed(true);
        }
    }, [hr, receipt.id]);
    useEffect(() => {
        void load();
    }, [load]);

    async function download() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        try {
            const blob = await hr.receiptPdf(receipt.id);
            await printOut.sharePdf(blob, `recibo-${receipt.periodLabel}.pdf`);
        } catch (e) {
            toast.show(toHrError(e).message || 'No se pudo descargar el recibo', 'error');
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    const money = (v: string) => formatHrMoney(receipt.currency, v);
    const components = detail?.components ?? [];
    return (
        <main className="ah">
            <ScreenHeader title={receipt.periodLabel} onBack={onBack} />
            <div className="ah-body">
                <Card title="Resumen">
                    <div className="pf-list">
                        <div className="pf-row"><span>Fecha de pago</span><span>{dateLabel(receipt.payDate)}</span></div>
                        <div className="pf-row"><span>Ingresos</span><span>{money(receipt.grossIncome)}</span></div>
                        <div className="pf-row"><span>Deducciones</span><span>{money(receipt.totalDeductions)}</span></div>
                        <div className="pf-row"><strong>Pago neto</strong><strong>{money(receipt.netPay)}</strong></div>
                    </div>
                </Card>
                {failed && (
                    <div>
                        <p role="alert" className="pf-error">No se pudo cargar el detalle.</p>
                        <button type="button" className="btn" onClick={() => void load()}>Reintentar</button>
                    </div>
                )}
                {!detail && !failed && <p className="muted">Cargando…</p>}
                {detail && (
                    <>
                        {(['INCOME', 'DEDUCTION'] as const).map((type) => {
                            const rows = components.filter((c) => c.type === type);
                            if (!rows.length) return null;
                            return (
                                <Card key={type} title={type === 'INCOME' ? 'Ingresos' : 'Deducciones'}>
                                    <div className="pf-list">
                                        {rows.map((c) => (
                                            <div key={c.id} className="pf-row"><span>{c.name}</span><span>{money(c.amount)}</span></div>
                                        ))}
                                    </div>
                                </Card>
                            );
                        })}
                    </>
                )}
                <button type="button" className="btn btn-primary ah-wide" disabled={busy} onClick={() => void download()}>
                    Descargar PDF
                </button>
            </div>
        </main>
    );
}

export function PayrollScreen({ hr, userId }: { hr: HrApi; userId: number }) {
    const { back, params } = useAccountNav();
    const [receipts, setReceipts] = useState<HrPayrollReceiptSummary[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [seen, setSeen] = useState<Set<number> | null>(() => seenReceipts(userId));
    const [open, setOpen] = useState<HrPayrollReceiptSummary | null>(null);

    const load = useCallback(async () => {
        setFailed(false);
        try {
            const list = await hr.myReceipts({ limit: 50 });
            // Never initialised for this user: whatever exists now is not "new" (same rule as the home).
            if (!seenReceipts(userId)) {
                markReceiptsSeen(userId, list.map((r) => r.id));
                setSeen(seenReceipts(userId));
            }
            setReceipts(list);
        } catch {
            setFailed(true);
        }
    }, [hr, userId]);
    useEffect(() => {
        void load();
    }, [load]);

    function openReceipt(r: HrPayrollReceiptSummary) {
        markReceiptsSeen(userId, [r.id]);
        setSeen((cur) => new Set([...(cur ?? []), r.id]));
        setOpen(r);
    }

    // Deep link from "Pendiente para ti": open that receipt once the list is in.
    const deepLinked = useRef(false);
    useEffect(() => {
        const id = Number(params.refId);
        if (deepLinked.current || !receipts || !params.refId || !Number.isFinite(id)) return;
        deepLinked.current = true;
        const r = receipts.find((x) => x.id === id);
        if (r) openReceipt(r);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [receipts, params.refId]);

    if (open) return <ReceiptDetail hr={hr} receipt={open} onBack={() => setOpen(null)} />;
    return (
        <main className="ah">
            <ScreenHeader title="Mi nómina" onBack={back} />
            <div className="ah-body">
                {failed && (
                    <div>
                        <p role="alert" className="pf-error">No se pudieron cargar tus recibos.</p>
                        <button type="button" className="btn" onClick={() => void load()}>Reintentar</button>
                    </div>
                )}
                {!receipts && !failed && <p className="muted">Cargando…</p>}
                {receipts?.length === 0 && <p className="muted">Aún no tienes recibos publicados</p>}
                <div className="ah-list">
                    {receipts?.map((r) => (
                        <Card
                            key={r.id}
                            title={r.periodLabel}
                            badge={seen && !seen.has(r.id) ? 'Nuevo' : undefined}
                            badgeTone="pending"
                            onClick={() => openReceipt(r)}
                        >
                            <span className="muted">Pago neto </span>
                            <strong>{formatHrMoney(r.currency, r.netPay)}</strong>
                        </Card>
                    ))}
                </div>
            </div>
        </main>
    );
}
