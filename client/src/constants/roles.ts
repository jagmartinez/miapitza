/**
 * Centralized role names and role groups for the client.
 *
 * These mirror the server-side role groups (`server/src/constants/roles.ts`).
 * Client-side guards are UX-only; the server is the source of truth for
 * authorization. Use these constants instead of inlining role-name arrays.
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

export const ADMIN: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN];
export const PLATFORM_ADMIN: RoleName[] = [ROLES.SUPERADMIN];
export const OPS: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CAJERO, ROLES.MESERO];
export const CASHIER: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CAJERO];
export const WAITER_TABLE: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MESERO, ROLES.HOST];
export const KITCHEN_ROLES: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MESERO, ROLES.COCINA, ROLES.CHEF];
export const HOST_ROLES: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.HOST, ROLES.CAJERO];
export const WAREHOUSE: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.BODEGA, ROLES.CHEF];
export const CHEF_MGMT: RoleName[] = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CHEF];
