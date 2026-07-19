import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Armchair, CopyPlus, LayoutDashboard, Lock, Maximize2, Plus, RotateCw, Save, Shapes, Trash2, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import type { SingleValue } from 'react-select';
import type { FloorArea, FloorAreaKind, FloorAreaShape, Table, TableFloorPlan } from '../types';
import Select from './Select';
import { getChairPlacements } from './tableChairLayout';
import './TableMap.css';

interface PositionedTable extends Table {
    mapX: number;
    mapY: number;
    mapWidth: number;
    mapHeight: number;
    mapRotation: number;
    mapVersion: number;
    mapShape: 'RECTANGLE' | 'SQUARE' | 'ROUND';
    floorAreaClientKey?: string | null;
}

interface EditableArea extends Omit<FloorArea, 'id'> {
    id?: number;
    clientKey: string;
}

interface FloorPlanDraft {
    expectedVersion: number;
    canvasWidth: number;
    canvasHeight: number;
    areas: EditableArea[];
    tables: PositionedTable[];
    deletedAreaIds: number[];
}

interface TableMapProps {
    plan: TableFloorPlan;
    statusFilter?: string | null;
    onStatusFilterChange: (status: string | null) => void;
    canEdit: boolean;
    saving: boolean;
    onSelect: (table: Table) => void;
    onSave: (draft: FloorPlanDraft) => Promise<void>;
    onCreateTable?: () => void;
    onReturnToAdministration?: () => void;
    branchControl?: ReactNode;
    themeControl?: ReactNode;
}

type Selection = { kind: 'table'; key: number } | { kind: 'area'; key: string };
type Interaction = {
    selection: Selection;
    pointerId: number;
    mode: 'MOVE' | 'RESIZE';
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
};

type CanvasResize = {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startHeight: number;
};

type SelectOption<T extends string = string> = { value: T; label: string };

const FALLBACK_COLUMNS = 5;
const FALLBACK_X_GAP = 165;
const FALLBACK_Y_GAP = 125;
const AREA_COLORS = ['#DFF4E8', '#E4EEFF', '#F8E8FF', '#FFF1D6', '#E4F5F7', '#FBE5E7'];
const STATUS_OPTIONS: SelectOption[] = [
    { value: '', label: 'Todas las mesas' },
    { value: 'AVAILABLE', label: 'Disponibles' },
    { value: 'OCCUPIED', label: 'Ocupadas' },
    { value: 'RESERVED', label: 'Reservadas' },
    { value: 'OUT_OF_SERVICE', label: 'Fuera de servicio' }
];
const AREA_KIND_OPTIONS: SelectOption<FloorAreaKind>[] = [
    { value: 'DINING', label: 'Salón' },
    { value: 'TERRACE', label: 'Terraza' },
    { value: 'BAR', label: 'Barra' },
    { value: 'PRIVATE', label: 'Privado' },
    { value: 'TAKEAWAY', label: 'Retiro' },
    { value: 'OTHER', label: 'Otro' }
];
const AREA_SHAPE_OPTIONS: SelectOption<FloorAreaShape>[] = [
    { value: 'RECTANGLE', label: 'Rectangular' },
    { value: 'ROUNDED', label: 'Esquinas suaves' },
    { value: 'OVAL', label: 'Ovalada' },
    { value: 'L_SHAPE', label: 'Forma L' }
];

function newArea(index: number): EditableArea {
    return {
        id: undefined,
        clientKey: `area-${Date.now()}-${index}`,
        floorPlanId: 0,
        branchId: 0,
        name: index === 0 ? 'Salón principal' : `Salón ${index + 1}`,
        kind: 'DINING',
        mapX: 30 + index * 32,
        mapY: 30 + index * 32,
        mapWidth: 760,
        mapHeight: 520,
        mapRotation: 0,
        mapShape: 'ROUNDED',
        color: AREA_COLORS[index % AREA_COLORS.length],
        mapVersion: 0
    };
}

function normalizeArea(area: FloorArea): EditableArea {
    return { ...area, clientKey: `area-id-${area.id}` };
}

function normalizeTable(table: Table, index: number, defaultArea?: EditableArea): PositionedTable {
    const isUnpositioned = (table.mapVersion ?? 0) === 0 && (table.mapX ?? 0) === 0 && (table.mapY ?? 0) === 0;
    return {
        ...table,
        mapX: isUnpositioned ? 76 + (index % FALLBACK_COLUMNS) * FALLBACK_X_GAP : (table.mapX ?? 0),
        mapY: isUnpositioned ? 110 + Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_Y_GAP : (table.mapY ?? 0),
        mapWidth: table.mapWidth ?? 120,
        mapHeight: table.mapHeight ?? 80,
        mapRotation: table.mapRotation ?? 0,
        mapVersion: table.mapVersion ?? 0,
        mapShape: table.mapShape ?? 'RECTANGLE',
        floorAreaClientKey: table.floorAreaId ? null : defaultArea?.clientKey ?? null
    };
}

const operationalLabel: Record<NonNullable<Table['operationalState']>, string> = {
    AVAILABLE: 'Disponible', RESERVED: 'Reservada', DISABLED: 'Inhabilitada', OPEN_ORDER: 'Orden abierta',
    WAITING_KITCHEN: 'Esperando cocina', PREPARING: 'En preparación', PARTIALLY_READY: 'Parcialmente lista',
    READY: 'Lista para entregar', INVOICED: 'Facturada', PARTIAL_PAYMENT: 'Pago parcial', PAID: 'Pagada', ATTENTION: 'Atención'
};

function resolveOperationalState(table: PositionedTable): NonNullable<Table['operationalState']> {
    if (table.operationalState) return table.operationalState;
    if (table.status === 'OUT_OF_SERVICE') return 'DISABLED';
    if (table.status === 'OCCUPIED') return 'ATTENTION';
    return table.status;
}

function areaKey(area: EditableArea): string { return area.id ? `id:${area.id}` : area.clientKey; }

export default function TableMap({
    plan,
    statusFilter,
    onStatusFilterChange,
    canEdit,
    saving,
    onSelect,
    onSave,
    onCreateTable,
    onReturnToAdministration,
    branchControl,
    themeControl
}: TableMapProps) {
    const createDraft = () => {
        const nextAreas = plan.areas.length ? plan.areas.map(normalizeArea) : [newArea(0)];
        return {
            areas: nextAreas,
            tables: plan.tables.map((table, index) => normalizeTable(table, index, nextAreas[0]))
        };
    };
    const initial = createDraft();
    const [areas, setAreas] = useState<EditableArea[]>(initial.areas);
    const [layout, setLayout] = useState<PositionedTable[]>(initial.tables);
    const [canvasWidth, setCanvasWidth] = useState(plan.canvasWidth);
    const [canvasHeight, setCanvasHeight] = useState(plan.canvasHeight);
    const [editing, setEditing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [dirty, setDirty] = useState(false);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [deletedAreaIds, setDeletedAreaIds] = useState<number[]>([]);
    const interactionRef = useRef<Interaction | null>(null);
    const canvasResizeRef = useRef<CanvasResize | null>(null);
    const dirtyRef = useRef(dirty);
    const editingRef = useRef(editing);
    dirtyRef.current = dirty;
    editingRef.current = editing;

    useEffect(() => {
        if (editingRef.current && dirtyRef.current) return;
        const nextAreas = plan.areas.length ? plan.areas.map(normalizeArea) : [newArea(0)];
        setAreas(nextAreas);
        setLayout(plan.tables.map((table, index) => normalizeTable(table, index, nextAreas[0])));
        setCanvasWidth(plan.canvasWidth);
        setCanvasHeight(plan.canvasHeight);
        setDeletedAreaIds([]);
        setSelection(null);
        setDirty(false);
    }, [plan]);

    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (!dirtyRef.current) return;
            event.preventDefault();
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, []);

    const selectedTable = selection?.kind === 'table' ? layout.find((table) => table.id === selection.key) : undefined;
    const selectedArea = selection?.kind === 'area' ? areas.find((area) => areaKey(area) === selection.key) : undefined;

    const beginInteraction = (event: React.PointerEvent<HTMLElement>, nextSelection: Selection, mode: 'MOVE' | 'RESIZE') => {
        if (!editing) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelection(nextSelection);
        const target = nextSelection.kind === 'table'
            ? layout.find((table) => table.id === nextSelection.key)
            : areas.find((area) => areaKey(area) === nextSelection.key);
        if (!target) return;
        interactionRef.current = {
            selection: nextSelection, pointerId: event.pointerId, mode,
            startClientX: event.clientX, startClientY: event.clientY,
            startX: target.mapX, startY: target.mapY, startWidth: target.mapWidth, startHeight: target.mapHeight
        };
    };

    const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
        const drag = interactionRef.current;
        if (!editing || !drag || drag.pointerId !== event.pointerId) return;
        const dx = Math.round((event.clientX - drag.startClientX) / zoom);
        const dy = Math.round((event.clientY - drag.startClientY) / zoom);
        const update = <T extends { mapX: number; mapY: number; mapWidth: number; mapHeight: number }>(item: T): T => {
            if (drag.mode === 'MOVE') return { ...item, mapX: Math.max(0, drag.startX + dx), mapY: Math.max(0, drag.startY + dy) };
            const min = drag.selection.kind === 'table' ? 56 : 160;
            return { ...item, mapWidth: Math.max(min, drag.startWidth + dx), mapHeight: Math.max(min, drag.startHeight + dy) };
        };
        if (drag.selection.kind === 'table') {
            setLayout((current) => current.map((table) => table.id === drag.selection.key ? update(table) : table));
        } else {
            setAreas((current) => current.map((area) => areaKey(area) === drag.selection.key ? update(area) : area));
        }
        setDirty(true);
    };

    const endInteraction = (event: React.PointerEvent<HTMLElement>) => {
        if (interactionRef.current?.pointerId === event.pointerId) interactionRef.current = null;
    };

    const beginCanvasResize = (event: React.PointerEvent<HTMLSpanElement>) => {
        if (!editing) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        canvasResizeRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWidth: canvasWidth,
            startHeight: canvasHeight
        };
        setSelection(null);
    };

    const resizeCanvas = (event: React.PointerEvent<HTMLSpanElement>) => {
        const resize = canvasResizeRef.current;
        if (!editing || !resize || resize.pointerId !== event.pointerId) return;
        const dx = Math.round((event.clientX - resize.startClientX) / zoom);
        const dy = Math.round((event.clientY - resize.startClientY) / zoom);
        setCanvasWidth(Math.min(10000, Math.max(640, resize.startWidth + dx)));
        setCanvasHeight(Math.min(10000, Math.max(480, resize.startHeight + dy)));
        setDirty(true);
    };

    const endCanvasResize = (event: React.PointerEvent<HTMLSpanElement>) => {
        if (canvasResizeRef.current?.pointerId === event.pointerId) canvasResizeRef.current = null;
    };

    const patchTable = (patch: Partial<PositionedTable>) => {
        if (!selectedTable) return;
        setLayout((current) => current.map((table) => table.id === selectedTable.id ? { ...table, ...patch } : table));
        setDirty(true);
    };

    const patchArea = (patch: Partial<EditableArea>) => {
        if (!selectedArea) return;
        setAreas((current) => current.map((area) => areaKey(area) === areaKey(selectedArea) ? { ...area, ...patch } : area));
        setDirty(true);
    };

    const addArea = () => {
        const area = newArea(areas.length);
        area.branchId = plan.branchId;
        setAreas((current) => [...current, area]);
        setSelection({ kind: 'area', key: area.clientKey });
        setDirty(true);
    };

    const removeSelectedArea = () => {
        if (!selectedArea || areas.length === 1) return;
        if (selectedArea.id) setDeletedAreaIds((current) => [...new Set([...current, selectedArea.id!])]);
        setAreas((current) => current.filter((area) => areaKey(area) !== areaKey(selectedArea)));
        setLayout((current) => current.map((table) => table.floorAreaId === selectedArea.id || table.floorAreaClientKey === selectedArea.clientKey
            ? { ...table, floorAreaId: null, floorAreaClientKey: null }
            : table));
        setSelection(null);
        setDirty(true);
    };

    const save = async () => {
        await onSave({ expectedVersion: plan.version, canvasWidth, canvasHeight, areas, tables: layout, deletedAreaIds });
        setDirty(false);
        setSelection(null);
        setEditing(false);
    };

    const toggleEditing = () => {
        if (editing && dirty && !window.confirm('Hay cambios sin guardar. ¿Deseas descartarlos?')) return;
        if (editing) {
            const nextAreas = plan.areas.length ? plan.areas.map(normalizeArea) : [newArea(0)];
            setAreas(nextAreas);
            setLayout(plan.tables.map((table, index) => normalizeTable(table, index, nextAreas[0])));
            setCanvasWidth(plan.canvasWidth);
            setCanvasHeight(plan.canvasHeight);
            setDeletedAreaIds([]);
            setDirty(false);
            setSelection(null);
        } else if (plan.areas.length === 0 || plan.tables.some((table) => (table.mapVersion ?? 0) === 0)) {
            setDirty(true);
        }
        setEditing((value) => !value);
    };

    const legendStates = useMemo(() => Array.from(new Set(layout.map(resolveOperationalState))), [layout]);

    return (
        <section className={`table-map-shell ${editing ? 'is-editing' : ''}`} aria-label="Mapa de mesas">
            <div className="table-map-toolbar">
                <div className="table-map-title-block">
                    <strong>{editing ? 'Gestión de mesas · Editor del plano' : 'Gestión de mesas · Mapa operativo'}</strong>
                    <span>{editing ? 'Selecciona un salón o mesa para cambiar tamaño, forma y rotación' : `${layout.length} ${layout.length === 1 ? 'mesa' : 'mesas'} · ${areas.length} ${areas.length === 1 ? 'salón' : 'salones'} · selecciona una mesa para operarla`}</span>
                </div>
                <div className="table-map-actions">
                    {!editing && <Select<SelectOption>
                        className="table-map-status-filter"
                        aria-label="Filtrar mesas por estado"
                        options={STATUS_OPTIONS}
                        value={STATUS_OPTIONS.find((option) => option.value === (statusFilter || '')) || STATUS_OPTIONS[0]}
                        onChange={(option: SingleValue<SelectOption>) => onStatusFilterChange(option?.value || null)}
                        isSearchable={false}
                    />}
                    {!editing && branchControl}
                    {!editing && themeControl}
                    {!editing && onCreateTable && <button type="button" className="primary" onClick={onCreateTable}><Plus size={18} /> Nueva mesa</button>}
                    {!editing && onReturnToAdministration && <button type="button" onClick={onReturnToAdministration}><LayoutDashboard size={18} /> Administración</button>}
                    {editing && (
                        <Select<SelectOption>
                            className="table-map-area-selector"
                            label="Editar salón"
                            options={areas.map((area) => ({ value: areaKey(area), label: area.name }))}
                            value={selectedArea ? { value: areaKey(selectedArea), label: selectedArea.name } : null}
                            onChange={(option: SingleValue<SelectOption>) => setSelection(option ? { kind: 'area', key: option.value } : null)}
                            isClearable
                            isSearchable={areas.length > 6}
                            placeholder="Seleccionar salón…"
                        />
                    )}
                    <span className="table-map-action-divider" aria-hidden="true" />
                    <button type="button" onClick={() => setZoom((value) => Math.max(0.45, value - 0.1))} aria-label="Alejar plano"><ZoomOut size={18} /></button>
                    <output aria-label="Nivel de zoom">{Math.round(zoom * 100)}%</output>
                    <button type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} aria-label="Acercar plano"><ZoomIn size={18} /></button>
                    {editing && <button type="button" onClick={addArea}><CopyPlus size={18} /> Agregar salón</button>}
                    {canEdit && <button type="button" className={editing ? 'active' : ''} onClick={toggleEditing}>{editing ? <Unlock size={18} /> : <Lock size={18} />}{editing ? 'Salir' : 'Editar plano'}</button>}
                    {editing && <button type="button" className="primary" disabled={saving || !dirty} onClick={() => void save()}><Save size={18} /> {saving ? 'Guardando…' : 'Guardar plano'}</button>}
                </div>
            </div>

            <div className="table-map-workspace">
                <div className="table-map-viewport">
                    <div className="table-map-canvas" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
                        <div className="table-map-scale" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }} onClick={() => editing && setSelection(null)}>
                            <div className="table-map-floor-outline" aria-hidden="true" />
                            {areas.map((area) => {
                                const key = areaKey(area);
                                const selected = selection?.kind === 'area' && selection.key === key;
                                return (
                                    <div key={key} className={`table-floor-area shape-${area.mapShape.toLowerCase()} ${selected ? 'selected' : ''}`}
                                        style={{ left: area.mapX, top: area.mapY, width: area.mapWidth, height: area.mapHeight, transform: `rotate(${area.mapRotation}deg)`, '--area-color': area.color || '#E4EEFF' } as React.CSSProperties}
                                        role={editing ? 'button' : undefined}
                                        tabIndex={editing ? 0 : -1}
                                        aria-label={editing ? `Editar salón ${area.name}` : undefined}
                                        onPointerDown={(event) => beginInteraction(event, { kind: 'area', key }, 'MOVE')}
                                        onClick={(event) => { event.stopPropagation(); if (editing) setSelection({ kind: 'area', key }); }}
                                        onKeyDown={(event) => {
                                            if (!editing || (event.key !== 'Enter' && event.key !== ' ')) return;
                                            event.preventDefault();
                                            setSelection({ kind: 'area', key });
                                        }}
                                        onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction}>
                                        <div className="table-floor-area-label"><span>{area.name}</span><small>{area.kind === 'TERRACE' ? 'Terraza' : area.kind === 'BAR' ? 'Barra' : area.kind === 'PRIVATE' ? 'Privado' : 'Salón'}</small></div>
                                        {editing && <span className="map-resize-handle" role="button" aria-label={`Redimensionar ${area.name}`} onPointerDown={(event) => beginInteraction(event, { kind: 'area', key }, 'RESIZE')} />}
                                    </div>
                                );
                            })}
                            {layout.map((table) => {
                                const state = resolveOperationalState(table);
                                const filteredOut = Boolean(!editing && statusFilter && table.status !== statusFilter);
                                const selected = selection?.kind === 'table' && selection.key === table.id;
                                const chairs = getChairPlacements(table);
                                return (
                                    <button key={table.id} type="button"
                                        className={`map-table state-${state.toLowerCase()} shape-${table.mapShape.toLowerCase()} ${selected ? 'selected' : ''} ${filteredOut ? 'filtered-out' : ''}`}
                                        style={{ left: table.mapX, top: table.mapY, width: table.mapWidth, height: table.mapHeight, transform: `rotate(${table.mapRotation}deg)` }}
                                        aria-label={`Mesa ${table.number}, ${operationalLabel[state]}, ${table.capacity} ${table.capacity === 1 ? 'silla' : 'sillas'}, capacidad para ${table.capacity} ${table.capacity === 1 ? 'comensal' : 'comensales'}`}
                                        data-chair-count={chairs.length}
                                        aria-hidden={filteredOut}
                                        disabled={!editing && (state === 'DISABLED' || filteredOut)}
                                        onClick={(event) => { event.stopPropagation(); if (!editing && !filteredOut) onSelect(table); else if (editing) setSelection({ kind: 'table', key: table.id }); }}
                                        onPointerDown={(event) => beginInteraction(event, { kind: 'table', key: table.id }, 'MOVE')}
                                        onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction}>
                                        <span className="map-table-chairs" aria-hidden="true">
                                            {chairs.map((chair, index) => (
                                                <span key={`${chair.side}-${index}`} className={`map-table-chair side-${chair.side}`}
                                                    style={(chair.side === 'top' || chair.side === 'bottom') ? { left: `${chair.offset}%` } : { top: `${chair.offset}%` }} />
                                            ))}
                                        </span>
                                        <span className="map-table-surface">
                                            <span className="map-table-state-dot" aria-hidden="true" />
                                            <span className="map-table-number">{table.number}</span>
                                            <span className="map-table-status">{operationalLabel[state]}</span>
                                            <span className="map-table-capacity">{table.capacity} {table.capacity === 1 ? 'silla' : 'sillas'}</span>
                                        </span>
                                        {editing && <span className="map-resize-handle" role="button" aria-label={`Redimensionar mesa ${table.number}`} onPointerDown={(event) => beginInteraction(event, { kind: 'table', key: table.id }, 'RESIZE')} />}
                                    </button>
                                );
                            })}
                            {editing && <span
                                className="canvas-resize-handle"
                                role="button"
                                tabIndex={0}
                                aria-label="Redimensionar el lienzo del plano"
                                title="Arrastra para cambiar el tamaño del plano"
                                onPointerDown={beginCanvasResize}
                                onPointerMove={resizeCanvas}
                                onPointerUp={endCanvasResize}
                                onPointerCancel={endCanvasResize}
                            />}
                        </div>
                    </div>
                </div>

                {editing && (
                    <aside className="table-map-inspector" aria-label="Propiedades del plano">
                        {selectedTable ? (
                            <>
                                <div className="inspector-heading"><Armchair size={20} /><div><strong>Mesa {selectedTable.number}</strong><span>Forma y ubicación</span></div></div>
                                <div className="inspector-capacity-relation">
                                    <Armchair size={18} aria-hidden="true" />
                                    <div><strong>{selectedTable.capacity} {selectedTable.capacity === 1 ? 'silla' : 'sillas'} = {selectedTable.capacity} {selectedTable.capacity === 1 ? 'comensal' : 'comensales'}</strong><span>Relación automática según la capacidad de la mesa.</span></div>
                                </div>
                                <Select<SelectOption>
                                    label="Salón"
                                    options={[{ value: '', label: 'Sin asignar' }, ...areas.map((area) => ({ value: areaKey(area), label: area.name }))]}
                                    value={(() => {
                                        const value = selectedTable.floorAreaId ? `id:${selectedTable.floorAreaId}` : selectedTable.floorAreaClientKey || '';
                                        return { value, label: areas.find((area) => areaKey(area) === value)?.name || 'Sin asignar' };
                                    })()}
                                    onChange={(option: SingleValue<SelectOption>) => {
                                    const value = option?.value || '';
                                    const area = areas.find((item) => areaKey(item) === value);
                                    patchTable({ floorAreaId: area?.id ?? null, floorAreaClientKey: area?.id ? null : area?.clientKey ?? null });
                                }} isSearchable={areas.length > 6} />
                                <div className="inspector-shapes"><button type="button" className={selectedTable.mapShape === 'RECTANGLE' ? 'active' : ''} onClick={() => patchTable({ mapShape: 'RECTANGLE' })}>Rectangular</button><button type="button" className={selectedTable.mapShape === 'SQUARE' ? 'active' : ''} onClick={() => { const size = Math.max(selectedTable.mapWidth, selectedTable.mapHeight); patchTable({ mapShape: 'SQUARE', mapWidth: size, mapHeight: size }); }}>Cuadrada</button><button type="button" className={selectedTable.mapShape === 'ROUND' ? 'active' : ''} onClick={() => { const size = Math.max(selectedTable.mapWidth, selectedTable.mapHeight); patchTable({ mapShape: 'ROUND', mapWidth: size, mapHeight: size }); }}>Redonda</button></div>
                                <div className="inspector-grid"><label>Ancho<input type="number" min="56" max="400" value={selectedTable.mapWidth} onChange={(event) => patchTable({ mapWidth: Number(event.target.value) })} /></label><label>Alto<input type="number" min="56" max="400" value={selectedTable.mapHeight} onChange={(event) => patchTable({ mapHeight: Number(event.target.value) })} /></label></div>
                                <label><span className="label-with-icon"><RotateCw size={15} /> Rotación</span><input type="range" min="0" max="359" value={selectedTable.mapRotation} onChange={(event) => patchTable({ mapRotation: Number(event.target.value) })} /><output>{selectedTable.mapRotation}°</output></label>
                            </>
                        ) : selectedArea ? (
                            <>
                                <div className="inspector-heading"><Shapes size={20} /><div><strong>{selectedArea.name}</strong><span>Diseño del salón</span></div></div>
                                <label>Nombre<input value={selectedArea.name} maxLength={100} onChange={(event) => patchArea({ name: event.target.value })} /></label>
                                <Select<SelectOption<FloorAreaKind>> label="Tipo" options={AREA_KIND_OPTIONS} value={AREA_KIND_OPTIONS.find((option) => option.value === selectedArea.kind)} onChange={(option: SingleValue<SelectOption<FloorAreaKind>>) => option && patchArea({ kind: option.value })} isSearchable={false} />
                                <Select<SelectOption<FloorAreaShape>> label="Forma" options={AREA_SHAPE_OPTIONS} value={AREA_SHAPE_OPTIONS.find((option) => option.value === selectedArea.mapShape)} onChange={(option: SingleValue<SelectOption<FloorAreaShape>>) => option && patchArea({ mapShape: option.value })} isSearchable={false} />
                                <label>Color<input type="color" value={selectedArea.color || '#E4EEFF'} onChange={(event) => patchArea({ color: event.target.value })} /></label>
                                <div className="inspector-grid"><label>Ancho<input type="number" min="160" max="10000" value={selectedArea.mapWidth} onChange={(event) => patchArea({ mapWidth: Number(event.target.value) })} /></label><label>Alto<input type="number" min="140" max="10000" value={selectedArea.mapHeight} onChange={(event) => patchArea({ mapHeight: Number(event.target.value) })} /></label></div>
                                <label><span className="label-with-icon"><RotateCw size={15} /> Rotación</span><input type="range" min="0" max="359" value={selectedArea.mapRotation} onChange={(event) => patchArea({ mapRotation: Number(event.target.value) })} /><output>{selectedArea.mapRotation}°</output></label>
                                <button type="button" className="inspector-danger" disabled={areas.length === 1} onClick={removeSelectedArea}><Trash2 size={16} /> Eliminar salón</button>
                            </>
                        ) : (
                            <>
                                <div className="inspector-heading"><Maximize2 size={20} /><div><strong>Plano general</strong><span>Selecciona una mesa o salón</span></div></div>
                                <div className="inspector-grid"><label>Ancho<input type="number" min="640" max="10000" value={canvasWidth} onChange={(event) => { setCanvasWidth(Number(event.target.value)); setDirty(true); }} /></label><label>Alto<input type="number" min="480" max="10000" value={canvasHeight} onChange={(event) => { setCanvasHeight(Number(event.target.value)); setDirty(true); }} /></label></div>
                                <div className="inspector-help">Arrastra los elementos para moverlos. Usa el control de la esquina inferior derecha para cambiar su tamaño.</div>
                            </>
                        )}
                    </aside>
                )}
            </div>

            {!editing && <div className="table-map-legend" aria-label="Leyenda de estados">{legendStates.map((state) => <span key={state}><i className={`state-${state.toLowerCase()}`} />{operationalLabel[state]}</span>)}</div>}
        </section>
    );
}

export type { EditableArea, FloorPlanDraft, PositionedTable };
