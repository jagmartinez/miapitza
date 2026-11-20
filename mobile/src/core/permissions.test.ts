import { can, canAny } from './permissions';
import { user } from '../test/helpers';

const u = { ...user, permissions: ['orders.view', 'bills.split'] };

describe('permissions', () => {
    it('can() is false for a permission not in user.permissions', () => {
        expect(can(u, 'orders.view')).toBe(true);
        expect(can(u, 'payments.process')).toBe(false);
    });
    it("canAny(['payments.process','bills.split'])", () => {
        expect(canAny(u, ['payments.process', 'bills.split'])).toBe(true);
        expect(canAny(u, ['payments.process', 'x'])).toBe(false);
        expect(canAny(u, [])).toBe(false);
    });
    it('is false when permissions is not an array', () => {
        expect(can({ ...u, permissions: undefined }, 'orders.view')).toBe(false);
        expect(can({ ...u, permissions: 'orders.view' }, 'orders.view')).toBe(false);
    });
});
