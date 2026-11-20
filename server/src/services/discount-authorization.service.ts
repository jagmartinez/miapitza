import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { collectPermissionNames } from '../utils/permission-names';
import { OperationalDeviceService } from './operational-device.service';
import { loginAttemptService } from './login-attempt.service';
import { AuditLogService } from './audit-log.service';

export const DISCOUNT_AUTH_ERROR = 'Autorización inválida';
export const DISCOUNT_APPLY_PERMISSION = 'orders.discount.apply';
export const DISCOUNT_AUTHORIZE_PERMISSION = 'orders.discount.authorize';

// Immutable cost-12 hash: every rejected path still pays one bcrypt comparison.
const DUMMY_PASSWORD_HASH = '$2a$12$m7N0cnrKHlL.SDwMiWxrC.RygLI/H8rmiroe/0eEp15SO752w7zl6';

const DEVICE_MAX_FAILURES = 20;
const DEVICE_WINDOW_MS = 15 * 60 * 1000;
// A per-supervisor row resets to 0 when it locks (after this many failures), so
// a row that is locked inside the window still stands for this many guesses.
const SUPERVISOR_LOCK_THRESHOLD = 5;
const LOCK_ERROR = /temporarily locked/i;

export const MIN_DISCOUNT_REASON = 3;
export const MAX_DISCOUNT_REASON = 120;

/** Generic 401: wrong PIN, no permission, other branch, low limit, lockout, bad device... */
export class DiscountAuthRejectedError extends Error {
    readonly statusCode = 401;
    constructor() {
        super(DISCOUNT_AUTH_ERROR);
        this.name = 'DiscountAuthRejectedError';
    }
}

/** 403: the requested discount is above the actor's own limit. Nothing was applied. */
export class DiscountAuthRequiredError extends Error {
    readonly statusCode = 403;
    readonly code = 'DISCOUNT_AUTH_REQUIRED';
    constructor(public readonly limitPercent: number, public readonly requestedPercent: number) {
        super('El descuento excede su límite y requiere autorización de un supervisor');
        this.name = 'DiscountAuthRequiredError';
    }
}

export const deviceDiscountKey = (deviceId: number) => `discount-auth:device:${deviceId}`;

/** Discount as % of the subtotal, rounded up to 2 decimals so a limit is never understated. */
export function discountPercentOf(discount: number, subtotal: number): number {
    if (!(subtotal > 0) || !(discount > 0)) return 0;
    return Math.ceil((discount / subtotal) * 10000 - 1e-9) / 100;
}

/** Largest discount (in currency, cents precision) a percent limit allows over a subtotal. */
export function maxDiscountForLimit(subtotal: number, limitPercent: number): number {
    return Math.floor(Math.max(0, subtotal) * limitPercent) / 100;
}

/** Valid role limit: finite number in 0..100. */
function isValidLimit(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

type Db = Pick<Prisma.TransactionClient, 'user' | 'setting'>;

export interface LimitSubject {
    userId: number;
    companyId: number;
    role?: string | null;
    roles?: string[] | null;
}

/** `${companyId}_maxManualDiscountPercent`; absent/invalid => 100 (no cap). */
export async function getCompanyDiscountCap(db: Pick<Db, 'setting'>, companyId: number): Promise<number> {
    const setting = await db.setting.findUnique({
        where: { companyId_name: { companyId, name: `${companyId}_maxManualDiscountPercent` } },
        select: { value: true },
    });
    const parsed = Number.parseFloat(setting?.value ?? '');
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 100;
}

/**
 * Highest manual-discount % (of the subtotal) the user may apply on their own.
 * - SUPERADMIN / ADMIN: 100.
 * - If any of their roles has `maxDiscountPercent`: the highest one, capped by
 *   the company cap. A stored value outside 0..100 (no DB CHECK) counts as 0:
 *   a corrupt limit must never widen access.
 * - Otherwise today's rule: MESERO => company cap (100 when unset); the rest 100.
 * Always 0..100.
 */
export async function getManualDiscountLimit(user: LimitSubject, db: Db = prisma): Promise<number> {
    const roleNames = new Set([user.role, ...(user.roles ?? [])].filter((name): name is string => !!name));
    if (roleNames.has('SUPERADMIN') || roleNames.has('ADMIN')) return 100;
    return (await loadLimit(user, roleNames, db)).limit;
}

/**
 * The limit coming from a role's own maxDiscountPercent (capped by the company
 * cap), or null when the user is an admin or none of their roles has one. Lets
 * the reason-less web path enforce role limits without changing anything for
 * roles that have none.
 */
export async function getConfiguredDiscountLimit(user: LimitSubject, db: Db = prisma): Promise<number | null> {
    const roleNames = new Set([user.role, ...(user.roles ?? [])].filter((name): name is string => !!name));
    if (roleNames.has('SUPERADMIN') || roleNames.has('ADMIN')) return null;
    const { limit, configured } = await loadLimit(user, roleNames, db);
    return configured ? limit : null;
}

async function loadLimit(user: LimitSubject, roleNames: Set<string>, db: Db): Promise<{ limit: number; configured: boolean }> {
    const record = await db.user.findUnique({
        where: { id: user.userId },
        select: {
            role: { select: { maxDiscountPercent: true } },
            userRoles: { select: { role: { select: { maxDiscountPercent: true } } } },
        },
    });
    const roleLimits = [record?.role, ...(record?.userRoles ?? []).map((entry) => entry.role)]
        .map((role) => role?.maxDiscountPercent);
    return {
        limit: resolveLimit(roleNames, roleLimits, await getCompanyDiscountCap(db, user.companyId)),
        configured: roleLimits.some((value) => value !== null && value !== undefined),
    };
}

export function resolveLimit(roleNames: Set<string>, roleLimits: Array<number | null | undefined>, companyCap: number): number {
    if (roleNames.has('SUPERADMIN') || roleNames.has('ADMIN')) return 100;
    const configured = roleLimits
        .filter((value): value is number => value !== null && value !== undefined)
        .map((value) => (isValidLimit(value) ? value : 0));
    if (configured.length > 0) return Math.min(Math.max(...configured), companyCap);
    return roleNames.has('MESERO') ? companyCap : 100;
}

/** Effective-permission check with the same rule as requirePermission's legacy fallback. */
export async function canApplyManualDiscount(user: { permissions?: string[] | null }): Promise<boolean> {
    if ((user.permissions ?? []).includes(DISCOUNT_APPLY_PERMISSION)) return true;
    // A catalog without the permission is a legacy database: keep today's rule.
    const defined = await prisma.permission.findUnique({
        where: { name: DISCOUNT_APPLY_PERMISSION },
        select: { id: true },
    });
    return defined === null;
}

const SUPERVISOR_SELECT = {
    id: true,
    name: true,
    color: true,
    status: true,
    companyId: true,
    branchId: true,
    pinHash: true,
    company: { select: { active: true } },
    branch: { select: { status: true } },
    allowedBranches: { select: { branchId: true } },
    role: { select: { name: true, maxDiscountPercent: true, permissions: { select: { name: true } } } },
    userRoles: {
        select: { role: { select: { name: true, maxDiscountPercent: true, permissions: { select: { name: true } } } } },
    },
} satisfies Prisma.UserSelect;

type SupervisorRecord = Prisma.UserGetPayload<{ select: typeof SUPERVISOR_SELECT }>;

function supervisorRoles(user: SupervisorRecord) {
    return [user.role, ...user.userRoles.map((entry) => entry.role)];
}

function isEligibleSupervisor(
    user: SupervisorRecord | null,
    device: { companyId: number; branchId: number },
    requesterUserId: number,
): user is SupervisorRecord {
    if (!user) return false;
    if (user.id === requesterUserId) return false; // dual control: nobody authorizes themself
    if (user.status !== 'ACTIVE' || !user.companyId || user.companyId !== device.companyId) return false;
    if (!user.company?.active) return false;
    if (user.branchId && user.branch?.status !== 'ACTIVE') return false;
    const inBranch = user.branchId
        ? user.branchId === device.branchId
        : user.allowedBranches.some((entry) => entry.branchId === device.branchId);
    if (!inBranch) return false;
    if (!user.pinHash) return false;
    return collectPermissionNames(supervisorRoles(user)).includes(DISCOUNT_AUTHORIZE_PERMISSION);
}

/** The supervisor's own limit (admins 100, else highest role limit under the company cap, else 100). */
async function supervisorLimit(db: Pick<Db, 'setting'>, user: SupervisorRecord): Promise<number> {
    const roles = supervisorRoles(user);
    return resolveLimit(
        new Set(roles.map((role) => role.name)),
        roles.map((role) => role.maxDiscountPercent),
        await getCompanyDiscountCap(db, user.companyId!),
    );
}

/** Failures on this device across all supervisors within the window (same scheme as pin-login). */
async function deviceIsLocked(deviceId: number): Promise<boolean> {
    const since = new Date(Date.now() - DEVICE_WINDOW_MS);
    const rows = await prisma.loginAttempt.findMany({
        where: { ipKey: deviceDiscountKey(deviceId), lastAttemptAt: { gte: since } },
        select: { failedCount: true, lockedUntil: true },
    });
    const failures = rows.reduce(
        (sum, row) => sum + row.failedCount + (row.lockedUntil ? SUPERVISOR_LOCK_THRESHOLD : 0),
        0,
    );
    return failures >= DEVICE_MAX_FAILURES;
}

function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
    return letters.map((part) => part[0]!.toUpperCase()).join('').slice(0, 2);
}

export interface DiscountRequester {
    userId: number;
    companyId: number;
    branchId?: number | null;
    role?: string | null;
    roles?: string[] | null;
}

/** Resolves the ACTIVE service tablet in the requester's company and branch scope, else generic reject. */
async function resolveDevice(deviceToken: string, requester: DiscountRequester) {
    const device = await OperationalDeviceService.resolveActive(deviceToken);
    if (!device || device.type !== 'SERVICE_TABLET' || device.companyId !== requester.companyId) return null;
    const roles = new Set([requester.role, ...(requester.roles ?? [])]);
    const companyWide = roles.has('SUPERADMIN') || roles.has('ADMIN');
    if (!companyWide && requester.branchId !== device.branchId) return null;
    return device;
}

export class DiscountAuthorizationService {
    /** Supervisors (authorize permission + PIN) selectable on this tablet's branch. */
    static async listSupervisors(deviceToken: string, requester: DiscountRequester) {
        const device = await resolveDevice(deviceToken, requester);
        if (!device) throw new DiscountAuthRejectedError();
        const users = await prisma.user.findMany({
            where: {
                companyId: device.companyId,
                status: 'ACTIVE',
                pinHash: { not: null },
                id: { not: requester.userId },
                OR: [
                    { role: { permissions: { some: { name: DISCOUNT_AUTHORIZE_PERMISSION } } } },
                    { userRoles: { some: { role: { permissions: { some: { name: DISCOUNT_AUTHORIZE_PERMISSION } } } } } },
                ],
                AND: [{
                    OR: [
                        { branchId: device.branchId },
                        { branchId: null, allowedBranches: { some: { branchId: device.branchId } } },
                    ],
                }],
            },
            select: { id: true, name: true, color: true },
            orderBy: { name: 'asc' },
        });
        return users.map((user) => ({
            id: user.id,
            name: user.name,
            initials: initialsOf(user.name),
            color: user.color ?? null,
        }));
    }

    /**
     * Verifies a supervisor's PIN for a discount and returns what the pricing
     * transaction needs to re-validate under the order lock. Every failure
     * (device, lockout, wrong PIN, missing permission, other branch, low
     * limit...) is the same DiscountAuthRejectedError; one bcrypt comparison
     * runs on every path. PINs are never logged or stored.
     *
     * No session is created: the supervisor never becomes the acting user.
     */
    static async verifySupervisor(input: {
        requester: DiscountRequester;
        deviceToken: string;
        supervisorUserId: number;
        pin: string;
        orderBranchId: number;
        orderId: number;
        requestedDiscount: number;
        reason: string;
    }): Promise<{
        supervisorUserId: number;
        revalidate: (tx: Prisma.TransactionClient, subtotal: number, discount: number) => Promise<void>;
        onApplied: (tx: Prisma.TransactionClient, info: {
            subtotal: number; discount: number; percent: number; previousDiscount: number;
        }) => Promise<void>;
    }> {
        const reject = async (): Promise<never> => {
            await bcrypt.compare(String(input.pin), DUMMY_PASSWORD_HASH);
            throw new DiscountAuthRejectedError();
        };

        const device = await resolveDevice(input.deviceToken, input.requester);
        if (!device || device.branchId !== input.orderBranchId) return reject();
        if (await deviceIsLocked(device.id)) return reject();

        const supervisor = Number.isInteger(input.supervisorUserId)
            ? await prisma.user.findFirst({
                where: { id: input.supervisorUserId, companyId: device.companyId },
                select: SUPERVISOR_SELECT,
            })
            : null;
        if (!supervisor) return reject();

        const lockKey = deviceDiscountKey(device.id);
        try {
            await loginAttemptService.assertAllowed(supervisor.id, lockKey);
        } catch (lockError) {
            if (lockError instanceof Error && LOCK_ERROR.test(lockError.message)) return reject();
            throw lockError;
        }

        let eligible = isEligibleSupervisor(supervisor, device, input.requester.userId);
        if (eligible) {
            // Pre-check of the supervisor's own limit so a PIN that opens the
            // supervisor but not this discount fails exactly like a wrong PIN.
            // The transaction re-checks it under the order lock.
            const aggregate = await prisma.orderItem.aggregate({
                where: { orderId: input.orderId },
                _sum: { subtotal: true },
            });
            const subtotal = Number(aggregate._sum?.subtotal ?? 0);
            const limit = await supervisorLimit(prisma, supervisor);
            const effective = Math.round(Math.min(input.requestedDiscount, Math.max(0, subtotal)) * 100) / 100;
            eligible = effective <= maxDiscountForLimit(subtotal, limit);
        }

        const pinMatches = await bcrypt.compare(
            String(input.pin),
            eligible ? supervisor.pinHash! : DUMMY_PASSWORD_HASH,
        );
        if (!eligible || !pinMatches) {
            await loginAttemptService.recordFailure(supervisor.id, lockKey);
            throw new DiscountAuthRejectedError();
        }
        try {
            await loginAttemptService.recordSuccess(supervisor.id, lockKey);
        } catch (lockError) {
            if (lockError instanceof Error && LOCK_ERROR.test(lockError.message)) {
                throw new DiscountAuthRejectedError();
            }
            throw lockError;
        }

        const supervisorId = supervisor.id;
        const requesterUserId = input.requester.userId;
        return {
            supervisorUserId: supervisorId,
            // Under the order lock: the supervisor must still be eligible and the
            // final (clamped) discount must fit their limit over the locked subtotal.
            revalidate: async (tx, subtotal, discount) => {
                const fresh = await tx.user.findFirst({
                    where: { id: supervisorId, companyId: device.companyId },
                    select: SUPERVISOR_SELECT,
                });
                if (!isEligibleSupervisor(fresh, device, requesterUserId)) throw new DiscountAuthRejectedError();
                const limit = await supervisorLimit(tx, fresh);
                if (discount > maxDiscountForLimit(subtotal, limit)) throw new DiscountAuthRejectedError();
            },
            // Same transaction as the pricing update: who asked, who authorized, how much, why.
            onApplied: async (tx, info) => {
                await AuditLogService.log({
                    companyId: input.requester.companyId,
                    userId: requesterUserId,
                    entityType: 'Order',
                    entityId: input.orderId,
                    action: 'DISCOUNT_AUTHORIZED',
                    details: {
                        requesterUserId,
                        authorizerUserId: supervisorId,
                        amount: info.discount,
                        percent: info.percent,
                        subtotal: info.subtotal,
                        previousDiscount: info.previousDiscount,
                        reason: input.reason,
                        deviceId: device.id,
                    },
                }, tx);
            },
        };
    }
}
