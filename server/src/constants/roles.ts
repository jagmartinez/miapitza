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

/**
 * Platform-capable role name. Cross-tenant company overrides additionally
 * require `isPlatformOperator` (see `utils/tenant-scope.ts`), which pins the
 * actor to `PLATFORM_ADMIN_COMPANY_ID` when that env is configured.
 */
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

/**
 * Roles allowed to sign in with a quick PIN on a shared service tablet.
 * Never includes ADMIN/SUPERADMIN: a 4-6 digit PIN is not a strong credential.
 */
export const PIN_ROLES: RoleName[] = [ROLES.MESERO, ROLES.CAJERO, ROLES.HOST, ROLES.BODEGA, ROLES.CHEF];

/** Roles a fixed kitchen-tablet account may hold. */
export const KITCHEN_DEVICE_ROLES: RoleName[] = [ROLES.COCINA];
