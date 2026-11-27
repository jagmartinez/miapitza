import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { productsAPI, unitsAPI } from '../services/api';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import {
    ArrowLeft, Package as PackageIcon, Ruler,
    Weight, Beaker, Hash, Wand2, Trash2, Star, StarOff, Info
} from 'lucide-react';
import type { Product, ProductAllowedUnit, UnitOfMeasure } from '../types';
import {
    AppSelect, Badge, Button, EmptyState, Field, FormSection, IconButton, Input, PageContent, PageHeader,
    Skeleton, formatNumber as formatNumberUi, Tooltip,
} from '@/ui';
import s from './ProductUnitSettings.module.css';


interface EditableAllowedUnit {
    unitId: number;
    conversionFactor: string;
    inverseFactor: string;
    isDefault: boolean;
}

function computeInverse(raw: string): string {
    if (raw === '' || raw == null) return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    const inv = 1 / n;
    return String(Number(inv.toPrecision(10)));
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
    // Factors below 1 keep up to 6 decimals so they do not collapse to 0.00.
    return formatNumberUi(n, Math.abs(n) > 0 && Math.abs(n) < 1 ? 6 : 2);
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
                setEditableAllowedUnits(configured.map((u) => {
                    const factor = String(u.conversionFactor);
                    return {
                        unitId: u.unitId,
                        conversionFactor: factor,
                        inverseFactor: computeInverse(factor),
                        isDefault: Boolean(u.isDefault)
                    };
                }));
            } else {
                const fallback = catalog.find((u) => u.abbreviation === productData.unit);
                if (fallback) {
                    setBaseUnitId(String(fallback.id));
                    setEditableAllowedUnits([{
                        unitId: fallback.id,
                        conversionFactor: '1',
                        inverseFactor: '1',
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
            { unitId: nextBaseUnitId, conversionFactor: '1', inverseFactor: '1', isDefault: !hasDefault },
            ...existingNonBase
        ];
    }, []);

    const handleChangeBaseUnit = (option: { value: string; label: string } | null) => {
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
        const factorStr = suggested != null ? String(suggested) : '';
        setEditableAllowedUnits((prev) => [
            ...prev,
            {
                unitId: parsedUnitId,
                conversionFactor: factorStr,
                inverseFactor: computeInverse(factorStr),
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

    const handleFactorChange = (unitId: number, raw: string) => {
        setEditableAllowedUnits((prev) => prev.map((u) =>
            u.unitId === unitId
                ? { ...u, conversionFactor: raw, inverseFactor: computeInverse(raw) }
                : u
        ));
    };

    const handleInverseChange = (unitId: number, raw: string) => {
        setEditableAllowedUnits((prev) => prev.map((u) =>
            u.unitId === unitId
                ? { ...u, inverseFactor: raw, conversionFactor: computeInverse(raw) }
                : u
        ));
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
        const factorStr = String(suggested);
        updateUnit(unitId, {
            conversionFactor: factorStr,
            inverseFactor: computeInverse(factorStr)
        });
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
        return (
            <PageContent>
                <PageHeader title="Conversiones del producto" breadcrumb={['Inventario']} />
                <div className={s.loading} role="status" aria-label="Cargando configuración">
                    <Skeleton height={40} />
                    <Skeleton height={120} />
                    <Skeleton height={120} />
                </div>
                <ToastContainer toasts={toasts} onRemove={removeToast} />
            </PageContent>
        );
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

    const BaseIcon = baseUnit ? TYPE_ICON[baseUnit.measurementType] : null;

    return (
        <PageContent>
            <PageHeader
                title="Conversiones del producto"
                breadcrumb={['Inventario']}
                description={`${product.name}${product.sku ? ` · ${product.sku}` : ''}`}
                actions={(
                    <>
                        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/inventory')}>
                            Volver a Inventario
                        </Button>
                        <Button variant="secondary" icon={Ruler} onClick={() => navigate('/units-of-measure')}>
                            Catálogo de unidades
                        </Button>
                        {canMutate && (
                            <Button variant="primary" onClick={handleSave} loading={saving}>
                                Guardar conversiones
                            </Button>
                        )}
                    </>
                )}
            />

            <p className={s.intro}>
                <Info size={16} aria-hidden="true" />
                <span>
                    <strong>¿Cómo funciona?</strong>{' '}
                    Cada producto se controla en <em>una unidad base</em> (el stock se guarda en esa unidad).
                    Las demás unidades se usan al comprar, recetar o transferir, y el sistema convierte
                    automáticamente al guardar/descontar. La <strong>unidad base contra sí misma siempre vale 1</strong>,
                    por eso ese campo no se edita: el peso o equivalencia se define en las otras unidades.
                    Para crear o inhabilitar unidades del catálogo usa <Link to="/units-of-measure">Unidades de Medida</Link>.
                </span>
            </p>

            {allUnits.length === 0 ? (
                <EmptyState
                    icon={Ruler}
                    title="Primero debes crear unidades en el catálogo."
                    action={<Button variant="primary" onClick={() => navigate('/units-of-measure')}>Ir a Unidades de Medida</Button>}
                />
            ) : (
                <div className={s.grid}>
                    <FormSection step={1} title="Unidad base del producto" description="El inventario interno se controla en esta unidad.">
                        <Field label="Unidad base interna" htmlFor="puc-base-unit">
                            <AppSelect
                                inputId="puc-base-unit"
                                options={baseOptions}
                                value={baseUnit ? String(baseUnit.id) : null}
                                onChange={(v) => handleChangeBaseUnit(baseOptions.find((o) => o.value === v) ?? null)}
                                placeholder="Selecciona la unidad base..."
                                isDisabled={!canMutate}
                            />
                        </Field>
                        {baseUnit && BaseIcon && (
                            <div className={s.baseSummary}>
                                <span className={s.unitIcon} aria-hidden="true"><BaseIcon size={18} /></span>
                                <div>
                                    <strong>{baseUnit.name} ({baseUnit.abbreviation})</strong>
                                    <p className={s.muted}>{TYPE_LABEL[baseUnit.measurementType]}</p>
                                    {baseUnit.measurementType === 'PACKAGE' && (
                                        <p className={s.tip}>
                                            Tu base es un paquete personalizado. Para que las compras en gramos/libras
                                            se conviertan correctamente, agrega esas unidades abajo y define
                                            <strong> cuánto pesa 1 paquete </strong>en cada una (1 g = X paquetes).
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </FormSection>

                    <FormSection step={2} title="Unidades permitidas y conversiones" description="Define qué unidades acepta este producto y a cuánto equivale cada una.">
                        {canMutate && (
                            <div className={s.addRow}>
                                <Field label="Agregar unidad" htmlFor="puc-add-unit">
                                    <AppSelect
                                        inputId="puc-add-unit"
                                        isClearable={false}
                                        options={addOptions}
                                        value={newAllowedUnitId || null}
                                        onChange={(v) => setNewAllowedUnitId(v ?? '')}
                                        placeholder="Selecciona una unidad para agregar..."
                                    />
                                </Field>
                                <Button variant="primary" onClick={handleAddAllowedUnit} disabled={!newAllowedUnitId}>
                                    Agregar unidad
                                </Button>
                            </div>
                        )}

                        {editableAllowedUnits.length === 0 ? (
                            <EmptyState
                                title="Sin unidades permitidas"
                                description="Selecciona arriba la unidad base. Las unidades permitidas aparecerán aquí."
                            />
                        ) : (
                            <ul className={s.unitList}>
                                {editableAllowedUnits.map((row) => {
                                    const unit = allUnits.find((u) => u.id === row.unitId);
                                    if (!unit) return null;
                                    const isBase = baseUnit?.id === unit.id;
                                    const Icon = TYPE_ICON[unit.measurementType];
                                    const suggestion = baseUnit ? suggestFactor(unit) : null;
                                    const canSuggest = !isBase && suggestion != null;
                                    const baseAbbr = baseUnit?.abbreviation || 'base';
                                    return (
                                        <li key={unit.id} className={s.unitRow}>
                                            <div className={s.unitHead}>
                                                <span className={s.unitIcon} aria-hidden="true"><Icon size={18} /></span>
                                                <div className={s.unitTitle}>
                                                    <strong>{unit.name}</strong>
                                                    <span className={s.muted}>{unit.abbreviation} · {TYPE_LABEL[unit.measurementType]}</span>
                                                </div>
                                                <div className={s.badges}>
                                                    {isBase ? <Badge tone="primary">Unidad base</Badge> : <Badge>Permitida</Badge>}
                                                    {row.isDefault && <Badge tone="warning">Por defecto</Badge>}
                                                </div>
                                                {canMutate && (
                                                    <div className={s.rowActions}>
                                                        <IconButton
                                                            icon={row.isDefault ? Star : StarOff}
                                                            label={row.isDefault ? 'Unidad por defecto al mostrar' : 'Marcar como unidad por defecto al mostrar'}
                                                            tooltip={row.isDefault ? 'Por defecto' : 'Hacer por defecto'}
                                                            tone={row.isDefault ? 'primary' : 'default'}
                                                            onClick={() => setDefault(unit.id)}
                                                        />
                                                        <IconButton
                                                            icon={Trash2}
                                                            tone="danger"
                                                            label={isBase ? 'Cambia la unidad base para quitarla' : `Quitar ${unit.name}`}
                                                            tooltip={isBase ? 'Cambia la unidad base para quitarla' : 'Quitar'}
                                                            onClick={() => removeAllowedUnit(unit.id)}
                                                            disabled={isBase}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            {isBase ? (
                                                <p className={s.note}>
                                                    <Info size={14} aria-hidden="true" />
                                                    <span>
                                                        Es la unidad de control de stock. <strong>1 {unit.abbreviation} = 1 {unit.abbreviation}</strong>.
                                                        No se edita: define la conversión en las otras unidades.
                                                    </span>
                                                </p>
                                            ) : (
                                                <div className={s.conversion}>
                                                    <div className={s.convHead}>
                                                        <span className={s.convLabel}>Equivalencia</span>
                                                        {canSuggest && canMutate && (
                                                            <Tooltip label={`Calcular desde el catálogo global (${formatNumber(suggestion!)})`}>
                                                                <Button variant="ghost" icon={Wand2} onClick={() => applySuggestion(unit.id)}>
                                                                    Sugerir desde catálogo
                                                                </Button>
                                                            </Tooltip>
                                                        )}
                                                    </div>
                                                    <p className={s.muted}>Edita cualquiera de las dos líneas, la otra se calcula automáticamente.</p>
                                                    <div className={s.convGrid}>
                                                        <Field label={`1 ${unit.abbreviation} equivale a`} htmlFor={`puc-factor-${unit.id}`}>
                                                            <Input
                                                                id={`puc-factor-${unit.id}`}
                                                                type="number"
                                                                min="0"
                                                                step="any"
                                                                inputMode="decimal"
                                                                className="ui-input--number"
                                                                value={row.conversionFactor}
                                                                onChange={(e) => handleFactorChange(unit.id, e.target.value)}
                                                                placeholder="Ej. 0.2857"
                                                                suffix={baseAbbr}
                                                                disabled={!canMutate}
                                                            />
                                                        </Field>
                                                        <Field label={`1 ${baseAbbr} equivale a`} htmlFor={`puc-inverse-${unit.id}`}>
                                                            <Input
                                                                id={`puc-inverse-${unit.id}`}
                                                                type="number"
                                                                min="0"
                                                                step="any"
                                                                inputMode="decimal"
                                                                className="ui-input--number"
                                                                value={row.inverseFactor}
                                                                onChange={(e) => handleInverseChange(unit.id, e.target.value)}
                                                                placeholder="Ej. 3.5"
                                                                suffix={unit.abbreviation}
                                                                disabled={!canMutate}
                                                            />
                                                        </Field>
                                                    </div>
                                                    {baseUnit?.measurementType === 'PACKAGE' && unit.measurementType !== 'PACKAGE' && (
                                                        <p className={s.tip}>
                                                            Como tu base es un paquete, lo más fácil es escribir en la
                                                            segunda línea cuánto pesa 1 paquete (ej. <strong>3.5</strong> {unit.abbreviation}).
                                                        </p>
                                                    )}
                                                    {!canSuggest && baseUnit
                                                        && unit.measurementType !== baseUnit.measurementType
                                                        && baseUnit.measurementType !== 'PACKAGE'
                                                        && unit.measurementType !== 'PACKAGE' && (
                                                            <p className={s.tip}>
                                                                Tipos distintos ({TYPE_LABEL[unit.measurementType]} ↔ {TYPE_LABEL[baseUnit.measurementType]}).
                                                                Define el factor manualmente según tu caso.
                                                            </p>
                                                        )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </FormSection>
                </div>
            )}

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </PageContent>
    );
}
