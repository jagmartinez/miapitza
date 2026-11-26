import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Route } from 'lucide-react';
import api, { categoriesAPI, productsAPI } from '../services/api';
import { AppSelect, Button } from '@/ui';
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
};

let draftSeq = 0;
const nextKey = () => `route-${++draftSeq}`;

const toDrafts = (rows: RouteRow[]): WarehouseRouteDraft[] => rows.map((row) => ({
    key: nextKey(),
    kind: row.productId ? 'PRODUCT' : 'CATEGORY',
    targetId: row.productId ?? row.categoryId,
    warehouseId: row.warehouseId,
}));

export default function BranchWarehouseRoutes({ branchId, warehouses, canEdit }: Props) {
    const [drafts, setDrafts] = useState<WarehouseRouteDraft[]>([]);
    const [categories, setCategories] = useState<Option[]>([]);
    const [products, setProducts] = useState<Option[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
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

    const save = async () => {
        const payload = buildWarehouseRoutesPayload(drafts);
        if ('error' in payload) {
            setMessage({ type: 'error', text: payload.error });
            return;
        }
        setSaving(true);
        try {
            const res = await api.put(`/branches/${branchId}/warehouse-routes`, payload);
            setDrafts(toDrafts((res.data?.data ?? []) as RouteRow[]));
            setDirty(false);
            setMessage({ type: 'ok', text: 'Rutas de bodega guardadas' });
        } catch (error) {
            setMessage({ type: 'error', text: getApiErrorMessage(error, 'No se pudieron guardar las rutas de bodega') });
        } finally {
            setSaving(false);
        }
    };

    const kindOptions: Array<{ value: 'CATEGORY' | 'PRODUCT'; label: string }> = [
        { value: 'CATEGORY', label: 'Categoría' },
        { value: 'PRODUCT', label: 'Producto' },
    ];

    return (
        <div className="modal-input-group" data-testid="branch-warehouse-routes">
            <div className="modal-section-header">
                <Route size={18} />
                <h3>Bodega de consumo por ingrediente</h3>
            </div>
            <small style={{ color: 'var(--ui-text-muted)' }}>
                Las ventas descuentan cada insumo de la bodega indicada (p. ej. bebidas de Barra, alimentos de Cocina).
                Una regla de producto tiene prioridad sobre la de su categoría; sin regla se usa la bodega de venta.
            </small>
            {loading ? (
                <small>Cargando rutas…</small>
            ) : (
                <>
                    {warehouseOptions.length < 2 && (
                        <small style={{ color: 'var(--ui-text-muted)' }}>
                            Esta sucursal tiene una sola bodega; las rutas solo aplican con varias bodegas de sucursal.
                        </small>
                    )}
                    {drafts.length === 0 && <small>Sin reglas: todo se consume de la bodega de venta.</small>}
                    {drafts.map((draft, index) => {
                        const targets = draft.kind === 'PRODUCT' ? products : categories;
                        return (
                            <div
                                key={draft.key}
                                style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 7rem) minmax(0, 1fr) minmax(0, 1fr) auto', gap: '0.5rem', alignItems: 'end' }}
                            >
                                <AppSelect<'CATEGORY' | 'PRODUCT'>
                                    aria-label={`Tipo de regla ${index + 1}`}
                                    options={kindOptions}
                                    value={draft.kind}
                                    onChange={(value) => update(draft.key, { kind: value ?? 'CATEGORY', targetId: null })}
                                    isClearable={false}
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
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        aria-label={`Quitar regla ${index + 1}`}
                                        onClick={() => {
                                            setDrafts((current) => current.filter((candidate) => candidate.key !== draft.key));
                                            setDirty(true);
                                        }}
                                    >
                                        <Trash2 size={16} />
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                    {canEdit && (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                    setDrafts((current) => [...current, { key: nextKey(), kind: 'CATEGORY', targetId: null, warehouseId: null }]);
                                    setDirty(true);
                                }}
                            >
                                <Plus size={16} /> Agregar regla
                            </Button>
                            <Button type="button" variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
                                {saving ? 'Guardando…' : 'Guardar rutas'}
                            </Button>
                        </div>
                    )}
                </>
            )}
            {message && (
                <small role={message.type === 'error' ? 'alert' : 'status'} style={{ color: message.type === 'error' ? 'var(--ui-danger)' : 'var(--ui-success)' }}>
                    {message.text}
                </small>
            )}
        </div>
    );
}
