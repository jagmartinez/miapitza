import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../../utils/prisma';
import { HrBenefitsController } from '../../controllers/hr-benefits.controller';
import { HrWorkforceController } from '../../controllers/hr-workforce.controller';
import { AuthController } from '../../controllers/auth.controller';
import { PinService } from '../../services/pin.service';

afterEach(() => {
    jest.restoreAllMocks();
});

const D = (v: string) => new Prisma.Decimal(v);
const policyRow = {
    id: 3, currency: 'NIO', loanMinTenureMonths: 6, loanMaxAmount: D('5000.00'),
    loanMaxInstallments: 12, loanMaxPaymentPercent: D('30.00'),
};
const internalUser = { id: 9, name: 'Ana', username: 'ana', employee: { id: 4, status: 'ACTIVE' } };

function mkRes() {
    const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
    (res.status as jest.Mock).mockReturnValue(res);
    return res;
}
function mkReq(over: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return {
        user: { userId: 9, companyId: 1, accountType: 'INTERNAL', employeeId: 4, roles: ['MESERO'], role: 'MESERO', permissions: [] },
        params: {}, body: {}, query: {},
        get: (name: string) => headers[name],
        ...over,
    } as unknown as Request;
}
function mockSelf() {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(internalUser as never);
}
function mockEmployee(hireDate: Date) {
    jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue({ hireDate, compensation: [] } as never);
}
const monthsAgo = (n: number) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - n);
    d.setUTCDate(1);
    return d;
};
const lastJson = (res: Response) => (res.json as jest.Mock).mock.calls[0][0] as { data: Record<string, unknown> };

describe('GET /hr/benefits/me/loan-policy', () => {
    it('loan-policy returns current limits and eligibility from the same rules as loan-requests', async () => {
        mockSelf();
        jest.spyOn(prisma.hrBenefitPolicyVersion, 'findFirst').mockResolvedValue(policyRow as never);
        mockEmployee(monthsAgo(14));
        const res = mkRes();
        await HrBenefitsController.myLoanPolicy(mkReq(), res, jest.fn() as NextFunction);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: {
                currency: 'NIO', maxAmount: '5000.00', maxInstallments: 12, maxPaymentPercent: 30,
                minTenureMonths: 6, eligible: true, ineligibleReason: null, tenureMonths: 14,
            },
        });
    });

    it('loan-policy ineligible by tenure', async () => {
        mockSelf();
        jest.spyOn(prisma.hrBenefitPolicyVersion, 'findFirst').mockResolvedValue(policyRow as never);
        mockEmployee(monthsAgo(2));
        const res = mkRes();
        await HrBenefitsController.myLoanPolicy(mkReq(), res, jest.fn() as NextFunction);
        expect(lastJson(res).data).toMatchObject({ eligible: false, ineligibleReason: 'HR_LOAN_TENURE_POLICY', tenureMonths: 2 });
    });

    it('loan-policy without an active policy reports HR_LOAN_POLICY_DISABLED', async () => {
        mockSelf();
        jest.spyOn(prisma.hrBenefitPolicyVersion, 'findFirst').mockResolvedValue(null);
        mockEmployee(monthsAgo(20));
        const res = mkRes();
        await HrBenefitsController.myLoanPolicy(mkReq(), res, jest.fn() as NextFunction);
        expect(lastJson(res).data).toMatchObject({
            eligible: false, ineligibleReason: 'HR_LOAN_POLICY_DISABLED', maxAmount: null,
            maxInstallments: null, maxPaymentPercent: null, minTenureMonths: null, tenureMonths: 20,
        });
    });
});

describe('POST /hr/benefits/me/loan-requests/:id/cancel', () => {
    const loan = (over: Record<string, unknown> = {}) => ({
        id: 7, companyId: 1, userId: 9, status: 'REQUESTED', revision: 2, currency: 'NIO',
        requestedAmount: D('100.00'), outstandingBalance: D('0'), ...over,
    });
    function mockTx(found: unknown) {
        const stored: Record<string, unknown> = {};
        const tx = {
            hrBenefitIdempotencyRecord: {
                create: (jest.fn() as jest.Mock<any>).mockImplementation(async (a: any) => { Object.assign(stored, a.data); return { id: 1 }; }),
                update: (jest.fn() as jest.Mock<any>).mockImplementation(async (a: any) => { stored.response = a.data.response; return {}; }),
            },
            hrLoan: {
                findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(found),
                updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 1 }),
                findUniqueOrThrow: (jest.fn() as jest.Mock<any>).mockResolvedValue({
                    ...(found as object), status: 'CANCELLED', user: internalUser, scheduleVersions: [], ledger: [],
                }),
            },
            hrBenefitTrace: { create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}), findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]) },
        };
        jest.spyOn(prisma.hrBenefitIdempotencyRecord, 'findUnique').mockImplementation((async () =>
            (stored.response === undefined ? null : stored)) as never);
        jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: (t: unknown) => unknown) => fn(tx)) as never);
        return tx;
    }
    const cancelReq = (key = 'k1') => mkReq({ params: { id: '7' }, body: { reason: 'ya no lo necesito' } }, { 'Idempotency-Key': key });

    it('cancel own REQUESTED loan request → CANCELLED + audit', async () => {
        mockSelf();
        const tx = mockTx(loan());
        const res = mkRes();
        await HrBenefitsController.myLoanCancel(cancelReq(), res, jest.fn() as NextFunction);
        expect(tx.hrLoan.findFirst.mock.calls[0][0]).toMatchObject({ where: { id: 7, companyId: 1, userId: 9 } });
        expect(tx.hrLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7, companyId: 1, revision: 2 },
            data: expect.objectContaining({ status: 'CANCELLED' }),
        }));
        expect(tx.hrBenefitTrace.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                resourceType: 'LOAN', resourceId: 7, event: 'CANCEL', actorId: 9,
                fromStatus: 'REQUESTED', toStatus: 'CANCELLED', reason: 'ya no lo necesito',
            }),
        });
        expect(res.status).not.toHaveBeenCalled();
        expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({ success: true, data: { status: 'CANCELLED' } });
    });

    it("cancel other user's request → 404", async () => {
        mockSelf();
        mockTx(null);
        const res = mkRes();
        await HrBenefitsController.myLoanCancel(cancelReq(), res, jest.fn() as NextFunction);
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'HR_LOAN_REQUEST_NOT_FOUND' }));
    });

    it('cancel APPROVED → 409 HR_LOAN_REQUEST_NOT_CANCELLABLE', async () => {
        mockSelf();
        const tx = mockTx(loan({ status: 'APPROVED' }));
        const res = mkRes();
        await HrBenefitsController.myLoanCancel(cancelReq(), res, jest.fn() as NextFunction);
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'HR_LOAN_REQUEST_NOT_CANCELLABLE' }));
        expect(tx.hrLoan.updateMany).not.toHaveBeenCalled();
    });

    it('cancel replay with same Idempotency-Key returns same response', async () => {
        mockSelf();
        const tx = mockTx(loan());
        const res1 = mkRes();
        await HrBenefitsController.myLoanCancel(cancelReq('same'), res1, jest.fn() as NextFunction);
        const res2 = mkRes();
        await HrBenefitsController.myLoanCancel(cancelReq('same'), res2, jest.fn() as NextFunction);
        expect(tx.hrLoan.updateMany).toHaveBeenCalledTimes(1);
        expect((res2.json as jest.Mock).mock.calls[0][0]).toEqual(
            JSON.parse(JSON.stringify((res1.json as jest.Mock).mock.calls[0][0]))
        );
    });
});

describe('GET /auth/me', () => {
    async function callMe(roles: string[], permissions: string[], pinHash: string | null) {
        jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ pinHash } as never);
        const res = mkRes();
        const req = mkReq({ user: { userId: 9, companyId: 1, role: roles[0], roles, permissions } });
        await AuthController.me(req, res, jest.fn() as NextFunction);
        return lastJson(res);
    }

    it('auth/me exposes hasPin and canUsePin (waiter true, admin-without-discount false)', async () => {
        const waiter = await callMe(['MESERO'], [], 'hash');
        expect(waiter.data).toMatchObject({ userId: 9, hasPin: true, canUsePin: true });
        const admin = await callMe(['ADMIN'], ['hr.workforce.self'], null);
        expect(admin.data).toMatchObject({ hasPin: false, canUsePin: false });
        const supervisor = await callMe(['ADMIN'], ['orders.discount.authorize'], null);
        expect(supervisor.data).toMatchObject({ canUsePin: true });
        expect(PinService.canUsePin(['MESERO'], [])).toBe(true);
        expect(PinService.canUsePin(['ADMIN'], [])).toBe(false);
    });
});

describe('GET /hr/me/employee', () => {
    it('me/employee returns summary; no employeeId → 403 like other self routes', async () => {
        jest.spyOn(prisma.employee, 'findFirst').mockResolvedValue({
            employeeCode: 'E-004', legalName: 'Ana Perez', preferredName: null,
            hireDate: new Date('2024-03-05T00:00:00.000Z'), workEmail: 'ana@x.com', workPhone: '555',
            emergencyContactName: 'Luis', emergencyContactPhone: '777',
            jobPosition: { name: 'Mesera' },
            branchAssignments: [{ branch: { name: 'Centro' } }],
        } as never);
        const res = mkRes();
        await HrWorkforceController.myEmployee(mkReq(), res, jest.fn() as NextFunction);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: {
                code: 'E-004', fullName: 'Ana Perez', position: 'Mesera', branchName: 'Centro',
                hireDate: '2024-03-05', workEmail: 'ana@x.com', workPhone: '555',
                emergencyContactName: 'Luis', emergencyContactPhone: '777',
            },
        });
        const res2 = mkRes();
        await HrWorkforceController.myEmployee(
            mkReq({ user: { userId: 9, companyId: 1, accountType: 'INTERNAL', roles: ['MESERO'], role: 'MESERO', permissions: [] } }),
            res2, jest.fn() as NextFunction
        );
        expect(res2.status).toHaveBeenCalledWith(403);
    });
});
