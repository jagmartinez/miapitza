import { Link } from 'react-router-dom';
import { AppSelect, Button, DataTable, DateInput, Field, type Column, formatNumber } from '@/ui';
import { kardexHref } from '../../utils/kardexLink';
import './InventoryCountReview.css';

export type CountStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type CountDisplayStatus = 'EN_CURSO' | 'EN_REVISION' | 'APROBADO' | 'RECHAZADO' | 'DEVUELTO';

export interface CountReviewListItem {
    id: number;
    branchName: string | null;
    warehouseName: string;
    startedByName: string;
    startedAt: string;
    submittedAt: string | null;
    status: CountStatus;
    displayStatus: CountDisplayStatus;
    productCount: number;
    countedCount: number;
    differences: number;
    netValue: number;
}

export interface CountReviewLine {
    productId: number;
    name: string;
    categoryName: string;
    baseUnit: string | null;
    unit: string | null;
    countedQuantity: number | null;
    countedBaseQuantity: number | null;
    expectedAtCount: number | null;
    diffQuantity: number | null;
    unitCost: number | null;
    diffValue: number | null;
    notCounted: boolean;
    recountRequested: boolean;
    previousCountedBase: number | null;
    countedByName: string | null;
    countedAt: string | null;
    movementId: number | null;
}

export interface CountReviewDetail {
    id: number;
    status: CountStatus;
    displayStatus: CountDisplayStatus;
    branchName: string | null;
    warehouse: { id: number; name: string };
    startedAt: string;
    startedByName: string;
    submittedAt: string | null;
    submittedByName: string | null;
    approvedAt: string | null;
    approvedByName: string | null;
    rejectedAt: string | null;
    rejectReason: string | null;
    returnNote: string | null;
    scopeLabel: string;
    lines: CountReviewLine[];
    totals: { differences: number; shortageValue: number; surplusValue: number; netValue: number; notCounted: number };
}

export const STATUS_LABELS: Record<CountDisplayStatus, string> = {
    EN_CURSO: 'En curso',
    EN_REVISION: 'En revisión',
    APROBADO: 'Aprobado',
    RECHAZADO: 'Rechazado',
    DEVUELTO: 'Devuelto',
};

export const STATUS_FILTERS: Array<{ value: CountStatus; label: string }> = [
    { value: 'SUBMITTED', label: 'En revisión' },
    { value: 'APPROVED', label: 'Aprobados' },
    { value: 'REJECTED', label: 'Rechazados' },
    { value: 'DRAFT', label: 'En curso o devueltos' },
];

export const DEFAULT_STATUS_FILTER: CountStatus = 'SUBMITTED';

const STATUS_TONE: Record<CountDisplayStatus, string> = {
    EN_CURSO: 'neutral',
    EN_REVISION: 'warning',
    APROBADO: 'success',
    RECHAZADO: 'danger',
    DEVUELTO: 'danger',
};

const money = (n: number) => formatNumber(n);
export const fmtMoney = (n: number) => `C$ ${money(n)}`;
/** Signed value: surplus "+C$ 5.00", shortage "-C$ 5.00". */
export const fmtSigned = (n: number) => (n === 0 ? fmtMoney(0) : `${n > 0 ? '+' : '-'}C$ ${money(Math.abs(n))}`);
export const fmtQty = (n: number | null) => (n === null ? '—' : formatNumber(n));
const fmtSignedQty = (n: number | null) => (n === null ? '—' : n > 0 ? `+${fmtQty(n)}` : fmtQty(n));
const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const diffTone = (n: number | null) => (n === null || n === 0 ? '' : n < 0 ? 'count-neg' : 'count-pos');

/** Lines with a quantity difference (the "Solo diferencias" filter keeps these). */
export const hasDifference = (line: CountReviewLine) => line.diffQuantity !== null && line.diffQuantity !== 0;

export const visibleLines = (lines: CountReviewLine[], onlyDifferences: boolean) =>
    onlyDifferences ? lines.filter(hasDifference) : lines;

/** A recount needs at least one selected product. */
export const canRecount = (selected: ReadonlyArray<number>) => selected.length > 0;

export const approveAdjustments = (detail: Pick<CountReviewDetail, 'lines'>) => detail.lines.filter(hasDifference).length;

export function approveConfirmMessage(detail: Pick<CountReviewDetail, 'lines' | 'totals'>): string {
    const n = approveAdjustments(detail);
    const withNotCounted = detail.totals.notCounted > 0 ? ` Los ${detail.totals.notCounted} productos sin contar no se ajustan.` : '';
    if (n === 0) return `No hay diferencias que ajustar; se aprobará el conteo sin movimientos.${withNotCounted}`;
    return `Se aplicarán ${n} ${n === 1 ? 'ajuste' : 'ajustes'} al inventario, con un resultado neto de ${fmtSigned(detail.totals.netValue)}. Esta acción no se puede deshacer.${withNotCounted}`;
}

type ApiErrorShape = { response?: { data?: { code?: string; message?: string; details?: unknown } } };

/** Spanish message for count review errors (COST_MISSING lists the products). */
export function reviewErrorMessage(error: unknown, fallback: string): string {
    const data = (error as ApiErrorShape)?.response?.data;
    const code = data?.code;
    if (code === 'INVENTORY_COUNT_COST_MISSING') {
        const products = (data?.details as { products?: unknown } | undefined)?.products;
        const names = Array.isArray(products) ? products.filter((p): p is string => typeof p === 'string') : [];
        return names.length > 0
            ? `No se puede aprobar: falta el costo de ${names.join(', ')}. Registra el costo y vuelve a intentar.`
            : 'No se puede aprobar: faltan costos de algunos productos.';
    }
    if (code === 'INVENTORY_COUNT_NOT_EDITABLE') return 'Este conteo ya no está en revisión (otra persona pudo aprobarlo o rechazarlo). Actualiza la lista.';
    if (code === 'INVENTORY_COUNT_RECOUNT_PENDING') return 'Hay productos pendientes de recontar; el contador debe volver a enviar el conteo.';
    if (code === 'INVENTORY_COUNT_NOT_FOUND') return 'No se encontró el conteo.';
    return data?.message || (error as Error)?.message || fallback;
}

function StatusBadge({ status }: { status: CountDisplayStatus }) {
    return <span className={`count-badge count-badge-${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export interface CountListFilters { status: CountStatus; branchId: string; dateFrom: string; dateTo: string }

export interface InventoryCountListViewProps {
    items: CountReviewListItem[];
    total: number;
    pageSize: number;
    page: number;
    filters: CountListFilters;
    branches: Array<{ id: number; name: string }>;
    onFiltersChange: (filters: CountListFilters) => void;
    onOpen: (id: number) => void;
    onPageChange: (page: number) => void;
}

const listColumns: Column<CountReviewListItem>[] = [
    { key: 'warehouse', header: 'Bodega', render: (r) => <><strong>{r.warehouseName}</strong>{r.branchName && <small className="count-sub">{r.branchName}</small>}</> },
    { key: 'counter', header: 'Contador', render: (r) => r.startedByName },
    { key: 'started', header: 'Iniciado', render: (r) => dateTime(r.startedAt) },
    { key: 'submitted', header: 'Enviado', render: (r) => dateTime(r.submittedAt) },
    { key: 'status', header: 'Estado', render: (r) => <StatusBadge status={r.displayStatus} /> },
    { key: 'counted', header: 'Contados', type: 'number', render: (r) => `${r.countedCount}/${r.productCount}` },
    { key: 'diffs', header: 'Diferencias', type: 'number', render: (r) => r.differences },
    { key: 'net', header: 'Valor neto', type: 'number', render: (r) => <span className={diffTone(r.netValue)}>{fmtSigned(r.netValue)}</span> },
];

export function InventoryCountListView({ items, total, pageSize, page, filters, branches, onFiltersChange, onOpen, onPageChange }: InventoryCountListViewProps) {
    const set = (patch: Partial<CountListFilters>) => onFiltersChange({ ...filters, ...patch });
    return (
        <div className="count-review">
            <div className="count-filters">
                <Field label="Estado" htmlFor="count-status">
                    <AppSelect<CountStatus>
                        inputId="count-status"
                        isClearable={false}
                        options={STATUS_FILTERS}
                        value={filters.status}
                        onChange={(v) => v && set({ status: v })}
                    />
                </Field>
                <Field label="Sucursal" htmlFor="count-branch">
                    <AppSelect<string>
                        inputId="count-branch"
                        isClearable={false}
                        options={[{ value: '', label: 'Todas las Sucursales' }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
                        value={filters.branchId}
                        onChange={(v) => set({ branchId: v ?? '' })}
                    />
                </Field>
                <Field label="Desde" htmlFor="count-from">
                    <DateInput id="count-from" value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
                </Field>
                <Field label="Hasta" htmlFor="count-to">
                    <DateInput id="count-to" value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
                </Field>
            </div>
            <DataTable<CountReviewListItem>
                ariaLabel="Conteos de inventario"
                columns={listColumns}
                rows={items}
                rowKey={(r) => r.id}
                onRowClick={(r) => onOpen(r.id)}
                empty={<p className="count-empty">No hay conteos con estos filtros</p>}
                pagination={{ mode: 'server', page, pageSize, total, onChange: (next) => onPageChange(next) }}
                pageSizeOptions={[pageSize]}
            />
        </div>
    );
}

export interface InventoryCountDetailViewProps {
    detail: CountReviewDetail;
    onlyDifferences: boolean;
    onToggleOnlyDifferences: (value: boolean) => void;
    selected: ReadonlyArray<number>;
    onToggleSelected: (productId: number) => void;
    onToggleAllVisible: (checked: boolean) => void;
    busy?: boolean;
    actionError?: string | null;
    onRecount: () => void;
    onReject: () => void;
    onApprove: () => void;
    /** Admin cancels a count still in progress (DRAFT), releasing its warehouse. */
    onCancelDraft?: () => void;
}

export function InventoryCountDetailView({
    detail, onlyDifferences, onToggleOnlyDifferences, selected, onToggleSelected, onToggleAllVisible, busy, actionError, onRecount, onReject, onApprove, onCancelDraft,
}: InventoryCountDetailViewProps) {
    const reviewable = detail.status === 'SUBMITTED';
    const cancellable = detail.status === 'DRAFT' && onCancelDraft !== undefined;
    const approved = detail.status === 'APPROVED';
    const lines = visibleLines(detail.lines, onlyDifferences);
    const allChecked = lines.length > 0 && lines.every((l) => selected.includes(l.productId));
    const t = detail.totals;

    const columns: Column<CountReviewLine>[] = [
        ...(reviewable ? [{
            key: 'pick',
            header: <input type="checkbox" aria-label="Seleccionar todos para recontar" checked={allChecked} onChange={(e) => onToggleAllVisible(e.target.checked)} />,
            render: (l: CountReviewLine) => (
                <input type="checkbox" aria-label={`Recontar ${l.name}`} checked={selected.includes(l.productId)} onChange={() => onToggleSelected(l.productId)} />
            ),
        }] : []),
        { key: 'product', header: 'Producto', render: (l) => <><strong>{l.name}</strong><small className="count-sub">{l.categoryName}</small></> },
        { key: 'system', header: 'Sistema al contar', type: 'number', render: (l) => (l.expectedAtCount === null ? '—' : `${fmtQty(l.expectedAtCount)} ${l.baseUnit ?? ''}`) },
        {
            key: 'counted', header: 'Contado', type: 'number',
            render: (l) => (l.notCounted ? <span className="count-muted">Sin contar</span>
                : l.countedBaseQuantity === null ? <span className="count-muted">Pendiente</span>
                    : `${fmtQty(l.countedBaseQuantity)} ${l.baseUnit ?? ''}`),
        },
        { key: 'diff', header: 'Diferencia', type: 'number', render: (l) => <span className={diffTone(l.diffQuantity)}>{fmtSignedQty(l.diffQuantity)}</span> },
        { key: 'value', header: 'Valor', type: 'number', render: (l) => (l.diffValue === null ? '—' : <span className={diffTone(l.diffValue)}>{fmtSigned(l.diffValue)}</span>) },
        { key: 'by', header: 'Contó', render: (l) => l.countedByName ?? '—' },
        ...(approved ? [{
            key: 'movement', header: 'Movimiento',
            render: (l: CountReviewLine) => (l.movementId === null ? '—' : <Link to={kardexHref({ productId: l.productId, warehouseId: detail.warehouse.id, from: detail.approvedAt ? new Date(detail.approvedAt) : null })}>Mov. #{l.movementId}</Link>),
        }] : []),
    ];

    return (
        <div className="count-review">
            <p className="count-meta">
                {detail.warehouse.name}{detail.branchName ? ` · ${detail.branchName}` : ''} · {detail.scopeLabel} · Contó {detail.startedByName}
                {detail.submittedAt ? ` · Enviado ${dateTime(detail.submittedAt)}` : ''}
                {' '}<StatusBadge status={detail.displayStatus} />
            </p>
            {detail.returnNote && detail.displayStatus === 'DEVUELTO' && <p className="count-note">Nota de reconteo: {detail.returnNote}</p>}
            {detail.status === 'REJECTED' && <p className="count-note">Rechazado: {detail.rejectReason}</p>}
            {approved && <p className="count-note">Aprobado por {detail.approvedByName ?? '—'} · {dateTime(detail.approvedAt)}</p>}

            <div className="kpi-grid">
                <div className={`kpi-card ${t.differences > 0 ? 'kpi-warning' : 'kpi-success'}`}>
                    <div className="kpi-label">Diferencias</div>
                    <div className="kpi-value">{t.differences}</div>
                </div>
                <div className={`kpi-card ${t.shortageValue > 0 ? 'kpi-danger' : 'kpi-neutral'}`}>
                    <div className="kpi-label">Faltante</div>
                    <div className="kpi-value">{fmtMoney(t.shortageValue)}</div>
                </div>
                <div className="kpi-card kpi-neutral">
                    <div className="kpi-label">Sobrante</div>
                    <div className="kpi-value">{fmtMoney(t.surplusValue)}</div>
                </div>
                <div className={`kpi-card ${t.netValue < 0 ? 'kpi-danger' : 'kpi-neutral'}`}>
                    <div className="kpi-label">Neto</div>
                    <div className="kpi-value">{fmtSigned(t.netValue)}</div>
                </div>
                <div className={`kpi-card ${t.notCounted > 0 ? 'kpi-warning' : 'kpi-neutral'}`}>
                    <div className="kpi-label">Sin contar</div>
                    <div className="kpi-value">{t.notCounted}</div>
                    {t.notCounted > 0 && <div className="kpi-detail">No se ajustan</div>}
                </div>
            </div>

            {actionError && <p className="state-error" role="alert">{actionError}</p>}

            <div className="count-toolbar">
                <label className="count-toggle">
                    <input type="checkbox" checked={onlyDifferences} onChange={(e) => onToggleOnlyDifferences(e.target.checked)} />
                    Solo diferencias
                </label>
                {cancellable && (
                    <div className="count-actions">
                        <Button variant="danger" disabled={busy} onClick={onCancelDraft}>Cancelar conteo</Button>
                    </div>
                )}
                {reviewable && (
                    <div className="count-actions">
                        <Button variant="secondary" disabled={busy || !canRecount(selected)} onClick={onRecount}>
                            Pedir reconteo{selected.length > 0 ? ` (${selected.length})` : ''}
                        </Button>
                        <Button variant="danger" disabled={busy} onClick={onReject}>Rechazar</Button>
                        <Button variant="primary" disabled={busy} onClick={onApprove}>Aprobar y ajustar</Button>
                    </div>
                )}
            </div>

            <DataTable<CountReviewLine>
                ariaLabel="Líneas del conteo"
                columns={columns}
                rows={lines}
                rowKey={(l) => l.productId}
                pagination={{ mode: 'client' }}
                defaultPageSize={50}
                resetKey={onlyDifferences}
                empty={<p className="count-empty">{onlyDifferences ? 'Sin diferencias' : 'Sin productos'}</p>}
            />
        </div>
    );
}
