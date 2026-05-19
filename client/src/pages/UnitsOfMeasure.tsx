import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { unitsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { Plus, Ruler, Edit2, Power, PowerOff, Weight, Beaker, Hash, Package as PackageIcon } from 'lucide-react';
import type { UnitOfMeasure } from '../types';
import './UnitsOfMeasure.css';

type MeasurementTypeOption = UnitOfMeasure['measurementType'];
type FilterOption = 'all' | 'active' | 'inactive';

const MEASUREMENT_TYPE_LABELS: Record<MeasurementTypeOption, string> = {
    MASS: 'Peso',
    VOLUME: 'Volumen',
    UNIT: 'Conteo',
    PACKAGE: 'Paquete'
};

interface MeasurementTypeMeta {
    value: MeasurementTypeOption;
    title: string;
    description: string;
    examples: string;
    icon: typeof Weight;
    baseLabel: string;
    factorLabel: string;
    factorHint: string;
    factorPlaceholder: string;
    factorEditable: boolean;
    factorPreset: string;
}

const MEASUREMENT_TYPES: MeasurementTypeMeta[] = [
    {
        value: 'MASS',
        title: 'Peso',
        description: 'Cualquier unidad que se mida en peso.',
        examples: 'gramo, libra, kilogramo, quintal',
        icon: Weight,
        baseLabel: 'gramos (g)',
        factorLabel: '¿Cuántos gramos equivale 1 de esta unidad?',
        factorHint: 'Ejemplos: 1 g = 1 · 1 lb = 453.592 · 1 kg = 1000 · 1 qq = 45 359.2',
        factorPlaceholder: 'Ej. 453.592 para libras',
        factorEditable: true,
        factorPreset: ''
    },
    {
        value: 'VOLUME',
        title: 'Volumen',
        description: 'Unidades líquidas o de capacidad.',
        examples: 'mililitro, litro, galón, onza fluida',
        icon: Beaker,
        baseLabel: 'mililitros (ml)',
        factorLabel: '¿Cuántos mililitros equivale 1 de esta unidad?',
        factorHint: 'Ejemplos: 1 ml = 1 · 1 l = 1000 · 1 galón = 3785.41',
        factorPlaceholder: 'Ej. 1000 para litros',
        factorEditable: true,
        factorPreset: ''
    },
    {
        value: 'UNIT',
        title: 'Conteo',
        description: 'Se cuenta por piezas o unidades enteras.',
        examples: 'unidad, pieza, docena, caja',
        icon: Hash,
        baseLabel: 'piezas',
        factorLabel: '¿Cuántas piezas hay en 1 de esta unidad?',
        factorHint: '1 unidad = 1 · 1 docena = 12 · 1 caja de 24 = 24',
        factorPlaceholder: 'Ej. 12 para docena',
        factorEditable: true,
        factorPreset: '1'
    },
    {
        value: 'PACKAGE',
        title: 'Paquete personalizado',
        description: 'Empaques que se arman con un peso específico por producto (ej. paquete de mozzarella de 3.5 g).',
        examples: 'paquete mozzarella 3.5g, bolsa pizza familiar, porción',
        icon: PackageIcon,
        baseLabel: 'paquete',
        factorLabel: 'Factor (se define por producto)',
        factorHint: 'Para paquetes el peso real se configura en cada producto. Deja en 1 aquí.',
        factorPlaceholder: '1',
        factorEditable: false,
        factorPreset: '1'
    }
];

const MEASUREMENT_TYPE_META: Record<MeasurementTypeOption, MeasurementTypeMeta> =
    MEASUREMENT_TYPES.reduce((acc, item) => {
        acc[item.value] = item;
        return acc;
    }, {} as Record<MeasurementTypeOption, MeasurementTypeMeta>);

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Activas' },
    { value: 'inactive', label: 'Inactivas' }
];

const EMPTY_FORM = {
    name: '',
    abbreviation: '',
    measurementType: 'MASS' as MeasurementTypeOption,
    systemFactor: '',
    active: true
};

function apiErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const m = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    if (error instanceof Error) return error.message;
    return 'Error';
}

export default function UnitsOfMeasurePage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { toasts, removeToast, success: showSuccess, error: showError } = useToast();
    const canMutate = hasAnyRole(user, ['SUPERADMIN', 'ADMIN', 'BODEGA']);

    const [units, setUnits] = useState<UnitOfMeasure[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<FilterOption>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUnit, setEditingUnit] = useState<UnitOfMeasure | null>(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    const loadUnits = useCallback(async () => {
        try {
            const res = await unitsAPI.getAll({ includeInactive: true });
            setUnits(res.data.data || []);
        } catch (error) {
            console.error('Error loading units:', error);
            showError('No se pudieron cargar las unidades de medida');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadUnits();
    }, [loadUnits]);

    const filteredUnits = useMemo(() => {
        return units.filter((unit) => {
            const matchStatus =
                statusFilter === 'all' ||
                (statusFilter === 'active' && unit.active) ||
                (statusFilter === 'inactive' && !unit.active);
            const q = searchQuery.trim().toLowerCase();
            const matchSearch =
                !q ||
                unit.name.toLowerCase().includes(q) ||
                unit.abbreviation.toLowerCase().includes(q);
            return matchStatus && matchSearch;
        });
    }, [units, statusFilter, searchQuery]);

    const openModal = (unit?: UnitOfMeasure) => {
        if (!canMutate) return;
        if (unit) {
            setEditingUnit(unit);
            setFormData({
                name: unit.name,
                abbreviation: unit.abbreviation,
                measurementType: unit.measurementType,
                systemFactor: String(unit.systemFactor),
                active: unit.active
            });
        } else {
            setEditingUnit(null);
            setFormData(EMPTY_FORM);
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingUnit(null);
    };

    const handleTypeChange = (type: MeasurementTypeOption) => {
        const meta = MEASUREMENT_TYPE_META[type];
        setFormData((prev) => ({
            ...prev,
            measurementType: type,
            systemFactor: meta.factorEditable ? (prev.systemFactor || meta.factorPreset) : meta.factorPreset
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canMutate) return;

        const meta = MEASUREMENT_TYPE_META[formData.measurementType];
        const name = formData.name.trim();
        const abbreviation = formData.abbreviation.trim().toLowerCase();
        const factorRaw = meta.factorEditable ? formData.systemFactor : meta.factorPreset;
        const systemFactor = Number(factorRaw);

        if (!name || !abbreviation) {
            showError('Nombre y abreviatura son obligatorios');
            return;
        }
        if (!Number.isFinite(systemFactor) || systemFactor <= 0) {
            showError(`Indica cuántos ${meta.baseLabel} equivale 1 ${abbreviation || 'unidad'}`);
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name,
                abbreviation,
                measurementType: formData.measurementType,
                systemFactor,
                active: formData.active
            };

            if (editingUnit) {
                await unitsAPI.update(editingUnit.id, payload);
                showSuccess('Unidad actualizada');
            } else {
                await unitsAPI.create(payload);
                showSuccess('Unidad creada');
            }

            await loadUnits();
            closeModal();
        } catch (error: unknown) {
            showError(apiErrorMessage(error));
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (unit: UnitOfMeasure) => {
        if (!canMutate) return;
        const nextActive = !unit.active;
        if (!confirm(`¿${nextActive ? 'Habilitar' : 'Inhabilitar'} la unidad "${unit.name}"?`)) return;

        try {
            await unitsAPI.update(unit.id, { active: nextActive });
            showSuccess(`Unidad ${nextActive ? 'habilitada' : 'inhabilitada'}`);
            await loadUnits();
        } catch (error: unknown) {
            showError(apiErrorMessage(error));
        }
    };

    const currentTypeMeta = MEASUREMENT_TYPE_META[formData.measurementType];

    const factorPreview = useMemo(() => {
        const factor = Number(formData.systemFactor);
        if (!Number.isFinite(factor) || factor <= 0) return '';
        const abbr = formData.abbreviation.trim() || 'unidad';
        return `1 ${abbr} equivale a ${factor.toLocaleString()} ${currentTypeMeta.baseLabel}`;
    }, [formData.systemFactor, formData.abbreviation, currentTypeMeta]);

    if (loading) {
        return <div className="units-loading">Cargando unidades de medida...</div>;
    }

    return (
        <div className="units-page">
            <div className="units-header">
                <div>
                    <h1><Ruler size={32} /> Unidades de Medida</h1>
                    <p className="units-subtitle">
                        {units.filter((u) => u.active).length} activas · {units.length} en catálogo
                    </p>
                </div>
                <div className="units-header-actions">
                    <Button variant="secondary" onClick={() => navigate('/inventory')}>
                        Ir a Inventario
                    </Button>
                    {canMutate && (
                        <Button variant="primary" onClick={() => openModal()}>
                            <Plus size={20} />
                            Nueva Unidad
                        </Button>
                    )}
                </div>
            </div>

            <div className="units-filters-row">
                <div className="units-status-filters">
                    {FILTER_OPTIONS.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            className={`units-status-btn ${statusFilter === opt.value ? 'active' : ''}`}
                            onClick={() => setStatusFilter(opt.value)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
                <input
                    type="text"
                    className="search-input units-search"
                    placeholder="Buscar por nombre o abreviatura..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            {units.length === 0 && (
                <div className="units-empty-page">
                    <Ruler size={48} />
                    <p>No hay unidades de medida en el catálogo.</p>
                    <p className="units-empty-hint">
                        Crea las unidades que usará tu empresa (gramos, libras, paquetes personalizados, etc.)
                        antes de configurar productos.
                    </p>
                    {canMutate && (
                        <Button onClick={() => openModal()}>Crear primera unidad</Button>
                    )}
                </div>
            )}

            <div className="units-grid">
                {filteredUnits.map((unit) => (
                    <div key={unit.id} className={`unit-card entity-card-new ${unit.active ? '' : 'inactive'}`}>
                        <div className={`status-badge-new ${unit.active ? 'active' : 'inactive'}`}>
                            {unit.active ? 'Activa' : 'Inactiva'}
                        </div>
                        <div className="unit-card-body entity-card-body">
                            <div className="unit-name">{unit.name}</div>
                            <div className="unit-details">
                                <span className="sku-tag">{unit.abbreviation}</span>
                                <span className="sku-tag">{MEASUREMENT_TYPE_LABELS[unit.measurementType]}</span>
                            </div>
                            <div className="unit-meta">
                                <span>1 {unit.abbreviation} = {Number(unit.systemFactor).toLocaleString()} {MEASUREMENT_TYPE_META[unit.measurementType].baseLabel}</span>
                            </div>
                            <p className="unit-meta-hint">
                                {unit.measurementType === 'MASS' && 'Se convierte automáticamente a gramos.'}
                                {unit.measurementType === 'VOLUME' && 'Se convierte automáticamente a mililitros.'}
                                {unit.measurementType === 'UNIT' && 'Se cuenta por piezas enteras.'}
                                {unit.measurementType === 'PACKAGE' && 'El peso real se define en cada producto.'}
                            </p>
                        </div>
                        {canMutate && (
                            <div className="unit-card-actions entity-card-actions">
                                <button type="button" className="action-btn-new edit" onClick={() => openModal(unit)} title="Editar">
                                    <Edit2 size={20} />
                                    <span>Editar</span>
                                </button>
                                <button
                                    type="button"
                                    className={`action-btn-new ${unit.active ? 'delete' : 'adjust'}`}
                                    onClick={() => handleToggleActive(unit)}
                                    title={unit.active ? 'Inhabilitar' : 'Habilitar'}
                                >
                                    {unit.active ? <PowerOff size={20} /> : <Power size={20} />}
                                    <span>{unit.active ? 'Inhabilitar' : 'Habilitar'}</span>
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {units.length > 0 && filteredUnits.length === 0 && (
                <div className="units-empty-page">
                    <p>No hay unidades con este filtro.</p>
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingUnit ? 'Editar unidad' : 'Nueva unidad de medida'}
            >
                <form onSubmit={handleSubmit} className="modal-form-new premium-modal-content">
                    <div className="modal-tab-content">
                        <div className="unit-form-step">
                            <div className="unit-form-step-header">
                                <span className="unit-form-step-num">1</span>
                                <div>
                                    <h4>¿Qué tipo de medida es?</h4>
                                    <p>Elige cómo se mide esta unidad. Esto define cómo se hacen las conversiones.</p>
                                </div>
                            </div>
                            <div className="unit-type-cards">
                                {MEASUREMENT_TYPES.map((type) => {
                                    const Icon = type.icon;
                                    const active = formData.measurementType === type.value;
                                    return (
                                        <button
                                            type="button"
                                            key={type.value}
                                            className={`unit-type-card ${active ? 'active' : ''}`}
                                            onClick={() => handleTypeChange(type.value)}
                                        >
                                            <div className="unit-type-card-icon"><Icon size={22} /></div>
                                            <div className="unit-type-card-body">
                                                <div className="unit-type-card-title">{type.title}</div>
                                                <div className="unit-type-card-desc">{type.description}</div>
                                                <div className="unit-type-card-examples">
                                                    <strong>Ej.</strong> {type.examples}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="unit-form-step">
                            <div className="unit-form-step-header">
                                <span className="unit-form-step-num">2</span>
                                <div>
                                    <h4>Identifica la unidad</h4>
                                    <p>El nombre y la abreviatura se mostrarán al elegirla en productos y operaciones.</p>
                                </div>
                            </div>
                            <div className="modal-form-row">
                                <div className="modal-input-group">
                                    <label className="modal-input-label">Nombre</label>
                                    <input
                                        type="text"
                                        className="modal-standard-input"
                                        value={formData.name}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                                        placeholder={
                                            formData.measurementType === 'MASS' ? 'Ej. Libra' :
                                                formData.measurementType === 'VOLUME' ? 'Ej. Litro' :
                                                    formData.measurementType === 'UNIT' ? 'Ej. Docena' :
                                                        'Ej. Paquete Mozzarella 3.5g'
                                        }
                                        required
                                    />
                                </div>
                                <div className="modal-input-group">
                                    <label className="modal-input-label">Abreviatura</label>
                                    <input
                                        type="text"
                                        className="modal-standard-input"
                                        value={formData.abbreviation}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, abbreviation: e.target.value }))}
                                        placeholder={
                                            formData.measurementType === 'MASS' ? 'lb' :
                                                formData.measurementType === 'VOLUME' ? 'l' :
                                                    formData.measurementType === 'UNIT' ? 'doc' :
                                                        'pkg_moz_3_5g'
                                        }
                                        required
                                    />
                                    <small className="modal-input-hint">Única en tu empresa. Es como un código corto.</small>
                                </div>
                            </div>
                        </div>

                        <div className="unit-form-step">
                            <div className="unit-form-step-header">
                                <span className="unit-form-step-num">3</span>
                                <div>
                                    <h4>Define la equivalencia</h4>
                                    <p>{currentTypeMeta.factorHint}</p>
                                </div>
                            </div>
                            <div className="modal-input-group">
                                <label className="modal-input-label">{currentTypeMeta.factorLabel}</label>
                                <div className="unit-factor-row">
                                    <span className="unit-factor-prefix">1 {formData.abbreviation || 'unidad'} =</span>
                                    <input
                                        type="number"
                                        min="0.000001"
                                        step="0.000001"
                                        className="modal-standard-input"
                                        value={formData.systemFactor}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, systemFactor: e.target.value }))}
                                        placeholder={currentTypeMeta.factorPlaceholder}
                                        disabled={!currentTypeMeta.factorEditable}
                                        required={currentTypeMeta.factorEditable}
                                    />
                                    <span className="unit-factor-suffix">{currentTypeMeta.baseLabel}</span>
                                </div>
                                {factorPreview && (
                                    <div className="unit-factor-preview">
                                        Vista previa: {factorPreview}
                                    </div>
                                )}
                                {!currentTypeMeta.factorEditable && (
                                    <small className="modal-input-hint">
                                        Para paquetes el peso real se configura por producto desde
                                        <strong> Inventario → Conversiones</strong>.
                                    </small>
                                )}
                            </div>
                        </div>

                        {editingUnit && (
                            <label className="units-default-checkbox">
                                <input
                                    type="checkbox"
                                    checked={formData.active}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, active: e.target.checked }))}
                                />
                                Unidad activa (disponible en productos y operaciones)
                            </label>
                        )}
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="ghost" onClick={closeModal}>Cancelar</Button>
                        <Button type="submit" variant="primary" disabled={saving}>
                            {saving ? 'Guardando...' : editingUnit ? 'Guardar cambios' : 'Crear unidad'}
                        </Button>
                    </div>
                </form>
            </Sidebar>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
}

