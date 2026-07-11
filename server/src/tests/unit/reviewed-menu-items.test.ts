import { readFile } from 'fs/promises';
import path from 'path';

import { validateReviewedMenuItemDocument } from '../../scripts/prepare-reviewed-menu-items';

const fixturePath = path.resolve(process.cwd(), 'prisma/data/recetas-menu.review-menu-items.json');

describe('reviewed menu item catalog contract', () => {
    it('contains 26 unique, positive-priced definitions', async () => {
        const input = JSON.parse(await readFile(fixturePath, 'utf8'));
        const parsed = validateReviewedMenuItemDocument(input);

        expect(parsed.issues).toEqual([]);
        expect(parsed.document?.menuItems).toHaveLength(26);
        expect(new Set(parsed.document?.menuItems.map((item) => item.sourceKey)).size).toBe(26);
        expect(parsed.document?.menuItems.every((item) => item.price > 0)).toBe(true);
    });

    it('rejects duplicate names and zero prices', async () => {
        const input = JSON.parse(await readFile(fixturePath, 'utf8'));
        input.menuItems[1].name = input.menuItems[0].name;
        input.menuItems[1].price = 0;

        const parsed = validateReviewedMenuItemDocument(input);

        expect(parsed.document).toBeNull();
        expect(parsed.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'REVIEW_MENU_NAME_DUPLICATE' }),
            expect.objectContaining({ code: 'REVIEW_MENU_PRICE_INVALID' })
        ]));
    });
});
