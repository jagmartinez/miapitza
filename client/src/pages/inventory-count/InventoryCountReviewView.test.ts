import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_STATUS_FILTER, InventoryCountDetailView, InventoryCountListView, approveConfirmMessage, canRecount, reviewErrorMessage,
    type CountReviewDetail, type CountReviewLine,
} from './InventoryCountReviewView';

const line = (over: Partial<CountReviewLine>): CountReviewLine => ({
    productId: 1, name: 'Leche', categoryName: 'Lácteos', baseUnit: 'L', unit: 'L', countedQuantity: 8, countedBaseQuantity: 8,
    expectedAtCount: 10, diffQuantity: -2, unitCost: 20, diffValue: -40, notCounted: false, recountRequested: false,
    previousCountedBase: null, countedByName: 'Ana', countedAt: '2026-11-24T10:00:00.000Z', movementId: null, ...over,
});

const detail = (over: Partial<CountReviewDetail> = {}): CountReviewDetail => ({
    id: 7, status: 'SUBMITTED', displayStatus: 'EN_REVISION', branchName: 'Centro', warehouse: { id: 1, name: 'Cocina' },
    startedAt: '2026-11-24T09:00:00.000Z', startedByName: 'Ana', submittedAt: '2026-11-24T11:00:00.000Z', submittedByName: 'Ana',
    approvedAt: null, approvedByName: null, rejectedAt: null, rejectReason: null, returnNote: null, scopeLabel: 'Todo',
    lines: [
        line({}),
        line({ productId: 2, name: 'Queso', expectedAtCount: 5, countedBaseQuantity: 6, diffQuantity: 1, diffValue: 30 }),
        line({ productId: 3, name: 'Arroz', expectedAtCount: 4, countedBaseQuantity: 4, diffQuantity: 0, diffValue: 0 }),
        line({ productId: 4, name: 'Sal', notCounted: true, countedBaseQuantity: null, expectedAtCount: null, diffQuantity: null, diffValue: null }),
    ],
    totals: { differences: 2, shortageValue: 40, surplusValue: 30, netValue: -10, notCounted: 1 },
    ...over,
});

const noop = () => undefined;
const renderDetail = (d: CountReviewDetail, over: Partial<Parameters<typeof InventoryCountDetailView>[0]> = {}) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InventoryCountDetailView, {
        detail: d, onlyDifferences: false, onToggleOnlyDifferences: noop, selected: [], onToggleSelected: noop,
        onToggleAllVisible: noop, onRecount: noop, onReject: noop, onApprove: noop, ...over,
    })));

describe('InventoryCountReview list', () => {
    it('list shows warehouse, counter, dates, status badges and net value; default filter En revisión', () => {
        const html = renderToStaticMarkup(createElement(InventoryCountListView, {
            items: [{
                id: 7, branchName: 'Centro', warehouseName: 'Cocina', startedByName: 'Ana', startedAt: '2026-11-24T09:00:00.000Z',
                submittedAt: '2026-11-24T11:00:00.000Z', status: 'SUBMITTED', displayStatus: 'EN_REVISION', productCount: 4,
                countedCount: 3, differences: 2, netValue: -10,
            }],
            total: 1, pageSize: 20, page: 1, filters: { status: DEFAULT_STATUS_FILTER, branchId: '', dateFrom: '', dateTo: '' },
            branches: [{ id: 1, name: 'Centro' }], onFiltersChange: noop, onOpen: noop, onPageChange: noop,
        }));
        expect(DEFAULT_STATUS_FILTER).toBe('SUBMITTED');
        expect(html).toContain('Cocina');
        expect(html).toContain('Ana');
        expect(html).toContain('En revisión');
        expect(html).toContain('count-badge-warning');
        expect(html).toContain('-C$ 10.00');
        expect(html).toContain('3/4');
        expect(html).toMatch(/app-select__single-value[^>]*>En revisión</);
    });
});

describe('InventoryCountReview detail', () => {
    it('detail shows system at count, counted, diff quantity and diff value per line', () => {
        const html = renderDetail(detail());
        expect(html).toContain('Sistema al contar');
        expect(html).toContain('10.00 L');
        expect(html).toContain('8.00 L');
        expect(html).toContain('-2.00');
        expect(html).toContain('-C$ 40.00');
        expect(html).toContain('+1.00');
        expect(html).toContain('+C$ 30.00');
    });

    it('Solo diferencias toggle hides zero-diff lines', () => {
        const off = renderDetail(detail(), { onlyDifferences: false });
        const on = renderDetail(detail(), { onlyDifferences: true });
        expect(off).toContain('Arroz');
        expect(on).not.toContain('Arroz');
        expect(on).not.toContain('Sal<');
        expect(on).toContain('Leche');
        expect(on).toContain('Queso');
    });

    it('KPIs: diferencias, faltante, sobrante, neto, sin contar', () => {
        const html = renderDetail(detail());
        for (const label of ['Diferencias', 'Faltante', 'Sobrante', 'Neto', 'Sin contar']) expect(html).toContain(`>${label}<`);
        expect(html).toContain('C$ 40.00');
        expect(html).toContain('C$ 30.00');
        expect(html).toContain('-C$ 10.00');
    });

    it('recount needs at least one selected product', () => {
        expect(canRecount([])).toBe(false);
        expect(canRecount([2])).toBe(true);
        expect(renderDetail(detail(), { selected: [] })).toMatch(/<button[^>]*disabled=""[^>]*>Pedir reconteo<\/button>/);
        const selected = renderDetail(detail(), { selected: [1, 2] });
        expect(selected).not.toMatch(/<button[^>]*disabled=""[^>]*>Pedir reconteo/);
        expect(selected).toContain('Pedir reconteo (2)');
    });

    it('approve confirmation states N ajustes and net value', () => {
        const msg = approveConfirmMessage(detail());
        expect(msg).toContain('2 ajustes');
        expect(msg).toContain('-C$ 10.00');
        expect(approveConfirmMessage(detail({ lines: [line({})], totals: { ...detail().totals, notCounted: 0, netValue: -40 } }))).toContain('1 ajuste ');
    });

    it('COST_MISSING error lists the products', () => {
        const error = { response: { data: { code: 'INVENTORY_COUNT_COST_MISSING', message: 'x', details: { products: ['Queso', 'Aceite'] } } } };
        const text = reviewErrorMessage(error, 'fallo');
        expect(text).toContain('Queso');
        expect(text).toContain('Aceite');
        expect(renderDetail(detail(), { actionError: text })).toContain('Queso, Aceite');
    });

    it('approved sheet shows movement links and no actions', () => {
        const approved = detail({
            status: 'APPROVED', displayStatus: 'APROBADO', approvedByName: 'Luis', approvedAt: '2026-11-24T12:00:00.000Z',
            lines: [line({ movementId: 55 })],
        });
        const html = renderDetail(approved);
        expect(html).toMatch(/href="\/kardex\?productId=1&amp;warehouseId=1&amp;dateFrom=2026-11-2[45]"/);
        expect(html).toContain('Mov. #55');
        expect(html).not.toContain('Aprobar y ajustar');
        expect(html).not.toContain('Pedir reconteo');
        expect(html).not.toContain('Rechazar');
        expect(html).not.toContain('type="checkbox" aria-label="Recontar');
    });
});

describe('InventoryCountReview cancel a DRAFT sheet (R12)', () => {
    const draft = detail({ status: 'DRAFT', displayStatus: 'EN_CURSO', submittedAt: null });

    it('a DRAFT sheet offers Cancelar conteo and none of the review actions', () => {
        const html = renderDetail(draft, { onCancelDraft: noop });
        expect(html).toContain('Cancelar conteo');
        expect(html).not.toContain('Aprobar y ajustar');
        expect(html).not.toContain('Pedir reconteo');
        expect(html).not.toContain('Rechazar');
        expect(html).not.toContain('Seleccionar todos para recontar');
    });

    it('a SUBMITTED sheet keeps its review actions and has no Cancelar conteo', () => {
        const html = renderDetail(detail(), { onCancelDraft: noop });
        expect(html).not.toContain('Cancelar conteo');
        expect(html).toContain('Aprobar y ajustar');
    });

    it('the page asks for a reason and cancels through the reject endpoint; approve key rule uses isAmbiguousMutationFailure', () => {
        const page = readFileSync('src/pages/inventory-count/InventoryCountReview.tsx', 'utf8');
        expect(page).toContain("dialog === 'cancel'");
        expect(page).toContain('title="Cancelar conteo"');
        expect(page).toMatch(/inventoryCountsAPI\.reject\(detail\.id, text\.trim\(\)\)/);
        expect(page).toContain('isAmbiguousMutationFailure(e)');
        expect(page).not.toMatch(/\(e as \{ response\?: unknown \}\)\?\.response\) approveAttempt/);
    });
});
