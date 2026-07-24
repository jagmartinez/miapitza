import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { canCreatePayment, canDeliverOrder, canOperateKitchenLineItems, canReversePayment, canUpdateWholeOrderStatus, getPrimaryRoleName, getRoleColor, getUserAccentColor, getUserRoleNames, hasAnyRole, hasPermission } from './authz';

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

    it('only exposes payment reversal to administrators', () => {
        expect(canReversePayment(buildUser({ role: { id: 1, name: 'SUPERADMIN' } }))).toBe(true);
        expect(canReversePayment(buildUser({ role: { id: 2, name: 'ADMIN' } }))).toBe(true);
        expect(canReversePayment(buildUser({ role: { id: 3, name: 'CAJERO' } }))).toBe(false);
        expect(canReversePayment(buildUser({ role: { id: 4, name: 'MESERO' } }))).toBe(false);
    });

    it('treats effective permission grants as authoritative over legacy roles', () => {
        const revokedAdmin = buildUser({
            role: { id: 2, name: 'ADMIN' },
            permissions: ['payments.process'],
        });

        expect(canCreatePayment(revokedAdmin)).toBe(true);
        expect(canReversePayment(revokedAdmin)).toBe(false);
        expect(hasPermission(revokedAdmin, 'payments.reverse', ['ADMIN'])).toBe(false);
    });

    it('allows a custom role through its effective permission grant', () => {
        const customRole = buildUser({
            role: { id: 9, name: 'AUDITOR_CAJA' },
            permissions: ['payments.reverse'],
        });

        expect(canReversePayment(customRole)).toBe(true);
    });

    it('shows delivery only to users with the effective orders.deliver permission', () => {
        const allowed = buildUser({
            role: { id: 9, name: 'DESPACHO' },
            permissions: ['orders.deliver'],
        });
        const deniedAdmin = buildUser({
            role: { id: 2, name: 'ADMIN' },
            permissions: ['orders.view'],
        });

        expect(canDeliverOrder(allowed)).toBe(true);
        expect(canDeliverOrder(deniedAdmin)).toBe(false);
    });
});
