import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoginUser } from '../../core/session';
import { useExtendedIdleLock } from '../../core/IdleLockBoundary';
import { IconArrowLeft, IconCheck, IconChevronDown, IconChevronUp, IconCloudCheck, IconEyeOff, IconSearch } from '../../ui/Icon';
import { CategoryPicker } from './CategoryPicker';
import { DecimalKeypad } from './DecimalKeypad';
import { DropNotices } from './DropNotices';
import { applyKey, nextLine, orderLines, parseQty, progress, type Key } from './countMath';
import type { InventoryApi } from './inventoryApi';
import { STATUS_LABEL, startedText } from './inventoryFormat';
import type { CountLine, CountSheet } from './inventoryTypes';
import type { DroppedLine } from './useDroppedLines';
import './inventory.css';

/** Short landscape screens (~360 dp): everything fits without scrolling. Kept in sync with inventory.css (a test pins the sum). */
export const LAYOUT = {
    compact: { header: 44, controls: 44, footer: 44, unit: 36, display: 44, key: 48, keyRows: 4, panelGap: 2, panelPadY: 2, keypadGap: 2 },
    compactMaxHeight: 520,
    /** Visible height of a 360 dp phone with its status bar showing (the app is not immersive outside kiosk mode). */
    usableHeight: 336,
} as const;

type Indicator = 'saved' | 'saving' | 'queued' | 'kept' | 'error';
const INDICATOR_LABEL: Record<Indicator, string> = {
    saved: 'Guardado',
    saving: 'Guardando…',
    queued: 'Sin conexión · se guardará',
    kept: 'Se conservó un valor más reciente',
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
    /** Lines the queue dropped (from the entry); only this sheet's are shown, in the left panel. */
    drops?: DroppedLine[];
    onDismissDrop?: (key: string) => void;
    /** Goes up when a line is dropped: the sheet is reloaded as the server has it. */
    dropTick?: number;
    onFinish: () => void;
    onExit: () => void;
}

export function CountScreen({ api, sheetId, user, uncountedOnly = false, drops = [], onDismissDrop, dropTick = 0, onFinish, onExit }: CountScreenProps) {
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
    const [noteOpen, setNoteOpen] = useState(true);
    const [fresh, setFresh] = useState(false);
    const [focus, setFocus] = useState<Set<number> | null>(null);
    const saveSeq = useRef(0);
    const firstLoad = useRef(true);
    const selectedRef = useRef<number | null>(null);
    selectedRef.current = selectedId;

    const select = useCallback((l: CountLine) => {
        setSelectedId(l.productId);
        setText(qtyText(l.countedQuantity));
        setUnit(l.unit ?? l.baseUnit);
        // The first key on a saved value types over it.
        setFresh(l.countedQuantity !== null);
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

    // A queued save the server turned down for good was dropped by the queue (the entry says which): show the sheet as the server has it.
    const lastTick = useRef(dropTick);
    useEffect(() => {
        if (dropTick === lastTick.current) return;
        lastTick.current = dropTick;
        void load(selectedRef.current ?? undefined);
    }, [dropTick, load]);

    const ordered = useMemo(() => (sheet ? orderLines(sheet.categories, lines) : []), [sheet, lines]);
    const editable = sheet?.status === 'DRAFT';
    // The counter's hands are on the shelf, not on the screen: an open count gets the longer idle window, like the cash count.
    useExtendedIdleLock(editable);
    const selected = ordered.find((l) => l.productId === selectedId) ?? null;
    const q = norm(query.trim());
    const visibleFor = (text: string, category: number | null, scope: Set<number> | null) => {
        const needle = norm(text.trim());
        return needle ? ordered.filter((l) => norm(l.name).includes(needle) || norm(l.sku ?? '').includes(needle)) : ordered.filter((l) => l.categoryId === category && (!scope || scope.has(l.productId)));
    };
    const visible = visibleFor(query, categoryId, focus);
    /** The keypad only writes to a row the counter can see. */
    const target = editable && !pickerOpen && selected !== null && visible.some((l) => l.productId === selected.productId) ? selected : null;
    /** After a filter changes: the first uncounted row on screen is the target; with none, nothing is. */
    const retarget = (list: CountLine[]) => {
        const first = list.find((l) => !l.counted);
        if (first) select(first);
        else {
            setSelectedId(null);
            setText('');
            setFresh(false);
        }
    };
    const sheetDrops = drops.filter((d) => d.sheetId === sheetId);
    const items = (sheet?.categories ?? []).map((c) => ({ ...c, ...progress(ordered, c.categoryId) }));
    const current = items.find((c) => c.categoryId === categoryId);
    const overall = progress(ordered);

    const pickCategory = (id: number | null) => {
        setCategoryId(id);
        setPickerOpen(false);
        setQuery('');
        retarget(visibleFor('', id, focus));
    };

    const changeQuery = (value: string) => {
        setQuery(value);
        retarget(visibleFor(value, categoryId, focus));
    };

    const onKey = (k: Key) => {
        if (!target) return;
        const typesOver = fresh && k !== 'back' && k !== 'clear';
        setText((t) => applyKey(typesOver ? '' : t, k));
        setFresh(false);
    };

    const save = () => {
        if (!target) return;
        const selected = target;
        const quantity = parseQty(text);
        if (quantity === null) return;
        const { productId } = selected;
        const updated = lines.map((l) => (l.productId === productId ? { ...l, unit, countedQuantity: quantity, counted: true } : l));
        setLines(updated);
        const next = nextLine(orderLines(sheet?.categories ?? [], updated), productId, selected.categoryId);
        const nextRow = next === null ? null : updated.find((l) => l.productId === next);
        if (nextRow) {
            setCategoryId(nextRow.categoryId);
            setQuery('');
            select(nextRow);
        }
        const token = ++saveSeq.current;
        setIndicator('saving');
        api.saveLine(sheetId, productId, { unit, countedQuantity: quantity }).then(
            (result) => {
                if (result === 'ignored') {
                    // The server kept a newer value: not "Guardado" and not a failure. The sheet reloads to show the value kept.
                    if (token === saveSeq.current) setIndicator('kept');
                    void load(productId);
                    return;
                }
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
            <button type="button" className="btn btn-ghost cnt-back" aria-label="Volver" onClick={onExit}>
                <IconArrowLeft size={20} stroke={1.5} aria-hidden />
            </button>
            <strong className="cnt-title">
                {sheet && <span className="muted cnt-title-pre">Conteo · </span>}
                <span>{sheet?.warehouse.name ?? 'Conteo'}</span>
            </strong>
            {sheet && (
                <span className="cnt-blind">
                    <IconEyeOff size={14} stroke={1.5} aria-hidden />
                    Ciego
                </span>
            )}
            {sheet && (
                <span className="cnt-meta muted">
                    {user.name} · desde {startedText(sheet.startedAt)}
                </span>
            )}
            <span className="grow" />
            {sheet && !editable && <span className="inv-badge">{STATUS_LABEL[sheet.displayStatus]}</span>}
            {editable && (
                <span className="cnt-saved" role="status" data-state={indicator}>
                    {indicator === 'saved' && <IconCloudCheck size={16} stroke={1.5} aria-hidden />}
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
            <div className="cnt-main">
                <section className="cnt-left">
                    <div className="cnt-controls">
                        <button type="button" className="cnt-catbtn" aria-haspopup="listbox" aria-expanded={pickerOpen} disabled={q !== ''} onClick={() => setPickerOpen((o) => !o)}>
                            {current ? (
                                <>
                                    {current.name} <span className="muted cnt-catcount">{`${current.counted}/${current.total}`}</span>
                                </>
                            ) : (
                                'Categoría'
                            )}
                            {pickerOpen ? <IconChevronUp size={16} stroke={1.5} aria-hidden /> : <IconChevronDown className="muted" size={16} stroke={1.5} aria-hidden />}
                        </button>
                        <div className="cnt-search-wrap">
                            <IconSearch className="muted" size={18} stroke={1.5} aria-hidden />
                            <input className="cnt-search" type="search" aria-label="Buscar producto" placeholder="Buscar producto" value={query} onChange={(e) => changeQuery(e.target.value)} />
                        </div>
                        {focus && (
                            <button
                                type="button"
                                className="btn btn-outline"
                                onClick={() => {
                                    setFocus(null);
                                    retarget(visibleFor(query, categoryId, null));
                                }}
                            >
                                Ver todos
                            </button>
                        )}
                    </div>
                    {(sheetDrops.length > 0 || (sheet.returnNote && editable)) && (
                        <div className="cnt-notices">
                            {sheet.returnNote && editable && (
                                <div className="cnt-note">
                                    <button type="button" className="cnt-note-toggle" aria-expanded={noteOpen} onClick={() => setNoteOpen((o) => !o)}>
                                        Nota del revisor {noteOpen ? '\u25BE' : '\u25B8'}
                                    </button>
                                    {noteOpen && <p className="cnt-note-text">{sheet.returnNote}</p>}
                                </div>
                            )}
                            <DropNotices drops={sheetDrops} onDismiss={(key) => onDismissDrop?.(key)} />
                        </div>
                    )}
                    <div className="cnt-listwrap">
                        <ul className="cnt-list" data-dim={pickerOpen} aria-label="Productos">
                            {visible.map((l) => (
                                <li key={l.productId}>
                                    <button type="button" className="cnt-row" data-testid="count-row" aria-current={l.productId === selectedId} data-counted={l.counted} onClick={() => select(l)}>
                                        <span className="cnt-row-check" aria-label={l.counted ? 'Contado' : undefined}>
                                            {l.counted && <IconCheck size={16} stroke={1.5} aria-hidden />}
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
                        <div className="cnt-total">
                            <div className="cnt-total-line">
                                <span className="cnt-total-label">Avance general</span>
                                <span className="cnt-total-text">
                                    {overall.counted} de {overall.total}
                                </span>
                            </div>
                            <div className="inv-progress" role="progressbar" aria-label="Avance general" aria-valuemin={0} aria-valuemax={overall.total} aria-valuenow={overall.counted}>
                                <div className="inv-progress-fill" style={{ width: `${overall.total > 0 ? Math.round((overall.counted / overall.total) * 100) : 0}%` }} />
                            </div>
                        </div>
                        {editable && (
                            <button type="button" className="btn btn-outline" onClick={onFinish}>
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
                                    <button key={u} type="button" className="cnt-unit" aria-pressed={u === unit} disabled={!target} onClick={() => setUnit(u)}>
                                        {u}
                                    </button>
                                ))}
                            </div>
                            <div className="cnt-display" data-testid="qty-display" data-empty={text === ''} data-unit={unit || undefined}>
                                {text === '' ? '0' : text}
                            </div>
                            <DecimalKeypad onKey={onKey} onSave={save} disabled={!target} saveDisabled={parseQty(text) === null} />
                        </>
                    ) : (
                        <p className="cnt-readonly">Conteo {STATUS_LABEL[sheet.displayStatus].toLowerCase()}: solo lectura.</p>
                    )}
                </aside>
            </div>
        </main>
    );
}
