import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Save, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import type { Table } from '../types';
import './TableMap.css';

interface PositionedTable extends Table {
    mapX: number;
    mapY: number;
    mapWidth: number;
    mapHeight: number;
    mapRotation: number;
    mapVersion: number;
    mapShape: 'RECTANGLE' | 'SQUARE' | 'ROUND';
}

interface TableMapProps {
    tables: Table[];
    canEdit: boolean;
    saving: boolean;
    onSelect: (table: Table) => void;
    onSave: (tables: PositionedTable[]) => Promise<void>;
}

interface DragState {
    id: number;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
}

const FALLBACK_COLUMNS = 5;
const FALLBACK_X_GAP = 160;
const FALLBACK_Y_GAP = 125;

function normalize(table: Table, index: number): PositionedTable {
    const isUnpositioned = (table.mapVersion ?? 0) === 0 && (table.mapX ?? 0) === 0 && (table.mapY ?? 0) === 0;
    return {
        ...table,
        mapX: isUnpositioned ? 36 + (index % FALLBACK_COLUMNS) * FALLBACK_X_GAP : (table.mapX ?? 0),
        mapY: isUnpositioned ? 36 + Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_Y_GAP : (table.mapY ?? 0),
        mapWidth: table.mapWidth ?? 120,
        mapHeight: table.mapHeight ?? 80,
        mapRotation: table.mapRotation ?? 0,
        mapVersion: table.mapVersion ?? 0,
        mapShape: table.mapShape ?? 'RECTANGLE'
    };
}

function overlaps(left: PositionedTable, right: PositionedTable): boolean {
    return left.mapX < right.mapX + right.mapWidth
        && left.mapX + left.mapWidth > right.mapX
        && left.mapY < right.mapY + right.mapHeight
        && left.mapY + left.mapHeight > right.mapY;
}

const operationalLabel: Record<NonNullable<Table['operationalState']>, string> = {
    AVAILABLE: 'Disponible',
    RESERVED: 'Reservada',
    DISABLED: 'Inhabilitada',
    OPEN_ORDER: 'Orden abierta',
    WAITING_KITCHEN: 'Esperando cocina',
    PREPARING: 'En preparación',
    PARTIALLY_READY: 'Parcialmente lista',
    READY: 'Lista para entregar',
    INVOICED: 'Facturada, pendiente de pago',
    PARTIAL_PAYMENT: 'Pago parcial',
    PAID: 'Pagada',
    ATTENTION: 'Requiere atención'
};

function resolveOperationalState(table: PositionedTable): NonNullable<Table['operationalState']> {
    if (table.operationalState) return table.operationalState;
    if (table.status === 'OUT_OF_SERVICE') return 'DISABLED';
    if (table.status === 'OCCUPIED') return 'ATTENTION';
    return table.status;
}

export default function TableMap({ tables, canEdit, saving, onSelect, onSave }: TableMapProps) {
    const [layout, setLayout] = useState<PositionedTable[]>(() => tables.map(normalize));
    const [editing, setEditing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [dirtyIds, setDirtyIds] = useState<Set<number>>(new Set());
    const dragRef = useRef<DragState | null>(null);
    const editingRef = useRef(editing);
    const dirtyIdsRef = useRef(dirtyIds);
    editingRef.current = editing;
    dirtyIdsRef.current = dirtyIds;

    useEffect(() => {
        setLayout((current) => {
            const currentById = new Map(current.map((table) => [table.id, table]));
            return tables.map((table, index) => {
                const normalized = normalize(table, index);
                const local = currentById.get(table.id);
                if (!editingRef.current || !dirtyIdsRef.current.has(table.id) || !local) return normalized;
                return {
                    ...normalized,
                    mapX: local.mapX,
                    mapY: local.mapY,
                    mapWidth: local.mapWidth,
                    mapHeight: local.mapHeight,
                    mapRotation: local.mapRotation,
                    mapShape: local.mapShape
                };
            });
        });
        if (!editingRef.current) setDirtyIds(new Set());
    }, [tables]);

    const collisions = useMemo(() => {
        const result = new Set<number>();
        layout.forEach((table, index) => {
            layout.slice(index + 1).forEach((other) => {
                if (overlaps(table, other)) {
                    result.add(table.id);
                    result.add(other.id);
                }
            });
        });
        return result;
    }, [layout]);

    const bounds = useMemo(() => ({
        width: Math.max(960, ...layout.map((table) => table.mapX + table.mapWidth + 80)),
        height: Math.max(600, ...layout.map((table) => table.mapY + table.mapHeight + 80))
    }), [layout]);

    const beginDrag = (event: React.PointerEvent<HTMLButtonElement>, table: PositionedTable) => {
        if (!editing) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
            id: table.id,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: table.mapX,
            startY: table.mapY
        };
    };

    const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!editing || !drag || drag.pointerId !== event.pointerId) return;
        const x = Math.max(0, Math.round(drag.startX + (event.clientX - drag.startClientX) / zoom));
        const y = Math.max(0, Math.round(drag.startY + (event.clientY - drag.startClientY) / zoom));
        setLayout((current) => current.map((table) => table.id === drag.id ? { ...table, mapX: x, mapY: y } : table));
        setDirtyIds((current) => new Set(current).add(drag.id));
    };

    const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };

    const save = async () => {
        if (dirtyIds.size === 0) return;
        await onSave(layout.filter((table) => dirtyIds.has(table.id)));
        setDirtyIds(new Set());
    };

    const toggleEditing = () => {
        if (editing) {
            setLayout(tables.map(normalize));
            setDirtyIds(new Set());
        }
        setEditing((value) => !value);
    };

    return (
        <section className="table-map-shell" aria-label="Mapa de mesas">
            <div className="table-map-toolbar">
                <div>
                    <strong>Plano operativo</strong>
                    <span>{editing ? 'Arrastra las mesas y guarda los cambios' : 'Selecciona una mesa para ver sus órdenes'}</span>
                </div>
                <div className="table-map-actions">
                    <button type="button" onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))} aria-label="Alejar plano">
                        <ZoomOut size={18} />
                    </button>
                    <output aria-label="Nivel de zoom">{Math.round(zoom * 100)}%</output>
                    <button type="button" onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))} aria-label="Acercar plano">
                        <ZoomIn size={18} />
                    </button>
                    {canEdit && (
                        <button type="button" className={editing ? 'active' : ''} onClick={toggleEditing}>
                            {editing ? <Unlock size={18} /> : <Lock size={18} />}
                            {editing ? 'Salir sin guardar' : 'Editar plano'}
                        </button>
                    )}
                    {editing && (
                        <button type="button" className="primary" disabled={saving || dirtyIds.size === 0 || collisions.size > 0} onClick={save}>
                            <Save size={18} /> {saving ? 'Guardando…' : 'Guardar'}
                        </button>
                    )}
                </div>
            </div>

            {collisions.size > 0 && editing && (
                <div className="table-map-warning" role="alert">
                    Se detectaron mesas superpuestas. Sepáralas antes de guardar.
                </div>
            )}

            <div className="table-map-viewport">
                <div
                    className={`table-map-canvas ${editing ? 'editing' : ''}`}
                    style={{ width: bounds.width * zoom, height: bounds.height * zoom }}
                >
                    <div style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
                        {layout.map((table) => {
                            const state = resolveOperationalState(table);
                            return (
                            <button
                                key={table.id}
                                type="button"
                                className={`map-table state-${state.toLowerCase()} shape-${table.mapShape.toLowerCase()} ${collisions.has(table.id) ? 'collision' : ''}`}
                                style={{
                                    left: table.mapX,
                                    top: table.mapY,
                                    width: table.mapWidth,
                                    height: table.mapHeight,
                                    transform: `rotate(${table.mapRotation}deg)`
                                }}
                                aria-label={`Mesa ${table.number}, ${operationalLabel[state]}, capacidad ${table.capacity}`}
                                onClick={() => { if (!editing) onSelect(table); }}
                                onPointerDown={(event) => beginDrag(event, table)}
                                onPointerMove={moveDrag}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                            >
                                <span className="map-table-number">{table.number}</span>
                                <span className="map-table-status">{operationalLabel[state]}</span>
                                <span className="map-table-capacity">{table.capacity} personas</span>
                            </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="table-map-legend" aria-label="Leyenda de estados">
                {Array.from(new Set(layout.map(resolveOperationalState))).map((state) => (
                    <span key={state}><i className={`state-${state.toLowerCase()}`} />{operationalLabel[state]}</span>
                ))}
            </div>
        </section>
    );
}

export type { PositionedTable };
