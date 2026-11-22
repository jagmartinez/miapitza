import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appEvents } from '../../core/events';
import type { LoginUser } from '../../core/session';
import { CategoryPicker } from './CategoryPicker';
import { DecimalKeypad } from './DecimalKeypad';
import { applyKey, nextLine, orderLines, parseQty, progress, type Key } from './countMath';
import type { InventoryApi } from './inventoryApi';
import { STATUS_LABEL, startedText } from './inventoryFormat';
import type { CountLine, CountSheet } from './inventoryTypes';
import './inventory.css';

/** Short landscape screens (~360 dp): everything fits without scrolling. Kept in sync with inventory.css (a test pins the sum). */
export const LAYOUT = {
    compact: { header: 44, controls: 44, footer: 44, unit: 36, display: 44, key: 44, keyRows: 4 },
    compactMaxHeight: 520,
} as const;

type Indicator = 'saved' | 'saving' | 'queued' | 'error';
const INDICATOR_LABEL: Record<Indicator, string> = {
    saved: 'Guardado',
    saving: 'Guardando…',
    queued: 'Sin conexión · se guardará',
    error: 'No se pudo guardar',
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const qtyText = (n: number | null) => (n === null ? '' : String(Number(n.toFixed(3))));
const unitsOf = (l: CountLine): string[] => {
    const list = l.units.map((u) => u.abbreviation);
    return list.includes(l.baseUnit) ? list : [l.baseUnit, ...list];
};

export interface CountScreenProps {
    api: Pick<InventoryApi, 'sheet' | 'saveLine'>;
    sheetId: number;
    user: Pick<LoginUser, 'name'>;
    /** Back from "Terminar" with "Volver a contarlos": only what is still uncounted is listed. */
    uncountedOnly?: boolean;
    onFinish: () => void;
    onExit: () => void;
}

export function CountScreen({ api, sheetId, user, uncountedOnly = false, onFinish, onExit }: CountScreenProps) {
    const [sheet, setSheet] = useState<CountSheet | null>(null);
    const [lines, setLines] = useState<CountLine[]>([]);
    const [failed, setFailed] = useState(false);
    const [categoryId, setCategoryId] = useState<number | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [text, setText] = useState('');
    const [unit, setUnit] = useState('');
    const [indicator, setIndicator] = useState<Indicator>('saved');
    const [dropped, setDropped] = useState<string[]>([]);
    const [focus, setFocus] = useState<Set<number> | null>(null);
    const saveSeq = useRef(0);
    const firstLoad = useRef(true);
    const selectedRef = useRef<number | null>(null);
    selectedRef.current = selectedId;

    const select = useCallback((l: CountLine) => {
        setSelectedId(l.productId);
        setText(qtyText(l.countedQuantity));
        setUnit(l.unit ?? l.baseUnit);
    }, []);

    /** Loads the sheet. The first load picks the starting line; later ones refresh the lines (and the open one if it is among `resync`). */
    const load = useCallback(
        (resync?: number): Promise<CountSheet | null> =>
            api.sheet(sheetId).then(
                (s) => {
                    setFailed(false);
                    setSheet(s);
                    setLines(s.lines);
                    const ordered = orderLines(s.categories, s.lines);
                    if (firstLoad.current) {
                        firstLoad.current = false;
                        const uncounted = ordered.filter((l) => !l.counted);
                        if (uncountedOnly) setFocus(new Set(uncounted.map((l) => l.productId)));
                        const start = uncounted[0] ?? ordered[0];
                        if (start) {
                            setCategoryId(start.categoryId);
                            select(start);
                        }
                    } else if (resync !== undefined && selectedRef.current === resync) {
                        const l = s.lines.find((x) => x.productId === resync);
                        if (l) select(l);
                    }
                    return s;
                },
                () => {
                    if (firstLoad.current) setFailed(true);
                    return null;
                },
            ),
        [api, sheetId, select, uncountedOnly],
    );

    useEffect(() => {
        void load();
    }, [load]);

    // A queued save the server turned down for good was dropped by the queue: show the sheet as the server has it and say so.
    useEffect(
        () =>
            appEvents.on('inventory-line-dropped', (payload) => {
                const p = payload as { sheetId?: number; productId?: number } | undefined;
                if (!p || p.sheetId !== sheetId || p.productId === undefined) return;
                const productId = p.productId;
                void load(productId).then((s) => {
                    const name = s?.lines.find((l) => l.productId === productId)?.name ?? 'Un producto';
                    setDropped((prev) => (prev.includes(name) ? prev : [...prev, name]));
                });
            }),
        [sheetId, load],
    );

    const ordered = useMemo(() => (sheet ? orderLines(sheet.categories, lines) : []), [sheet, lines]);
    const editable = sheet?.status === 'DRAFT';
    const selected = ordered.find((l) => l.productId === selectedId) ?? null;
    const q = norm(query.trim());
    const visible = q
        ? ordered.filter((l) => norm(l.name).includes(q) || norm(l.sku ?? '').includes(q))
        : ordered.filter((l) => l.categoryId === categoryId && (!focus || focus.has(l.productId)));
    const items = (sheet?.categories ?? []).map((c) => ({ ...c, ...progress(ordered, c.categoryId) }));
    const current = items.find((c) => c.categoryId === categoryId);
    const overall = progress(ordered);

    const pickCategory = (id: number | null) => {
        setCategoryId(id);
        setPickerOpen(false);
        setQuery('');
        const first = ordered.find((l) => l.categoryId === id && (!focus || focus.has(l.productId)));
        if (first) select(first);
    };

    const onKey = (k: Key) => setText((t) => applyKey(t, k));

    const save = () => {
        if (!selected || !editable) return;
        const quantity = parseQty(text);
        if (quantity === null) return;
        const { productId } = selected;
        const updated = lines.map((l) => (l.productId === productId ? { ...l, unit, countedQuantity: quantity, counted: true } : l));
        setLines(updated);
        const next = nextLine(orderLines(sheet?.categories ?? [], updated), productId, selected.categoryId);
        const target = next === null ? null : updated.find((l) => l.productId === next);
        if (target) {
            setCategoryId(target.categoryId);
            setQuery('');
            select(target);
        }
        const token = ++saveSeq.current;
        setIndicator('saving');
        api.saveLine(sheetId, productId, { unit, countedQuantity: quantity }).then(
            (result) => {
                if (token === saveSeq.current) setIndicator(result);
            },
            () => {
                if (token === saveSeq.current) setIndicator('error');
                void load(productId);
            },
        );
    };

    const header = (
        <header className="cnt-header">
            <button type="button" className="btn cnt-back" aria-label="Volver" onClick={onExit}>
                ←
            </button>
            <strong className="cnt-title">{sheet?.warehouse.name ?? 'Conteo'}</strong>
            {sheet && <span className="cnt-blind">Ciego</span>}
            {sheet && (
                <span className="cnt-meta muted">
                    {user.name} · Inicio {startedText(sheet.startedAt)}
                </span>
            )}
            <span className="grow" />
            {sheet && !editable && <span className="inv-badge">{STATUS_LABEL[sheet.displayStatus]}</span>}
            {editable && (
                <span className="cnt-saved" role="status" data-state={indicator}>
                    {INDICATOR_LABEL[indicator]}
                </span>
            )}
        </header>
    );

    if (!sheet)
        return (
            <main className="cnt" data-testid="count-screen">
                {header}
                <div className="cnt-empty">
                    {failed ? (
                        <>
                            <p className="error">No se pudo cargar el conteo.</p>
                            <button type="button" className="btn" onClick={() => void load()}>
                                Reintentar
                            </button>
                        </>
                    ) : (
                        <p className="muted">Cargando…</p>
                    )}
                </div>
            </main>
        );

    const units = selected ? unitsOf(selected) : [];

    return (
        <main className="cnt" data-testid="count-screen" data-readonly={!editable}>
            {header}
            {(dropped.length > 0 || sheet.returnNote) && (
                <div className="cnt-notices">
                    {sheet.returnNote && editable && <p className="cnt-notice">Nota del revisor: {sheet.returnNote}</p>}
                    {dropped.map((name) => (
                        <p key={name} className="cnt-notice" role="alert">
                            «{name}» no se guardó: hay que contarlo de nuevo.
                            <button type="button" className="btn" onClick={() => setDropped((prev) => prev.filter((n) => n !== name))}>
                                Entendido
                            </button>
                        </p>
                    ))}
                </div>
            )}
            <div className="cnt-main">
                <section className="cnt-left">
                    <div className="cnt-controls">
                        <button type="button" className="cnt-catbtn" aria-haspopup="listbox" aria-expanded={pickerOpen} disabled={q !== ''} onClick={() => setPickerOpen((o) => !o)}>
                            {current ? `${current.name} ${current.counted}/${current.total}` : 'Categoría'} ▾
                        </button>
                        <input className="cnt-search" type="search" aria-label="Buscar producto" placeholder="Buscar producto" value={query} onChange={(e) => setQuery(e.target.value)} />
                        {focus && (
                            <button type="button" className="btn" onClick={() => setFocus(null)}>
                                Ver todos
                            </button>
                        )}
                    </div>
                    <div className="cnt-listwrap">
                        <ul className="cnt-list" data-dim={pickerOpen} aria-label="Productos">
                            {visible.map((l) => (
                                <li key={l.productId}>
                                    <button type="button" className="cnt-row" data-testid="count-row" aria-current={l.productId === selectedId} data-counted={l.counted} onClick={() => select(l)}>
                                        <span className="cnt-row-check" aria-label={l.counted ? 'Contado' : undefined}>
                                            {l.counted ? '✓' : ''}
                                        </span>
                                        <span className="cnt-row-name">{l.name}</span>
                                        {l.recountRequested && <span className="inv-badge inv-badge-returned">Recontar</span>}
                                        <span className="cnt-row-unit muted">{l.unit ?? l.baseUnit}</span>
                                        <span className="cnt-row-qty">{l.countedQuantity === null ? '—' : qtyText(l.countedQuantity)}</span>
                                    </button>
                                </li>
                            ))}
                            {visible.length === 0 && <li className="muted cnt-none">{q ? 'Sin resultados.' : 'Sin productos por contar aquí.'}</li>}
                        </ul>
                        {pickerOpen && <CategoryPicker items={items} selectedId={categoryId} onPick={pickCategory} />}
                    </div>
                    <footer className="cnt-footer">
                        <div className="inv-progress cnt-total" role="progressbar" aria-label="Avance general" aria-valuemin={0} aria-valuemax={overall.total} aria-valuenow={overall.counted}>
                            <div className="inv-progress-fill" style={{ width: `${overall.total > 0 ? Math.round((overall.counted / overall.total) * 100) : 0}%` }} />
                        </div>
                        <span className="cnt-total-text">
                            {overall.counted} de {overall.total}
                        </span>
                        {editable && (
                            <button type="button" className="btn btn-primary" onClick={onFinish}>
                                Terminar conteo
                            </button>
                        )}
                    </footer>
                </section>
                <aside className="cnt-right">
                    {editable ? (
                        <>
                            <div className="cnt-units" role="group" aria-label="Unidad de conteo">
                                {units.map((u) => (
                                    <button key={u} type="button" className="cnt-unit" aria-pressed={u === unit} disabled={!selected} onClick={() => setUnit(u)}>
                                        {u}
                                    </button>
                                ))}
                            </div>
                            <div className="cnt-display" data-testid="qty-display" data-empty={text === ''}>
                                {text === '' ? '0' : text}
                            </div>
                            <DecimalKeypad onKey={onKey} onSave={save} saveDisabled={!selected || parseQty(text) === null} />
                        </>
                    ) : (
                        <p className="cnt-readonly">Conteo {STATUS_LABEL[sheet.displayStatus].toLowerCase()}: solo lectura.</p>
                    )}
                </aside>
            </div>
        </main>
    );
}
