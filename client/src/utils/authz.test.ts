import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { canOperateKitchenLineItems, canUpdateWholeOrderStatus, getPrimaryRoleName, getRoleColor, getUserAccentColor, getUserRoleNames, hasAnyRole } from './authz';

const buildUser = (overrides: Partial<User> = {}): User => ({
    id: 1,
    name: 'Ana',
    email: 'ana@example.com',
    username: 'ana',
    role: { id: 1, name: 'MESERO' },
    companyId: 1,
    branchId: 1,
    status: 'ACTIVE',
    ...overrides,
});

describe('authz utils', () => {
    it('prefers explicit roles when present', () => {
        const user = buildUser({
            roles: [{ id: 1, name: 'MESERO' }, { id: 2, name: 'CAJERO' }],
        });

        expect(getUserRoleNames(user)).toEqual(['MESERO', 'CAJERO']);
        expect(hasAnyRole(user, ['CAJERO'])).toBe(true);
        expect(getPrimaryRoleName(user)).toBe('MESERO');
    });

    it('falls back to userRoles when the flat roles array is absent', () => {
        const user = buildUser({
            roles: undefined,
            userRoles: [{ role: { id: 3, name: 'COCINA' } }],
        });

        expect(getUserRoleNames(user)).toEqual(['COCINA']);
        expect(getPrimaryRoleName(user)).toBe('COCINA');
    });

    it('uses the explicit user color before the role fallback', () => {
        const user = buildUser({ color: '#123456' });
        expect(getUserAccentColor(user)).toBe('#123456');
    });

    it('falls back to the role color when the user has no custom accent', () => {
        const user = buildUser({ color: null, role: { id: 2, name: 'CAJERO' } });
        expect(getRoleColor('CAJERO')).toBe('#059669');
        expect(getUserAccentColor(user)).toBe('#059669');
    });

    it('does not expose whole-order status mutation to kitchen-only roles', () => {
        const kitchen = buildUser({ role: { id: 3, name: 'COCINA' } });
        expect(canOperateKitchenLineItems(kitchen)).toBe(true);
        expect(canUpdateWholeOrderStatus(kitchen)).toBe(false);
        expect(canUpdateWholeOrderStatus(buildUser())).toBe(true);
    });
});
