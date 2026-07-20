import type { User } from '../types';
import { hasAnyRole, hasPermission } from './authz';

const ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

/**
 * Capability map for the operational table screen. The permission array sent
 * by the API is authoritative; role names are only a compatibility fallback
 * for sessions created by older backends.
 */
export function getTableAccess(user?: User | null) {
    const canCreateOrder = hasPermission(user, 'orders.create', ['SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO']);
    const canEditOrder = hasPermission(user, 'orders.edit', ['SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO']);

    return {
        canCreateTable: hasPermission(user, 'tables.create', ADMIN_ROLES),
        canEditTable: hasPermission(user, 'tables.edit', [...ADMIN_ROLES, 'HOST']),
        canDeleteTable: hasPermission(user, 'tables.delete', ADMIN_ROLES),
        canEditMap: hasPermission(user, 'tables.map.edit', ADMIN_ROLES),
        canTransfer: hasPermission(user, 'tables.transfer', [...ADMIN_ROLES, 'MESERO']),
        canConsolidate: hasPermission(user, 'tables.consolidate', [...ADMIN_ROLES, 'CAJERO']),
        canGroup: hasPermission(user, 'tables.group.manage', [...ADMIN_ROLES, 'HOST', 'MESERO']),
        canIssueInvoice: hasPermission(user, 'invoices.issue', [...ADMIN_ROLES, 'CAJERO']),
        canOperatePOS: canCreateOrder && canEditOrder,
        // Branch scope is an API identity rule, not a grant. Operational roles
        // stay pinned to User.branchId even when a custom role gains more table
        // permissions.
        canChooseBranch: hasAnyRole(user, ADMIN_ROLES),
    };
}

