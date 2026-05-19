import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import Select from '../components/Select';
import { productsAPI, unitsAPI } from '../services/api';
import Button from '../components/Button';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import {
    ArrowLeft, Layers, Package as PackageIcon, Ruler,
    Weight, Beaker, Hash, Wand2, Trash2, Star, StarOff, Info
} from 'lucide-react';
import type { Product, ProductAllowedUnit, UnitOfMeasure } from '../types';
import type { SingleValue } from 'react-select';
import './Inventory.css';
import './UnitsOfMeasure.css';
import './ProductUnitSettings.css';

type StrOption = SingleValue<{ value: string; label: string }>;

interface EditableAllowedUnit {
    unitId: number;
    conversionFactor: string;
    isDefault: boolean;
}

const TYPE_ICON: Record<UnitOfMeasure['measurementType'], typeof Weight> = {
    MASS: Weight,
    VOLUME: Beaker,
    UNIT: Hash,
    PACKAGE: PackageIcon
};

const TYPE_LABEL: Record<UnitOfMeasure['measurementType'], string> = {
    MASS: 'Peso',
    VOLUME: 'Volumen',
    UNIT: 'Conteo',
    PACKAGE: 'Paquete'
};

function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

function formatNumber(n: number): string {
    if (!Number.isFinite(n)) return '';
    if (n === 0) return '0';
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (abs >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
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

    const baseUnit = useMemo(
        () => allUnits.find((u) => String(u.id) === baseUnitId) || null,
        [allUnits, baseUnitId]
    );

    const ensureBaseUnitIncluded = useCallback((nextBaseUnitId: number, units: EditableAllowedUnit[]) => {
        const existingNonBase = units.filter((u) => u.unitId !== nextBaseUnitId);
        const hasDefault = existingNonBase.some((u) => u.isDefault);
        return [
            { unitId: nextBaseUnitId, conversionFactor: '1', isDefault: !hasDefault },
            ...existingNonBase
        ];
    }, []);

    const handleChangeBaseUnit = (option: StrOption) => {
        const nextBaseUnitId = option?.value || '';
        setBaseUnitId(nextBaseUnitId);
        const parsedBase = Number(nextBaseUnitId);
        if (!parsedBase) return;
        setEditableAllowedUnits((prev) => ensureBaseUnitIncluded(parsedBase, prev));
    };

    const suggestFactor = (unit: UnitOfMeasure): number | null => {
        if (!baseUnit) return null;
        if (unit.id === baseUnit.id) return 1;
        if (unit.measurementType !== baseUnit.measurementType) return null;
        const a = Number(unit.systemFactor);
        const b = Number(baseUnit.systemFactor);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
        if (unit.measurementType === 'PACKAGE') return null;
        return a / b;
    };

    const handleAddAllowedUnit = () => {
        const parsedUnitId = Number(newAllowedUnitId);
        if (!parsedUnitId) return;
        if (editableAllowedUnits.some((u) => u.unitId === parsedUnitId)) {
            showWarning('Esa unidad ya está agregada');
            return;
        }
        const unit = allUnits.find((u) => u.id === parsedUnitId);
        const suggested = unit ? suggestFactor(unit) : null;
        setEditableAllowedUnits((prev) => [
            ...prev,
            {
                unitId: parsedUnitId,
                conversionFactor: suggested != null ? String(suggested) : '',
                isDefault: false
            }
        ]);
        setNewAllowedUnitId('');
    };

    const updateUnit = (unitId: number, patch: Partial<EditableAllowedUnit>) => {
        setEditableAllowedUnits((prev) => prev.map((u) =>
            u.unitId === unitId ? { ...u, ...patch } : u
        ));
    };

    const updateFactorByInverse = (unitId: number, inverseRaw: string) => {
        if (inverseRaw === '') {
            updateUnit(unitId, { conversionFactor: '' });
            return;
        }
        const inv = Number(inverseRaw);
        if (!Number.isFinite(inv) || inv <= 0) {
            updateUnit(unitId, { conversionFactor: '' });
            return;
        }
        const factor = 1 / inv;
        const rounded = Number(factor.toPrecision(10));
        updateUnit(unitId, { conversionFactor: String(rounded) });
    };

    const removeAllowedUnit = (unitId: number) => {
        const parsedBase = Number(baseUnitId);
        if (unitId === parsedBase) {
            showWarning('La unidad base no se puede quitar. Cámbiala antes de retirarla.');
            return;
        }
        setEditableAllowedUnits((prev) => prev.filter((u) => u.unitId !== unitId));
    };

    const setDefault = (unitId: number) => {
        setEditableAllowedUnits((prev) => prev.map((u) => ({
            ...u,
            isDefault: u.unitId === unitId
        })));
    };

    const applySuggestion = (unitId: number) => {
        const unit = allUnits.find((u) => u.id === unitId);
        if (!unit) return;
        const suggested = suggestFactor(unit);
        if (suggested == null) {
            showWarning('No hay sugerencia automática para esta unidad (tipos distintos o paquete personalizado).');
            return;
        }
        updateUnit(unitId, { conversionFactor: String(suggested) });
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
                const unitObj = allUnits.find((u) => u.id === unit.unitId);
                showWarning(`Define un factor válido para ${unitObj?.name || `unidad #${unit.unitId}`}`);
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

    const baseOptions = allUnits.map((unit) => ({
        value: String(unit.id),
        label: `${unit.name} (${unit.abbreviation}) · ${TYPE_LABEL[unit.measurementType]}`
    }));

    const addOptions = allUnits
        .filter((unit) => !editableAllowedUnits.some((u) => u.unitId === unit.id))
        .map((unit) => ({
            value: String(unit.id),
            label: `${unit.name} (${unit.abbreviation}) · ${TYPE_LABEL[unit.measurementType]}`
        }));

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
                        <PackageIcon size={14} /> {product.name}
                        {product.sku ? ` · ${product.sku}` : ''}
                    </p>
                </div>
                <div className="puc-header-actions">
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

            <div className="puc-intro">
                <Info size={18} />
                <div>
                    <strong>¿Cómo funciona?</strong>
                    <p>
                        Cada producto se controla en <em>una unidad base</em> (el stock se guarda en esa unidad).
                        Las demás unidades se usan al comprar, recetar o transferir, y el sistema convierte
                        automáticamente al guardar/descontar. La <strong>unidad base contra sí misma siempre vale 1</strong>,
                        por eso ese campo no se edita: el peso o equivalencia se define en las otras unidades.
                        Para crear o inhabilitar unidades del catálogo usa <Link to="/units-of-measure">Unidades de Medida</Link>.
                    </p>
                </div>
            </div>

            {allUnits.length === 0 ? (
                <div className="units-empty-page">
                    <Ruler size={48} />
                    <p>Primero debes crear unidades en el catálogo.</p>
                    <Button onClick={() => navigate('/units-of-measure')}>Ir a Unidades de Medida</Button>
                </div>
            ) : (
                <div className="puc-grid">
                    <section className="puc-section">
                        <div className="puc-section-header">
                            <span className="puc-step">1</span>
                            <div>
                                <h2>Unidad base del producto</h2>
                                <p>El inventario interno se controla en esta unidad.</p>
                            </div>
                        </div>
                        <div className="puc-base-card">
                            <Select
                                variant="modal"
                                label="Unidad base interna"
                                options={baseOptions}
                                value={baseUnit
                                    ? { value: String(baseUnit.id), label: `${baseUnit.name} (${baseUnit.abbreviation}) · ${TYPE_LABEL[baseUnit.measurementType]}` }
                                    : null}
                                onChange={handleChangeBaseUnit}
                                placeholder="Selecciona la unidad base..."
                                isDisabled={!canMutate}
                            />
                            {baseUnit && (
                                <div className="puc-base-summary">
                                    {(() => {
                                        const Icon = TYPE_ICON[baseUnit.measurementType];
                                        return <div className="puc-base-icon"><Icon size={22} /></div>;
                                    })()}
                                    <div>
                                        <strong>{baseUnit.name} ({baseUnit.abbreviation})</strong>
                                        <p>{TYPE_LABEL[baseUnit.measurementType]}</p>
                                        {baseUnit.measurementType === 'PACKAGE' && (
                                            <small className="puc-package-hint">
                                                Tu base es un paquete personalizado. Para que las compras en gramos/libras
                                                se conviertan correctamente, agrega esas unidades abajo y define
                                                <em> cuánto pesa 1 paquete </em>en cada una (1 g = X paquetes).
                                            </small>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="puc-section">
                        <div className="puc-section-header">
                            <span className="puc-step">2</span>
                            <div>
                                <h2>Unidades permitidas y conversiones</h2>
                                <p>Define qué unidades acepta este producto y a cuánto equivale cada una.</p>
                            </div>
                        </div>

                        {canMutate && (
                            <div className="puc-add-row">
                                <Select
                                    variant="modal"
                                    options={addOptions}
                                    value={newAllowedUnitId
                                        ? addOptions.find((o) => o.value === newAllowedUnitId) || null
                                        : null}
                                    onChange={(option: StrOption) => setNewAllowedUnitId(option?.value || '')}
                                    placeholder="Selecciona una unidad para agregar..."
                                />
                                <Button type="button" variant="primary" onClick={handleAddAllowedUnit} disabled={!newAllowedUnitId}>
                                    Agregar unidad
                                </Button>
                            </div>
                        )}

                        <div className="puc-units-list">
                            {editableAllowedUnits.length === 0 && (
                                <div className="puc-empty">
                                    Selecciona arriba la unidad base. Las unidades permitidas aparecerán aquí.
                                </div>
                            )}
                            {editableAllowedUnits.map((row) => {
                                const unit = allUnits.find((u) => u.id === row.unitId);
                                if (!unit) return null;
                                const isBase = baseUnit?.id === unit.id;
                                const Icon = TYPE_ICON[unit.measurementType];
                                const factor = Number(row.conversionFactor);
                                const factorValid = Number.isFinite(factor) && factor > 0;
                                const inverseFactor = factorValid ? 1 / factor : null;
                                const suggestion = baseUnit ? suggestFactor(unit) : null;
                                const canSuggest = !isBase && suggestion != null;
                                return (
                                    <div
                                        key={unit.id}
                                        className={`entity-card puc-unit-card ${isBase ? 'puc-unit-base' : ''}`}
                                    >
                                        <div className="entity-card-body puc-unit-card-body">
                                            <div className="puc-unit-head">
                                                <div className="puc-unit-icon"><Icon size={20} /></div>
                                                <div className="puc-unit-headings">
                                                    <h3 className="entity-card-title">{unit.name}</h3>
                                                    <p className="entity-card-subtitle">
                                                        <span className="entity-card-tag">{unit.abbreviation}</span>
                                                        <span>{TYPE_LABEL[unit.measurementType]}</span>
                                                    </p>
                                                </div>
                                                <div className="puc-unit-status">
                                                    {isBase ? (
                                                        <span className="puc-pill base">Unidad base</span>
                                                    ) : (
                                                        <span className="puc-pill allowed">Permitida</span>
                                                    )}
                                                    {row.isDefault && (
                                                        <span className="puc-pill default"><Star size={12} /> Por defecto</span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="puc-conversion-block">
                                                {isBase ? (
                                                    <div className="puc-base-explainer">
                                                        <Info size={16} />
                                                        <span>
                                                            Es la unidad de control de stock. <strong>1 {unit.abbreviation} = 1 {unit.abbreviation}</strong>.
                                                            No se edita: define la conversión en las otras unidades.
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="puc-conv-header">
                                                            <span className="puc-conv-label">Equivalencia</span>
                                                            {canSuggest && canMutate && (
                                                                <button
                                                                    type="button"
                                                                    className="puc-suggest-btn"
                                                                    onClick={() => applySuggestion(unit.id)}
                                                                    title={`Calcular desde el catálogo global (${formatNumber(suggestion!)})`}
                                                                >
                                                                    <Wand2 size={14} />
                                                                    Sugerir desde catálogo
                                                                </button>
                                                            )}
                                                        </div>

                                                        <p className="puc-conv-hint">
                                                            Edita cualquiera de las dos líneas, la otra se calcula automáticamente.
                                                        </p>

                                                        <div className="puc-conv-row">
                                                            <span className="puc-conv-token">1 {unit.abbreviation}</span>
                                                            <span className="puc-conv-eq">=</span>
                                                            <input
                                                                type="number"
                                                                min="0.000001"
                                                                step="any"
                                                                className="modal-standard-input puc-conv-input"
                                                                value={row.conversionFactor}
                                                                onChange={(e) => updateUnit(unit.id, { conversionFactor: e.target.value })}
                                                                placeholder="Ej. 0.2857"
                                                                disabled={!canMutate}
                                                            />
                                                            <span className="puc-conv-token">{baseUnit?.abbreviation || 'base'}</span>
                                                        </div>

                                                        <div className="puc-conv-row puc-conv-row-inverse">
                                                            <span className="puc-conv-token">1 {baseUnit?.abbreviation || 'base'}</span>
                                                            <span className="puc-conv-eq">=</span>
                                                            <input
                                                                type="number"
                                                                min="0.000001"
                                                                step="any"
                                                                className="modal-standard-input puc-conv-input"
                                                                value={inverseFactor != null ? formatNumber(inverseFactor) : ''}
                                                                onChange={(e) => updateFactorByInverse(unit.id, e.target.value)}
                                                                placeholder="Ej. 3.5"
                                                                disabled={!canMutate}
                                                            />
                                                            <span className="puc-conv-token">{unit.abbreviation}</span>
                                                        </div>

                                                        {baseUnit?.measurementType === 'PACKAGE' && unit.measurementType !== 'PACKAGE' && (
                                                            <div className="puc-conv-tip">
                                                                <Info size={14} />
                                                                <span>
                                                                    Como tu base es un paquete, lo más fácil es escribir en la
                                                                    segunda línea cuánto pesa 1 paquete (ej. <strong>3.5</strong> {unit.abbreviation}).
                                                                </span>
                                                            </div>
                                                        )}
                                                        {!canSuggest && baseUnit
                                                            && unit.measurementType !== baseUnit.measurementType
                                                            && baseUnit.measurementType !== 'PACKAGE'
                                                            && unit.measurementType !== 'PACKAGE' && (
                                                                <div className="puc-conv-tip">
                                                                    <Info size={14} />
                                                                    <span>
                                                                        Tipos distintos ({TYPE_LABEL[unit.measurementType]} ↔ {TYPE_LABEL[baseUnit.measurementType]}).
                                                                        Define el factor manualmente según tu caso.
                                                                    </span>
                                                                </div>
                                                            )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {canMutate && (
                                            <div className="entity-card-actions">
                                                <button
                                                    type="button"
                                                    className={`action-btn-new ${row.isDefault ? 'view' : 'edit'}`}
                                                    onClick={() => setDefault(unit.id)}
                                                    title="Marcar como unidad por defecto al mostrar"
                                                >
                                                    {row.isDefault ? <Star size={18} /> : <StarOff size={18} />}
                                                    <span>{row.isDefault ? 'Por defecto' : 'Hacer por defecto'}</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="action-btn-new delete"
                                                    onClick={() => removeAllowedUnit(unit.id)}
                                                    disabled={isBase}
                                                    title={isBase ? 'Cambia la unidad base para quitarla' : 'Quitar'}
                                                >
                                                    <Trash2 size={18} />
                                                    <span>Quitar</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}
