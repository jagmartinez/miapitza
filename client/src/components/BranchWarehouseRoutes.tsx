import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Plus, Trash2, Route } from 'lucide-react';
import api, { categoriesAPI, productsAPI } from '../services/api';
import { AppSelect, Button, IconButton, Skeleton } from '@/ui';
import s from './BranchWarehouseRoutes.module.css';
import { getApiErrorMessage } from '../utils/apiError';
import { buildWarehouseRoutesPayload, type WarehouseRouteDraft } from '../utils/warehouseRoutes';

/**
 * Per-branch ingredient -> warehouse routing for sale consumption.
 * A product rule wins over a category rule; ingredients without a rule are
 * consumed from the branch's sale warehouse. Saved as a whole rule set.
 */

type Option = { value: number; label: string };

type RouteRow = {
    id: number;
    warehouseId: number;
    categoryId: number | null;
    productId: number | null;
};

type Props = {
    branchId: number;
    warehouses: Array<{ id: number; name: string; code?: string; type?: 'CENTRAL' | 'BRANCH' }>;
    canEdit: boolean;
    /** El modal contenedor guarda las rutas desde su pie: expone save() y dirty. */
    controllerRef?: MutableRefObject<WarehouseRoutesController | null>;
};

export type WarehouseRoutesController = {
    dirty: boolean;
    /** Devuelve false si la validación o la API fallaron (el mensaje queda visible). */
    save: () => Promise<boolean>;
};

let draftSeq = 0;
const nextKey = () => `route-${++draftSeq}`;

const toDrafts = (rows: RouteRow[]): WarehouseRouteDraft[] => rows.map((row) => ({
    key: nextKey(),
    kind: row.productId ? 'PRODUCT' : 'CATEGORY',
    targetId: row.productId ?? row.categoryId,
    warehouseId: row.warehouseId,
}));

export default function BranchWarehouseRoutes({ branchId, warehouses, canEdit, controllerRef }: Props) {
    const [drafts, setDrafts] = useState<WarehouseRouteDraft[]>([]);
    const [categories, setCategories] = useState<Option[]>([]);
    const [products, setProducts] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'error' | 'ok'; text: string } | null>(null);
    const [dirty, setDirty] = useState(false);

    const warehouseOptions = useMemo<Option[]>(() => warehouses
        .filter((warehouse) => !warehouse.type || warehouse.type === 'BRANCH')
        .map((warehouse) => ({
            value: warehouse.id,
            label: warehouse.code ? `${warehouse.name} (${warehouse.code})` : warehouse.name,
        })), [warehouses]);

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const [routesRes, categoriesRes, productsRes] = await Promise.all([
                api.get(`/branches/${branchId}/warehouse-routes`),
                categoriesAPI.getAll(),
                productsAPI.getAll({ active: true, limit: 500 }),
            ]);
            setDrafts(toDrafts((routesRes.data?.data ?? []) as RouteRow[]));
            setCategories(((categoriesRes.data?.data ?? []) as Array<{ id: number; name: string; showInInventory?: boolean }>)
                .filter((category) => category.showInInventory !== false)
                .map((category) => ({ value: category.id, label: category.name })));
            setProducts(((productsRes.data?.data ?? []) as Array<{ id: number; name: string; sku?: string | null }>)
                .map((product) => ({ value: product.id, label: product.sku ? `${product.name} (${product.sku})` : product.name })));
            setDirty(false);
        } catch (error) {
            setMessage({ type: 'error', text: getApiErrorMessage(error, 'No se pudieron cargar las rutas de bodega') });
        } finally {
            setLoading(false);
        }
    }, [branchId]);

    useEffect(() => { void load(); }, [load]);

    const update = (key: string, patch: Partial<WarehouseRouteDraft>) => {
        setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...patch } : draft));
        setDirty(true);
        setMessage(null);
    };

    const save = async (): Promise<boolean> => {
        const payload = buildWarehouseRoutesPayload(drafts);
        if ('error' in payload) {
            setMessage({ type: 'error', text: payload.error });
            return false;
        }
        try {
            const res = await api.put(`/branches/${branchId}/warehouse-routes`, payload);
            setDrafts(toDrafts((res.data?.data ?? []) as RouteRow[]));
            setDirty(false);
            setMessage({ type: 'ok', text: 'Rutas de bodega guardadas' });
            return true;
        } catch (error) {
            setMessage({ type: 'error', text: getApiErrorMessage(error, 'No se pudieron guardar las rutas de bodega') });
            return false;
        }
    };

    useEffect(() => {
        if (!controllerRef) return undefined;
        controllerRef.current = { dirty, save };
        return () => { controllerRef.current = null; };
    });

    const kindOptions: Array<{ value: 'CATEGORY' | 'PRODUCT'; label: string }> = [
        { value: 'CATEGORY', label: 'Categoría' },
        { value: 'PRODUCT', label: 'Producto' },
    ];

    return (
        <section className={s.block} data-testid="branch-warehouse-routes" aria-labelledby="branch-warehouse-routes-title">
            <header className={s.head}>
                <Route size={16} aria-hidden="true" />
                <h4 id="branch-warehouse-routes-title" className={s.title}>Bodega de consumo por ingrediente</h4>
            </header>
            <p className={s.muted}>
                Las ventas descuentan cada insumo de la bodega indicada (p. ej. bebidas de Barra, alimentos de Cocina).
                Una regla de producto tiene prioridad sobre la de su categoría; sin regla se usa la bodega de venta.
            </p>
            {loading ? (
                <div className={s.rules} role="status" aria-label="Cargando rutas…">
                    <Skeleton height={40} />
                    <Skeleton height={40} />
                </div>
            ) : (
                <>
                    {warehouseOptions.length < 2 && (
                        <p className={s.muted}>
                            Esta sucursal tiene una sola bodega; las rutas solo aplican con varias bodegas de sucursal.
                        </p>
                    )}
                    {drafts.length === 0 ? (
                        <p className={s.muted}>Sin reglas: todo se consume de la bodega de venta.</p>
                    ) : (
                        <ul className={s.rules}>
                            {drafts.map((draft, index) => {
                                const targets = draft.kind === 'PRODUCT' ? products : categories;
                                return (
                                    <li key={draft.key} className={s.rule}>
                                        <AppSelect<'CATEGORY' | 'PRODUCT'>
                                            aria-label={`Tipo de regla ${index + 1}`}
                                            options={kindOptions}
                                            value={draft.kind}
                                            onChange={(value) => update(draft.key, { kind: value ?? 'CATEGORY', targetId: null })}
                                            isClearable={false}
                                            isSearchable={false}
                                            isDisabled={!canEdit}
                                        />
                                        <AppSelect<number>
                                            aria-label={`${draft.kind === 'PRODUCT' ? 'Producto' : 'Categoría'} de la regla ${index + 1}`}
                                            placeholder={draft.kind === 'PRODUCT' ? 'Producto…' : 'Categoría…'}
                                            options={targets}
                                            value={targets.find((option) => option.value === draft.targetId)?.value ?? null}
                                            onChange={(value) => update(draft.key, { targetId: value ?? null })}
                                            isDisabled={!canEdit}
                                        />
                                        <AppSelect<number>
                                            aria-label={`Bodega de la regla ${index + 1}`}
                                            placeholder="Bodega…"
                                            options={warehouseOptions}
                                            value={warehouseOptions.find((option) => option.value === draft.warehouseId)?.value ?? null}
                                            onChange={(value) => update(draft.key, { warehouseId: value ?? null })}
                                            isDisabled={!canEdit}
                                        />
                                        {canEdit && (
                                            <IconButton
                                                icon={Trash2}
                                                tone="danger"
                                                label={`Quitar regla ${index + 1}`}
                                                tooltip="Quitar regla"
                                                onClick={() => {
                                                    setDrafts((current) => current.filter((candidate) => candidate.key !== draft.key));
                                                    setDirty(true);
                                                }}
                                            />
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {canEdit && (
                        <div className={s.actions}>
                            <Button
                                variant="secondary"
                                icon={Plus}
                                onClick={() => {
                                    setDrafts((current) => [...current, { key: nextKey(), kind: 'CATEGORY', targetId: null, warehouseId: null }]);
                                    setDirty(true);
                                }}
                            >
                                Agregar regla
                            </Button>
                        </div>
                    )}
                </>
            )}
            {message && (
                <p role={message.type === 'error' ? 'alert' : 'status'} className={message.type === 'error' ? s.error : s.ok}>
                    {message.text}
                </p>
            )}
        </section>
    );
}
