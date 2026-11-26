import type { LoginUser } from './session';

/** The server sends effective permission names as a string array; anything else grants nothing. */
export function can(user: LoginUser, permission: string): boolean {
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function canAny(user: LoginUser, permissions: string[]): boolean {
    return permissions.some((permission) => can(user, permission));
}

/** Roles that may use the caja (server CASHIERS). */
const CASHIER_ROLES = ['SUPERADMIN', 'ADMIN', 'CAJERO'];
/** Roles that see the expected cash ("Debe haber") of an open shift: the count is blind for everyone else. */
const CASH_ADMIN_ROLES = ['SUPERADMIN', 'ADMIN'];

const roleNames = (user: LoginUser): string[] => [user.role?.name, ...(Array.isArray(user.roles) ? user.roles : [])].filter((r): r is string => typeof r === 'string');

export function isCashier(user: LoginUser): boolean {
    return roleNames(user).some((r) => CASHIER_ROLES.includes(r));
}

/** ADMIN or SUPERADMIN: the only ones who see expected cash and difference on an open shift. */
export function isCashAdmin(user: LoginUser): boolean {
    return roleNames(user).some((r) => CASH_ADMIN_ROLES.includes(r));
}

/** ADMIN or SUPERADMIN: the only accounts the server lets decide HR requests ("Por aprobar"). */
export function isCompanyAdmin(user: LoginUser): boolean {
    return roleNames(user).some((r) => CASH_ADMIN_ROLES.includes(r));
}

/** The waiter role: the only one with a monthly customer-service score. */
export function isWaiter(user: LoginUser): boolean {
    return roleNames(user).includes('MESERO');
}
