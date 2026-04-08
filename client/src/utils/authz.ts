import type { User } from '../types';

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
        return user.roles.map((role) => role.name);
    }

    if (Array.isArray(user.userRoles) && user.userRoles.length > 0) {
        return user.userRoles.map((userRole) => userRole.role.name);
    }

    return user.role?.name ? [user.role.name] : [];
};

export const hasAnyRole = (user: User | null | undefined, roles: string[]): boolean => {
    const userRoles = getUserRoleNames(user);
    return userRoles.some((role) => roles.includes(role));
};

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
