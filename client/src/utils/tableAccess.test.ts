import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { getTableAccess } from './tableAccess';

function session(role: string, permissions: string[]): User {
    return {
        id: 1,
        name: 'Operador',
        email: 'operador@example.test',
        username: 'operador',
        role: { id: 1, name: role },
        permissions,
        companyId: 1,
        branchId: 7,
        status: 'ACTIVE',
    };
}

describe('table operational access', () => {
    it('keeps a waiter on the operational flow without administrative controls', () => {
        const access = getTableAccess(session('MESERO', [
            'tables.map.view',
            'tables.transfer',
            'tables.group.manage',
            'orders.create',
            'orders.edit',
        ]));

        expect(access).toMatchObject({
            canCreateTable: false,
            canEditTable: false,
            canDeleteTable: false,
            canEditMap: false,
            canTransfer: true,
            canConsolidate: false,
            canGroup: true,
            canIssueInvoice: false,
            canOperatePOS: true,
            canChooseBranch: false,
        });
    });

    it('treats effective permissions as authoritative instead of inferring admin access', () => {
        const access = getTableAccess(session('ADMIN', ['tables.map.view']));

        expect(access.canCreateTable).toBe(false);
        expect(access.canEditMap).toBe(false);
        expect(access.canChooseBranch).toBe(true);
    });

    it('requires both create and edit order grants before opening the POS workspace', () => {
        expect(getTableAccess(session('MESERO', ['orders.create'])).canOperatePOS).toBe(false);
        expect(getTableAccess(session('MESERO', ['orders.create', 'orders.edit'])).canOperatePOS).toBe(true);
    });

    it('does not allow an operational role to switch branches through extra table grants', () => {
        const access = getTableAccess(session('MESERO', ['tables.create', 'tables.map.edit']));
        expect(access.canCreateTable).toBe(true);
        expect(access.canEditMap).toBe(true);
        expect(access.canChooseBranch).toBe(false);
    });
});

