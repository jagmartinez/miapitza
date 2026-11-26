import bcrypt from 'bcryptjs';
import { afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../utils/prisma';
import { OrderService } from '../../services/order.service';
import { OrderController } from '../../controllers/order.controller';
import { AuthController } from '../../controllers/auth.controller';
import { AuthService } from '../../services/auth.service';
import { PinService } from '../../services/pin.service';
import { WebSocketService } from '../../services/websocket.service';
import { OperationalDeviceService } from '../../services/operational-device.service';
import { loginAttemptService } from '../../services/login-attempt.service';
import { AuditLogService } from '../../services/audit-log.service';
import {
    DiscountAuthRejectedError,
    DiscountAuthRequiredError,
    DiscountAuthorizationService,
    getManualDiscountLimit,
} from '../../services/discount-authorization.service';
import { isLenientSessionPath } from '../../middlewares/device-rate-limit';

const PIN = '2580';
const GENERIC = 'Autorización inválida';
let pinHash: string;

beforeAll(async () => {
    pinHash = await bcrypt.hash(PIN, 4);
    process.env.JWT_SECRET = 'test-secret-discount-auth';
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Rejection audits go through the global client (mocked away); in-transaction audits reach tx.auditLog.
const mockAuditLog = () => jest.spyOn(AuditLogService, 'log').mockImplementation((async (entry: Record<string, unknown>, db?: { auditLog: { create: (a: unknown) => Promise<unknown> } }) =>
    db ? db.auditLog.create({ data: { ...entry } }) : undefined) as never);

const requester = { userId: 21, companyId: 5, branchId: 1, role: 'MESERO', roles: ['MESERO'], permissions: ['orders.discount.apply'] };
const device = (over: Record<string, unknown> = {}) => ({
    id: 7, companyId: 5, branchId: 1, type: 'SERVICE_TABLET', status: 'ACTIVE', ...over,
});
const supervisor = (over: Record<string, unknown> = {}) => ({
    id: 50, name: 'Sofia Rojas', color: null, status: 'ACTIVE', companyId: 5, branchId: 1, pinHash,
    company: { active: true }, branch: { status: 'ACTIVE' }, allowedBranches: [],
    role: { name: 'ADMIN', maxDiscountPercent: null, permissions: [{ name: 'orders.discount.authorize' }] },
    userRoles: [],
    ...over,
});

// ---------------------------------------------------------------- limits

describe('getManualDiscountLimit', () => {
    function db(roles: Array<number | null>, cap: string | null) {
        return {
            user: {
                findUnique: jest.fn(async () => ({
                    role: { maxDiscountPercent: roles[0] },
                    userRoles: roles.slice(1).map((value) => ({ role: { maxDiscountPercent: value } })),
                })),
            },
            setting: { findUnique: jest.fn(async () => (cap === null ? null : { value: cap })) },
        };
    }
    const subject = (role: string, roles = [role]) => ({ userId: 21, companyId: 5, role, roles });

    it('ADMIN and SUPERADMIN are 100 without reading anything', async () => {
        const d = db([5], '10');
        expect(await getManualDiscountLimit(subject('ADMIN'), d as never)).toBe(100);
        expect(await getManualDiscountLimit(subject('SUPERADMIN'), d as never)).toBe(100);
        expect(d.user.findUnique).not.toHaveBeenCalled();
    });

    it('keeps today\'s rule when no role has a limit: MESERO = company cap, others 100', async () => {
        expect(await getManualDiscountLimit(subject('MESERO'), db([null], '15') as never)).toBe(15);
        expect(await getManualDiscountLimit(subject('MESERO'), db([null], null) as never)).toBe(100);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([null], '15') as never)).toBe(100);
    });

    it('uses the highest role limit and the company cap is a ceiling over it', async () => {
        expect(await getManualDiscountLimit(subject('CAJERO', ['CAJERO', 'MESERO']), db([10, 40], '100') as never)).toBe(40);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([60], '25') as never)).toBe(25);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([20], '25') as never)).toBe(20);
    });

    it('treats a stored limit outside 0..100 as 0 (never widens access)', async () => {
        expect(await getManualDiscountLimit(subject('CAJERO'), db([150], null) as never)).toBe(0);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([-5], null) as never)).toBe(0);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([Number.NaN], null) as never)).toBe(0);
    });

    it('an invalid company cap means no cap', async () => {
        expect(await getManualDiscountLimit(subject('MESERO'), db([null], '250') as never)).toBe(100);
        expect(await getManualDiscountLimit(subject('CAJERO'), db([30], 'abc') as never)).toBe(30);
    });
});

// ---------------------------------------------------------------- updatePricing

function pricingTx(opts: {
    cap?: string | null;
    roleLimit?: number | null;
    order?: Record<string, unknown>;
} = {}) {
    const order = {
        id: 41, status: 'OPEN', discount: 0, discountCode: null, tax: 0, tipAmount: 0,
        invoiceNumber: null, preInvoicedAt: null, payments: [], ...opts.order,
    };
    return {
        $queryRaw: jest.fn(async () => []),
        order: {
            findFirst: jest.fn(async () => order),
            update: jest.fn(async (args: unknown) => args),
        },
        orderItem: { findMany: jest.fn(async () => [{ subtotal: 100 }]) },
        setting: {
            findMany: jest.fn(async () => [{ name: '5_tax_rate', value: '15' }]),
            findUnique: jest.fn(async (args: { where: { companyId_name: { name: string } } }) => {
                if (args.where.companyId_name.name.endsWith('_maxManualDiscountPercent')) {
                    return opts.cap == null ? null : { value: opts.cap };
                }
                return null;
            }),
        },
        user: {
            findUnique: jest.fn(async () => ({
                role: { maxDiscountPercent: opts.roleLimit ?? null },
                userRoles: [],
            })),
        },
        auditLog: { create: jest.fn(async (_args: unknown) => ({})) },
    };
}
const useTx = (tx: unknown) => jest.spyOn(prisma, '$transaction')
    .mockImplementation((async (cb: (db: unknown) => unknown) => cb(tx)) as never);
const mesero = { role: 'MESERO', roles: ['MESERO'] };

describe('OrderService.updatePricing manual discount limits', () => {
    it('MESERO over the company cap gets DISCOUNT_AUTH_REQUIRED and nothing changes', async () => {
        const tx = pricingTx({ cap: '10' });
        useTx(tx);

        const error = await OrderService.updatePricing(
            41, 5, { discount: 20, discountReason: 'Cliente frecuente' }, 21, mesero,
        ).catch((e) => e);

        expect(error).toBeInstanceOf(DiscountAuthRequiredError);
        expect(error).toMatchObject({ statusCode: 403, code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 10, requestedPercent: 20 });
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('MESERO within the cap stores the reason and clears any authorizer', async () => {
        const tx = pricingTx({ cap: '25' });
        useTx(tx);

        await OrderService.updatePricing(41, 5, { discount: 20, discountReason: '  Cumpleaños  ' }, 21, mesero);

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 20, discountReason: 'Cumpleaños', discountAuthorizedById: null }),
        }));
    });

    it("CAJERO keeps today's uncapped behaviour when its role has no maxDiscountPercent", async () => {
        const tx = pricingTx({ cap: '10', roleLimit: null });
        useTx(tx);

        await OrderService.updatePricing(41, 5, { discount: 60, discountReason: 'Cortesía gerencia' }, 22,
            { role: 'CAJERO', roles: ['CAJERO'] });

        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 60 }),
        }));
    });

    it('role maxDiscountPercent is capped by the company cap', async () => {
        const tx = pricingTx({ cap: '30', roleLimit: 50 });
        useTx(tx);

        const error = await OrderService.updatePricing(41, 5, { discount: 40, discountReason: 'Cortesía gerencia' }, 22,
            { role: 'CAJERO', roles: ['CAJERO'] }).catch((e) => e);

        expect(error).toMatchObject({ code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 30, requestedPercent: 40 });
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('web pricing call without discountReason still works for a role with no limit', async () => {
        const tx = pricingTx({ cap: '10' });
        useTx(tx);

        await OrderService.updatePricing(41, 5, { discount: 5 }, 22, { role: 'CAJERO', roles: ['CAJERO'] });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 5, discountReason: null, discountAuthorizedById: null }),
        }));
    });

    it('web pricing call without discountReason keeps the legacy MESERO error', async () => {
        const tx = pricingTx({ cap: '10' });
        useTx(tx);
        await expect(OrderService.updatePricing(41, 5, { discount: 20 }, 21, mesero))
            .rejects.toThrow(/El descuento manual excede el máximo permitido para su rol \(10% del subtotal\)/);
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('a tip-only web call leaves the stored reason and authorizer untouched', async () => {
        const tx = pricingTx({ order: { discount: 20 } });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 20, tipAmount: 0 }, 22, { role: 'CAJERO', roles: ['CAJERO'] });
        const data = (tx.order.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data).not.toHaveProperty('discountReason');
        expect(data).not.toHaveProperty('discountAuthorizedById');
    });

    it('removing the discount clears reason and authorizer', async () => {
        const tx = pricingTx({ order: { discount: 20 } });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 0 }, 22, { role: 'CAJERO', roles: ['CAJERO'] });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 0, discountReason: null, discountAuthorizedById: null }),
        }));
    });

    it.each(['ab', 'x'.repeat(121), '   '])('rejects a discountReason that is not 3..120 chars (%#)', async (reason) => {
        const tx = pricingTx();
        useTx(tx);
        await expect(OrderService.updatePricing(41, 5, { discount: 5, discountReason: reason }, 22,
            { role: 'CAJERO', roles: ['CAJERO'] })).rejects.toThrow(/motivo/);
        expect(tx.order.update).not.toHaveBeenCalled();
    });
});

describe('OrderService.updatePricing with a supervisor authorization', () => {
    const authorization = () => ({
        supervisorUserId: 50,
        revalidate: jest.fn(async (_tx: unknown, _subtotal: number, _discount: number) => undefined),
        onApplied: jest.fn(async (_tx: unknown, _info: unknown) => undefined),
    });

    it('applies discount, reason and authorizer in the same transaction as the audit hook', async () => {
        const tx = pricingTx({ cap: '10' });
        const transaction = useTx(tx);
        const auth = authorization();

        await OrderService.updatePricing(41, 5, { discount: 40, discountReason: 'Error de cocina' }, 21, mesero,
            { authorization: auth });

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(tx.$queryRaw).toHaveBeenCalled(); // order row lock
        expect(auth.revalidate).toHaveBeenCalledWith(tx, 100, 40);
        expect(auth.onApplied).toHaveBeenCalledWith(tx, { subtotal: 100, discount: 40, percent: 40, previousDiscount: 0 });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                discount: 40, discountCode: null, discountReason: 'Error de cocina', discountAuthorizedById: 50,
            }),
        }));
    });

    it('persists the authorized percent with the stamp (I1) and clears both when the discount changes', async () => {
        const tx = pricingTx({ cap: '10' });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 12.5, discountReason: 'Error de cocina' }, 21, mesero,
            { authorization: authorization() });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discountAuthorizedById: 50, discountAuthorizedPercent: 12.5 }),
        }));

        const tx2 = pricingTx({ cap: '50', order: { discount: 12.5, discountReason: 'Error de cocina', discountAuthorizedById: 50 } });
        useTx(tx2);
        await OrderService.updatePricing(41, 5, { discount: 20, discountReason: 'Error de cocina' }, 21, mesero);
        expect(tx2.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discountAuthorizedById: null, discountAuthorizedPercent: null }),
        }));
    });

    it.each([
        ['pre-invoiced', { preInvoicedAt: new Date() }, /facturada/],
        ['invoiced', { invoiceNumber: 'F-1' }, /facturada/],
        ['with active payments', { payments: [{ id: 3 }] }, /pagos activos/],
        ['cancelled', { status: 'CANCELLED' }, /canceladas/],
    ])('refuses an %s order and applies nothing', async (_label, order, message) => {
        const tx = pricingTx({ order });
        useTx(tx);
        const auth = authorization();

        await expect(OrderService.updatePricing(41, 5, { discount: 40, discountReason: 'Error de cocina' }, 21, mesero,
            { authorization: auth })).rejects.toThrow(message);

        expect(tx.order.update).not.toHaveBeenCalled();
        expect(auth.onApplied).not.toHaveBeenCalled();
    });

    it('applies nothing when the supervisor revalidation fails under the lock', async () => {
        const tx = pricingTx();
        useTx(tx);
        const auth = authorization();
        auth.revalidate.mockRejectedValue(new DiscountAuthRejectedError() as never);

        await expect(OrderService.updatePricing(41, 5, { discount: 40, discountReason: 'Error de cocina' }, 21, mesero,
            { authorization: auth })).rejects.toBeInstanceOf(DiscountAuthRejectedError);

        expect(tx.order.update).not.toHaveBeenCalled();
        expect(auth.onApplied).not.toHaveBeenCalled();
    });

    it('replaces an applied promotion code with the authorized manual discount', async () => {
        const tx = pricingTx({ order: { discountCode: 'PROMO10', discount: 10 } });
        useTx(tx);
        const auth = authorization();
        await OrderService.updatePricing(41, 5, { discount: 40, discountReason: 'Error de cocina' }, 21, mesero,
            { authorization: auth });
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 40, discountCode: null, discountAuthorizedById: 50 }),
        }));
    });
});

describe('reason-only change on a stamped discount (M5)', () => {
    const stamped = { discount: 20, discountReason: 'Error de cocina', discountAuthorizedById: 50, discountAuthorizedPercent: 20 };
    const auditsOf = (tx: ReturnType<typeof pricingTx>) => tx.auditLog.create.mock.calls
        .map((c) => (c[0] as { data: { action: string; details: Record<string, unknown> } }).data);

    it('clears the stamp, audits PRICING_UPDATED with previousReason and keeps the discount', async () => {
        const tx = pricingTx({ cap: '50', order: stamped });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 20, discountReason: 'Cortesía gerente' }, 21, mesero);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                discount: 20, discountReason: 'Cortesía gerente', discountAuthorizedById: null, discountAuthorizedPercent: null,
            }),
        }));
        const audit = auditsOf(tx).find((a) => a.action === 'PRICING_UPDATED')!;
        expect(audit.details).toMatchObject({ previousReason: 'Error de cocina', discountReason: 'Cortesía gerente', previousDiscount: 20, discount: 20 });
    });

    it('re-applies the requester limit: over it, 403 DISCOUNT_AUTH_REQUIRED and nothing changes', async () => {
        const tx = pricingTx({ cap: '10', order: stamped });
        useTx(tx);
        const error = await OrderService.updatePricing(41, 5, { discount: 20, discountReason: 'Cortesía gerente' }, 21, mesero)
            .catch((e) => e);
        expect(error).toMatchObject({ code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 10, requestedPercent: 20 });
        expect(tx.order.update).not.toHaveBeenCalled();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('re-sending the same reason keeps the stamp and writes no audit', async () => {
        const tx = pricingTx({ cap: '10', order: stamped });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 20, discountReason: 'Error de cocina' }, 21, mesero);
        const data = (tx.order.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data.discountAuthorizedById).toBeUndefined();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
});

describe('manual discount re-cap after a line void', () => {
    const clamp = (tx: unknown, pricing: Record<string, unknown>) =>
        (OrderService as unknown as {
            clampManualDiscountAfterVoid: (...args: unknown[]) => Promise<unknown>;
        }).clampManualDiscountAfterVoid(tx, 5, { id: 41, userId: 21, tipAmount: 0 }, pricing);

    it('does not clamp a supervisor-authorized discount to the requester cap', async () => {
        const tx = {
            order: { findUnique: jest.fn(async () => ({ discountAuthorizedById: 50 })) },
            user: {
                findFirst: jest.fn(async (_args: unknown) => ({ role: { name: 'ADMIN' }, userRoles: [] })),
                findUnique: jest.fn(),
            },
            auditLog: { findFirst: jest.fn(async () => ({ userId: 21 })) },
            setting: { findUnique: jest.fn(async () => ({ value: '10' })) },
        };
        const pricing = { subtotal: 50, discount: 30, discountCode: null, tax: 0, tipAmount: 0, total: 20 };

        expect(await clamp(tx, pricing)).toBeNull();
        expect(pricing.discount).toBe(30);
        expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 50, companyId: 5 } }));
    });
});

// ---------------------------------------------------------------- verifySupervisor

describe('DiscountAuthorizationService.verifySupervisor', () => {
    function infra(opts: {
        dev?: unknown; sup?: unknown; subtotal?: number; deviceFailures?: number; cap?: string | null;
    } = {}) {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const resolve = jest.spyOn(OperationalDeviceService, 'resolveActive')
            .mockResolvedValue((opts.dev === undefined ? device() : opts.dev) as never);
        const attempts = jest.spyOn(prisma.loginAttempt, 'findMany').mockResolvedValue(
            opts.deviceFailures ? [{ failedCount: opts.deviceFailures, lockedUntil: null }] as never : [] as never,
        );
        const findUser = jest.spyOn(prisma.user, 'findFirst')
            .mockResolvedValue((opts.sup === undefined ? supervisor() : opts.sup) as never);
        jest.spyOn(prisma.orderItem, 'aggregate')
            .mockResolvedValue({ _sum: { subtotal: opts.subtotal ?? 100 } } as never);
        jest.spyOn(prisma.setting, 'findUnique')
            .mockResolvedValue((opts.cap == null ? null : { value: opts.cap }) as never);
        const assertAllowed = jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        const failure = jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        const success = jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
        const compare = jest.spyOn(bcrypt, 'compare');
        const audit = mockAuditLog();
        return { resolve, attempts, findUser, assertAllowed, failure, success, compare, audit };
    }
    const input = (over: Record<string, unknown> = {}) => ({
        requester,
        deviceToken: 'tok',
        supervisorUserId: 50,
        pin: PIN,
        orderBranchId: 1,
        orderId: 41,
        requestedDiscount: 40,
        reason: 'Error de cocina',
        ...over,
    });
    const verify = (over: Record<string, unknown> = {}) =>
        DiscountAuthorizationService.verifySupervisor(input(over) as never);

    it('accepts a valid supervisor, clears the failure counter and creates no session', async () => {
        const m = infra();
        const sessionCreate = jest.spyOn(prisma.userSession, 'create');
        const tx = jest.spyOn(prisma, '$transaction');

        const result = await verify();

        expect(result.supervisorUserId).toBe(50);
        expect(m.success).toHaveBeenCalledWith(50, 'discount-auth:device:7');
        expect(m.failure).not.toHaveBeenCalled();
        expect(sessionCreate).not.toHaveBeenCalled();
        expect(tx).not.toHaveBeenCalled();
    });

    const rejections: Array<[string, () => ReturnType<typeof infra>, Record<string, unknown>?]> = [
        ['wrong PIN', () => infra(), { pin: '1357' }],
        ['supervisor without the permission', () => infra({
            sup: supervisor({ role: { name: 'CAJERO', maxDiscountPercent: null, permissions: [{ name: 'orders.discount.apply' }] } }),
        }), {}],
        ['supervisor from another branch', () => infra({ sup: supervisor({ branchId: 2 }) }), {}],
        ['supervisor of another company', () => infra({ sup: supervisor({ companyId: 9 }) }), {}],
        ['inactive supervisor', () => infra({ sup: supervisor({ status: 'INACTIVE' }) }), {}],
        ['supervisor without a PIN', () => infra({ sup: supervisor({ pinHash: null }) }), {}],
        ['supervisor whose own limit is lower', () => infra({
            sup: supervisor({ role: { name: 'CAJERO', maxDiscountPercent: 20, permissions: [{ name: 'orders.discount.authorize' }] } }),
        }), {}],
        ['supervisor limited by the company cap', () => infra({
            cap: '30',
            sup: supervisor({ role: { name: 'CAJERO', maxDiscountPercent: 80, permissions: [{ name: 'orders.discount.authorize' }] } }),
        }), {}],
        ['the requester authorizing themself', () => infra(), { supervisorUserId: 21 }],
    ];

    it.each(rejections)('rejects %s with the same generic message and one bcrypt comparison', async (_label, setup, over) => {
        const m = setup();
        if (over?.supervisorUserId === 21) m.findUser.mockResolvedValue(supervisor({ id: 21 }) as never);
        const error = await verify(over).catch((e) => e);

        expect(error).toBeInstanceOf(DiscountAuthRejectedError);
        expect(error).toMatchObject({ statusCode: 401, message: GENERIC });
        expect(m.compare).toHaveBeenCalledTimes(1);
        expect(m.failure).toHaveBeenCalledWith(expect.any(Number), 'discount-auth:device:7');
        expect(m.success).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown device', { dev: null }],
        ['kitchen tablet', { dev: device({ type: 'KITCHEN_TABLET' }) }],
        ['device of another company', { dev: device({ companyId: 9 }) }],
        ['device of another branch than the order', { dev: device({ branchId: 2 }) }],
        ['unknown supervisor', { sup: null }],
    ])('rejects %s generically with one bcrypt comparison', async (_label, opts) => {
        const m = infra(opts as never);
        const error = await verify().catch((e) => e);
        expect(error).toMatchObject({ statusCode: 401, message: GENERIC });
        expect(m.compare).toHaveBeenCalledTimes(1);
        expect(m.success).not.toHaveBeenCalled();
    });

    const REJECT_LOG = {
        companyId: 5, userId: 21, entityType: 'Order', entityId: 41, action: 'DISCOUNT_AUTH_REJECTED',
    };

    it.each(rejections)('audits DISCOUNT_AUTH_REJECTED for %s, without the PIN (I3)', async (_label, setup, over) => {
        const m = setup();
        if (over?.supervisorUserId === 21) m.findUser.mockResolvedValue(supervisor({ id: 21 }) as never);
        await verify(over).catch(() => undefined);
        expect(m.audit).toHaveBeenCalledTimes(1);
        const entry = m.audit.mock.calls[0][0] as { details: Record<string, unknown> };
        expect(entry).toMatchObject(REJECT_LOG);
        expect(entry.details).toEqual({
            requesterUserId: 21,
            supervisorUserId: (over?.supervisorUserId as number | undefined) ?? 50,
            deviceId: 7, orderId: 41, requestedAmount: 40,
        });
        expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/2580|1357/);
    });

    it.each([
        ['unknown device', { dev: null }, null],
        ['device lock', { deviceFailures: 20 }, 7],
        ['unknown supervisor', { sup: null }, 7],
    ])('audits the early reject path (%s) the same way (I3)', async (_label, opts, deviceId) => {
        const m = infra(opts as never);
        await verify().catch(() => undefined);
        expect(m.audit).toHaveBeenCalledTimes(1);
        expect(m.audit.mock.calls[0][0]).toMatchObject({
            ...REJECT_LOG, details: expect.objectContaining({ deviceId, supervisorUserId: 50, requestedAmount: 40 }),
        });
    });

    it('a failing audit write changes neither the error nor the outcome (I3)', async () => {
        const m = infra();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        m.audit.mockRejectedValue(new Error('db down') as never);
        await expect(verify({ pin: '1357' })).rejects.toMatchObject({ statusCode: 401, message: GENERIC });
    });

    it('does not audit a successful verification as a rejection', async () => {
        const m = infra();
        await verify();
        expect(m.audit).not.toHaveBeenCalled();
    });

    it('a revalidation failure under the order lock is audited outside the transaction', async () => {
        const m = infra();
        const verified = await verify();
        const tx = {
            user: { findFirst: jest.fn(async () => supervisor({ status: 'INACTIVE' })) },
            setting: { findUnique: jest.fn(async () => null) },
            auditLog: { create: jest.fn() },
        };
        await expect(verified.revalidate(tx as never, 100, 40)).rejects.toBeInstanceOf(DiscountAuthRejectedError);
        expect(m.audit).toHaveBeenCalledTimes(1);
        expect(m.audit.mock.calls[0][1]).toBeUndefined();
        expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('a requester from another branch cannot use a tablet of this branch', async () => {
        const m = infra();
        const error = await verify({ requester: { ...requester, branchId: 2 } }).catch((e) => e);
        expect(error).toMatchObject({ statusCode: 401, message: GENERIC });
        expect(m.findUser).not.toHaveBeenCalled();
    });

    it('5 wrong supervisor PINs lock that supervisor on that device (even for the right PIN)', async () => {
        const m = infra();
        let failures = 0;
        m.failure.mockImplementation((async () => { failures += 1; }) as never);
        m.assertAllowed.mockImplementation((async () => {
            if (failures >= 5) throw new Error('Account temporarily locked. Try again in 15 minutes');
        }) as never);

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await expect(verify({ pin: '1357' })).rejects.toMatchObject({ statusCode: 401, message: GENERIC });
        }
        expect(m.failure).toHaveBeenCalledTimes(5);
        expect(m.failure).toHaveBeenLastCalledWith(50, 'discount-auth:device:7');

        m.compare.mockClear();
        await expect(verify({ pin: PIN })).rejects.toMatchObject({ statusCode: 401, message: GENERIC });
        expect(m.success).not.toHaveBeenCalled();
        expect(m.compare).toHaveBeenCalledTimes(1); // dummy hash: no timing difference
    });

    it('20 failures on the device within the window reject every supervisor generically', async () => {
        const m = infra({ deviceFailures: 20 });
        const error = await verify().catch((e) => e);

        expect(error).toMatchObject({ statusCode: 401, message: GENERIC });
        expect(m.attempts).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ ipKey: 'discount-auth:device:7' }),
        }));
        expect(m.findUser).not.toHaveBeenCalled();
        expect(m.success).not.toHaveBeenCalled();
        expect(m.compare).toHaveBeenCalledTimes(1);
    });

    it('counts a locked per-supervisor row as 5 guesses toward the device cap', async () => {
        const m = infra();
        m.attempts.mockResolvedValue([
            { failedCount: 0, lockedUntil: new Date(Date.now() + 60_000) },
            { failedCount: 0, lockedUntil: new Date(Date.now() + 60_000) },
            { failedCount: 0, lockedUntil: new Date(Date.now() + 60_000) },
            { failedCount: 0, lockedUntil: new Date(Date.now() + 60_000) },
        ] as never);
        await expect(verify()).rejects.toMatchObject({ message: GENERIC });
        expect(m.findUser).not.toHaveBeenCalled();
    });

    it('19 failures on the device still allow a correct PIN', async () => {
        infra({ deviceFailures: 19 });
        await expect(verify()).resolves.toMatchObject({ supervisorUserId: 50 });
    });

    it('revalidate re-reads the supervisor under the lock and rejects a revoked permission', async () => {
        infra();
        const verified = await verify();
        const tx = {
            user: { findFirst: jest.fn(async () => supervisor({ role: { name: 'CAJERO', maxDiscountPercent: null, permissions: [] } })) },
            setting: { findUnique: jest.fn(async () => null) },
        };
        await expect(verified.revalidate(tx as never, 100, 40)).rejects.toBeInstanceOf(DiscountAuthRejectedError);
    });

    it('revalidate rejects when the clamped discount exceeds the supervisor limit over the locked subtotal', async () => {
        infra({ sup: supervisor({ role: { name: 'CAJERO', maxDiscountPercent: 50, permissions: [{ name: 'orders.discount.authorize' }] } }) });
        const verified = await verify({ requestedDiscount: 40 });
        const tx = {
            user: { findFirst: jest.fn(async () => supervisor({ role: { name: 'CAJERO', maxDiscountPercent: 50, permissions: [{ name: 'orders.discount.authorize' }] } })) },
            setting: { findUnique: jest.fn(async () => null) },
        };
        await expect(verified.revalidate(tx as never, 100, 50)).resolves.toBeUndefined();
        await expect(verified.revalidate(tx as never, 100, 50.01)).rejects.toBeInstanceOf(DiscountAuthRejectedError);
    });

    it('onApplied audits requester, authorizer, amount, percent and reason, never the PIN', async () => {
        infra();
        const verified = await verify();
        const create = jest.fn(async (_args: unknown) => ({}));

        await verified.onApplied({ auditLog: { create } } as never, {
            subtotal: 100, discount: 40, percent: 40, previousDiscount: 0,
        });

        const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
        expect(data).toMatchObject({
            companyId: 5, userId: 21, entityType: 'Order', entityId: 41, action: 'DISCOUNT_AUTHORIZED',
        });
        expect(data.details).toEqual({
            requesterUserId: 21, authorizerUserId: 50, amount: 40, percent: 40, subtotal: 100,
            previousDiscount: 0, reason: 'Error de cocina', deviceId: 7,
        });
        expect(JSON.stringify(create.mock.calls)).not.toContain(PIN);
    });
});

describe('DiscountAuthorizationService.listSupervisors', () => {
    it('returns id, name, initials and color of PIN-holding supervisors of the device branch', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device() as never);
        const find = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([
            { id: 50, name: 'Sofia Rojas', color: '#abc' },
            { id: 51, name: 'Mario', color: null },
        ] as never);

        const list = await DiscountAuthorizationService.listSupervisors('tok', requester);

        expect(list).toEqual([
            { id: 50, name: 'Sofia Rojas', initials: 'SR', color: '#abc' },
            { id: 51, name: 'Mario', initials: 'M', color: null },
        ]);
        const where = (find.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toMatchObject({ companyId: 5, status: 'ACTIVE', pinHash: { not: null }, id: { not: 21 } });
        expect(JSON.stringify(find.mock.calls[0][0])).toContain('orders.discount.authorize');
        expect(JSON.stringify(list)).not.toMatch(/pin/i);
    });

    it('rejects an unknown or foreign device generically', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(null);
        const find = jest.spyOn(prisma.user, 'findMany');
        await expect(DiscountAuthorizationService.listSupervisors('tok', requester))
            .rejects.toBeInstanceOf(DiscountAuthRejectedError);
        expect(find).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------- controllers

describe('POST /orders/:id/discount/authorize', () => {
    const res = () => {
        const r = { json: jest.fn(), status: jest.fn() } as unknown as Response;
        (r.status as jest.Mock).mockReturnValue(r);
        return r;
    };
    const req = (body: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
        params: { id: '41' },
        headers: { 'x-device-token': 'tok' },
        body,
        user: requester,
        ...over,
    }) as unknown as Request;
    const body = { supervisorUserId: 50, pin: PIN, discount: 40, discountReason: 'Error de cocina' };

    function wire() {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(OrderService, 'getById').mockResolvedValue({ id: 41, branchId: 1 } as never);
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device() as never);
        jest.spyOn(prisma.loginAttempt, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(supervisor() as never);
        jest.spyOn(prisma.orderItem, 'aggregate').mockResolvedValue({ _sum: { subtotal: 100 } } as never);
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue(null as never);
        jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        const failure = jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
        const rejectedAudit = mockAuditLog();
        const tx = pricingTx({ cap: '10' });
        const transaction = jest.spyOn(prisma, '$transaction')
            .mockImplementation((async (cb: (db: unknown) => unknown) => cb({
                ...tx,
                user: { ...tx.user, findFirst: jest.fn(async () => supervisor()) },
            })) as never);
        const txState = tx;
        const broadcast = jest.spyOn(WebSocketService, 'broadcastOrderUpdate').mockImplementation(() => undefined as never);
        return { tx: txState, transaction, broadcast, failure, rejectedAudit };
    }

    it('authorize applies discount, reason and authorizer atomically and audits', async () => {
        const w = wire();
        const response = res();
        const next = jest.fn();

        await OrderController.authorizeDiscount(req(body), response, next as unknown as NextFunction);

        expect(next).not.toHaveBeenCalled();
        expect(w.transaction).toHaveBeenCalledTimes(1);
        expect(w.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                discount: 40, discountCode: null, discountReason: 'Error de cocina', discountAuthorizedById: 50,
            }),
        }));
        const audits = w.tx.auditLog.create.mock.calls.map((call) => (call[0] as { data: Record<string, unknown> }).data);
        expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['PRICING_UPDATED', 'DISCOUNT_AUTHORIZED']));
        const authorized = audits.find((a) => a.action === 'DISCOUNT_AUTHORIZED')!;
        expect(authorized.userId).toBe(21);
        expect(authorized.details).toMatchObject({
            requesterUserId: 21, authorizerUserId: 50, amount: 40, percent: 40, reason: 'Error de cocina',
        });
        expect(JSON.stringify(audits)).not.toContain(PIN);
        expect(w.broadcast).toHaveBeenCalled();
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('never logs the PIN', async () => {
        wire();
        const warn = jest.spyOn(console, 'warn');
        const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await OrderController.authorizeDiscount(req(body), res(), jest.fn() as unknown as NextFunction);
        await OrderController.authorizeDiscount(req({ ...body, pin: '1357' }), res(), jest.fn() as unknown as NextFunction);

        for (const spy of [warn, log, error]) {
            expect(JSON.stringify(spy.mock.calls)).not.toMatch(/2580|1357/);
        }
    });

    it('a wrong PIN returns the generic 401 and applies nothing', async () => {
        const w = wire();
        const response = res();

        await OrderController.authorizeDiscount(req({ ...body, pin: '1357' }), response, jest.fn() as unknown as NextFunction);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({ success: false, message: GENERIC });
        expect(w.transaction).not.toHaveBeenCalled();
        expect(w.failure).toHaveBeenCalledWith(50, 'discount-auth:device:7');
    });

    it.each([
        ['non-numeric supervisor', { supervisorUserId: '50' }],
        ['short PIN', { pin: '12' }],
        ['numeric PIN', { pin: 2580 }],
        ['missing PIN', { pin: undefined }],
    ])('a malformed credential (%s) is the same generic 401', async (_label, over) => {
        const w = wire();
        const response = res();
        await OrderController.authorizeDiscount(req({ ...body, ...over }), response, jest.fn() as unknown as NextFunction);
        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({ success: false, message: GENERIC });
        expect(w.transaction).not.toHaveBeenCalled();
    });

    it.each([
        ['no reason', { discountReason: undefined }],
        ['short reason', { discountReason: 'ab' }],
        ['zero discount', { discount: 0 }],
        ['string discount', { discount: '40' }],
        ['negative discount', { discount: -5 }],
    ])('rejects %s with 400 before checking any credential', async (_label, over) => {
        const w = wire();
        const next = jest.fn();
        await OrderController.authorizeDiscount(req({ ...body, ...over }), res(), next as unknown as NextFunction);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        expect(w.transaction).not.toHaveBeenCalled();
        expect(w.failure).not.toHaveBeenCalled();
    });

    it('a requester without orders.discount.apply may still obtain a supervisor authorization (M4)', async () => {
        const w = wire();
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue({ id: 1 } as never);
        const response = res();
        await OrderController.authorizeDiscount(
            req(body, { user: { ...requester, permissions: [] } }), response, jest.fn() as unknown as NextFunction);
        expect(response.status).not.toHaveBeenCalledWith(403);
        expect(w.transaction).toHaveBeenCalled();
    });

    it('an authorize call with an idempotency key stores no row and a replay with another PIN is really verified (I2)', async () => {
        const { idempotency } = require('../../middlewares/idempotency') as typeof import('../../middlewares/idempotency');
        const w = wire();
        const create = jest.spyOn(prisma.idempotencyRecord, 'create');
        const find = jest.spyOn(prisma.idempotencyRecord, 'findUnique');
        const authorizeReq = (pin: string) => ({
            ...req({ ...body, pin }),
            headers: { 'x-device-token': 'tok', authorization: 'Bearer t', 'x-idempotency-key': 'k-1' },
            method: 'POST', originalUrl: '/api/orders/41/discount/authorize', authContextValidated: true,
        }) as unknown as Request;

        // First, successful call goes through the idempotency middleware untouched.
        const next1 = jest.fn();
        await idempotency(authorizeReq(PIN), res(), next1 as unknown as NextFunction);
        expect(next1).toHaveBeenCalledWith();
        await OrderController.authorizeDiscount(authorizeReq(PIN), res(), jest.fn() as unknown as NextFunction);

        // Replay with the same key but a wrong PIN: not 409, not a stored 200 - the real check runs.
        const next2 = jest.fn();
        await idempotency(authorizeReq('1357'), res(), next2 as unknown as NextFunction);
        expect(next2).toHaveBeenCalledWith();
        const response = res();
        await OrderController.authorizeDiscount(authorizeReq('1357'), response, jest.fn() as unknown as NextFunction);
        expect(response.status).toHaveBeenCalledWith(401);
        expect(w.failure).toHaveBeenCalledWith(50, 'discount-auth:device:7');
        expect(create).not.toHaveBeenCalled();
        expect(find).not.toHaveBeenCalled();
    });

    it('the PATCH pricing 403 DISCOUNT_AUTH_REQUIRED carries both percents and applies nothing', async () => {
        const w = wire();
        const response = res();
        const next = jest.fn();

        await OrderController.updatePricing(
            req({ discount: 40, discountCode: null, discountReason: 'Error de cocina' }),
            response, next as unknown as NextFunction);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false, code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 10, requestedPercent: 40,
        }));
        expect(w.tx.order.update).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('the PATCH pricing with a reason and no orders.discount.apply answers 403 DISCOUNT_AUTH_REQUIRED (M4)', async () => {
        const w = wire();
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue({ id: 1 } as never);
        const response = res();
        await OrderController.updatePricing(
            req({ discount: 5, discountReason: 'Cortesía' }, { user: { ...requester, permissions: [] } }),
            response, jest.fn() as unknown as NextFunction);
        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 0, requestedPercent: 5,
        }));
        expect(w.tx.order.update).not.toHaveBeenCalled();
    });

    it('the PATCH pricing with a reason falls back to today\'s rule when the permission is not defined', async () => {
        const w = wire();
        jest.spyOn(prisma.permission, 'findUnique').mockResolvedValue(null as never);
        const response = res();
        await OrderController.updatePricing(
            req({ discount: 5, discountReason: 'Cortesía' }, { user: { ...requester, permissions: [] } }),
            response, jest.fn() as unknown as NextFunction);
        expect(response.status).not.toHaveBeenCalled();
        expect(w.tx.order.update).toHaveBeenCalled();
    });
});

describe('GET /auth/me/discount-limit', () => {
    it('returns the caller\'s limit', async () => {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ role: { maxDiscountPercent: null }, userRoles: [] } as never);
        jest.spyOn(prisma.setting, 'findUnique').mockResolvedValue({ value: '12' } as never);
        const json = jest.fn();
        await AuthController.myDiscountLimit(
            { user: requester } as unknown as Request, { json } as unknown as Response, jest.fn() as unknown as NextFunction);
        expect(json).toHaveBeenCalledWith({ success: true, data: { limitPercent: 12 } });
    });

    it('is exempt from the shared credential limiter (it checks no credential)', () => {
        expect(isLenientSessionPath('/me/discount-limit')).toBe(true);
        expect(isLenientSessionPath('/ME/discount-limit/')).toBe(true);
    });
});

// ---------------------------------------------------------------- PIN rules

describe('supervisor PINs', () => {
    it('PinService.setPin lets a user with orders.discount.authorize set a PIN', async () => {
        const PASSWORD = 'Correct-Horse-9';
        jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            id: 9, companyId: 5, status: 'ACTIVE', password: bcrypt.hashSync(PASSWORD, 4),
            role: { name: 'ADMIN', permissions: [{ name: 'orders.discount.authorize' }] },
            userRoles: [],
        } as never);
        const update = jest.fn(async (_args: unknown) => ({}));
        jest.spyOn(prisma, '$transaction').mockImplementation((async (cb: (tx: unknown) => unknown) =>
            cb({ user: { update }, auditLog: { create: jest.fn(async () => ({})) } })) as never);

        await PinService.setPin(9, '2580', PASSWORD, '10.0.0.1');
        expect(update).toHaveBeenCalledTimes(1);
    });

    it('PinService.setPin still rejects an ADMIN without the permission', async () => {
        const PASSWORD = 'Correct-Horse-9';
        jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            id: 9, companyId: 5, status: 'ACTIVE', password: bcrypt.hashSync(PASSWORD, 4),
            role: { name: 'ADMIN', permissions: [{ name: 'orders.view' }] },
            userRoles: [],
        } as never);
        const tx = jest.spyOn(prisma, '$transaction');
        await expect(PinService.setPin(9, '2580', PASSWORD, '10.0.0.1')).rejects.toThrow();
        expect(tx).not.toHaveBeenCalled();
    });

    it('an ADMIN with a PIN still cannot pin-login', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device() as never);
        jest.spyOn(prisma.loginAttempt, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(loginAttemptService, 'assertAllowed').mockResolvedValue(undefined);
        const failure = jest.spyOn(loginAttemptService, 'recordFailure').mockResolvedValue(undefined);
        const success = jest.spyOn(loginAttemptService, 'recordSuccess').mockResolvedValue(undefined);
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
            id: 50, companyId: 5, branchId: 1, name: 'Sofia', status: 'ACTIVE', pinHash,
            role: { id: 1, name: 'ADMIN', permissions: [{ name: 'orders.discount.authorize' }] },
            userRoles: [],
            company: { id: 5, active: true }, branch: { status: 'ACTIVE' }, allowedBranches: [], employee: null,
        } as never);
        const tx = jest.spyOn(prisma, '$transaction');

        await expect(AuthService.pinLogin({ deviceToken: 'tok', userId: 50, pin: PIN }))
            .rejects.toThrow('Credenciales inválidas');

        expect(tx).not.toHaveBeenCalled(); // no session
        expect(success).not.toHaveBeenCalled();
        expect(failure).toHaveBeenCalled();
    });

    it('the pin-login roster never lists a supervisor outside PIN_ROLES', async () => {
        jest.spyOn(OperationalDeviceService, 'resolveActive').mockResolvedValue(device() as never);
        const find = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([] as never);
        await AuthService.deviceRoster('tok');
        expect(JSON.stringify(find.mock.calls[0][0])).toContain('notIn');
    });
});

// ---------------------------------------------------------------- fix round 1

describe('reason-less PATCH /pricing enforces a role maxDiscountPercent', () => {
    const cajero = { role: 'CAJERO', roles: ['CAJERO'] };

    it('CAJERO with a 5% limit sending 8% with no reason gets DISCOUNT_AUTH_REQUIRED', async () => {
        const tx = pricingTx({ roleLimit: 5 });
        useTx(tx);
        const error = await OrderService.updatePricing(41, 5, { discount: 8 }, 22, cajero).catch((e) => e);
        expect(error).toBeInstanceOf(DiscountAuthRequiredError);
        expect(error).toMatchObject({ statusCode: 403, code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 5, requestedPercent: 8 });
        expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('the same CAJERO sending 5% is applied', async () => {
        const tx = pricingTx({ roleLimit: 5 });
        useTx(tx);
        await OrderService.updatePricing(41, 5, { discount: 5 }, 22, cajero);
        expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ discount: 5 }),
        }));
    });

    it('a role with a null limit keeps the legacy behaviour (uncapped CAJERO, capped MESERO text)', async () => {
        const open = pricingTx({ cap: '10', roleLimit: null });
        useTx(open);
        await OrderService.updatePricing(41, 5, { discount: 60 }, 22, cajero);
        expect(open.order.update).toHaveBeenCalled();

        jest.restoreAllMocks();
        const capped = pricingTx({ cap: '10', roleLimit: null });
        useTx(capped);
        await expect(OrderService.updatePricing(41, 5, { discount: 20 }, 21, mesero))
            .rejects.toThrow(/El descuento manual excede el máximo permitido para su rol/);
    });

    it('the role limit is a ceiling under the company cap on the reason-less path too', async () => {
        const tx = pricingTx({ cap: '3', roleLimit: 50 });
        useTx(tx);
        await expect(OrderService.updatePricing(41, 5, { discount: 4 }, 22, cajero))
            .rejects.toMatchObject({ code: 'DISCOUNT_AUTH_REQUIRED', limitPercent: 3 });
    });
});

describe('removing or shrinking unsent lines re-caps the manual discount', () => {
    type Role = { name: string; maxDiscountPercent: number | null };
    function lineTx(o: {
        discount: number; remaining: number; author: Role; authorizerId?: number | null; authorizedPercent?: number | null;
        lastPricingUser?: number | null; cap?: string | null;
        audits?: Array<{ userId: number; details: Record<string, number> }>;
        roleOf?: Record<number, Role>;
    }) {
        const item = {
            id: 10, orderId: 41, menuItemId: 3, quantity: 4, price: 25, sentAt: null, voidedAt: null,
            order: {
                id: 41, userId: 21, companyId: 5, branchId: 1, status: 'OPEN', invoiceNumber: null, preInvoicedAt: null,
                payments: [], discount: o.discount, discountCode: null, tipAmount: 0,
            },
        };
        return {
            $queryRaw: jest.fn(async () => []),
            orderItem: {
                findFirst: jest.fn(async (_a: unknown) => ({ orderId: 41 })),
                findUnique: jest.fn(async (_a: unknown) => item),
                delete: jest.fn(async (_a: unknown) => ({})),
                update: jest.fn(async (_a: unknown) => ({ id: 10, orderId: 41 })),
                findMany: jest.fn(async (_a: unknown) => [{ subtotal: o.remaining }]),
            },
            kitchenBatch: { count: jest.fn(async () => 0) },
            order: {
                findUnique: jest.fn(async (_a: unknown) => ({
                    discountAuthorizedById: o.authorizerId ?? null,
                    discountAuthorizedPercent: o.authorizedPercent ?? null,
                })),
                update: jest.fn(async (args: unknown) => args),
            },
            user: {
                findFirst: jest.fn(async (a: { where: { id: number } }) =>
                    ({ role: o.roleOf?.[a.where.id] ?? o.author, userRoles: [] })),
            },
            setting: {
                findMany: jest.fn(async () => [{ name: '5_tax_rate', value: '15' }]),
                findUnique: jest.fn(async (args: { where: { companyId_name: { name: string } } }) =>
                    args.where.companyId_name.name.endsWith('_maxManualDiscountPercent') && o.cap != null ? { value: o.cap } : null),
            },
            auditLog: {
                findMany: jest.fn(async (_a: unknown) => o.audits
                    ?? (o.lastPricingUser === null
                        ? []
                        : [{ userId: o.lastPricingUser ?? 21, details: { previousDiscount: 0, discount: o.discount } }])),
                create: jest.fn(async (_args: unknown) => ({})),
            },
        };
    }
    const orderUpdate = (tx: ReturnType<typeof lineTx>) =>
        (tx.order.update.mock.calls[0][0] as { data: Record<string, number> }).data;
    const clampAudit = (tx: ReturnType<typeof lineTx>) => tx.auditLog.create.mock.calls
        .map((c) => (c[0] as { data: { action: string; details: Record<string, unknown>; userId: number } }).data)
        .find((d) => d.action === 'MANUAL_DISCOUNT_CLAMPED');
    const actions = [
        ['removeItem', (actor?: number) => OrderService.removeItem(10, 5, 1, actor)],
        ['updateItem quantity decrease', (actor?: number) => OrderService.updateItem(10, 5, 1, { quantity: 2 }, actor)],
    ] as const;

    it.each(actions)('%s: a MESERO own-limit discount is re-capped to the cap over the new subtotal', async (_n, run) => {
        const tx = lineTx({ discount: 10, remaining: 50, author: { name: 'MESERO', maxDiscountPercent: null }, cap: '10' });
        useTx(tx);

        await run(21);

        expect(orderUpdate(tx).discount).toBe(5); // 10% of 50, not 20%
        const audit = clampAudit(tx)!;
        expect(audit.details).toMatchObject({ previousDiscount: 10, discount: 5, maxPercent: 10, limitOwnerUserId: 21 });
        expect(audit.userId).toBe(21);
    });

    it.each(actions)('%s: a supervisor-authorized discount is re-capped to the AUTHORIZER limit', async (_n, run) => {
        const tx = lineTx({
            discount: 30, remaining: 50, author: { name: 'CAJERO', maxDiscountPercent: 30 }, authorizerId: 50,
        });
        useTx(tx);

        await run(21);

        expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 50, companyId: 5 } }));
        expect(orderUpdate(tx).discount).toBe(15);
        expect(clampAudit(tx)!.details).toMatchObject({ maxPercent: 30, limitOwnerUserId: 50 });
    });

    it.each(actions)('%s: an ADMIN-authorized discount is re-capped to the AUTHORIZED percent, not the ADMIN limit (I1)', async (_n, run) => {
        // 12% of a padded 1200 bill = 144; the padding lines are then removed (remaining 200).
        const tx = lineTx({
            discount: 144, remaining: 200, author: { name: 'ADMIN', maxDiscountPercent: null },
            authorizerId: 50, authorizedPercent: 12, cap: '10',
        });
        useTx(tx);
        await run(21);
        expect(orderUpdate(tx).discount).toBe(24); // 12% of 200, not 72%
        expect(clampAudit(tx)!.details).toMatchObject({ previousDiscount: 144, discount: 24, maxPercent: 12, limitOwnerUserId: 50 });
    });

    it.each(actions)('%s: the authorized percent never raises the authorizer role limit', async (_n, run) => {
        const tx = lineTx({
            discount: 30, remaining: 50, author: { name: 'CAJERO', maxDiscountPercent: 30 },
            authorizerId: 50, authorizedPercent: 60,
        });
        useTx(tx);
        await run(21);
        expect(orderUpdate(tx).discount).toBe(15); // min(30, 60)
    });

    it.each(actions)('%s: an authorized discount still within its authorized percent is left alone', async (_n, run) => {
        const tx = lineTx({
            discount: 6, remaining: 50, author: { name: 'ADMIN', maxDiscountPercent: null },
            authorizerId: 50, authorizedPercent: 12,
        });
        useTx(tx);
        await run(21);
        expect(orderUpdate(tx).discount).toBe(6);
        expect(clampAudit(tx)).toBeUndefined();
    });

    it.each(actions)('%s: an untracked applier falls back to the order creator, never the acting ADMIN', async (_n, run) => {
        const tx = lineTx({
            discount: 10, remaining: 50, author: { name: 'MESERO', maxDiscountPercent: null }, cap: '10', lastPricingUser: null,
            roleOf: { 7: { name: 'ADMIN', maxDiscountPercent: null } },
        });
        useTx(tx);

        await run(7); // an ADMIN shrinks the lines of a waiter-created discount

        expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 21, companyId: 5 } }));
        expect(orderUpdate(tx).discount).toBe(5);
    });

    it.each(actions)('%s: a later tip-only edit by a MESERO does not take over an ADMIN discount', async (_n, run) => {
        const tx = lineTx({
            discount: 30, remaining: 50, author: { name: 'MESERO', maxDiscountPercent: null }, cap: '10',
            audits: [
                { userId: 21, details: { previousDiscount: 30, discount: 30 } }, // tip-only, newest
                { userId: 7, details: { previousDiscount: 0, discount: 30 } },
            ],
            roleOf: { 7: { name: 'ADMIN', maxDiscountPercent: null } },
        });
        useTx(tx);

        await run(21);

        expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, companyId: 5 } }));
        expect(orderUpdate(tx).discount).toBe(30);
        expect(clampAudit(tx)).toBeUndefined();
    });

    it.each(actions)('%s: a later tip-only edit by an ADMIN does not free a MESERO discount', async (_n, run) => {
        const tx = lineTx({
            discount: 10, remaining: 50, author: { name: 'MESERO', maxDiscountPercent: null }, cap: '10',
            audits: [
                { userId: 7, details: { previousDiscount: 10, discount: 10 } }, // tip-only, newest
                { userId: 21, details: { previousDiscount: 0, discount: 10 } },
            ],
            roleOf: { 7: { name: 'ADMIN', maxDiscountPercent: null } },
        });
        useTx(tx);

        await run(7);

        expect(tx.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 21, companyId: 5 } }));
        expect(orderUpdate(tx).discount).toBe(5);
    });

    it.each(actions)('%s: a discount within the limit is left alone and nothing is audited', async (_n, run) => {
        const tx = lineTx({ discount: 4, remaining: 50, author: { name: 'MESERO', maxDiscountPercent: null }, cap: '10' });
        useTx(tx);
        await run(21);
        expect(orderUpdate(tx).discount).toBe(4);
        expect(clampAudit(tx)).toBeUndefined();
    });
});
