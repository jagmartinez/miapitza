import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Armchair, ArrowRightLeft, CopyPlus, List, Lock, Maximize2, Merge, Plus, RotateCw, Save, Shapes, Trash2, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import type { FloorArea, FloorAreaKind, FloorAreaShape, Table, TableFloorPlan } from '../types';
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
    onShowList: () => void;
    onTransfer?: () => void;
    onConsolidate?: () => void;
    onCreateTable?: () => void;
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

const FALLBACK_COLUMNS = 5;
const FALLBACK_X_GAP = 165;
const FALLBACK_Y_GAP = 125;
const AREA_COLORS = ['#DFF4E8', '#E4EEFF', '#F8E8FF', '#FFF1D6', '#E4F5F7', '#FBE5E7'];

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
    onShowList,
    onTransfer,
    onConsolidate,
    onCreateTable,
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
                    <span>{editing ? 'Selecciona un salón o mesa para cambiar tamaño, forma y rotación' : `${layout.length} mesas · ${areas.length} salones · selecciona una mesa para operarla`}</span>
                </div>
                <div className="table-map-actions">
                    {!editing && (
                        <label className="table-map-status-filter">
                            <span>Estado</span>
                            <select value={statusFilter || ''} onChange={(event) => onStatusFilterChange(event.target.value || null)}>
                                <option value="">Todas las mesas</option>
                                <option value="AVAILABLE">Disponibles</option>
                                <option value="OCCUPIED">Ocupadas</option>
                                <option value="RESERVED">Reservadas</option>
                                <option value="OUT_OF_SERVICE">Fuera de servicio</option>
                            </select>
                        </label>
                    )}
                    {!editing && branchControl}
                    {!editing && themeControl}
                    {!editing && <button type="button" onClick={onShowList}><List size={18} /> Lista</button>}
                    {!editing && onTransfer && <button type="button" onClick={onTransfer}><ArrowRightLeft size={18} /> Cambiar mesa</button>}
                    {!editing && onConsolidate && <button type="button" onClick={onConsolidate}><Merge size={18} /> Consolidar</button>}
                    {!editing && onCreateTable && <button type="button" className="primary" onClick={onCreateTable}><Plus size={18} /> Nueva mesa</button>}
                    {editing && (
                        <label className="table-map-area-selector">
                            <span>Editar salón</span>
                            <select
                                value={selectedArea ? areaKey(selectedArea) : ''}
                                onChange={(event) => setSelection(event.target.value ? { kind: 'area', key: event.target.value } : null)}
                            >
                                <option value="">Seleccionar salón…</option>
                                {areas.map((area) => <option key={areaKey(area)} value={areaKey(area)}>{area.name}</option>)}
                            </select>
                        </label>
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
                                return (
                                    <button key={table.id} type="button"
                                        className={`map-table state-${state.toLowerCase()} shape-${table.mapShape.toLowerCase()} ${selected ? 'selected' : ''} ${filteredOut ? 'filtered-out' : ''}`}
                                        style={{ left: table.mapX, top: table.mapY, width: table.mapWidth, height: table.mapHeight, transform: `rotate(${table.mapRotation}deg)` }}
                                        aria-label={`Mesa ${table.number}, ${operationalLabel[state]}, capacidad ${table.capacity}`}
                                        aria-hidden={filteredOut}
                                        disabled={!editing && (state === 'DISABLED' || filteredOut)}
                                        onClick={(event) => { event.stopPropagation(); if (!editing && !filteredOut) onSelect(table); else if (editing) setSelection({ kind: 'table', key: table.id }); }}
                                        onPointerDown={(event) => beginInteraction(event, { kind: 'table', key: table.id }, 'MOVE')}
                                        onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction}>
                                        <Armchair size={16} aria-hidden="true" />
                                        <span className="map-table-number">{table.number}</span>
                                        <span className="map-table-status">{operationalLabel[state]}</span>
                                        <span className="map-table-capacity">{table.capacity} personas</span>
                                        {editing && <span className="map-resize-handle" role="button" aria-label={`Redimensionar mesa ${table.number}`} onPointerDown={(event) => beginInteraction(event, { kind: 'table', key: table.id }, 'RESIZE')} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {editing && (
                    <aside className="table-map-inspector" aria-label="Propiedades del plano">
                        {selectedTable ? (
                            <>
                                <div className="inspector-heading"><Armchair size={20} /><div><strong>Mesa {selectedTable.number}</strong><span>Forma y ubicación</span></div></div>
                                <label>Salón<select value={selectedTable.floorAreaId ? `id:${selectedTable.floorAreaId}` : selectedTable.floorAreaClientKey || ''} onChange={(event) => {
                                    const value = event.target.value;
                                    const area = areas.find((item) => areaKey(item) === value);
                                    patchTable({ floorAreaId: area?.id ?? null, floorAreaClientKey: area?.id ? null : area?.clientKey ?? null });
                                }}><option value="">Sin asignar</option>{areas.map((area) => <option key={areaKey(area)} value={areaKey(area)}>{area.name}</option>)}</select></label>
                                <div className="inspector-shapes"><button type="button" className={selectedTable.mapShape === 'RECTANGLE' ? 'active' : ''} onClick={() => patchTable({ mapShape: 'RECTANGLE' })}>Rectangular</button><button type="button" className={selectedTable.mapShape === 'SQUARE' ? 'active' : ''} onClick={() => { const size = Math.max(selectedTable.mapWidth, selectedTable.mapHeight); patchTable({ mapShape: 'SQUARE', mapWidth: size, mapHeight: size }); }}>Cuadrada</button><button type="button" className={selectedTable.mapShape === 'ROUND' ? 'active' : ''} onClick={() => { const size = Math.max(selectedTable.mapWidth, selectedTable.mapHeight); patchTable({ mapShape: 'ROUND', mapWidth: size, mapHeight: size }); }}>Redonda</button></div>
                                <div className="inspector-grid"><label>Ancho<input type="number" min="56" max="400" value={selectedTable.mapWidth} onChange={(event) => patchTable({ mapWidth: Number(event.target.value) })} /></label><label>Alto<input type="number" min="56" max="400" value={selectedTable.mapHeight} onChange={(event) => patchTable({ mapHeight: Number(event.target.value) })} /></label></div>
                                <label><span className="label-with-icon"><RotateCw size={15} /> Rotación</span><input type="range" min="0" max="359" value={selectedTable.mapRotation} onChange={(event) => patchTable({ mapRotation: Number(event.target.value) })} /><output>{selectedTable.mapRotation}°</output></label>
                            </>
                        ) : selectedArea ? (
                            <>
                                <div className="inspector-heading"><Shapes size={20} /><div><strong>{selectedArea.name}</strong><span>Diseño del salón</span></div></div>
                                <label>Nombre<input value={selectedArea.name} maxLength={100} onChange={(event) => patchArea({ name: event.target.value })} /></label>
                                <label>Tipo<select value={selectedArea.kind} onChange={(event) => patchArea({ kind: event.target.value as FloorAreaKind })}><option value="DINING">Salón</option><option value="TERRACE">Terraza</option><option value="BAR">Barra</option><option value="PRIVATE">Privado</option><option value="TAKEAWAY">Retiro</option><option value="OTHER">Otro</option></select></label>
                                <label>Forma<select value={selectedArea.mapShape} onChange={(event) => patchArea({ mapShape: event.target.value as FloorAreaShape })}><option value="RECTANGLE">Rectangular</option><option value="ROUNDED">Esquinas suaves</option><option value="OVAL">Ovalada</option><option value="L_SHAPE">Forma L</option></select></label>
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
