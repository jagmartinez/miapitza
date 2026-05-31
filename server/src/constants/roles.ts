/**
 * Centralized role names and role groups.
 *
 * Authorization in this system is role-based (the permission model is additive,
 * see `requirePermission`). Use these constants instead of hardcoding role
 * strings across routes/services so the set of allowed roles stays consistent.
 */

export const ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    ADMIN: 'ADMIN',
    CAJERO: 'CAJERO',
    MESERO: 'MESERO',
    HOST: 'HOST',
    COCINA: 'COCINA',
    CHEF: 'CHEF',
    BODEGA: 'BODEGA',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

/** Full administrators (tenant-wide management). */
export const ADMINS: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN];

/** Platform-only role; can act across tenants. */
export const PLATFORM_ADMINS: RoleName[] = [ROLES.SUPERADMIN];

/** Front-of-house operations (POS, orders). */
export const OPERATIONS: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CAJERO, ROLES.MESERO];

/** Cash handling (payments, shifts, invoices, reconciliation reads). */
export const CASHIERS: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CAJERO];

/** Table/host operations. */
export const HOSTS: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.HOST, ROLES.CAJERO];

/** Kitchen line. */
export const KITCHEN: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.COCINA, ROLES.CHEF];

/** Inventory / warehouse / purchasing management. */
export const INVENTORY: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.BODEGA, ROLES.CHEF];

/** Menu / recipe management. */
export const MENU_MANAGEMENT: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CHEF];
