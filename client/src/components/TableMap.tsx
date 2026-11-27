import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Armchair, CopyPlus, LayoutDashboard, Link2, Lock, Maximize2, Plus, RotateCw, Save, Shapes, Trash2, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import type { FloorArea, FloorAreaKind, FloorAreaShape, Table, TableFloorPlan } from '../types';
import { AppSelect, Button, Field, IconButton, Input, SegmentedControl, formatMoney, formatNumber } from '@/ui';
import { getChairPlacements } from './tableChairLayout';
import { resolveTablePresentationState, type TablePresentationState } from '../utils/tablePresentation';
import './TableMap.css';
import styles from './TableMap.module.css';

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
    /** Indicadores del salón (tarjetas KPI); se despliegan desde el botón Indicadores. */
    insights?: ReactNode;
    /** Minutos abiertos y consumo por mesa; amount null = N/D. Si se omite, no se muestra. */
    tableMeta?: Map<number, { minutes: number; amount: number | null }>;
    /** Las órdenes no se pudieron cargar: minutos y consumo se muestran como N/D. */
    tableMetaUnavailable?: boolean;
    currencySymbol?: string;
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

type TableGroupConnectionLine = {
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};

type TableGroupConnection = {
    key: string;
    count: number;
    hub: { x: number; y: number } | null;
    lines: TableGroupConnectionLine[];
};

type SelectOption<T extends string = string> = { value: T; label: string };

const FALLBACK_COLUMNS = 5;
const FALLBACK_X_GAP = 165;
const FALLBACK_Y_GAP = 125;
// Paleta con la que se crean los salones: se guarda como dato del plano (el usuario lo edita); sin color guardado se usa el token del tema.
const AREA_COLORS = ['#DFF4E8', '#E4EEFF', '#F8E8FF', '#FFF1D6', '#E4F5F7', '#FBE5E7'];
const STATUS_OPTIONS: SelectOption<TablePresentationState | ''>[] = [
    { value: '', label: 'Todas las mesas' },
    { value: 'AVAILABLE', label: 'Disponibles' },
    { value: 'OCCUPIED', label: 'Ocupadas' },
    { value: 'PENDING_PAYMENT', label: 'Pendientes de pago' }
];
const PRESENTATION_STATES: Array<{ value: TablePresentationState; label: string }> = [
    { value: 'AVAILABLE', label: 'Mesa disponible' },
    { value: 'OCCUPIED', label: 'Mesa ocupada' },
    { value: 'PENDING_PAYMENT', label: 'Mesa pendiente de pago' }
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

function areaKey(area: EditableArea): string { return area.id ? `id:${area.id}` : area.clientKey; }

export default function TableMap({
    plan,
    statusFilter,
    tableMeta,
    tableMetaUnavailable,
    currencySymbol = '',
    onStatusFilterChange,
    canEdit,
    saving,
    onSelect,
    onSave,
    onCreateTable,
    onReturnToAdministration,
    branchControl,
    themeControl,
    insights
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
    const [showInsights, setShowInsights] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [deletedAreaIds, setDeletedAreaIds] = useState<number[]>([]);
    const [focusedAreaKey, setFocusedAreaKey] = useState(() => initial.areas[0] ? areaKey(initial.areas[0]) : '');
    const viewportRef = useRef<HTMLDivElement>(null);
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

    const [zoneFilter, setZoneFilter] = useState<string>('ALL');
    const zoneOptions = useMemo(
        () => [{ value: 'ALL', label: 'Todas' }, ...areas.filter((a) => a.id).map((a) => ({ value: `id:${a.id}`, label: a.name }))],
        [areas],
    );
    const activeZone = zoneOptions.some((o) => o.value === zoneFilter) ? zoneFilter : 'ALL';

    const focusArea = useCallback((key: string) => {
        const area = areas.find((candidate) => areaKey(candidate) === key);
        const viewport = viewportRef.current;
        if (!area || !viewport) return;

        const availableWidth = Math.max(280, viewport.clientWidth - 24);
        // Keep table targets large enough for touch. Wide salons may require a
        // short horizontal pan, but never shrink a 120x80 table below an
        // approximately 78x52 px target.
        const nextZoom = Math.min(1.15, Math.max(0.65, availableWidth / (area.mapWidth + 36)));
        setFocusedAreaKey(key);
        setZoom(nextZoom);
        window.requestAnimationFrame(() => {
            viewport.scrollTo({
                left: Math.max(0, area.mapX * nextZoom - 12),
                top: Math.max(0, area.mapY * nextZoom - 12),
                behavior: 'smooth',
            });
        });
    }, [areas]);

    useEffect(() => {
        if (editing || !areas.length || !window.matchMedia('(max-width: 600px)').matches) return;
        const validKey = areas.some((area) => areaKey(area) === focusedAreaKey)
            ? focusedAreaKey
            : areaKey(areas[0]);
        const timer = window.setTimeout(() => focusArea(validKey), 0);
        return () => window.clearTimeout(timer);
    }, [areas, editing, focusArea, focusedAreaKey]);

    const activeGroupIds = useMemo(
        () => [...new Set(layout.map((table) => table.activeTableGroupId).filter((id): id is number => Boolean(id)))],
        [layout]
    );
    const groupConnections = useMemo<TableGroupConnection[]>(() => {
        return activeGroupIds.flatMap<TableGroupConnection>((groupId) => {
            const members = layout.filter((table) => table.activeTableGroupId === groupId);
            const primaryId = members[0]?.activeTableGroup?.primaryTableId;
            const primary = members.find((table) => table.id === primaryId);
            if (!primary || members.length < 2) return [];
            const primaryCenter = { x: primary.mapX + primary.mapWidth / 2, y: primary.mapY + primary.mapHeight / 2 };
            if (members.length === 2) {
                const other = members.find((table) => table.id !== primary.id)!;
                return [{
                    key: `group-${groupId}`,
                    count: 2,
                    hub: null,
                    lines: [{
                        key: `${groupId}-${other.id}`,
                        x1: primaryCenter.x,
                        y1: primaryCenter.y,
                        x2: other.mapX + other.mapWidth / 2,
                        y2: other.mapY + other.mapHeight / 2
                    }]
                }];
            }

            // Three or more tables use a fan-shaped hub above (or below) the
            // primary table. Every member gets its own arm, so the connector
            // cannot be mistaken for a chain that includes an unrelated table.
            const hubAbove = primary.mapY - 25;
            const hub = {
                x: primaryCenter.x,
                y: hubAbove >= 22 ? hubAbove : primary.mapY + primary.mapHeight + 25
            };
            return [{
                key: `group-${groupId}`,
                count: members.length,
                hub,
                lines: members.map((table) => ({
                    key: `${groupId}-${table.id}`,
                    x1: hub.x,
                    y1: hub.y,
                    x2: table.mapX + table.mapWidth / 2,
                    y2: table.mapY + table.mapHeight / 2
                }))
            }];
        });
    }, [activeGroupIds, layout]);
    const activePresentationFilter = STATUS_OPTIONS.some((option) => option.value === statusFilter)
        ? statusFilter
        : null;

    return (
        <section className={`table-map-shell ${editing ? 'is-editing' : ''}`} aria-label="Mapa de mesas">
            <div className="table-map-toolbar">
                <div className="table-map-title-block">
                    <strong>{editing ? 'Gestión de mesas · Editor del plano' : 'Gestión de mesas · Mapa operativo'}</strong>
                    <span>{editing ? 'Selecciona un salón o mesa para cambiar tamaño, forma y rotación' : `${layout.length} ${layout.length === 1 ? 'mesa' : 'mesas'} · ${areas.length} ${areas.length === 1 ? 'salón' : 'salones'} · selecciona una mesa para operarla`}</span>
                </div>
                <div className="table-map-actions">
                    {!editing && (
                        <div className="table-map-status-filter">
                            <AppSelect<string>
                                aria-label="Filtrar mesas por estado"
                                options={STATUS_OPTIONS}
                                value={activePresentationFilter || ''}
                                onChange={(value) => onStatusFilterChange(value || null)}
                                isClearable={false}
                            />
                        </div>
                    )}
                    {!editing && zoneOptions.length > 2 && (
                        <div className="table-map-zone-filter">
                            <SegmentedControl ariaLabel="Zona del salón" size="sm" options={zoneOptions} value={activeZone} onChange={setZoneFilter} />
                        </div>
                    )}
                    {!editing && branchControl}
                    {!editing && themeControl}
                    {!editing && insights && (
                        <Button variant={showInsights ? 'primary' : 'secondary'} icon={LayoutDashboard} className={styles.touch} aria-expanded={showInsights} aria-controls="table-map-insights" onClick={() => setShowInsights((value) => !value)}>
                            Indicadores
                        </Button>
                    )}
                    {!editing && onCreateTable && <Button variant="primary" icon={Plus} className={styles.touch} onClick={onCreateTable}>Nueva mesa</Button>}
                    {!editing && onReturnToAdministration && <Button variant="secondary" icon={LayoutDashboard} className={styles.touch} onClick={onReturnToAdministration}>Administración</Button>}
                    {editing && (
                        <div className="table-map-area-selector">
                            <AppSelect<string>
                                aria-label="Editar salón"
                                options={areas.map((area) => ({ value: areaKey(area), label: area.name }))}
                                value={selectedArea ? areaKey(selectedArea) : null}
                                onChange={(value) => setSelection(value ? { kind: 'area', key: value } : null)}
                                placeholder="Seleccionar salón…"
                            />
                        </div>
                    )}
                    <span className="table-map-action-divider table-map-zoom-only" aria-hidden="true" />
                    <div className="table-map-zoom-controls">
                        <IconButton icon={ZoomOut} label="Alejar plano" tooltip="Alejar" onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))} />
                        <output aria-label="Nivel de zoom">{formatNumber(zoom * 100, 0)}%</output>
                        <IconButton icon={ZoomIn} label="Acercar plano" tooltip="Acercar" onClick={() => setZoom((value) => Math.min(1.8, value + 0.1))} />
                    </div>
                    {editing && <Button variant="secondary" icon={CopyPlus} className={styles.touch} onClick={addArea}>Agregar salón</Button>}
                    {canEdit && <Button variant="secondary" icon={editing ? Unlock : Lock} className={styles.touch} onClick={toggleEditing}>{editing ? 'Salir' : 'Editar plano'}</Button>}
                    {editing && <Button variant="primary" icon={Save} className={styles.touch} loading={saving} disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar plano'}</Button>}
                </div>
            </div>

            {!editing && insights && showInsights && <div id="table-map-insights" className="table-map-insights">{insights}</div>}

            {!editing && areas.length > 0 && (
                <nav className="table-map-mobile-areas" aria-label="Enfocar salón">
                    {areas.map((area) => {
                        const key = areaKey(area);
                        return <Button key={key} size="sm" variant={focusedAreaKey === key ? 'primary' : 'secondary'} aria-pressed={focusedAreaKey === key} onClick={() => focusArea(key)}>{area.name}</Button>;
                    })}
                </nav>
            )}

            <div className="table-map-workspace">
                <div ref={viewportRef} className="table-map-viewport">
                    <div className="table-map-canvas" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
                        <div className="table-map-scale" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})` }} onClick={() => editing && setSelection(null)}>
                            <div className="table-map-floor-outline" aria-hidden="true" />
                            {areas.map((area) => {
                                const key = areaKey(area);
                                const selected = selection?.kind === 'area' && selection.key === key;
                                return (
                                    <div key={key} className={`table-floor-area shape-${area.mapShape.toLowerCase()} ${selected ? 'selected' : ''}`}
                                        style={{ left: area.mapX, top: area.mapY, width: area.mapWidth, height: area.mapHeight, transform: `rotate(${area.mapRotation}deg)`, ...(area.color ? { '--area-color': area.color } : {}) } as React.CSSProperties}
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
                            {!editing && groupConnections.length > 0 && (
                                <svg className="table-group-connections" width={canvasWidth} height={canvasHeight} aria-hidden="true">
                                    {groupConnections.map((group) => (
                                        <g key={group.key}>
                                            {group.lines.map((line) => <g key={line.key}>
                                                <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
                                                <circle className="table-group-endpoint" cx={line.x2} cy={line.y2} r="4" />
                                            </g>)}
                                            {group.hub && <>
                                                <circle className="table-group-hub" cx={group.hub.x} cy={group.hub.y} r="11" />
                                                <text className="table-group-hub-count" x={group.hub.x} y={group.hub.y}>{group.count}</text>
                                            </>}
                                        </g>
                                    ))}
                                </svg>
                            )}
                            {layout.map((table) => {
                                const presentationState = resolveTablePresentationState(table);
                                const presentationLabel = PRESENTATION_STATES.find(({ value }) => value === presentationState)!.label;
                                const operationalDisabled = table.operationalState === 'DISABLED' || table.status === 'OUT_OF_SERVICE';
                                const outOfZone = !editing && activeZone !== 'ALL' && `id:${table.floorAreaId ?? ''}` !== activeZone;
                                const filteredOut = Boolean(!editing && ((activePresentationFilter && presentationState !== activePresentationFilter) || outOfZone));
                                const meta = tableMeta?.get(table.id);
                                const isOpen = !editing && tableMeta !== undefined && (table.status === 'OCCUPIED' || meta !== undefined);
                                const selected = selection?.kind === 'table' && selection.key === table.id;
                                const chairs = getChairPlacements(table);
                                const group = table.activeTableGroup;
                                const isGroupPrimary = group?.primaryTableId === table.id;
                                const groupMembers = group ? layout.filter((candidate) => candidate.activeTableGroupId === group.id) : [];
                                const groupCapacity = groupMembers.reduce((sum, member) => sum + member.capacity, 0);
                                const orderedGroupMembers = group
                                    ? [...groupMembers].sort((left, right) => group.memberTableIds.indexOf(left.id) - group.memberTableIds.indexOf(right.id))
                                    : [];
                                const groupPosition = orderedGroupMembers.findIndex((member) => member.id === table.id) + 1;
                                const groupLabel = group
                                    ? (isGroupPrimary ? `Principal de ${groupMembers.length} mesas` : `Unida a mesa ${group.primaryTable.number}`)
                                    : '';
                                return (
                                    <button key={table.id} type="button"
                                        className={`map-table state-${presentationState.toLowerCase()} shape-${table.mapShape.toLowerCase()} ${group ? 'is-grouped' : ''} ${isGroupPrimary ? 'is-group-primary' : ''} ${selected ? 'selected' : ''} ${filteredOut ? 'filtered-out' : ''}`}
                                        style={{ left: table.mapX, top: table.mapY, width: table.mapWidth, height: table.mapHeight, transform: `rotate(${table.mapRotation}deg)` }}
                                        aria-label={`Mesa ${table.number}, ${presentationLabel}, ${table.capacity} ${table.capacity === 1 ? 'silla' : 'sillas'}, capacidad para ${table.capacity} ${table.capacity === 1 ? 'comensal' : 'comensales'}${group ? `, ${groupLabel}, ${groupCapacity} comensales en el grupo` : ''}`}
                                        data-chair-count={chairs.length}
                                        data-group-size={groupMembers.length || undefined}
                                        aria-hidden={filteredOut}
                                        disabled={!editing && (operationalDisabled || filteredOut)}
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
                                            {group && <span className="map-table-group-badge"><Link2 size={10} /> {isGroupPrimary ? `Grupo de ${groupMembers.length} mesas` : `Mesa ${groupPosition}/${groupMembers.length}`}</span>}
                                            <span className="map-table-number" title={table.number}>{table.number}</span>
                                            {/* El estado se lee por color, punto y leyenda; el texto queda para lectores de pantalla. */}
                                            <span className="map-table-status">{presentationLabel}</span>
                                            {isOpen ? (
                                                <span className="map-table-consumption">
                                                    {tableMetaUnavailable ? 'N/D' : (
                                                        <>
                                                            <span>{meta?.amount != null ? formatMoney(meta.amount, currencySymbol || 'C$') : 'N/D'}</span>
                                                            <span className="map-table-minutes">{meta ? `${formatNumber(meta.minutes, 0)} min` : 'N/D'}</span>
                                                        </>
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="map-table-capacity">{table.capacity} {table.capacity === 1 ? 'silla' : 'sillas'}</span>
                                            )}
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
                                <Field label="Salón" htmlFor="map-table-area">
                                    <AppSelect<string>
                                        inputId="map-table-area"
                                        options={[{ value: '', label: 'Sin asignar' }, ...areas.map((area) => ({ value: areaKey(area), label: area.name }))]}
                                        value={selectedTable.floorAreaId ? `id:${selectedTable.floorAreaId}` : selectedTable.floorAreaClientKey || ''}
                                        isClearable={false}
                                        onChange={(value) => {
                                            const area = areas.find((item) => areaKey(item) === (value || ''));
                                            patchTable({ floorAreaId: area?.id ?? null, floorAreaClientKey: area?.id ? null : area?.clientKey ?? null });
                                        }}
                                    />
                                </Field>
                                <SegmentedControl<'RECTANGLE' | 'SQUARE' | 'ROUND'>
                                    ariaLabel="Forma de la mesa"
                                    options={[{ value: 'RECTANGLE', label: 'Rectangular' }, { value: 'SQUARE', label: 'Cuadrada' }, { value: 'ROUND', label: 'Redonda' }]}
                                    value={selectedTable.mapShape}
                                    onChange={(shape) => {
                                        if (shape === 'RECTANGLE') { patchTable({ mapShape: shape }); return; }
                                        const size = Math.max(selectedTable.mapWidth, selectedTable.mapHeight);
                                        patchTable({ mapShape: shape, mapWidth: size, mapHeight: size });
                                    }}
                                />
                                <div className="inspector-grid"><Field label="Ancho" htmlFor="map-field-1"><Input id="map-field-1" type="number" min="56" max="400" value={selectedTable.mapWidth} onChange={(event) => patchTable({ mapWidth: Number(event.target.value) })} /></Field><Field label="Alto" htmlFor="map-field-2"><Input id="map-field-2" type="number" min="56" max="400" value={selectedTable.mapHeight} onChange={(event) => patchTable({ mapHeight: Number(event.target.value) })} /></Field></div>
                                <label><span className="label-with-icon"><RotateCw size={15} /> Rotación</span><input type="range" min="0" max="359" value={selectedTable.mapRotation} onChange={(event) => patchTable({ mapRotation: Number(event.target.value) })} /><output>{selectedTable.mapRotation}°</output></label>
                            </>
                        ) : selectedArea ? (
                            <>
                                <div className="inspector-heading"><Shapes size={20} /><div><strong>{selectedArea.name}</strong><span>Diseño del salón</span></div></div>
                                <Field label="Nombre" htmlFor="map-area-name"><Input id="map-area-name" value={selectedArea.name} maxLength={100} onChange={(event) => patchArea({ name: event.target.value })} /></Field>
                                <Field label="Tipo" htmlFor="map-area-kind">
                                    <AppSelect<FloorAreaKind>
                                        inputId="map-area-kind"
                                        options={AREA_KIND_OPTIONS}
                                        value={selectedArea.kind}
                                        isClearable={false}
                                        onChange={(value) => value && patchArea({ kind: value })}
                                    />
                                </Field>
                                <Field label="Forma" htmlFor="map-area-shape">
                                    <AppSelect<FloorAreaShape>
                                        inputId="map-area-shape"
                                        options={AREA_SHAPE_OPTIONS}
                                        value={selectedArea.mapShape}
                                        isClearable={false}
                                        onChange={(value) => value && patchArea({ mapShape: value })}
                                    />
                                </Field>
                                <label className="inspector-color" htmlFor="map-area-color">
                                    <span>Color</span>
                                    <input id="map-area-color" type="color" value={selectedArea.color || AREA_COLORS[1]} onChange={(event) => patchArea({ color: event.target.value })} />
                                </label>
                                <div className="inspector-grid"><Field label="Ancho" htmlFor="map-field-3"><Input id="map-field-3" type="number" min="160" max="10000" value={selectedArea.mapWidth} onChange={(event) => patchArea({ mapWidth: Number(event.target.value) })} /></Field><Field label="Alto" htmlFor="map-field-4"><Input id="map-field-4" type="number" min="140" max="10000" value={selectedArea.mapHeight} onChange={(event) => patchArea({ mapHeight: Number(event.target.value) })} /></Field></div>
                                <label><span className="label-with-icon"><RotateCw size={15} /> Rotación</span><input type="range" min="0" max="359" value={selectedArea.mapRotation} onChange={(event) => patchArea({ mapRotation: Number(event.target.value) })} /><output>{selectedArea.mapRotation}°</output></label>
                                <Button variant="danger" icon={Trash2} className={styles.touch} disabled={areas.length === 1} onClick={removeSelectedArea}>Eliminar salón</Button>
                            </>
                        ) : (
                            <>
                                <div className="inspector-heading"><Maximize2 size={20} /><div><strong>Plano general</strong><span>Selecciona una mesa o salón</span></div></div>
                                <div className="inspector-grid"><Field label="Ancho" htmlFor="map-field-5"><Input id="map-field-5" type="number" min="640" max="10000" value={canvasWidth} onChange={(event) => { setCanvasWidth(Number(event.target.value)); setDirty(true); }} /></Field><Field label="Alto" htmlFor="map-field-6"><Input id="map-field-6" type="number" min="480" max="10000" value={canvasHeight} onChange={(event) => { setCanvasHeight(Number(event.target.value)); setDirty(true); }} /></Field></div>
                                <div className="inspector-help">Arrastra los elementos para moverlos. Usa el control de la esquina inferior derecha para cambiar su tamaño.</div>
                            </>
                        )}
                    </aside>
                )}
            </div>

            {!editing && <div className="table-map-legend" aria-label="Leyenda de estados">{PRESENTATION_STATES.map((state) => <span key={state.value}><i className={`state-${state.value.toLowerCase()}`} />{state.label}</span>)}</div>}
        </section>
    );
}

export type { EditableArea, FloorPlanDraft, PositionedTable };
