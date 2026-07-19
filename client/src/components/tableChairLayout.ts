import type { Table } from '../types';

type ChairSide = 'top' | 'right' | 'bottom' | 'left';
export type ChairPlacement = { side: ChairSide; offset: number };
type ChairLayoutTable = Pick<Table, 'capacity'> & { mapWidth: number; mapHeight: number };

export function getChairPlacements(table: ChairLayoutTable): ChairPlacement[] {
    const capacity = Number.isSafeInteger(table.capacity) && table.capacity > 0 ? table.capacity : 0;
    if (capacity === 0) return [];

    const sides: Record<ChairSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };

    if (capacity === 1) {
        sides.bottom = 1;
    } else if (capacity === 2) {
        if (table.mapHeight > table.mapWidth) {
            sides.top = 1;
            sides.bottom = 1;
        } else {
            sides.left = 1;
            sides.right = 1;
        }
    } else if (capacity === 3) {
        sides.top = 1;
        sides.left = 1;
        sides.right = 1;
    } else if (table.mapHeight > table.mapWidth * 1.12) {
        sides.top = 1;
        sides.bottom = 1;
        const remaining = capacity - 2;
        sides.left = Math.ceil(remaining / 2);
        sides.right = Math.floor(remaining / 2);
    } else {
        sides.left = 1;
        sides.right = 1;
        const remaining = capacity - 2;
        sides.top = Math.ceil(remaining / 2);
        sides.bottom = Math.floor(remaining / 2);
    }

    return (Object.entries(sides) as [ChairSide, number][]).flatMap(([side, count]) =>
        Array.from({ length: count }, (_, index) => ({
            side,
            offset: ((index + 1) / (count + 1)) * 100
        }))
    );
}
