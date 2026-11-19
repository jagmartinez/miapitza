import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

import prisma from '../../utils/prisma';
import { AttendanceService } from '../../services/hr-attendance.service';
import { AttendancePolicyService, BiometricService } from '../../services/hr-biometric.service';
import {
    createFaceVerificationProvider,
    FaceProviderUnavailableError,
    type FaceVerificationProvider,
} from '../../services/hr-face-provider';
import { HrAttendanceController } from '../../controllers/hr-attendance.controller';
import { encryptBiometricTemplate } from '../../utils/hr-biometric-crypto';

const httpEnv = {
    NODE_ENV: 'production', HR_FACE_PROVIDER: 'http',
    HR_FACE_PROVIDER_BASE_URL: 'https://faces.internal.example', HR_FACE_PROVIDER_TOKEN: 's'.repeat(32),
    HR_FACE_PROVIDER_TIMEOUT_MS: '500',
};
const evidence = { frames: [{ buffer: Buffer.from('capture'), mimeType: 'image/jpeg' as const }] };
const context = {
    tenantRef: '4', subjectRef: '8', challengeRef: 'challenge',
    livenessAction: 'TURN_LEFT' as const, requireLiveness: true, retentionDays: 365,
};

const policy = {
    id: 2, version: 1, branchId: 10, timezone: 'America/Managua',
    requireBiometric: true, requireLiveness: true, requireGeolocation: false,
    maxLocationAccuracyM: 50, earlyCheckInMinutes: 60, lateCheckInToleranceM: 10,
    earlyCheckOutToleranceM: 15, lateCheckOutMinutes: 240, scheduleViolationMode: 'WARN',
    geofenceViolationMode: 'BLOCK', biometricViolationMode: 'BLOCK', allowUnscheduledPunch: true,
    unscheduledViolationMode: 'WARN', allowManualFallback: true, biometricConsentVersion: 'v1',
    biometricRetentionDays: 365, biometricRetentionNotice: null,
};

describe('biometric hardening', () => {
    const originalKey = process.env.HR_BIOMETRIC_ENCRYPTION_KEY;

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalKey === undefined) delete process.env.HR_BIOMETRIC_ENCRYPTION_KEY;
        else process.env.HR_BIOMETRIC_ENCRYPTION_KEY = originalKey;
    });

    it('never leaks runtime transport text when the provider is unreachable', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
        const provider = createFaceVerificationProvider(httpEnv);
        const failure = await provider.enroll(evidence, context).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(FaceProviderUnavailableError);
        expect((failure as Error).message).toBe('No fue posible conectar con el proveedor facial; reintenta en unos segundos');
        expect((failure as Error).message).not.toContain('fetch failed');
    });

    it('reports a provider timeout in Spanish', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(global, 'fetch').mockImplementation(((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        })) as typeof fetch);
        const provider = createFaceVerificationProvider(httpEnv);
        await expect(provider.verifyOneToOne(evidence, 'template-ref-0000000000000', context))
            .rejects.toThrow('El proveedor facial no respondió a tiempo; reintenta en unos segundos');
    });

    it('translates provider rejection codes into actionable Spanish guidance', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            code: 'MULTIPLE_FACES', message: 'Debe aparecer exactamente una persona', retryable: true,
        }), { status: 422 }));
        const provider = createFaceVerificationProvider(httpEnv);
        await expect(provider.enroll(evidence, context)).rejects.toMatchObject({
            code: 'MULTIPLE_FACES',
            message: 'Se detectó más de una persona. Solo debe aparecer tu rostro en la cámara.',
        });
    });

    it('keeps the provider text for unknown rejection codes and flags auth misconfiguration', async () => {
        const fetchMock = jest.spyOn(global, 'fetch');
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'SOMETHING_NEW', message: 'Detalle remoto' }), { status: 422 }));
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'AUTH_INVALID', message: 'Token Bearer invalido' }), { status: 401 }));
        const provider = createFaceVerificationProvider(httpEnv);
        await expect(provider.enroll(evidence, context)).rejects.toMatchObject({ code: 'SOMETHING_NEW', message: 'Detalle remoto' });
        await expect(provider.enroll(evidence, context)).rejects.toThrow(/autenticarse con el proveedor facial/);
    });

    it('closes an already-wiped purge request instead of retrying it forever', async () => {
        jest.spyOn(prisma.biometricPurgeRequest, 'findFirst').mockResolvedValue({
            id: 91, companyId: 4, biometricProfileId: 3, provider: 'http', encryptedTemplateRef: 'PURGED',
            reason: 'SELF_REVOKED', status: 'FAILED', attempts: 2, nextAttemptAt: null, lastError: 'x',
            createdAt: new Date(), completedAt: null, profile: { userId: 8 },
        } as never);
        const update = jest.spyOn(prisma.biometricPurgeRequest, 'updateMany').mockResolvedValue({ count: 1 });
        const revokeTemplate = jest.fn(async () => undefined);
        const provider = { name: 'http', model: 'm', enroll: jest.fn(), verifyOneToOne: jest.fn(), revokeTemplate } as unknown as FaceVerificationProvider;

        await expect(BiometricService.processPurgeRequest(91, provider)).resolves.toBe(false);
        expect(revokeTemplate).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 91, status: 'FAILED', encryptedTemplateRef: 'PURGED' }),
            data: expect.objectContaining({ status: 'COMPLETED' }),
        }));
    });

    it('requires re-enrollment instead of matching a template issued by another provider', async () => {
        process.env.HR_BIOMETRIC_ENCRYPTION_KEY = 'a'.repeat(64);
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
        jest.spyOn(prisma.biometricProfile, 'findFirst').mockResolvedValue({
            id: 3, companyId: 4, userId: 8, status: 'ACTIVE', provider: 'fake',
            consentVersion: 'v1', retentionExpiresAt: new Date('2027-07-13T00:00:00Z'),
            templateRef: encryptBiometricTemplate('f'.repeat(64)),
        } as never);
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
            ...args.data, id: 70, createdAt: new Date(),
            user: { id: 8, name: 'Ana', username: 'ana', accountType: 'INTERNAL' },
            branch: { id: 10, name: 'Centro', code: 'CTR' }, review: null,
        }));
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }] as never),
            attendanceEvent: { create },
            attendancePunchRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );
        const verifyOneToOne = jest.fn();
        const provider = { name: 'http', model: 'm', enroll: jest.fn(), verifyOneToOne, revokeTemplate: jest.fn() } as unknown as FaceVerificationProvider;

        const result = await AttendanceService.punch({
            companyId: 4, userId: 8, activeBranchId: 10, idempotencyKey: 'idem-reenroll',
            action: 'CHECK_IN', challengeId: 'challenge', challengeToken: 'token', evidence,
        }, provider, new Date('2026-07-13T14:00:00Z'));

        expect(verifyOneToOne).not.toHaveBeenCalled();
        expect(result.decision).toBe('REJECTED');
        expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({
            decision: 'REJECTED', reasonCode: 'BIOMETRIC_REENROLL_REQUIRED',
        }));
    });

    it('enrolls against the same policy scope the UI reads (company-wide admins ignore their active branch)', async () => {
        const enroll = jest.spyOn(BiometricService, 'enroll').mockResolvedValue({ status: 'ACTIVE' } as never);
        const req = {
            user: { userId: 8, companyId: 4, branchId: 10, role: 'ADMIN', roles: ['ADMIN'] },
            files: { faceImage: [{ buffer: Buffer.from('x'), mimetype: 'image/jpeg' }] },
            body: { challengeId: 'c', challengeToken: 't', consentAccepted: 'true', consentVersion: 'v1' },
        } as unknown as Request;
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() } as unknown as Response;
        await HrAttendanceController.enroll(req, res, jest.fn() as unknown as NextFunction);
        expect(enroll).toHaveBeenCalledWith(expect.objectContaining({ branchId: undefined }));

        const operator = { ...req, user: { userId: 9, companyId: 4, branchId: 10, role: 'MESERO', roles: ['MESERO'] } } as unknown as Request;
        await HrAttendanceController.enroll(operator, res, jest.fn() as unknown as NextFunction);
        expect(enroll).toHaveBeenLastCalledWith(expect.objectContaining({ branchId: 10 }));
    });
});
