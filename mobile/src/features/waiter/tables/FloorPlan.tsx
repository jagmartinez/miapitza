import { useMemo } from 'react';
import { TableTile } from './TableTile';
import { buildUnits, elapsedMinutes, formatElapsed, tableState, unitOrder, type ActiveOrder, type Plan, type PlanTable, type TableState } from './tableState';

export interface FloorPlanProps {
    plan: Plan;
    /** Area shown; null shows tables with no area. */
    areaId: number | null;
    orders: Map<number, ActiveOrder>;
    now: number;
    /** When set, only units whose order belongs to this user are drawn. */
    onlyUserId?: number | null;
    /** When set, only units in this state are drawn (the "Por cobrar" filter). */
    onlyState?: TableState | null;
    /** Picking mode: returns whether a table may be chosen as the destination. */
    canPick?: (table: PlanTable) => boolean;
    onTap: (table: PlanTable, order: ActiveOrder | undefined, state: TableState) => void;
    onLongPress: (table: PlanTable, order: ActiveOrder | undefined, state: TableState) => void;
}

export function tileLines(label: string, state: TableState, order: ActiveOrder | undefined, now: number): string[] {
    const waiter = order?.user?.name?.trim().split(/\s+/)[0] ?? ''; // first name only, as in the mockup
    if (state === 'free' || !order) return [label, 'Libre'];
    const mins = formatElapsed(elapsedMinutes(order.createdAt, now));
    const guests = order.guests ? String(order.guests) : '';
    // Mockup: "Listo" / "Por cobrar" stand alone (coloured); an ordinary table reads "4 · 38 min".
    const statusOnly = !order.pendingSync && (state === 'ready' || state === 'due');
    const second = statusOnly ? (state === 'ready' ? 'Listo' : 'Por cobrar') : [order.pendingSync ? 'Sin sincronizar' : guests, mins].filter(Boolean).join(' · ');
    const lines = [label, second];
    if (waiter) lines.push(waiter);
    return lines;
}

/** Read-only floor plan scaled to the available width (positions and sizes in canvas units, as percentages). */
export function FloorPlan({ plan, areaId, orders, now, onlyUserId, onlyState, canPick, onTap, onLongPress }: FloorPlanProps) {
    const units = useMemo(
        () => buildUnits(plan.tables.filter((t) => (t.floorAreaId ?? null) === areaId)),
        [plan.tables, areaId],
    );
    // Fit to the tables of this area (not the whole canvas): no empty bands around them.
    const box = useMemo(() => {
        if (units.length === 0) return { x: 0, y: 0, w: plan.canvasWidth, h: plan.canvasHeight };
        const PAD = 24;
        const x = Math.max(0, Math.min(...units.map((u) => u.x)) - PAD);
        const y = Math.max(0, Math.min(...units.map((u) => u.y)) - PAD);
        const x2 = Math.max(...units.map((u) => u.x + u.w)) + PAD;
        const y2 = Math.max(...units.map((u) => u.y + u.h)) + PAD;
        return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
    }, [units, plan.canvasWidth, plan.canvasHeight]);
    return (
        <div className="plan" style={{ ['--ar' as string]: box.w / box.h, aspectRatio: `${box.w} / ${box.h}` }} data-testid="floor-plan">
            {units.map((unit) => {
                const order = unitOrder(unit, orders);
                if (onlyUserId != null && order?.user?.id !== onlyUserId) return null;
                const { primary } = unit;
                const state = tableState(primary, order);
                if (onlyState != null && state !== onlyState) return null;
                const grouped = unit.tables.length > 1;
                const label = grouped ? unit.tables.map((t) => t.number).join(' + ') : primary.number;
                return (
                    <TableTile
                        key={unit.key}
                        id={primary.id}
                        label={label}
                        state={state}
                        grouped={grouped}
                        dimmed={canPick ? !canPick(primary) : false}
                        lines={tileLines(label, state, order, now)}
                        style={{
                            left: `${((unit.x - box.x) / box.w) * 100}%`,
                            top: `${((unit.y - box.y) / box.h) * 100}%`,
                            width: `${(unit.w / box.w) * 100}%`,
                            height: `${(unit.h / box.h) * 100}%`,
                            borderRadius: primary.mapShape === 'ROUND' ? '50%' : undefined,
                        }}
                        onTap={() => onTap(primary, order, state)}
                        onLongPress={canPick ? undefined : () => onLongPress(primary, order, state)}
                    />
                );
            })}
        </div>
    );
}
