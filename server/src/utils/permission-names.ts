type PermissionGrant = { name: string };
type RoleWithPermissions = { permissions?: readonly PermissionGrant[] | null };

/** Returns the stable, deduplicated effective grant names across all assigned roles. */
export function collectPermissionNames(roles: readonly RoleWithPermissions[]): string[] {
    return Array.from(new Set(
        roles.flatMap((role) => (role.permissions ?? []).map((permission) => permission.name))
    )).sort();
}
