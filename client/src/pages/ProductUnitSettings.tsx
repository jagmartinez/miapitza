import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Select from '../components/Select';
import { productsAPI, unitsAPI } from '../services/api';
import Button from '../components/Button';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import { ArrowLeft, Layers, Package, Ruler } from 'lucide-react';
import type { Product, ProductAllowedUnit, UnitOfMeasure } from '../types';
import type { SingleValue } from 'react-select';
import './Inventory.css';
import './UnitsOfMeasure.css';

type StrOption = SingleValue<{ value: string; label: string }>;

interface EditableAllowedUnit {
    unitId: number;
    conversionFactor: string;
    isDefault: boolean;
}

function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

export default function ProductUnitSettings() {
    const { productId } = useParams<{ productId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { toasts, removeToast, success: showSuccess, error: showError, warning: showWarning } = useToast();
    const canMutate = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);

    const [product, setProduct] = useState<Product | null>(null);
    const [allUnits, setAllUnits] = useState<UnitOfMeasure[]>([]);
    const [baseUnitId, setBaseUnitId] = useState('');
    const [editableAllowedUnits, setEditableAllowedUnits] = useState<EditableAllowedUnit[]>([]);
    const [newAllowedUnitId, setNewAllowedUnitId] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const parsedProductId = Number(productId);

    const loadData = useCallback(async () => {
        try {
            const [productRes, unitsRes, productUnitsRes] = await Promise.all([
                productsAPI.getById(parsedProductId),
                unitsAPI.getAll(),
                unitsAPI.getProductUnits(parsedProductId)
            ]);
            const productData: Product = productRes.data.data;
            const catalog: UnitOfMeasure[] = unitsRes.data.data || [];
            const configured: ProductAllowedUnit[] = productUnitsRes.data.data || [];

            setProduct(productData);
            setAllUnits(catalog);

            const configuredBase = configured.find((u) => u.isBase);
            if (configuredBase?.unitId) {
                setBaseUnitId(String(configuredBase.unitId));
                setEditableAllowedUnits(configured.map((u) => ({
                    unitId: u.unitId,
                    conversionFactor: String(u.conversionFactor),
                    isDefault: Boolean(u.isDefault)
                })));
            } else {
                const fallback = catalog.find((u) => u.abbreviation === productData.unit);
                if (fallback) {
                    setBaseUnitId(String(fallback.id));
                    setEditableAllowedUnits([{
                        unitId: fallback.id,
                        conversionFactor: '1',
                        isDefault: true
                    }]);
                }
            }
        } catch (error) {
            showError('No se pudo cargar la configuración: ' + apiErrorMessage(error));
            navigate('/inventory');
        } finally {
            setLoading(false);
        }
    }, [parsedProductId, navigate, showError]);

    useEffect(() => {
        if (!parsedProductId) {
            navigate('/inventory');
            return;
        }
        loadData();
    }, [parsedProductId, loadData, navigate]);

    const unitLabelById = (unitId: number) => {
        const unit = allUnits.find((u) => u.id === unitId);
        return unit ? `${unit.name} (${unit.abbreviation})` : `Unidad #${unitId}`;
    };

    const ensureBaseUnitIncluded = (nextBaseUnitId: number, units: EditableAllowedUnit[]) => {
        const filtered = units.filter((u) => u.unitId !== nextBaseUnitId);
        const existingDefault = filtered.some((u) => u.isDefault);
        return [
            { unitId: nextBaseUnitId, conversionFactor: '1', isDefault: !existingDefault },
            ...filtered
        ];
    };

    const handleChangeBaseUnit = (nextBaseUnitId: string) => {
        setBaseUnitId(nextBaseUnitId);
        const parsedBase = Number(nextBaseUnitId);
        if (!parsedBase) return;
        setEditableAllowedUnits((prev) => ensureBaseUnitIncluded(parsedBase, prev));
    };

    const handleAddAllowedUnit = () => {
        const parsedUnitId = Number(newAllowedUnitId);
        if (!parsedUnitId) return;
        if (editableAllowedUnits.some((u) => u.unitId === parsedUnitId)) {
            showWarning('Esa unidad ya está agregada');
            return;
        }
        setEditableAllowedUnits((prev) => [
            ...prev,
            { unitId: parsedUnitId, conversionFactor: '1', isDefault: prev.length === 0 }
        ]);
        setNewAllowedUnitId('');
    };

    const handleSave = async () => {
        if (!canMutate) return;
        const parsedBase = Number(baseUnitId);
        if (!parsedBase) {
            showWarning('Selecciona la unidad base del producto');
            return;
        }
        if (editableAllowedUnits.length === 0) {
            showWarning('Agrega al menos una unidad permitida');
            return;
        }

        const uniqueByUnit = new Map<number, { unitId: number; conversionFactor: number; isDefault?: boolean }>();
        for (const unit of editableAllowedUnits) {
            const factor = unit.unitId === parsedBase ? 1 : Number(unit.conversionFactor);
            if (!Number.isFinite(factor) || factor <= 0) {
                showWarning(`Factor inválido para ${unitLabelById(unit.unitId)}`);
                return;
            }
            uniqueByUnit.set(unit.unitId, {
                unitId: unit.unitId,
                conversionFactor: factor,
                isDefault: unit.isDefault
            });
        }
        if (!uniqueByUnit.has(parsedBase)) {
            uniqueByUnit.set(parsedBase, { unitId: parsedBase, conversionFactor: 1, isDefault: true });
        }
        const normalized = Array.from(uniqueByUnit.values());
        if (!normalized.some((u) => u.isDefault)) {
            const baseEntry = normalized.find((u) => u.unitId === parsedBase);
            if (baseEntry) baseEntry.isDefault = true;
        }

        setSaving(true);
        try {
            await unitsAPI.setProductUnits(parsedProductId, {
                baseUnitId: parsedBase,
                allowedUnits: normalized
            });
            showSuccess('Conversiones del producto guardadas');
            navigate('/inventory');
        } catch (error) {
            showError(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="inventory-loading">Cargando configuración...</div>;
    }

    if (!product) return null;

    return (
        <div className="inventory-page product-units-page">
            <div className="inventory-header-new">
                <div className="header-title-section">
                    <button type="button" className="units-back-btn" onClick={() => navigate('/inventory')}>
                        <ArrowLeft size={20} />
                        Volver a Inventario
                    </button>
                    <h1><Layers size={32} /> Conversiones del producto</h1>
                    <p className="header-subtitle">
                        <Package size={14} /> {product.name}
                        {product.sku ? ` · ${product.sku}` : ''}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <Button variant="secondary" onClick={() => navigate('/units-of-measure')}>
                        <Ruler size={18} />
                        Catálogo de unidades
                    </Button>
                    {canMutate && (
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar conversiones'}
                        </Button>
                    )}
                </div>
            </div>

            <div className="import-info-banner" style={{ marginBottom: '1.5rem' }}>
                <p>
                    Aquí defines <strong>qué unidades puede usar este producto</strong> y el factor hacia su unidad base
                    (inventario interno). Para crear o inhabilitar unidades del catálogo (gramos, quintales, paquetes, etc.),
                    usa <Link to="/units-of-measure">Unidades de Medida</Link>.
                </p>
            </div>

            {allUnits.length === 0 ? (
                <div className="units-empty-page">
                    <Ruler size={48} />
                    <p>Primero debes crear unidades en el catálogo.</p>
                    <Button onClick={() => navigate('/units-of-measure')}>Ir a Unidades de Medida</Button>
                </div>
            ) : (
                <div className="premium-modal-content" style={{ maxWidth: 720 }}>
                    <div className="modal-section">
                        <div className="modal-input-group">
                            <label className="modal-input-label">Unidad base interna</label>
                            <Select
                                variant="modal"
                                options={allUnits.map((unit) => ({
                                    value: String(unit.id),
                                    label: `${unit.name} (${unit.abbreviation})`
                                }))}
                                value={baseUnitId
                                    ? { value: baseUnitId, label: unitLabelById(Number(baseUnitId)) }
                                    : null}
                                onChange={(option: StrOption) => handleChangeBaseUnit(option?.value || '')}
                                placeholder="Selecciona la unidad base..."
                                isDisabled={!canMutate}
                            />
                            <small className="modal-input-hint">
                                Toda existencia se controla en esta unidad (ej. gramos para peso).
                            </small>
                        </div>

                        <div className="modal-input-group">
                            <label className="modal-input-label">Agregar unidad permitida</label>
                            <div className="units-row-inline">
                                <Select
                                    variant="modal"
                                    options={allUnits
                                        .filter((unit) => !editableAllowedUnits.some((u) => u.unitId === unit.id))
                                        .map((unit) => ({
                                            value: String(unit.id),
                                            label: `${unit.name} (${unit.abbreviation})`
                                        }))}
                                    value={newAllowedUnitId
                                        ? { value: newAllowedUnitId, label: unitLabelById(Number(newAllowedUnitId)) }
                                        : null}
                                    onChange={(option: StrOption) => setNewAllowedUnitId(option?.value || '')}
                                    placeholder="Selecciona una unidad..."
                                    isDisabled={!canMutate}
                                />
                                <Button type="button" variant="secondary" onClick={handleAddAllowedUnit} disabled={!canMutate}>
                                    Agregar
                                </Button>
                            </div>
                        </div>

                        <div className="units-config-list">
                            {editableAllowedUnits.length === 0 && (
                                <div className="units-empty-state">Sin unidades permitidas configuradas.</div>
                            )}
                            {editableAllowedUnits.map((unit) => {
                                const isBase = baseUnitId && Number(baseUnitId) === unit.unitId;
                                return (
                                    <div key={unit.unitId} className="units-config-item">
                                        <div className="units-config-main">
                                            <strong>{unitLabelById(unit.unitId)}</strong>
                                            <span className="sku-tag">{isBase ? 'Base' : 'Permitida'}</span>
                                        </div>
                                        <div className="units-config-controls">
                                            <div className="units-factor-input">
                                                <label>Factor a base</label>
                                                <input
                                                    type="number"
                                                    min="0.000001"
                                                    step="0.000001"
                                                    className="modal-standard-input"
                                                    value={isBase ? '1' : unit.conversionFactor}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        setEditableAllowedUnits((prev) => prev.map((u) =>
                                                            u.unitId === unit.unitId ? { ...u, conversionFactor: v } : u
                                                        ));
                                                    }}
                                                    disabled={Boolean(isBase) || !canMutate}
                                                />
                                            </div>
                                            <label className="units-default-checkbox">
                                                <input
                                                    type="radio"
                                                    name="productDefaultUnit"
                                                    checked={unit.isDefault}
                                                    onChange={() => setEditableAllowedUnits((prev) => prev.map((u) => ({
                                                        ...u,
                                                        isDefault: u.unitId === unit.unitId
                                                    })))}
                                                    disabled={!canMutate}
                                                />
                                                Por defecto
                                            </label>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => {
                                                    if (isBase) {
                                                        showWarning('La unidad base no se puede quitar');
                                                        return;
                                                    }
                                                    setEditableAllowedUnits((prev) => prev.filter((u) => u.unitId !== unit.unitId));
                                                }}
                                                disabled={Boolean(isBase) || !canMutate}
                                            >
                                                Quitar
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
