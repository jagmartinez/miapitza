import { describe, expect, it } from 'vitest';
import { getChairPlacements } from './tableChairLayout';

function tableWithCapacity(capacity: number, mapWidth = 120, mapHeight = 80) {
    return { capacity, mapWidth, mapHeight };
}

describe('table map chair placement', () => {
    it.each([1, 2, 4, 6, 10, 12, 20])('renders exactly one chair for each of %i diners', (capacity) => {
        expect(getChairPlacements(tableWithCapacity(capacity))).toHaveLength(capacity);
    });

    it('distributes a vertical table capacity along its longest sides without losing chairs', () => {
        const chairs = getChairPlacements(tableWithCapacity(8, 80, 180));

        expect(chairs).toHaveLength(8);
        expect(chairs.filter((chair) => chair.side === 'left')).toHaveLength(3);
        expect(chairs.filter((chair) => chair.side === 'right')).toHaveLength(3);
        expect(chairs.filter((chair) => chair.side === 'top')).toHaveLength(1);
        expect(chairs.filter((chair) => chair.side === 'bottom')).toHaveLength(1);
    });

    it('renders no misleading chairs for an invalid stored capacity', () => {
        expect(getChairPlacements(tableWithCapacity(0))).toEqual([]);
        expect(getChairPlacements(tableWithCapacity(2.5))).toEqual([]);
    });
});
