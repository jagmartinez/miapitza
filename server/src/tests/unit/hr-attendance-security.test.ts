import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import {
    AttendanceService,
    availableActionsFrom,
    evaluateGeofence,
    haversineDistanceM,
    locationFreshness,
} from '../../services/hr-attendance.service';
import {
    AttendancePolicyService,
    BiometricService,
    hashChallengeToken,
} from '../../services/hr-biometric.service';
import {
    createFaceVerificationProvider,
    FaceProviderUnavailableError,
    type FaceVerificationProvider,
} from '../../services/hr-face-provider';
import { encryptBiometricTemplate } from '../../utils/hr-biometric-crypto';

const policy = {
    id: 2,
    version: 1,
    branchId: 10,
    timezone: 'America/Managua',
    requireBiometric: true,
    requireLiveness: true,
    requireGeolocation: false,
    maxLocationAccuracyM: 50,
    earlyCheckInMinutes: 60,
    lateCheckInToleranceM: 10,
    earlyCheckOutToleranceM: 15,
    lateCheckOutMinutes: 240,
    scheduleViolationMode: 'WARN',
    geofenceViolationMode: 'BLOCK',
    biometricViolationMode: 'BLOCK',
    allowUnscheduledPunch: true,
    unscheduledViolationMode: 'WARN',
    allowManualFallback: true,
    biometricConsentVersion: 'v1',
    biometricRetentionDays: 365,
    biometricRetentionNotice: null,
};

function eventFixture(overrides: Record<string, unknown> = {}) {
    return {
        id: 70, companyId: 4, userId: 8, actorUserId: 8, branchId: 10,
        scheduledShiftId: null, policyId: 2, policyVersion: 1, biometricProfileId: 3,
        challengeId: 'challenge', deviceId: null, adjustsEventId: null,
        idempotencyKey: 'idem-1', requestHash: 'hash', sequenceKey: null,
        action: 'CHECK_IN', source: 'SELF', serverAt: new Date('2026-07-13T14:00:00Z'), clientAt: null,
        latitude: null, longitude: null, locationAccuracyM: null, distanceM: null,
        faceStatus: 'ERROR', livenessStatus: 'ERROR', providerStatus: 'UNAVAILABLE', providerScore: null,
        decision: 'REJECTED', reasonCode: 'FACE_PROVIDER_UNAVAILABLE',
        reasonCodes: ['FACE_PROVIDER_UNAVAILABLE'], message: 'Marcaje rechazado', checks: {}, createdAt: new Date(),
        user: { id: 8, name: 'Ana', username: 'ana', accountType: 'INTERNAL' },
        branch: { id: 10, name: 'Centro', code: 'CTR' }, review: null,
        ...overrides,
    };
}

describe('HR attendance security and invariants', () => {
    const originalKey = process.env.HR_BIOMETRIC_ENCRYPTION_KEY;

    afterEach(() => {
        jest.restoreAllMocks();
        if (originalKey === undefined) delete process.env.HR_BIOMETRIC_ENCRYPTION_KEY;
        else process.env.HR_BIOMETRIC_ENCRYPTION_KEY = originalKey;
    });

    it('forbids the fake provider in production even with opt-in', () => {
        expect(() => createFaceVerificationProvider({
            NODE_ENV: 'production', HR_FACE_PROVIDER: 'fake', HR_ALLOW_FAKE_FACE_PROVIDER: 'true',
        })).toThrow('prohibido');
    });

    it('fails closed when no production face provider is configured', async () => {
        const provider = createFaceVerificationProvider({ NODE_ENV: 'production', HR_FACE_PROVIDER: 'disabled' });
        await expect(provider.verifyOneToOne(Buffer.from('capture'), 'template')).rejects.toBeInstanceOf(FaceProviderUnavailableError);
    });

    it('rejects replayed challenges without attempting another CAS update', async () => {
        const update = jest.spyOn(prisma.biometricChallenge, 'updateMany');
        jest.spyOn(prisma.biometricChallenge, 'findFirst').mockResolvedValue({
            id: 'c1', companyId: 4, userId: 8, purpose: 'ATTENDANCE_PUNCH', action: 'CHECK_IN',
            tokenHash: hashChallengeToken('nonce', 'token'), nonce: 'nonce', expiresAt: new Date(Date.now() + 60000),
            usedAt: new Date(), usedByKey: 'other', attempts: 1, maxAttempts: 3, createdAt: new Date(),
        } as never);

        await expect(BiometricService.consumeChallenge({
            companyId: 4, userId: 8, challengeId: 'c1', challengeToken: 'token',
            purpose: 'ATTENDANCE_PUNCH', action: 'CHECK_IN', useKey: 'new-attempt',
        })).rejects.toMatchObject({ code: 'CHALLENGE_REPLAY', statusCode: 409 });
        expect(update).not.toHaveBeenCalled();
    });

    it('binds a consumed challenge to both idempotency key and request hash', async () => {
        jest.spyOn(prisma.biometricChallenge, 'findFirst').mockResolvedValue({
            id: 'c1', companyId: 4, userId: 8, purpose: 'ATTENDANCE_PUNCH', action: 'CHECK_IN',
            tokenHash: hashChallengeToken('nonce', 'token'), nonce: 'nonce', expiresAt: new Date(Date.now() + 60000),
            usedAt: new Date(), usedByKey: 'same-key', usedRequestHash: 'a'.repeat(64), attempts: 1, maxAttempts: 3, createdAt: new Date(),
        } as never);

        await expect(BiometricService.consumeChallenge({
            companyId: 4, userId: 8, challengeId: 'c1', challengeToken: 'token',
            purpose: 'ATTENDANCE_PUNCH', action: 'CHECK_IN', useKey: 'same-key', requestHash: 'b'.repeat(64),
        })).rejects.toMatchObject({ code: 'CHALLENGE_IDEMPOTENCY_MISMATCH', statusCode: 409 });
    });

    it('computes Haversine distance and rejects poor GPS precision independently', () => {
        expect(haversineDistanceM(12.1364, -86.2514, 12.1364, -86.2514)).toBeCloseTo(0, 6);
        const result = evaluateGeofence({ latitude: 12.1364, longitude: -86.2514, accuracyM: 75 }, {
            attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364000'), longitude: new Prisma.Decimal('-86.2514000'),
            geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        }, { ...policy, requireGeolocation: true } as never);
        expect(result.geofence.status).toBe('PASSED');
        expect(result.locationAccuracy).toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'LOCATION_ACCURACY_TOO_LOW' }));
        const outside = evaluateGeofence({ latitude: 12.1464, longitude: -86.2514, accuracyM: 10 }, {
            attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364000'), longitude: new Prisma.Decimal('-86.2514000'),
            geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        }, { ...policy, requireGeolocation: true } as never);
        expect(outside.geofence).toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'OUTSIDE_GEOFENCE' }));
        const uncertainEdge = evaluateGeofence({ latitude: 12.13658, longitude: -86.2514, accuracyM: 90 }, {
            attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364000'), longitude: new Prisma.Decimal('-86.2514000'),
            geofenceRadiusM: 100, maxLocationAccuracyM: 100,
        }, { ...policy, requireGeolocation: true, maxLocationAccuracyM: 100 } as never);
        expect(uncertainEdge.geofence).toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'OUTSIDE_GEOFENCE' }));
    });

    it('rejects stale and future geolocation evidence', () => {
        const now = new Date('2026-07-13T14:00:00Z');
        expect(locationFreshness(new Date('2026-07-13T13:57:59Z'), now, true)).toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'LOCATION_CAPTURE_STALE' }));
        expect(locationFreshness(new Date('2026-07-13T14:00:31Z'), now, true)).toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'LOCATION_CAPTURE_IN_FUTURE' }));
    });

    it('derives strict punch sequence actions', () => {
        expect(availableActionsFrom([])).toEqual(['CHECK_IN']);
        expect(availableActionsFrom([{ action: 'CHECK_IN' }])).toEqual(['BREAK_START', 'CHECK_OUT']);
        expect(availableActionsFrom([{ action: 'CHECK_IN' }, { action: 'BREAK_START' }])).toEqual(['BREAK_END']);
        expect(availableActionsFrom([{ action: 'CHECK_OUT' }])).toEqual([]);
    });

    it('keeps an overnight shift session open across the local date boundary', async () => {
        const now = new Date('2026-07-14T11:00:00Z');
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ branchId: 10 } as never);
        jest.spyOn(AttendancePolicyService, 'getCurrent').mockResolvedValue(policy as never);
        jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([{
            id: 20, companyId: 4, scheduleId: 9, userId: 8, branchId: 10,
            startAt: new Date('2026-07-14T04:00:00Z'), endAt: new Date('2026-07-14T12:00:00Z'),
            timezoneSnapshot: 'America/Managua', status: 'SCHEDULED',
            branch: { id: 10, name: 'Centro', code: 'CTR', timezone: 'America/Managua' }, assignmentOverride: null,
        }] as never);
        jest.spyOn(prisma.attendanceEvent, 'findMany').mockResolvedValue([eventFixture({
            id: 71, action: 'CHECK_IN', decision: 'ACCEPTED', review: null,
            scheduledShiftId: 20, sessionKey: 'SHIFT:20', serverAt: new Date('2026-07-14T04:01:00Z'),
        })] as never);

        const result = await AttendanceService.today(4, 8, 10, now);

        expect(result.scheduledShift?.id).toBe(20);
        expect(result.availableActions).toEqual(['BREAK_START', 'CHECK_OUT']);
    });

    it('allows check-in for a second adjacent shift after the prior session closed', async () => {
        const now = new Date('2026-07-14T20:00:00Z');
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ branchId: 10 } as never);
        jest.spyOn(AttendancePolicyService, 'getCurrent').mockResolvedValue(policy as never);
        const shift = (id: number, startAt: string, endAt: string) => ({
            id, companyId: 4, scheduleId: 9, userId: 8, branchId: 10,
            startAt: new Date(startAt), endAt: new Date(endAt), timezoneSnapshot: 'America/Managua', status: 'SCHEDULED',
            branch: { id: 10, name: 'Centro', code: 'CTR', timezone: 'America/Managua' }, assignmentOverride: null,
        });
        jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([
            shift(20, '2026-07-14T12:00:00Z', '2026-07-14T20:00:00Z'),
            shift(21, '2026-07-14T20:00:00Z', '2026-07-15T02:00:00Z'),
        ] as never);
        jest.spyOn(prisma.attendanceEvent, 'findMany').mockResolvedValue([
            eventFixture({ id: 71, action: 'CHECK_IN', decision: 'ACCEPTED', review: null, scheduledShiftId: 20, sessionKey: 'SHIFT:20', serverAt: new Date('2026-07-14T12:00:00Z') }),
            eventFixture({ id: 72, action: 'CHECK_OUT', decision: 'ACCEPTED', review: null, scheduledShiftId: 20, sessionKey: 'SHIFT:20', serverAt: new Date('2026-07-14T19:59:00Z') }),
        ] as never);

        const result = await AttendanceService.today(4, 8, 10, now);

        expect(result.scheduledShift?.id).toBe(21);
        expect(result.availableActions).toEqual(['CHECK_IN']);
    });

    it('persists a provider failure as a non-effective immutable review without capture/template leakage', async () => {
        process.env.HR_BIOMETRIC_ENCRYPTION_KEY = 'a'.repeat(64);
        jest.spyOn(AttendancePolicyService, 'getCurrent').mockResolvedValue({ ...policy, biometricViolationMode: 'WARN' } as never);
        jest.spyOn(BiometricService, 'consumeChallenge').mockResolvedValue({ id: 'challenge' } as never);
        jest.spyOn(prisma.attendanceEvent, 'findFirst').mockResolvedValue(null as never);
        jest.spyOn(prisma.attendancePunchRequest, 'findUnique').mockResolvedValue(null as never);
        jest.spyOn(prisma.attendancePunchRequest, 'create').mockResolvedValue({ id: 501 } as never);
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8, branchId: 10, allowedBranches: [] } as never);
        jest.spyOn(prisma.scheduledShift, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue({
            id: 10, name: 'Centro', code: 'CTR', status: 'ACTIVE', timezone: 'America/Managua', attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364'), longitude: new Prisma.Decimal('-86.2514'),
            geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        } as never);
        jest.spyOn(prisma.branchGeofenceVersion, 'findFirst').mockResolvedValue({
            id: 9, timezone: 'America/Managua', attendanceEnabled: true,
            latitude: new Prisma.Decimal('12.1364'), longitude: new Prisma.Decimal('-86.2514'),
            geofenceRadiusM: 100, maxLocationAccuracyM: 40,
        } as never);
        jest.spyOn(prisma.attendanceEvent, 'findMany').mockResolvedValue([] as never);
        jest.spyOn(prisma.biometricProfile, 'findFirst').mockResolvedValue({
            id: 3, companyId: 4, userId: 8, status: 'ACTIVE', provider: 'unavailable-test',
            consentVersion: 'v1', retentionExpiresAt: new Date('2027-07-13T00:00:00Z'),
            templateRef: encryptBiometricTemplate('opaque-template'),
        } as never);
        const create = jest.fn(async (args: { data: Record<string, unknown> }) => eventFixture({ ...args.data }));
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }] as never),
            attendanceEvent: { create },
            attendancePunchRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );
        const provider: FaceVerificationProvider = {
            name: 'unavailable-test', model: 'none',
            enroll: async () => { throw new FaceProviderUnavailableError(); },
            verifyOneToOne: async () => { throw new FaceProviderUnavailableError(); },
            revokeTemplate: async () => undefined,
        };

        const result = await AttendanceService.punch({
            companyId: 4, userId: 8, activeBranchId: 10, idempotencyKey: 'idem-1',
            action: 'CHECK_IN', challengeId: 'challenge', challengeToken: 'token',
            capture: Buffer.from('ephemeral-face-capture'),
        }, provider, new Date('2026-07-13T14:00:00Z'));

        expect(result).toEqual(expect.objectContaining({ decision: 'REVIEW_REQUIRED', serviceUnavailable: true }));
        const stored = create.mock.calls[0][0].data;
        expect(stored).toEqual(expect.objectContaining({ decision: 'REVIEW', providerStatus: 'UNAVAILABLE' }));
        expect(stored.sequenceKey).toBeNull();
        expect(stored).not.toHaveProperty('capture');
        expect(stored).not.toHaveProperty('faceImage');
        expect(stored).not.toHaveProperty('templateRef');
        expect(JSON.stringify(stored)).not.toContain(Buffer.from('ephemeral-face-capture').toString('base64'));
    });

    it('returns an existing identical idempotent event only for an internal employee', async () => {
        const request = {
            userId: 8, action: 'CHECK_IN', challengeId: 'challenge',
            latitude: null, longitude: null, accuracyM: null, clientAt: undefined, deviceId: null,
        };
        const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
        jest.spyOn(prisma.attendanceEvent, 'findFirst').mockResolvedValue(eventFixture({ requestHash: hash }) as never);
        const userLookup = jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
            id: 8, branchId: 10, allowedBranches: [],
        } as never);

        const result = await AttendanceService.punch({
            companyId: 4, userId: 8, idempotencyKey: 'idem-1', action: 'CHECK_IN', challengeId: 'challenge',
        });

        expect(result.decision).toBe('REJECTED');
        expect(userLookup).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ accountType: 'INTERNAL', employee: { is: { status: 'ACTIVE' } } }),
        }));
    });

    it('rejects attendance before claiming idempotency for external users', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null as never);
        const punchClaim = jest.spyOn(prisma.attendancePunchRequest, 'create');

        await expect(AttendanceService.punch({
            companyId: 4, userId: 8, idempotencyKey: 'external-1', action: 'CHECK_IN', challengeId: 'challenge',
        })).rejects.toMatchObject({ code: 'HR_INTERNAL_EMPLOYEE_REQUIRED', statusCode: 403 });

        expect(punchClaim).not.toHaveBeenCalled();
    });

    it('tenant/scopes event list at both company and branch', async () => {
        const findMany = jest.spyOn(prisma.attendanceEvent, 'findMany');
        const count = jest.spyOn(prisma.attendanceEvent, 'count');
        jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as never);

        await AttendanceService.listEvents(4, {}, 10);

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 4, branchId: 10 } }));
        expect(count).toHaveBeenCalledWith({ where: { companyId: 4, branchId: 10 } });
    });

    it('allows human review only for REVIEW events, never hard rejects or accepted punches', async () => {
        const findFirst = jest.spyOn(prisma.attendanceEvent, 'findFirst').mockResolvedValue(null as never);
        await expect(AttendanceService.review(70, 4, 3, 'APPROVED', 'evidencia revisada'))
            .rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 70, companyId: 4, decision: 'REVIEW' }),
        }));
    });

    it('selects biometric profiles without the encrypted template', async () => {
        jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ id: 8 } as never);
        const findFirst = jest.spyOn(prisma.biometricProfile, 'findFirst').mockResolvedValue(null as never);
        await BiometricService.getMyProfile(4, 8);
        const select = findFirst.mock.calls[0][0]?.select as Record<string, unknown>;
        expect(select).not.toHaveProperty('templateRef');
        expect(select).not.toHaveProperty('provider');
    });
});
