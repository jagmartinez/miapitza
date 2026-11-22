import { useCallback, useEffect, useState } from 'react';
import type { LoginUser } from '../../core/session';
import type { InventoryApi } from './inventoryApi';
import { IconClipboardCheck, IconClipboardList, IconLock, IconPlus } from '../../ui/Icon';
import { initialsOf, plural, resultText, STATUS_LABEL, startedText } from './inventoryFormat';
import type { RecentSheet } from './inventoryTypes';
import './inventory.css';

type Filter = 'all' | 'review' | 'approved';
const FILTERS: Array<{ id: Filter; label: string }> = [
    { id: 'all', label: 'Todos' },
    { id: 'review', label: 'En revisión' },
    { id: 'approved', label: 'Aprobados' },
];
const isOpen = (s: RecentSheet) => s.displayStatus === 'EN_CURSO' || s.displayStatus === 'DEVUELTO';
const matches = (s: RecentSheet, f: Filter) => f === 'all' || (f === 'review' ? s.displayStatus === 'EN_REVISION' : s.displayStatus === 'APROBADO');

export interface InventoryHomeProps {
    api: Pick<InventoryApi, 'recent'>;
    user: Pick<LoginUser, 'name' | 'color'>;
    onNew: () => void;
    onContinue: (sheetId: number) => void;
    onSwitchUser: () => void;
    /** Only when opened from the tables. */
    onBack?: () => void;
}

export function InventoryHome({ api, user, onNew, onContinue, onSwitchUser, onBack }: InventoryHomeProps) {
    const [sheets, setSheets] = useState<RecentSheet[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');

    // "En curso" is fetched on its own: an open or returned sheet older than the first page of Recientes must still show.
    const fetchAll = useCallback(
        () =>
            Promise.all([api.recent('all'), api.recent('open').catch(() => null)]).then(([list, openList]) => ({
                list,
                open: (openList ?? list).filter(isOpen),
            })),
        [api],
    );
    const [open, setOpen] = useState<RecentSheet[]>([]);
    const load = useCallback(() => {
        setFailed(false);
        fetchAll().then(
            (r) => {
                setSheets(r.list);
                setOpen(r.open);
            },
            () => setFailed(true),
        );
    }, [fetchAll]);
    useEffect(() => {
        let alive = true;
        fetchAll().then(
            (r) => {
                if (!alive) return;
                setSheets(r.list);
                setOpen(r.open);
            },
            () => alive && setFailed(true),
        );
        return () => {
            alive = false;
        };
    }, [fetchAll]);

    const rows = (sheets ?? []).filter((s) => matches(s, filter));

    return (
        <main className="inv" data-testid="inventory-home">
            <header className="inv-bar">
                <span className="avatar-disc small" role="img" aria-label={`Usuario ${user.name}`} style={user.color ? { background: user.color } : undefined}>
                    {initialsOf(user.name)}
                </span>
                <div className="inv-who">
                    <div className="inv-who-name">{user.name}</div>
                    <div className="inv-who-sub">Inventario</div>
                </div>
                <span className="grow" />
                {onBack && (
                    <button type="button" className="btn btn-outline" onClick={onBack}>
                        Mesas
                    </button>
                )}
                <button type="button" className="btn btn-primary" onClick={onNew}>
                    <IconPlus size={18} stroke={1.5} aria-hidden />
                    Nuevo conteo
                </button>
                <button type="button" className="btn btn-ghost inv-ib" aria-label="Cambiar usuario" onClick={onSwitchUser}>
                    <IconLock size={20} stroke={1.5} aria-hidden />
                </button>
            </header>
            <div className="inv-body">
                {failed && (
                    <div className="inv-error" role="alert">
                        <p className="error">No se pudo cargar el inventario.</p>
                        <button type="button" className="btn" onClick={load}>
                            Reintentar
                        </button>
                    </div>
                )}
                {!failed && sheets === null && <p className="muted">Cargando…</p>}
                {sheets !== null && (
                    <>
                        {open.length > 0 && (
                            <section className="inv-section" aria-label="En curso">
                                <h2>En curso</h2>
                                <div className="inv-open">
                                    {open.map((s) => (
                                        <article key={s.id} className="inv-card inv-card-open" data-testid="open-sheet">
                                            <IconClipboardList className="inv-card-icon" size={24} stroke={1.5} aria-hidden />
                                            <div className="inv-open-main">
                                                <strong>{s.warehouseName}</strong>
                                                <span className="muted">
                                                    Inicio {startedText(s.startedAt)} · {s.scopeLabel}
                                                </span>
                                                {s.result && 'recount' in s.result && <span className="muted">{resultText(s.result)}</span>}
                                                <div className="inv-progress" role="progressbar" aria-label="Avance del conteo" aria-valuemin={0} aria-valuemax={s.productCount} aria-valuenow={s.countedCount}>
                                                    <div className="inv-progress-fill" style={{ width: `${s.productCount > 0 ? Math.min(100, Math.round((s.countedCount / s.productCount) * 100)) : 0}%` }} />
                                                </div>
                                            </div>
                                            <span className="inv-open-count">
                                                {s.countedCount} de {s.productCount} contados
                                            </span>
                                            {s.displayStatus === 'DEVUELTO' && <span className="inv-badge inv-badge-returned">Devuelto</span>}
                                            <button type="button" className="btn btn-primary" onClick={() => onContinue(s.id)}>
                                                Continuar
                                            </button>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        )}
                        <section className="inv-section" aria-label="Recientes">
                            <div className="inv-recent-head">
                                <h2>Recientes</h2>
                                <div className="seg inv-filters" role="group" aria-label="Filtrar recientes">
                                    {FILTERS.map((f) => (
                                        <button key={f.id} type="button" className="seg-item" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {rows.length === 0 ? (
                                <p className="muted">Sin conteos.</p>
                            ) : (
                                <div className="inv-recent-list">
                                    {rows.map((s) => (
                                        <article key={s.id} className="inv-card" data-testid="recent-row">
                                            <IconClipboardCheck className="inv-card-icon" size={24} stroke={1.5} aria-hidden />
                                            <div className="inv-open-main">
                                                <span>{s.warehouseName}</span>
                                                <span className="muted">
                                                    {startedText(s.startedAt)} · {s.startedByName} · {plural(s.productCount, 'producto', 'productos')}
                                                </span>
                                                {s.result && <span className="muted">{resultText(s.result)}</span>}
                                            </div>
                                            <span className={`inv-badge inv-badge-${s.displayStatus.toLowerCase()}`}>{STATUS_LABEL[s.displayStatus]}</span>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
