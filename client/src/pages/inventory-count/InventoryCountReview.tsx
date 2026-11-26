import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, ConfirmDialog, Field, FullScreenModal, PageContent, PageHeader, Textarea } from '@/ui';
import { branchesAPI, inventoryCountsAPI } from '../../services/api';
import { getIdempotentAttempt, isAmbiguousMutationFailure, type IdempotentAttempt } from '../../utils/idempotency';
import type { Branch } from '../../types';
import {
    DEFAULT_STATUS_FILTER, InventoryCountDetailView, InventoryCountListView, approveConfirmMessage, canRecount,
    reviewErrorMessage, visibleLines, type CountListFilters, type CountReviewDetail, type CountReviewListItem,
} from './InventoryCountReviewView';

const PAGE_SIZE = 20;
const REASON_MIN = 3;

type Dialog = 'recount' | 'reject' | 'cancel' | 'approve' | null;

export default function InventoryCountReview() {
    const [filters, setFilters] = useState<CountListFilters>({ status: DEFAULT_STATUS_FILTER, branchId: '', dateFrom: '', dateTo: '' });
    const [branches, setBranches] = useState<Branch[]>([]);
    const [items, setItems] = useState<CountReviewListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [listError, setListError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [reloadTick, setReloadTick] = useState(0);

    const [openId, setOpenId] = useState<number | null>(null);
    const [detail, setDetail] = useState<CountReviewDetail | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [onlyDifferences, setOnlyDifferences] = useState(false);
    const [selected, setSelected] = useState<number[]>([]);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const approveAttempt = useRef<IdempotentAttempt | null>(null);

    useEffect(() => {
        branchesAPI.getAll().then((r) => setBranches(r.data.data || [])).catch(() => setBranches([]));
    }, []);

    useEffect(() => {
        if (openId !== null) return undefined;
        let cancelled = false;
        setLoading(true);
        setListError(null);
        inventoryCountsAPI.list({
            status: filters.status,
            page,
            ...(filters.branchId ? { branchId: filters.branchId } : {}),
            ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
            ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
        }).then((r) => {
            if (cancelled) return;
            setItems(r.data.data.items);
            setTotal(r.data.data.total);
        }).catch((e) => {
            if (cancelled) return;
            setItems([]);
            setTotal(0);
            setListError(reviewErrorMessage(e, 'Error al cargar los conteos'));
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [filters, page, openId, reloadTick]);

    const loadDetail = useCallback((id: number) => {
        setDetailError(null);
        return inventoryCountsAPI.detail(id)
            .then((r) => { setDetail(r.data.data); })
            .catch((e) => { setDetail(null); setDetailError(reviewErrorMessage(e, 'Error al cargar el conteo')); });
    }, []);

    const open = (id: number) => {
        setOpenId(id);
        setDetail(null);
        setSelected([]);
        setOnlyDifferences(false);
        setActionError(null);
        approveAttempt.current = null;
        void loadDetail(id);
    };

    const back = () => {
        setOpenId(null);
        setDetail(null);
        setDialog(null);
        setReloadTick((t) => t + 1);
    };

    const changeFilters = (next: CountListFilters) => { setPage(1); setFilters(next); };

    const closeDialog = () => { setDialog(null); setText(''); };

    const run = async (action: () => Promise<unknown>, fallback: string, onDone: () => void) => {
        setBusy(true);
        setActionError(null);
        try {
            await action();
            onDone();
        } catch (e) {
            // A definitive server answer ends the attempt; only a lost response keeps the key for a safe retry.
            if (!isAmbiguousMutationFailure(e)) approveAttempt.current = null;
            setActionError(reviewErrorMessage(e, fallback));
            // A stale sheet (already approved/rejected elsewhere) is refreshed so the actions disappear.
            if (openId !== null) void loadDetail(openId);
        } finally {
            setBusy(false);
            setDialog(null);
            setText('');
        }
    };

    const approve = () => {
        if (!detail) return;
        approveAttempt.current = getIdempotentAttempt(approveAttempt.current, `approve-${detail.id}`);
        const key = approveAttempt.current.key;
        void run(() => inventoryCountsAPI.approve(detail.id, key), 'No se pudo aprobar el conteo', () => {
            approveAttempt.current = null;
            void loadDetail(detail.id);
        });
    };

    const recount = () => {
        if (!detail || !canRecount(selected)) return;
        const note = text.trim();
        void run(
            () => inventoryCountsAPI.recount(detail.id, { productIds: selected, ...(note ? { note } : {}) }),
            'No se pudo pedir el reconteo',
            back,
        );
    };

    const reject = () => {
        if (!detail || text.trim().length < REASON_MIN) return;
        void run(() => inventoryCountsAPI.reject(detail.id, text.trim()), 'No se pudo rechazar el conteo', back);
    };

    // A count still in progress is cancelled through the same endpoint (reason required, audited); it frees the warehouse.
    const cancelDraft = () => {
        if (!detail || text.trim().length < REASON_MIN) return;
        void run(() => inventoryCountsAPI.reject(detail.id, text.trim()), 'No se pudo cancelar el conteo', back);
    };

    const toggleSelected = (productId: number) =>
        setSelected((cur) => (cur.includes(productId) ? cur.filter((id) => id !== productId) : [...cur, productId]));
    const toggleAllVisible = (checked: boolean) => {
        if (!detail) return;
        const ids = visibleLines(detail.lines, onlyDifferences).map((l) => l.productId);
        setSelected((cur) => (checked ? [...new Set([...cur, ...ids])] : cur.filter((id) => !ids.includes(id))));
    };

    if (openId !== null) {
        return (
            <PageContent>
                <PageHeader
                    title={detail ? `Conteo #${detail.id}` : 'Conteo de inventario'}
                    description="Revisa las diferencias contra la existencia del sistema al momento de contar."
                    actions={<Button variant="ghost" size="sm" icon={ArrowLeft} onClick={back}>Volver</Button>}
                />
                {detailError && <p className="state-error" role="alert">{detailError}</p>}
                {!detail && !detailError && <p className="state-placeholder" role="status">Cargando...</p>}
                {detail && (
                    <InventoryCountDetailView
                        detail={detail}
                        onlyDifferences={onlyDifferences}
                        onToggleOnlyDifferences={setOnlyDifferences}
                        selected={selected}
                        onToggleSelected={toggleSelected}
                        onToggleAllVisible={toggleAllVisible}
                        busy={busy}
                        actionError={actionError}
                        onRecount={() => setDialog('recount')}
                        onReject={() => setDialog('reject')}
                        onApprove={() => setDialog('approve')}
                        onCancelDraft={() => setDialog('cancel')}
                    />
                )}
                <FullScreenModal
                    isOpen={dialog === 'recount'}
                    onClose={closeDialog}
                    title="Pedir reconteo"
                    size="compact"
                    footer={(
                        <div className="count-dialog-actions">
                            <Button variant="secondary" onClick={closeDialog}>Cancelar</Button>
                            <Button variant="primary" disabled={busy || !canRecount(selected)} onClick={recount}>Pedir reconteo</Button>
                        </div>
                    )}
                >
                    <div className="count-dialog-field">
                        <p>Se devolverán {selected.length} {selected.length === 1 ? 'producto' : 'productos'} al contador.</p>
                        <Field label="Nota (opcional)" htmlFor="count-recount-note">
                            <Textarea id="count-recount-note" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                        </Field>
                    </div>
                </FullScreenModal>
                <FullScreenModal
                    isOpen={dialog === 'reject'}
                    onClose={closeDialog}
                    title="Rechazar conteo"
                    size="compact"
                    footer={(
                        <div className="count-dialog-actions">
                            <Button variant="secondary" onClick={closeDialog}>Cancelar</Button>
                            <Button variant="danger" disabled={busy || text.trim().length < REASON_MIN} onClick={reject}>Rechazar</Button>
                        </div>
                    )}
                >
                    <div className="count-dialog-field">
                        <Field label="Motivo" htmlFor="count-reject-reason">
                            <Textarea id="count-reject-reason" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                        </Field>
                    </div>
                </FullScreenModal>
                <FullScreenModal
                    isOpen={dialog === 'cancel'}
                    onClose={closeDialog}
                    title="Cancelar conteo"
                    size="compact"
                    footer={(
                        <div className="count-dialog-actions">
                            <Button variant="secondary" onClick={closeDialog}>Volver</Button>
                            <Button variant="danger" disabled={busy || text.trim().length < REASON_MIN} onClick={cancelDraft}>Cancelar conteo</Button>
                        </div>
                    )}
                >
                    <div className="count-dialog-field">
                        <p>El conteo sigue en curso. Al cancelarlo se descarta lo contado y la bodega queda libre para un conteo nuevo.</p>
                        <Field label="Motivo" htmlFor="count-cancel-reason">
                            <Textarea id="count-cancel-reason" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
                        </Field>
                    </div>
                </FullScreenModal>
                <ConfirmDialog
                    isOpen={dialog === 'approve'}
                    title="Aprobar y ajustar"
                    message={detail ? approveConfirmMessage(detail) : ''}
                    confirmLabel="Aprobar y ajustar"
                    loading={busy}
                    onConfirm={approve}
                    onCancel={closeDialog}
                />
            </PageContent>
        );
    }

    return (
        <PageContent>
            <PageHeader
                title="Conteos de inventario"
                description="Revisa los conteos ciegos enviados, pide reconteos y aprueba los ajustes."
            />
            {listError && <p className="state-error" role="alert">{listError}</p>}
            {loading && <p className="state-placeholder" role="status">Cargando...</p>}
            <InventoryCountListView
                items={items}
                total={total}
                pageSize={PAGE_SIZE}
                page={page}
                filters={filters}
                branches={branches}
                onFiltersChange={changeFilters}
                onOpen={open}
                onPageChange={setPage}
            />
        </PageContent>
    );
}
