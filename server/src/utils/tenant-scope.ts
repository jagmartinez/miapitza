import type { Request } from 'express';
import prisma from './prisma';
import { ROLES } from '../constants/roles';

type ReqUser = NonNullable<Request['user']>;

/**
 * Tenant (company) scoping rules:
 * - Every authenticated user is bound to `User.companyId` (loaded from DB in auth).
 * - Cross-tenant overrides (`?companyId=` / `body.companyId`) are reserved for
 *   platform operators: primary-role SUPERADMIN users whose home company matches
 *   `PLATFORM_ADMIN_COMPANY_ID`, and only in explicit `multi` tenancy mode.
 * - Missing or invalid tenancy configuration always fails closed.
 * - `single` mode keeps every actor pinned to its home company.
 */

export class TenantScopeError extends Error {
    statusCode = 403;
    constructor(message = 'No autorizado para operar en esta empresa') {
        super(message);
        this.name = 'TenantScopeError';
    }
}

/** Parse an optional company id from query/body. Returns undefined when absent. */
export function parseCompanyIdInput(raw: unknown): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isInteger(value) || value <= 0) {
        throw new TenantScopeError('Identificador de empresa inválido');
    }
    return value;
}

export type PlatformTenancyMode = 'single' | 'multi';

export function getPlatformTenancyMode(env: NodeJS.ProcessEnv = process.env): PlatformTenancyMode | null {
    const value = env.PLATFORM_TENANCY_MODE?.trim().toLowerCase();
    return value === 'single' || value === 'multi' ? value : null;
}

/**
 * True when the actor may perform cross-tenant company operations
 * (list/create foreign branches/users, manage the companies registry).
 */
export function isPlatformOperator(user: ReqUser): boolean {
    // SUPERADMIN is authoritative only as the primary role. A secondary role
    // must never silently turn a tenant user into a cross-tenant operator.
    if (user.role !== ROLES.SUPERADMIN || getPlatformTenancyMode() !== 'multi') return false;
    const configured = process.env.PLATFORM_ADMIN_COMPANY_ID?.trim();
    if (!configured) return false;
    const operatorCompanyId = Number.parseInt(configured, 10);
    if (!Number.isInteger(operatorCompanyId) || operatorCompanyId <= 0) return false;
    return user.companyId === operatorCompanyId;
}

export function assertPlatformOperator(user: ReqUser): void {
    if (!isPlatformOperator(user)) {
        throw new TenantScopeError(
            'No autorizado: se requiere un operador de plataforma para gestionar otras empresas'
        );
    }
}

/** Ensure the target company exists (and optionally is active). */
export async function assertCompanyExists(
    companyId: number,
    opts: { requireActive?: boolean } = {}
): Promise<void> {
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, active: true },
    });
    if (!company) {
        throw new TenantScopeError('Empresa no encontrada');
    }
    if (opts.requireActive && company.active !== true) {
        throw new TenantScopeError('La empresa destino está inactiva');
    }
}

/**
 * Resolve the company id a request may act on.
 * Non-platform actors are always pinned to their home company; requested
 * overrides are ignored (not accepted) to prevent IDOR via spoofed ids.
 */
export async function resolveActingCompanyId(
    user: ReqUser,
    requestedCompanyId?: number,
    opts: { requireActiveTarget?: boolean } = {}
): Promise<number> {
    const homeCompanyId = user.companyId;
    if (requestedCompanyId === undefined || requestedCompanyId === homeCompanyId) {
        return homeCompanyId;
    }
    if (!isPlatformOperator(user)) {
        throw new TenantScopeError('No autorizado para operar en otra empresa');
    }
    await assertCompanyExists(requestedCompanyId, {
        requireActive: opts.requireActiveTarget === true,
    });
    return requestedCompanyId;
}
