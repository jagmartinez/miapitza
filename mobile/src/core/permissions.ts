import type { LoginUser } from './session';

/** The server sends effective permission names as a string array; anything else grants nothing. */
export function can(user: LoginUser, permission: string): boolean {
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function canAny(user: LoginUser, permissions: string[]): boolean {
    return permissions.some((permission) => can(user, permission));
}
