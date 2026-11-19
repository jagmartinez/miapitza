import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { AttendanceService } from '../../services/hr-attendance.service';
import {
    AttendancePolicyService,
    BIOMETRIC_ENROLLMENT_PENDING_APPROVAL,
    BiometricService,
    mapBiometricProfile,
} from '../../services/hr-biometric.service';
import type { FaceVerificationProvider } from '../../services/hr-face-provider';
import { HrAttendanceController } from '../../controllers/hr-attendance.controller';
import { encryptBiometricTemplate } from '../../utils/hr-biometric-crypto';

const evidence = { frames: [{ buffer: Buffer.from('capture'), mimeType: 'image/jpeg' as const }] };

const policy = {
    id: 2, version: 1, branchId: 10, timezone: 'America/Managua',
    requireBiometric: true, requireLiveness: true, requireGeolocation: false,
    maxLocationAccuracyM: 50, earlyCheckInMinutes: 60, lateCheckInToleranceM: 10,
    earlyCheckOutToleranceM: 15, lateCheckOutMinutes: 240, scheduleViolationMode: 'WARN',
    geofenceViolationMode: 'BLOCK', biometricViolationMode: 'BLOCK', allowUnscheduledPunch: true,
    unscheduledViolationMode: 'WARN', allowManualFallback: true, biometricConsentVersion: 'v1',
    biometricRetentionDays: 365, biometricRetentionNotice: null,
};

const safeProfile = (overrides: Record<string, unknown> = {}) => ({
    id: 3, status: 'PENDING', consentVersion: 'v1', consentedAt: new Date('2026-07-13T00:00:00Z'),
    enrolledAt: new Date('2026-07-13T00:00:00Z'), retentionExpiresAt: new Date('2027-07-13T00:00:00Z'),
    purgeRequestedAt: null, revokedAt: null, revocationReason: null, approvedAt: null,
    ...overrides,
});

function enrollProvider(): FaceVerificationProvider {
    return {
        name: 'http', model: 'm',
        enroll: jest.fn(async () => ({ provider: 'http', model: 'm', templateRef: 'tpl-new', livenessPassed: true })),
        verifyOneToOne: jest.fn(),
        revokeTemplate: jest.fn(async () => undefined),
    } as unknown as FaceVerificationProvider;
}

function enrollTx() {
    return {
        biometricProfile: {
            create: jest.fn(async (args: { data: Record<string, unknown> }) => safeProfile({ status: args.data.status })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 } as never),
            findUnique: jest.fn(),
        },
        biometricPurgeRequest: { create: jest.fn().mockResolvedValue({ id: 91 } as never) },
        auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
    };
}

function mockTransaction<T>(tx: T) {
    return jest.spyOn(prisma, '$transaction').mockImplementation(
        (async (callback: (client: T) => Promise<unknown>) => callback(tx)) as never,
    );
}

describe('biometric enrollment HR approval', () => {
    const originalKey = process.env.HR_BIOMETRIC_ENCRYPTION_KEY;

    beforeEach(() => {
        process.env.HR_BIOMETRIC_ENCRYPTION_KEY = 'a'.repeat(64);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalKey === undefined) delete process.env.HR_BIOMETRIC_ENCRYPTION_KEY;
        else process.env.HR_BIOMETRIC_ENCRYPTION_KEY = originalKey;
    });

    function arrangeEnroll(existing: Record<string, unknown> | null) {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(AttendancePolicyService, 'getCurrent').mockResolvedValue(policy as never);
        jest.spyOn(BiometricService, 'consumeChallenge').mockResolvedValue({ id: 'challenge', nonce: 'nonce' } as never);
        jest.spyOn(BiometricService, 'processPurgeRequest').mockResolvedValue(true);
        jest.spyOn(prisma.biometricProfile, 'findFirst').mockResolvedValue(existing as never);
        const tx = enrollTx();
        mockTransaction(tx);
        return tx;
    }

    const enrollInput = {
        companyId: 4, userId: 8, challengeId: 'challenge', challengeToken: 'token',
        consentAccepted: true, consentVersion: 'v1', evidence,
    };

    it('leaves the first enrollment PENDING until HR approves it', async () => {
        const tx = arrangeEnroll(null);
        const result = await BiometricService.enroll(enrollInput, enrollProvider());

        expect(tx.biometricProfile.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PENDING' }),
        }));
        expect(result).toEqual(expect.objectContaining({ status: 'PENDING', pendingApproval: true }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                details: expect.objectContaining({ status: 'PENDING', requiresHrApproval: true }),
            }),
        }));
    });

    it('re-enrolls a previously approved user straight to ACTIVE (consent renewal / provider change)', async () => {
        const existing = {
            id: 3, companyId: 4, userId: 8, status: 'ACTIVE', provider: 'fake', templateRef: 'old-encrypted',
            approvedAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
        };
        const tx = arrangeEnroll(existing);
        tx.biometricProfile.findUnique.mockResolvedValue(safeProfile({ status: 'ACTIVE', approvedAt: existing.approvedAt }) as never);

        const result = await BiometricService.enroll(enrollInput, enrollProvider());

        const update = tx.biometricProfile.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
        expect(update.data.status).toBe('ACTIVE');
        expect(update.data).not.toHaveProperty('approvedAt');
        expect(tx.biometricPurgeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ reason: 'REENROLL_REPLACED' }),
        }));
        expect(result).toEqual(expect.objectContaining({ status: 'ACTIVE', pendingApproval: false }));
    });

    it('treats a self-revoked approved user as previously approved', async () => {
        const tx = arrangeEnroll({
            id: 3, companyId: 4, userId: 8, status: 'REVOKED', provider: 'http', templateRef: 'REVOKED:x',
            revocationReason: 'SELF_REVOKED', approvedAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date(),
        });
        tx.biometricProfile.findUnique.mockResolvedValue(safeProfile({ status: 'ACTIVE' }) as never);

        await BiometricService.enroll(enrollInput, enrollProvider());

        expect((tx.biometricProfile.updateMany.mock.calls[0][0] as { data: { status: string } }).data.status).toBe('ACTIVE');
        // A REVOKED profile no longer holds a template: nothing to purge.
        expect(tx.biometricPurgeRequest.create).not.toHaveBeenCalled();
    });

    it('requires a new approval after an owner revocation (approval withdrawn)', async () => {
        const tx = arrangeEnroll({
            id: 3, companyId: 4, userId: 8, status: 'REVOKED', provider: 'http', templateRef: 'REVOKED:x',
            revocationReason: 'Suplantación', approvedAt: null, updatedAt: new Date(),
        });
        tx.biometricProfile.findUnique.mockResolvedValue(safeProfile() as never);

        await BiometricService.enroll(enrollInput, enrollProvider());

        expect(tx.biometricProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PENDING', approvedAt: null, approvedByUserId: null }),
        }));
    });

    it('purges the previous template when a PENDING enrollment is captured again', async () => {
        const tx = arrangeEnroll({
            id: 3, companyId: 4, userId: 8, status: 'PENDING', provider: 'http', templateRef: 'pending-encrypted',
            approvedAt: null, updatedAt: new Date(),
        });
        tx.biometricProfile.findUnique.mockResolvedValue(safeProfile() as never);

        await BiometricService.enroll(enrollInput, enrollProvider());

        expect(tx.biometricProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PENDING' }),
        }));
        expect(tx.biometricPurgeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ encryptedTemplateRef: 'pending-encrypted', reason: 'REENROLL_REPLACED' }),
        }));
    });

    it('rejects punches with a PENDING profile without matching the face', async () => {
        jest.spyOn(AttendancePolicyService, 'getCurrent').mockResolvedValue(policy as never);
        jest.spyOn(BiometricService, 'consumeChallenge').mockResolvedValue({ id: 'challenge', nonce: 'nonce' } as never);
        jest.spyOn(prisma.attendanceEvent, 'findFirst').mockResolvedValue(null as never);
        jest.spyOn(prisma.attendancePunchRequest, 'findUnique').mockResolvedValue(null as never);
        jest.spyOn(prisma.attendancePunchRequest, 'create').mockResolvedValue({ id: 501, attempts: 0 } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8 } as never);
        jest.spyOn(prisma.employeeBranchAssignment, 'findMany').mockResolvedValue([{
            id: 4, companyId: 4, employeeId: 6, branchId: 10, isPrimary: true,
            effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: null,
            branch: { id: 10, name: 'Centro', code: 'CTR', timezone: 'America/Managua', status: 'ACTIVE' },
        }] as never);
        jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10, name: 'Centro', code: 'CTR', status: 'ACTIVE', timezone: 'America/Managua', attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364'), longitude: new Prisma.Decimal('-86.2514'), geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        } as never);
        jest.spyOn(prisma.branchGeofenceVersion, 'findFirst').mockResolvedValue({
            id: 9, timezone: 'America/Managua', attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364'), longitude: new Prisma.Decimal('-86.2514'), geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        } as never);
        jest.spyOn(prisma.attendanceEvent, 'findMany').mockResolvedValue([] as never);
        const profileLookup = jest.spyOn(prisma.biometricProfile, 'findFirst').mockResolvedValue({
            id: 3, companyId: 4, userId: 8, status: 'PENDING', provider: 'http', approvedAt: null,
            consentVersion: 'v1', retentionExpiresAt: new Date('2027-07-13T00:00:00Z'),
            templateRef: encryptBiometricTemplate('pending-template'),
        } as never);
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
            ...args.data, id: 70, createdAt: new Date(),
            user: { id: 8, name: 'Ana', username: 'ana', accountType: 'INTERNAL' },
            branch: { id: 10, name: 'Centro', code: 'CTR' }, review: null,
        }));
        mockTransaction({
            $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }] as never),
            attendanceEvent: { create },
            attendancePunchRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        });
        const verifyOneToOne = jest.fn();
        const provider = { name: 'http', model: 'm', enroll: jest.fn(), verifyOneToOne, revokeTemplate: jest.fn() } as unknown as FaceVerificationProvider;

        const result = await AttendanceService.punch({
            companyId: 4, userId: 8, activeBranchId: 10, idempotencyKey: 'idem-pending',
            action: 'CHECK_IN', challengeId: 'challenge', challengeToken: 'token', evidence,
        }, provider, new Date('2026-07-13T14:00:00Z'));

        expect(profileLookup).toHaveBeenCalledWith({ where: { companyId: 4, userId: 8 } });
        expect(verifyOneToOne).not.toHaveBeenCalled();
        expect(result.decision).toBe('REJECTED');
        const data = create.mock.calls[0][0].data;
        expect(data).toEqual(expect.objectContaining({
            decision: 'REJECTED', reasonCode: BIOMETRIC_ENROLLMENT_PENDING_APPROVAL, biometricProfileId: 3,
        }));
        expect(String(data.message)).toMatch(/pendiente de aprobación de RRHH/);
    });

    describe('approve', () => {
        function approvalTx(current: Record<string, unknown> | null, updatedCount = 1) {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }] as never),
                biometricProfile: {
                    findFirst: jest.fn().mockResolvedValue(current as never),
                    updateMany: jest.fn().mockResolvedValue({ count: updatedCount } as never),
                    findUnique: jest.fn().mockResolvedValue(safeProfile({ status: 'ACTIVE', approvedAt: new Date() }) as never),
                },
                auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
            };
            mockTransaction(tx);
            return tx;
        }

        it('activates a PENDING enrollment with a conditional update and audit trail', async () => {
            const tx = approvalTx({ id: 3, status: 'PENDING', approvedAt: null });
            const result = await BiometricService.approveEnrollment(4, 8, 2);

            expect(tx.$queryRaw).toHaveBeenCalled();
            expect(tx.biometricProfile.updateMany).toHaveBeenCalledWith({
                where: { id: 3, companyId: 4, userId: 8, status: 'PENDING' },
                data: expect.objectContaining({ status: 'ACTIVE', approvedByUserId: 2, approvedAt: expect.any(Date) }),
            });
            expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    userId: 2, details: expect.objectContaining({ transition: 'ENROLLMENT_APPROVED', subjectUserId: 8 }),
                }),
            }));
            expect(result).toEqual(expect.objectContaining({ status: 'ACTIVE', pendingApproval: false }));
        });

        it('is idempotent for an already approved profile', async () => {
            const tx = approvalTx({ id: 3, status: 'ACTIVE', approvedAt: new Date() });
            await expect(BiometricService.approveEnrollment(4, 8, 2)).resolves.toEqual(expect.objectContaining({ status: 'ACTIVE' }));
            expect(tx.biometricProfile.updateMany).not.toHaveBeenCalled();
            expect(tx.auditLog.create).not.toHaveBeenCalled();
        });

        it('rejects a lost race and non-pending profiles', async () => {
            approvalTx({ id: 3, status: 'PENDING', approvedAt: null }, 0);
            await expect(BiometricService.approveEnrollment(4, 8, 2)).rejects.toMatchObject({ statusCode: 409, code: 'BIOMETRIC_PROFILE_CHANGED' });
            jest.restoreAllMocks();
            approvalTx({ id: 3, status: 'REVOKED', approvedAt: null });
            await expect(BiometricService.approveEnrollment(4, 8, 2)).rejects.toMatchObject({ statusCode: 409, code: 'BIOMETRIC_ENROLLMENT_NOT_PENDING' });
        });

        it('applies the branch scope and forbids approving one\'s own enrollment', async () => {
            const tx = approvalTx(null);
            await expect(BiometricService.approveEnrollment(4, 8, 2, 10)).rejects.toMatchObject({ statusCode: 404 });
            expect(tx.biometricProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    companyId: 4, userId: 8,
                    user: { employee: { is: { branchAssignments: { some: expect.objectContaining({ branchId: 10 }) } } } },
                }),
            }));
            await expect(BiometricService.approveEnrollment(4, 8, 8)).rejects.toMatchObject({ statusCode: 403, code: 'BIOMETRIC_SELF_APPROVAL_FORBIDDEN' });
        });
    });

    describe('reject', () => {
        function revokeTx(current: Record<string, unknown> | null) {
            const tx = {
                $queryRaw: jest.fn().mockResolvedValue([{ id: 3 }] as never),
                biometricProfile: {
                    findFirst: jest.fn().mockResolvedValue(current as never),
                    update: jest.fn(async (args: { data: Record<string, unknown> }) => safeProfile({
                        status: args.data.status, revocationReason: args.data.revocationReason, revokedAt: new Date(),
                    })),
                    findUnique: jest.fn().mockResolvedValue(safeProfile({ status: 'REVOKED' }) as never),
                },
                biometricPurgeRequest: { create: jest.fn().mockResolvedValue({ id: 92 } as never) },
                auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
            };
            mockTransaction(tx);
            jest.spyOn(BiometricService, 'processPurgeRequest').mockResolvedValue(true);
            return tx;
        }

        it('revokes a PENDING enrollment, withdraws approval and schedules the purge', async () => {
            const tx = revokeTx({ id: 3, status: 'PENDING', provider: 'http', templateRef: 'pending-encrypted', approvedAt: null });
            const result = await BiometricService.rejectEnrollment(4, 8, 2, 'Foto borrosa', undefined, enrollProvider());

            expect(tx.biometricPurgeRequest.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ encryptedTemplateRef: 'pending-encrypted', reason: 'ENROLLMENT_REJECTED' }),
            }));
            expect(tx.biometricProfile.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: 'REVOKED', revocationReason: 'ENROLLMENT_REJECTED: Foto borrosa',
                    approvedAt: null, approvedByUserId: null,
                }),
            }));
            expect(BiometricService.processPurgeRequest).toHaveBeenCalledWith(92, expect.anything());
            expect(result).toEqual(expect.objectContaining({ status: 'REVOKED', rejectionReason: 'Foto borrosa' }));
        });

        it('refuses to reject an approved profile and requires a reason', async () => {
            revokeTx({ id: 3, status: 'ACTIVE', provider: 'http', templateRef: 'x', approvedAt: new Date() });
            await expect(BiometricService.rejectEnrollment(4, 8, 2, 'Motivo', undefined, enrollProvider()))
                .rejects.toMatchObject({ statusCode: 409, code: 'BIOMETRIC_ENROLLMENT_NOT_PENDING' });
            await expect(BiometricService.rejectEnrollment(4, 8, 2, '  ', undefined, enrollProvider()))
                .rejects.toMatchObject({ statusCode: 400 });
        });

        it('owner revocation withdraws the approval so the next enrollment waits for HR', async () => {
            const revoke = jest.spyOn(BiometricService, 'revoke').mockResolvedValue({ status: 'REVOKED' } as never);
            const req = {
                user: { userId: 2, companyId: 4, role: 'ADMIN', roles: ['ADMIN'] },
                params: { userId: '8' }, body: { reason: 'Suplantación detectada' },
            } as unknown as Request;
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
            await HrAttendanceController.revokeUserBiometrics(req, res, jest.fn() as unknown as NextFunction);
            expect(revoke).toHaveBeenCalledWith(4, 8, undefined, expect.objectContaining({
                actorUserId: 2, requireReapproval: true, purgeReason: 'OWNER_REVOKED',
            }));
        });
    });

    it('lists pending enrollments scoped to the branch', async () => {
        const findMany = jest.spyOn(prisma.biometricProfile, 'findMany').mockResolvedValue([{
            id: 3, userId: 8, consentVersion: 'v1', enrolledAt: new Date('2026-07-13T00:00:00Z'), provider: 'http',
            user: { id: 8, name: 'Ana', username: 'ana', employee: { id: 6, employeeCode: 'E-6', legalName: 'Ana Pérez', preferredName: null } },
        }] as never);
        const rows = await BiometricService.listPendingEnrollments(4, 10);
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 4, status: 'PENDING', user: expect.anything() }),
        }));
        expect(rows).toEqual([expect.objectContaining({ userId: 8, employeeName: 'Ana Pérez', employeeCode: 'E-6' })]);
    });

    it('maps pending and rejected states for the employee', () => {
        expect(mapBiometricProfile(safeProfile() as never)).toEqual(expect.objectContaining({ pendingApproval: true, canEnroll: true }));
        expect(mapBiometricProfile(safeProfile({ status: 'REVOKED', revocationReason: 'ENROLLMENT_REJECTED: Sin luz' }) as never))
            .toEqual(expect.objectContaining({ rejectionReason: 'Sin luz' }));
        expect(mapBiometricProfile(safeProfile({ status: 'REVOKED', revocationReason: 'SELF_REVOKED' }) as never))
            .toEqual(expect.objectContaining({ rejectionReason: null }));
    });
});
