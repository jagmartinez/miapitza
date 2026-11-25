import type { Request } from 'express';
import { ADMINS } from '../constants/roles';

type ReqUser = NonNullable<Request['user']>;

/**
 * Branch-scoping rules for this system:
 * - SUPERADMIN and ADMIN are company-wide inside their home company. Cross-
 *   tenant company overrides are handled separately by
 *   `tenant-scope.ts` (`isPlatformOperator` / `resolveActingCompanyId`).
 * - Every operational role (CAJERO, MESERO, BODEGA, ...) is pinned to its
 *   currently active branch (`User.branchId`), which a SUPERADMIN rotates over time.
 *
 * Multi-tenant isolation by `companyId` is always enforced separately at the
 * query level; these helpers only deal with the branch dimension.
 */

export class BranchScopeError extends Error {
    statusCode = 403;
    constructor(message = 'No autorizado para esta sucursal') {
        super(message);
        this.name = 'BranchScopeError';
    }
}

/** True when the user may operate across all branches of its company. */
export function isCompanyWide(user: ReqUser): boolean {
    const roles = user.roles ?? [user.role];
    return ADMINS.some((role) => roles.includes(role));
}

/**
 * Resolve the branch filter to apply on list/read endpoints.
 * - Company-wide admin: honours an explicit `requestedBranchId`, or returns `undefined`
 *   (no branch filter → all branches).
 * - Other roles: always pinned to their active branch; any requested branch is
 *   ignored. Throws if the user has no active branch assigned.
 */
export function resolveBranchScope(user: ReqUser, requestedBranchId?: number): number | undefined {
    if (isCompanyWide(user)) {
        return requestedBranchId && !Number.isNaN(requestedBranchId) ? requestedBranchId : undefined;
    }
    if (!user.branchId) {
        throw new BranchScopeError('Su usuario no tiene una sucursal activa asignada. Contacte al administrador.');
    }
    return user.branchId;
}

/**
 * Assert that the user may act on a resource belonging to `branchId`.
 * Company-wide admins always pass. Other roles must match their active branch.
 * When `allowGlobal` is true, resources with a null branch (shared across the
 * company, e.g. global menu items or the CENTRAL warehouse) are also allowed.
 */
export function assertBranchAccess(
    user: ReqUser,
    branchId: number | null | undefined,
    opts: { allowGlobal?: boolean } = {}
): void {
    if (isCompanyWide(user)) return;
    if (!user.branchId) {
        throw new BranchScopeError('Su usuario no tiene una sucursal activa asignada. Contacte al administrador.');
    }
    if (branchId == null) {
        if (opts.allowGlobal) return;
        throw new BranchScopeError('No autorizado: el recurso pertenece a otra sucursal');
    }
    if (branchId !== user.branchId) {
        throw new BranchScopeError('No autorizado: el recurso pertenece a otra sucursal');
    }
}
