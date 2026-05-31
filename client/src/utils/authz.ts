import type { User } from '../types';
import { ROLES } from '../constants/roles';

const ROLE_COLORS: Record<string, string> = {
    SUPERADMIN: '#7C3AED',
    ADMIN: '#2563EB',
    CAJERO: '#059669',
    MESERO: '#F97316',
    HOST: '#EC4899',
    COCINA: '#DC2626',
    CHEF: '#8B5CF6',
    BODEGA: '#0F766E',
};

export const getUserRoleNames = (user?: User | null): string[] => {
    if (!user) {
        return [];
    }

    if (Array.isArray(user.roles) && user.roles.length > 0) {
        const rolesFromArray = user.roles
            .map((role) => {
                if (typeof role === 'string') {
                    return role;
                }
                if (role && typeof role === 'object' && 'name' in role && typeof role.name === 'string') {
                    return role.name;
                }
                return '';
            })
            .filter(Boolean);
        if (rolesFromArray.length > 0) {
            return rolesFromArray;
        }
    }

    if (Array.isArray(user.userRoles) && user.userRoles.length > 0) {
        const userRoles = user.userRoles
            .map((userRole) => userRole?.role?.name || '')
            .filter(Boolean);
        if (userRoles.length > 0) {
            return userRoles;
        }
    }

    const rawRole = (user as unknown as { role?: { name?: string } | string }).role;
    if (typeof rawRole === 'string') {
        return [rawRole];
    }
    if (rawRole && typeof rawRole === 'object' && typeof rawRole.name === 'string') {
        return [rawRole.name];
    }

    return [];
};

export const hasAnyRole = (user: User | null | undefined, roles: string[]): boolean => {
    const userRoles = getUserRoleNames(user);
    return userRoles.some((role) => roles.includes(role));
};

/** POST /orders/:id/send-to-kitchen */
export const canSendOrderToKitchen = (user: User | null | undefined): boolean =>
    hasAnyRole(user, [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MESERO]);

/** POST /orders/:id/cancel */
export const canCancelOrder = (user: User | null | undefined): boolean =>
    hasAnyRole(user, [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MESERO]);

/** POST /payments (registrar cobro) */
export const canCreatePayment = (user: User | null | undefined): boolean =>
    hasAnyRole(user, [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.CAJERO]);

/** PATCH items start/finish, POST report-problem */
export const canOperateKitchenLineItems = (user: User | null | undefined): boolean =>
    hasAnyRole(user, [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.COCINA, ROLES.CHEF]);

export const getPrimaryRoleName = (user?: User | null): string => {
    return getUserRoleNames(user)[0] || user?.role?.name || '';
};

export const getRoleColor = (roleName?: string | null): string => {
    return ROLE_COLORS[roleName || ''] || '#6B7280';
};

export const getUserAccentColor = (user?: Pick<User, 'color' | 'role' | 'roles' | 'userRoles'> | null): string => {
    if (!user) {
        return '#6B7280';
    }

    return user.color || getRoleColor(getPrimaryRoleName(user as User));
};
