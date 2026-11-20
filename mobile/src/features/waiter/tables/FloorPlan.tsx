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
    /** Picking mode: returns whether a table may be chosen as the destination. */
    canPick?: (table: PlanTable) => boolean;
    onTap: (table: PlanTable, order: ActiveOrder | undefined, state: TableState) => void;
    onLongPress: (table: PlanTable, order: ActiveOrder | undefined, state: TableState) => void;
}

export function tileLines(label: string, state: TableState, order: ActiveOrder | undefined, now: number): string[] {
    const waiter = order?.user?.name ?? '';
    if (state === 'free' || !order) return [label, 'Libre'];
    const mins = formatElapsed(elapsedMinutes(order.createdAt, now));
    const guests = order.guests ? `${order.guests} pers` : '';
    const status = order.pendingSync ? 'Sin sincronizar' : state === 'ready' ? 'Listo' : state === 'due' ? 'Por cobrar' : '';
    const second = [status || guests, mins].filter(Boolean).join(' · ');
    const lines = [label, second];
    if (waiter) lines.push(waiter);
    return lines;
}

/** Read-only floor plan scaled to the available width (positions and sizes in canvas units, as percentages). */
export function FloorPlan({ plan, areaId, orders, now, onlyUserId, canPick, onTap, onLongPress }: FloorPlanProps) {
    const units = useMemo(
        () => buildUnits(plan.tables.filter((t) => (t.floorAreaId ?? null) === areaId)),
        [plan.tables, areaId],
    );
    return (
        <div className="plan" style={{ aspectRatio: `${plan.canvasWidth} / ${plan.canvasHeight}` }} data-testid="floor-plan">
            {units.map((unit) => {
                const order = unitOrder(unit, orders);
                if (onlyUserId != null && order?.user?.id !== onlyUserId) return null;
                const { primary } = unit;
                const state = tableState(primary, order);
                const grouped = unit.tables.length > 1;
                const label = grouped ? unit.tables.map((t) => t.number).join('+') : primary.number;
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
                            left: `${(unit.x / plan.canvasWidth) * 100}%`,
                            top: `${(unit.y / plan.canvasHeight) * 100}%`,
                            width: `${(unit.w / plan.canvasWidth) * 100}%`,
                            height: `${(unit.h / plan.canvasHeight) * 100}%`,
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
