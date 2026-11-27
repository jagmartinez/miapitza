import { useState, useEffect, useMemo, useCallback } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { useNavigate } from 'react-router-dom';
import { unitsAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { hasAnyRole } from '../utils/authz';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { Plus, Ruler, Pencil, Power, Weight, Beaker, Hash, Search, Package as PackageIcon } from 'lucide-react';
import type { UnitOfMeasure } from '../types';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, Switch, TableToolbar, Tabs, type Column, formatNumber} from '@/ui';

type MeasurementTypeOption = UnitOfMeasure['measurementType'];
type FilterOption = 'all' | 'active' | 'inactive';

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

/** Conversion factors below 1 (e.g. 0.001) keep up to 6 decimals so they do not collapse to 0.00. */
const formatFactor = (n: number) => formatNumber(n, Math.abs(n) > 0 && Math.abs(n) < 1 ? 6 : 2);

export default function UnitsOfMeasurePage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
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

    const [loadFailed, setLoadFailed] = useState(false);

    const loadUnits = useCallback(async () => {
        try {
            const res = await unitsAPI.getAll({ includeInactive: true });
            setUnits(res.data.data || []);
            setLoadFailed(false);
        } catch (error) {
            console.error('Error loading units:', error);
            setLoadFailed(true);
            showError(getApiErrorMessage(error, 'No se pudieron cargar las unidades de medida'));
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
        if (!(await confirm(`¿${nextActive ? 'Habilitar' : 'Inhabilitar'} la unidad "${unit.name}"?`, { title: 'Confirmar acción' }))) return;

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
        return `1 ${abbr} equivale a ${formatFactor(factor)} ${currentTypeMeta.baseLabel}`;
    }, [formData.systemFactor, formData.abbreviation, currentTypeMeta]);

    const columns: Column<UnitOfMeasure>[] = [
        {
            key: 'name',
            header: 'Unidad',
            render: (unit) => {
                const TypeIcon = MEASUREMENT_TYPE_META[unit.measurementType].icon;
                return (
                    <span className={styles.cellTitle}>
                        <TypeIcon size={16} aria-hidden="true" />
                        {unit.name}
                    </span>
                );
            }
        },
        { key: 'abbreviation', header: 'Abreviatura' },
        { key: 'type', header: 'Tipo', accessor: (unit) => MEASUREMENT_TYPE_META[unit.measurementType].title },
        {
            key: 'factor',
            header: 'Equivalencia',
            render: (unit) => `1 ${unit.abbreviation} = ${formatFactor(Number(unit.systemFactor))} ${MEASUREMENT_TYPE_META[unit.measurementType].baseLabel}`
        },
        {
            key: 'status',
            header: 'Estado',
            type: 'status',
            render: (unit) => <Badge tone={unit.active ? 'success' : 'neutral'} dot>{unit.active ? 'Activa' : 'Inactiva'}</Badge>
        },
        ...(canMutate ? [{
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (unit: UnitOfMeasure) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${unit.name}`} onClick={() => openModal(unit)} />
                    <IconButton
                        size="sm"
                        icon={Power}
                        tone={unit.active ? 'danger' : 'primary'}
                        tooltip={unit.active ? 'Desactivar' : 'Activar'}
                        label={`${unit.active ? 'Inhabilitar' : 'Habilitar'} ${unit.name}`}
                        onClick={() => handleToggleActive(unit)}
                    />
                </div>
            )
        }] : [])
    ] as Column<UnitOfMeasure>[];

    return (
        <PageContent>
            <PageHeader
                title="Unidades de medida"
                description="Catálogo de unidades y su equivalencia con la unidad del sistema."
                actions={canMutate ? (
                    <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                        Nueva unidad
                    </Button>
                ) : undefined}
            />

            <Tabs
                ariaLabel="Filtrar por estado"
                active={statusFilter}
                onChange={(id) => setStatusFilter(id as FilterOption)}
                tabs={FILTER_OPTIONS.map(({ value, label }) => ({
                    id: value,
                    label,
                    badge: loadFailed ? undefined : value === 'all' ? units.length : units.filter((unit) => (value === 'active' ? unit.active : !unit.active)).length,
                }))}
            />

            <TableToolbar actions={<Button onClick={() => navigate('/inventory')}>Ir a Inventario</Button>}>
                <Input
                    type="search"
                    aria-label="Buscar unidad"
                    placeholder="Buscar por nombre o abreviatura"
                    prefix={<Search size={14} aria-hidden="true" />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </TableToolbar>

            <DataTable<UnitOfMeasure>
                ariaLabel="Unidades de medida"
                rows={filteredUnits}
                rowKey={(u) => u.id}
                columns={columns}
                loading={loading}
                resetKey={`${searchQuery}|${statusFilter}`}
                onRowClick={canMutate ? (u) => openModal(u) : undefined}
                empty={units.length === 0 ? (
                    <EmptyState
                        icon={Ruler}
                        title="No hay unidades de medida en el catálogo"
                        description="Crea las unidades que usará tu empresa (gramos, libras, paquetes personalizados, etc.) antes de configurar productos."
                        action={canMutate ? <Button variant="primary" onClick={() => openModal()}>Crear primera unidad</Button> : undefined}
                    />
                ) : 'No hay unidades con este filtro.'}
            />

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingUnit ? 'Editar unidad' : 'Nueva unidad de medida'}
                breadcrumb={['Inventario', 'Unidades de medida']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="unit-form" variant="primary" loading={saving}>
                            {editingUnit ? 'Guardar cambios' : 'Crear unidad'}
                        </Button>
                    </>
                )}
            >
                <form id="unit-form" onSubmit={handleSubmit} className={styles.stack}>
                    <FormSection step={1} title="¿Qué tipo de medida es?" description="Define cómo se hacen las conversiones.">
                        <FormGrid>
                            <Field label="Tipo de medida" htmlFor="unit-type" required>
                                <AppSelect<MeasurementTypeOption>
                                    inputId="unit-type"
                                    isClearable={false}
                                    isSearchable={false}
                                    options={MEASUREMENT_TYPES.map((t) => ({
                                        value: t.value,
                                        label: t.title,
                                        description: `${t.description} Ej.: ${t.examples}`
                                    }))}
                                    value={formData.measurementType}
                                    onChange={(v) => v && handleTypeChange(v)}
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>

                    <FormSection step={2} title="Identifica la unidad" description="El nombre y la abreviatura se mostrarán al elegirla en productos y operaciones.">
                        <FormGrid>
                            <Field label="Nombre" htmlFor="unit-name" required>
                                <Input
                                    id="unit-name"
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
                            </Field>
                            <Field label="Abreviatura" htmlFor="unit-abbreviation" hint="Única en tu empresa. Es como un código corto." required>
                                <Input
                                    id="unit-abbreviation"
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
                            </Field>
                        </FormGrid>
                    </FormSection>

                    <FormSection step={3} title="Define la equivalencia" description={currentTypeMeta.factorHint}>
                        <FormGrid>
                            <Field
                                label={currentTypeMeta.factorLabel}
                                htmlFor="unit-factor"
                                required={currentTypeMeta.factorEditable}
                                hint={!currentTypeMeta.factorEditable
                                    ? 'Para paquetes el peso real se configura por producto desde Inventario → Conversiones.'
                                    : factorPreview ? `Vista previa: ${factorPreview}` : undefined}
                            >
                                <Input
                                    id="unit-factor"
                                    type="number"
                                    min="0.000001"
                                    step="0.000001"
                                    className="ui-input--number"
                                    prefix={`1 ${formData.abbreviation || 'unidad'} =`}
                                    suffix={currentTypeMeta.baseLabel}
                                    value={formData.systemFactor}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, systemFactor: e.target.value }))}
                                    placeholder={currentTypeMeta.factorPlaceholder}
                                    disabled={!currentTypeMeta.factorEditable}
                                    required={currentTypeMeta.factorEditable}
                                />
                            </Field>
                        </FormGrid>
                        {editingUnit && (
                            <Switch
                                id="unit-active"
                                checked={formData.active}
                                onChange={(active) => setFormData((prev) => ({ ...prev, active }))}
                                label="Unidad activa (disponible en productos y operaciones)"
                            />
                        )}
                    </FormSection>
                </form>
            </FullScreenModal>

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </PageContent>
    );
}
