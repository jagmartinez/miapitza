import { useCallback, useEffect, useState } from 'react';
import type { InventoryApi } from './inventoryApi';
import { OfflineError } from './inventoryApi';
import { COUNT_ERROR, type CountWarehouse, type WarehouseCategory } from './inventoryTypes';
import './inventory.css';

type Scope = 'all' | 'some';
const keyOf = (c: WarehouseCategory) => (c.categoryId === null ? 'none' : String(c.categoryId));

/** The sheet already open in the warehouse (from the 409), -1 when the answer did not say which, null when it was another error. */
const busySheetId = (e: unknown): number | null => {
    const r = (e as { response?: { data?: { code?: unknown; details?: { sheetId?: unknown } } } } | null)?.response?.data;
    if (r?.code !== COUNT_ERROR.warehouseBusy) return null;
    const id = Number(r.details?.sheetId);
    return Number.isInteger(id) && id > 0 ? id : -1;
};

export interface NewCountScreenProps {
    api: Pick<InventoryApi, 'warehouses' | 'categories' | 'start'>;
    onStarted: (sheetId: number) => void;
    onBack: () => void;
}

export function NewCountScreen({ api, onStarted, onBack }: NewCountScreenProps) {
    const [warehouses, setWarehouses] = useState<CountWarehouse[] | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [warehouseId, setWarehouseId] = useState<number | null>(null);
    const [scope, setScope] = useState<Scope>('all');
    const [categories, setCategories] = useState<WarehouseCategory[] | null>(null);
    const [catFailed, setCatFailed] = useState(false);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [starting, setStarting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const loadWarehouses = useCallback(() => {
        setLoadFailed(false);
        api.warehouses().then(
            (list) => setWarehouses(list),
            () => setLoadFailed(true),
        );
    }, [api]);
    useEffect(() => {
        loadWarehouses();
    }, [loadWarehouses]);

    const loadCategories = useCallback(
        (id: number) => {
            setCatFailed(false);
            setCategories(null);
            api.categories(id).then(
                (list) => {
                    setCategories(list);
                    setPicked(new Set(list.map(keyOf)));
                },
                () => setCatFailed(true),
            );
        },
        [api],
    );

    const warehouse = warehouses?.find((w) => w.id === warehouseId) ?? null;

    const choose = (w: CountWarehouse) => {
        if (w.id === warehouseId) return;
        setWarehouseId(w.id);
        setMessage(null);
        setCategories(null);
        setPicked(new Set());
        if (scope === 'some') loadCategories(w.id);
    };
    const chooseScope = (next: Scope) => {
        setScope(next);
        if (next === 'some' && warehouseId !== null && categories === null && !catFailed) loadCategories(warehouseId);
    };
    const toggle = (k: string) =>
        setPicked((prev) => {
            const n = new Set(prev);
            if (n.has(k)) n.delete(k);
            else n.add(k);
            return n;
        });

    const chosenCats = scope === 'some' && categories ? categories.filter((c) => picked.has(keyOf(c))) : [];
    const productCount = scope === 'all' ? (warehouse?.productCount ?? 0) : chosenCats.reduce((n, c) => n + c.productCount, 0);
    const canStart = !!warehouse && !warehouse.openSheet && !starting && (scope === 'all' || chosenCats.length > 0);

    const start = async () => {
        if (!warehouse || !canStart) return;
        setStarting(true);
        setMessage(null);
        try {
            const sheet = await api.start({ warehouseId: warehouse.id, categoryIds: scope === 'all' ? null : chosenCats.map((c) => c.categoryId) });
            onStarted(sheet.id);
            return;
        } catch (error) {
            const busy = busySheetId(error);
            if (busy !== null) {
                if (busy > 0) {
                    onStarted(busy);
                    return;
                }
                setMessage('Esta bodega ya tiene un conteo abierto.');
                loadWarehouses();
            } else if (error instanceof OfflineError) setMessage('Requiere conexión para iniciar un conteo.');
            else setMessage('No se pudo iniciar el conteo.');
        }
        setStarting(false);
    };

    return (
        <main className="inv" data-testid="new-count">
            <header className="inv-bar">
                <button type="button" className="btn" aria-label="Volver" onClick={onBack}>
                    ←
                </button>
                <strong className="inv-title">Nuevo conteo</strong>
            </header>
            <div className="inv-body inv-new">
                <div className="inv-new-main">
                    {loadFailed && (
                        <div className="inv-error" role="alert">
                            <p className="error">No se pudieron cargar las bodegas.</p>
                            <button type="button" className="btn" onClick={loadWarehouses}>
                                Reintentar
                            </button>
                        </div>
                    )}
                    {!loadFailed && warehouses === null && <p className="muted">Cargando…</p>}
                    {warehouses && (
                        <>
                            <section className="inv-section" aria-label="Bodega">
                                <h2>Bodega</h2>
                                <div className="inv-wh">
                                    {warehouses.map((w) => {
                                        const review = w.openSheet?.status === 'SUBMITTED';
                                        const draft = w.openSheet?.status === 'DRAFT';
                                        return (
                                            <div key={w.id} className="inv-wh-card" data-selected={w.id === warehouseId} data-disabled={review}>
                                                <button type="button" className="inv-wh-pick" aria-pressed={w.id === warehouseId} disabled={review || draft} onClick={() => choose(w)}>
                                                    <strong>{w.name}</strong>
                                                    <span className="muted">{w.productCount} productos</span>
                                                    {review && <span className="inv-badge inv-badge-en_revision">En revisión</span>}
                                                </button>
                                                {draft && w.openSheet && (
                                                    <button type="button" className="btn btn-primary" onClick={() => onStarted(w.openSheet!.id)}>
                                                        Continuar
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                            <section className="inv-section" aria-label="Qué contar">
                                <h2>Qué contar</h2>
                                <div className="inv-scope">
                                    <button type="button" className="inv-chip" aria-pressed={scope === 'all'} onClick={() => chooseScope('all')}>
                                        Todo
                                    </button>
                                    <button type="button" className="inv-chip" aria-pressed={scope === 'some'} onClick={() => chooseScope('some')}>
                                        Elegir categorías
                                    </button>
                                </div>
                                {scope === 'some' && !warehouse && <p className="muted">Elige una bodega.</p>}
                                {scope === 'some' && warehouse && catFailed && (
                                    <div className="inv-error" role="alert">
                                        <p className="error">No se pudieron cargar las categorías.</p>
                                        <button type="button" className="btn" onClick={() => loadCategories(warehouse.id)}>
                                            Reintentar
                                        </button>
                                    </div>
                                )}
                                {scope === 'some' && warehouse && !catFailed && categories === null && <p className="muted">Cargando…</p>}
                                {scope === 'some' && categories && (
                                    <>
                                        <button type="button" className="inv-link" onClick={() => setPicked(new Set(categories.map(keyOf)))}>
                                            Seleccionar todas
                                        </button>
                                        <div className="inv-cats" data-testid="category-grid">
                                            {categories.map((c) => (
                                                <button key={keyOf(c)} type="button" className="inv-cat" aria-pressed={picked.has(keyOf(c))} onClick={() => toggle(keyOf(c))}>
                                                    <strong>{c.name}</strong>
                                                    <span className="muted">{c.productCount} productos</span>
                                                </button>
                                            ))}
                                        </div>
                                        <p className="muted">
                                            {chosenCats.length} categorías · {productCount} productos
                                        </p>
                                    </>
                                )}
                            </section>
                        </>
                    )}
                </div>
                <aside className="inv-summary" aria-label="Resumen">
                    <h2>Resumen</h2>
                    <dl>
                        <dt>Bodega</dt>
                        <dd>{warehouse?.name ?? '—'}</dd>
                        <dt>Categorías</dt>
                        <dd>{scope === 'all' ? 'Todas' : String(chosenCats.length)}</dd>
                        <dt>Productos</dt>
                        <dd>{warehouse ? productCount : '—'}</dd>
                    </dl>
                    <span className="inv-badge">Conteo ciego</span>
                    {message && (
                        <p className="error" role="alert">
                            {message}
                        </p>
                    )}
                    <span className="grow" />
                    <button type="button" className="btn btn-primary" disabled={!canStart} onClick={start}>
                        Iniciar conteo
                    </button>
                </aside>
            </div>
        </main>
    );
}
