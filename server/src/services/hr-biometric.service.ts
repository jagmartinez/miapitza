import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type AttendanceAction, type BiometricChallengePurpose } from '@prisma/client';
import prisma from '../utils/prisma';
import { isValidTimeZone } from '../utils/timezone';
import { decryptBiometricTemplate, encryptBiometricTemplate } from '../utils/hr-biometric-crypto';
import { AuditLogService } from './audit-log.service';
import {
    createFaceVerificationProvider,
    createFaceVerificationProviderForName,
    FaceProviderUnavailableError,
    type FaceCaptureEvidence,
    type FaceLivenessAction,
    type FaceVerificationProvider,
} from './hr-face-provider';

export class HrAttendanceError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code?: string) {
        super(message);
        this.name = 'HrAttendanceError';
    }
}

const ACTIONS = ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT'] as const;
const PURPOSES = ['ATTENDANCE_PUNCH', 'BIOMETRIC_ENROLLMENT'] as const;
const MODES = ['BLOCK', 'REVIEW', 'WARN'] as const;

async function assertInternalEmployee(companyId: number, userId: number) {
    const user = await prisma.user.findFirst({
        where: {
            id: userId, companyId, status: 'ACTIVE', accountType: 'INTERNAL',
            employee: { is: { status: 'ACTIVE' } },
        },
        select: { id: true },
    });
    if (!user) {
        throw new HrAttendanceError(
            'El marcaje biometrico requiere un usuario interno vinculado a un empleado',
            403,
            'HR_INTERNAL_EMPLOYEE_REQUIRED',
        );
    }
}

function text(value: unknown, field: string, max = 191): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrAttendanceError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrAttendanceError(`${field} excede ${max} caracteres`);
    return normalized;
}

function optionalText(value: unknown, field: string, max = 5000): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== 'string') throw new HrAttendanceError(`${field} debe ser texto`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrAttendanceError(`${field} excede ${max} caracteres`);
    return normalized || null;
}

function integer(value: unknown, field: string, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new HrAttendanceError(`${field} debe ser un entero entre ${min} y ${max}`);
    }
    return parsed;
}

function booleanValue(value: unknown, field: string, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new HrAttendanceError(`${field} debe ser booleano`);
    return value;
}

function mode(value: unknown, field: string, fallback: typeof MODES[number]) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !MODES.includes(value as typeof MODES[number])) throw new HrAttendanceError(`${field} inválido`);
    return value as typeof MODES[number];
}

export function hashChallengeToken(nonce: string, token: string): string {
    return createHash('sha256').update(`${nonce}.${token}`).digest('hex');
}

export function livenessActionFromNonce(nonce: string): FaceLivenessAction {
    const discriminator = createHash('sha256').update(`hr-active-liveness-v1.${nonce}`).digest()[0];
    return discriminator % 2 === 0 ? 'TURN_LEFT' : 'TURN_RIGHT';
}

function livenessInstruction(action: FaceLivenessAction): string {
    return action === 'TURN_LEFT'
        ? 'Mantén primero el rostro al frente. Solo cuando la cámara muestre “AHORA GIRA”, gira despacio hacia tu hombro izquierdo y mantén la posición.'
        : 'Mantén primero el rostro al frente. Solo cuando la cámara muestre “AHORA GIRA”, gira despacio hacia tu hombro derecho y mantén la posición.';
}

function safeEqualHex(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

const safeProfileSelect = {
    id: true, status: true, consentVersion: true, consentedAt: true,
    enrolledAt: true, retentionExpiresAt: true, purgeRequestedAt: true, revokedAt: true,
} satisfies Prisma.BiometricProfileSelect;

export function mapBiometricProfile(profile: {
    status: 'PENDING' | 'ACTIVE' | 'REVOKED'; consentVersion: string; consentedAt: Date;
    enrolledAt: Date | null; retentionExpiresAt: Date | null; purgeRequestedAt: Date | null; revokedAt: Date | null;
} | null) {
    if (!profile) return { status: 'NOT_ENROLLED' as const, canEnroll: true };
    return {
        status: profile.status,
        consentVersion: profile.consentVersion,
        consentedAt: profile.consentedAt,
        enrolledAt: profile.enrolledAt,
        retentionExpiresAt: profile.retentionExpiresAt,
        purgeRequestedAt: profile.purgeRequestedAt,
        revokedAt: profile.revokedAt,
        canEnroll: profile.status !== 'ACTIVE',
    };
}

export class AttendancePolicyService {
    static readonly defaults = {
        version: 0,
        timezone: 'America/Managua',
        requireBiometric: true,
        requireLiveness: true,
        requireGeolocation: true,
        maxLocationAccuracyM: 50,
        earlyCheckInMinutes: 60,
        lateCheckInToleranceM: 10,
        earlyCheckOutToleranceM: 15,
        lateCheckOutMinutes: 240,
        scheduleViolationMode: 'REVIEW' as const,
        geofenceViolationMode: 'BLOCK' as const,
        biometricViolationMode: 'BLOCK' as const,
        allowUnscheduledPunch: false,
        unscheduledViolationMode: 'REVIEW' as const,
        allowManualFallback: true,
        biometricConsentVersion: 'v1',
        biometricRetentionDays: 365,
        biometricRetentionNotice: null as string | null,
    };

    static async getCurrent(companyId: number, branchId?: number) {
        let branchTimezone: string | undefined;
        if (branchId) {
            const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { timezone: true } });
            if (!branch) throw new HrAttendanceError('Sucursal no encontrada en la empresa', 404);
            branchTimezone = branch.timezone;
        }
        const keys = [...(branchId ? [`BRANCH:${branchId}`] : []), 'COMPANY'];
        for (const currentKey of keys) {
            const policy = await prisma.attendancePolicy.findFirst({ where: { companyId, currentKey, active: true } });
            if (policy) {
                const enforced = {
                    ...policy,
                    // Self-service identity and location evidence are mandatory.
                    // Legacy WARN/REVIEW rows remain readable but are normalized
                    // fail-closed before they reach any punch decision.
                    geofenceViolationMode: 'BLOCK' as const,
                    biometricViolationMode: 'BLOCK' as const,
                };
                return branchTimezone ? { ...enforced, timezone: branchTimezone } : enforced;
            }
        }
        return { ...this.defaults, timezone: branchTimezone || this.defaults.timezone, id: undefined, branchId: branchId || null };
    }

    static async replace(companyId: number, input: Record<string, unknown>, actorUserId: number, scopeBranchId?: number) {
        const requestedBranchId = input.branchId === undefined || input.branchId === null ? undefined : integer(input.branchId, 'branchId', 1, Number.MAX_SAFE_INTEGER);
        const branchId = scopeBranchId || requestedBranchId;
        if (scopeBranchId && requestedBranchId && requestedBranchId !== scopeBranchId) throw new HrAttendanceError('No autorizado para otra sucursal', 403);
        let branchTimezone: string | undefined;
        if (branchId) {
            const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { timezone: true } });
            if (!branch) throw new HrAttendanceError('Sucursal no encontrada en la empresa', 404);
            branchTimezone = branch.timezone;
        }
        const currentKey = branchId ? `BRANCH:${branchId}` : 'COMPANY';
        const current = await prisma.attendancePolicy.findFirst({ where: { companyId, currentKey, active: true } });
        const base = current || this.defaults;
        const requestedTimezone = typeof input.timezone === 'string' ? input.timezone.trim() : undefined;
        if (branchTimezone && requestedTimezone && requestedTimezone !== branchTimezone) {
            throw new HrAttendanceError('La política de sucursal debe usar la zona horaria configurada en la sucursal', 409);
        }
        const timezone = branchTimezone || requestedTimezone || base.timezone;
        if (!isValidTimeZone(timezone)) throw new HrAttendanceError('Zona horaria inválida');
        const data = {
            companyId, branchId: branchId || null, scopeKey: currentKey, currentKey,
            version: (current?.version || 0) + 1, timezone,
            requireBiometric: booleanValue(input.requireBiometric, 'requireBiometric', base.requireBiometric),
            requireLiveness: booleanValue(input.requireLiveness, 'requireLiveness', base.requireLiveness),
            requireGeolocation: booleanValue(input.requireGeolocation, 'requireGeolocation', base.requireGeolocation),
            maxLocationAccuracyM: input.maxLocationAccuracyM === undefined ? base.maxLocationAccuracyM : integer(input.maxLocationAccuracyM, 'maxLocationAccuracyM', 1, 5000),
            earlyCheckInMinutes: input.earlyCheckInMinutes === undefined ? base.earlyCheckInMinutes : integer(input.earlyCheckInMinutes, 'earlyCheckInMinutes', 0, 1440),
            lateCheckInToleranceM: input.lateCheckInToleranceM === undefined ? base.lateCheckInToleranceM : integer(input.lateCheckInToleranceM, 'lateCheckInToleranceM', 0, 1440),
            earlyCheckOutToleranceM: input.earlyCheckOutToleranceM === undefined ? base.earlyCheckOutToleranceM : integer(input.earlyCheckOutToleranceM, 'earlyCheckOutToleranceM', 0, 1440),
            lateCheckOutMinutes: input.lateCheckOutMinutes === undefined ? base.lateCheckOutMinutes : integer(input.lateCheckOutMinutes, 'lateCheckOutMinutes', 0, 2880),
            scheduleViolationMode: mode(input.scheduleViolationMode, 'scheduleViolationMode', base.scheduleViolationMode),
            geofenceViolationMode: 'BLOCK' as const,
            biometricViolationMode: 'BLOCK' as const,
            allowUnscheduledPunch: booleanValue(input.allowUnscheduledPunch, 'allowUnscheduledPunch', base.allowUnscheduledPunch),
            unscheduledViolationMode: mode(input.unscheduledViolationMode, 'unscheduledViolationMode', base.unscheduledViolationMode),
            allowManualFallback: booleanValue(input.allowManualFallback, 'allowManualFallback', base.allowManualFallback),
            biometricConsentVersion: input.biometricConsentVersion === undefined ? base.biometricConsentVersion : text(input.biometricConsentVersion, 'biometricConsentVersion', 64),
            biometricRetentionDays: input.biometricRetentionDays === undefined ? base.biometricRetentionDays : integer(input.biometricRetentionDays, 'biometricRetentionDays', 1, 3650),
            biometricRetentionNotice: input.biometricRetentionNotice === undefined ? base.biometricRetentionNotice : optionalText(input.biometricRetentionNotice, 'biometricRetentionNotice'),
            createdById: actorUserId,
        };
        return prisma.$transaction(async (tx) => {
            if (current) {
                const superseded = await tx.attendancePolicy.updateMany({
                    where: { id: current.id, companyId, currentKey, active: true },
                    data: { active: false, currentKey: null, supersededAt: new Date() },
                });
                if (superseded.count !== 1) throw new HrAttendanceError('La política cambió concurrentemente', 409);
            }
            const policy = await tx.attendancePolicy.create({ data });
            await AuditLogService.log({
                companyId, userId: actorUserId, entityType: 'AttendancePolicy', entityId: policy.id,
                action: current ? 'UPDATE' : 'CREATE', details: { branchId: branchId || null, version: policy.version },
            }, tx);
            return {
                ...policy,
                geofenceViolationMode: 'BLOCK' as const,
                biometricViolationMode: 'BLOCK' as const,
            };
        });
    }
}

export class BiometricService {
    static async providerHealth(provider: FaceVerificationProvider = createFaceVerificationProvider()) {
        if (!provider.healthCheck) {
            return { provider: provider.name, model: provider.model, status: 'UNAVAILABLE' as const, checkedAt: new Date().toISOString(), detail: 'El adaptador no implementa health check' };
        }
        return provider.healthCheck();
    }

    static async getMyProfile(companyId: number, userId: number) {
        await assertInternalEmployee(companyId, userId);
        const profile = await prisma.biometricProfile.findFirst({ where: { companyId, userId }, select: safeProfileSelect });
        return mapBiometricProfile(profile);
    }

    static async createChallenge(
        companyId: number,
        userId: number,
        purposeValue: unknown,
        actionValue?: unknown,
        provider: FaceVerificationProvider = createFaceVerificationProvider(),
    ) {
        await assertInternalEmployee(companyId, userId);
        if (typeof purposeValue !== 'string' || !PURPOSES.includes(purposeValue as typeof PURPOSES[number])) throw new HrAttendanceError('purpose inválido');
        const purpose = purposeValue as BiometricChallengePurpose;
        let action: AttendanceAction | null = null;
        if (actionValue !== undefined) {
            if (typeof actionValue !== 'string' || !ACTIONS.includes(actionValue as typeof ACTIONS[number])) throw new HrAttendanceError('action inválido');
            action = actionValue as AttendanceAction;
        }
        if (purpose === 'ATTENDANCE_PUNCH' && !action) throw new HrAttendanceError('action es requerida para marcaje');
        if (purpose === 'BIOMETRIC_ENROLLMENT' && action) throw new HrAttendanceError('action no aplica al enrolamiento');
        if (purpose === 'BIOMETRIC_ENROLLMENT') {
            const health = await this.providerHealth(provider);
            if (health.status !== 'AVAILABLE') {
                throw new FaceProviderUnavailableError(
                    'El enrolamiento biométrico no está disponible porque el proveedor facial no está configurado o no responde',
                );
            }
        }
        const token = randomBytes(32).toString('base64url');
        const nonce = randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + 5 * 60_000);
        const livenessAction = livenessActionFromNonce(nonce);
        const challenge = await prisma.biometricChallenge.create({
            data: {
                id: randomUUID(), companyId, userId, purpose, action,
                tokenHash: hashChallengeToken(nonce, token), nonce, expiresAt, maxAttempts: 3,
            },
            select: { id: true, purpose: true, action: true, expiresAt: true },
        });
        return {
            ...challenge, token,
            livenessAction,
            captureFrameCount: 6,
            captureIntervalMs: 450,
            livenessInstruction: livenessInstruction(livenessAction),
        };
    }

    static async consumeChallenge(input: {
        companyId: number; userId: number; challengeId: string; challengeToken?: string;
        purpose: BiometricChallengePurpose; action?: AttendanceAction; useKey?: string; requestHash?: string;
    }) {
        const challenge = await prisma.biometricChallenge.findFirst({
            where: { id: input.challengeId, companyId: input.companyId, userId: input.userId },
        });
        if (!challenge) throw new HrAttendanceError('Reto no encontrado', 401, 'CHALLENGE_INVALID');
        if (challenge.usedAt) {
            if (
                input.useKey && input.requestHash && challenge.usedByKey === input.useKey &&
                challenge.usedRequestHash === input.requestHash
            ) {
                // A durable AttendancePunchRequest owns this retry. Matching both
                // key and request hash prevents changing location/device after a crash.
                return challenge;
            }
            if (input.useKey && challenge.usedByKey === input.useKey) {
                throw new HrAttendanceError('El reto fue ligado a otro contenido para la misma idempotencia', 409, 'CHALLENGE_IDEMPOTENCY_MISMATCH');
            }
            throw new HrAttendanceError('El reto ya fue utilizado', 409, 'CHALLENGE_REPLAY');
        }
        if (challenge.expiresAt <= new Date()) throw new HrAttendanceError('El reto expiró', 409, 'CHALLENGE_EXPIRED');
        if (challenge.attempts >= challenge.maxAttempts) throw new HrAttendanceError('El reto agotó sus intentos', 429, 'CHALLENGE_ATTEMPTS_EXCEEDED');
        if (challenge.purpose !== input.purpose || (input.action && challenge.action !== input.action)) {
            throw new HrAttendanceError('El reto no corresponde a esta operación', 409, 'CHALLENGE_MISMATCH');
        }
        const suppliedHash = hashChallengeToken(challenge.nonce, input.challengeToken || '');
        if (!safeEqualHex(challenge.tokenHash, suppliedHash)) {
            await prisma.biometricChallenge.updateMany({
                where: { id: challenge.id, usedAt: null, attempts: { lt: challenge.maxAttempts } },
                data: { attempts: { increment: 1 } },
            });
            throw new HrAttendanceError('Token de reto inválido', 401, 'CHALLENGE_TOKEN_INVALID');
        }
        const consumed = await prisma.biometricChallenge.updateMany({
            where: { id: challenge.id, companyId: input.companyId, userId: input.userId, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: challenge.maxAttempts } },
            data: {
                usedAt: new Date(), usedByKey: input.useKey || null,
                usedRequestHash: input.requestHash || null, attempts: { increment: 1 },
            },
        });
        if (consumed.count !== 1) throw new HrAttendanceError('El reto fue consumido concurrentemente', 409, 'CHALLENGE_REPLAY');
        return challenge;
    }

    static async enroll(input: {
        companyId: number; userId: number; challengeId: string; challengeToken?: string;
        consentAccepted: boolean; consentVersion: string; evidence: FaceCaptureEvidence; branchId?: number;
    }, provider: FaceVerificationProvider = createFaceVerificationProvider()) {
        await assertInternalEmployee(input.companyId, input.userId);
        if (input.consentAccepted !== true) throw new HrAttendanceError('Se requiere consentimiento biométrico explícito', 400, 'CONSENT_REQUIRED');
        const policy = await AttendancePolicyService.getCurrent(input.companyId, input.branchId);
        if (input.consentVersion !== policy.biometricConsentVersion) throw new HrAttendanceError('La versión de consentimiento cambió; recargue la política', 409, 'CONSENT_VERSION_MISMATCH');
        const challenge = await this.consumeChallenge({
            companyId: input.companyId, userId: input.userId, challengeId: input.challengeId,
            challengeToken: input.challengeToken, purpose: 'BIOMETRIC_ENROLLMENT',
        });
        const existing = await prisma.biometricProfile.findFirst({ where: { companyId: input.companyId, userId: input.userId } });
        const providerContext = {
            tenantRef: String(input.companyId),
            subjectRef: String(input.userId),
            challengeRef: challenge.id,
            livenessAction: livenessActionFromNonce(challenge.nonce),
            requireLiveness: policy.requireLiveness,
            retentionDays: policy.biometricRetentionDays,
        } as const;
        const enrolled = await provider.enroll(input.evidence, providerContext);
        if (policy.requireLiveness && !enrolled.livenessPassed) {
            try { await provider.revokeTemplate(enrolled.templateRef, providerContext); } catch { /* provider reconciliation remains operational */ }
            throw new HrAttendanceError('La prueba de vida no fue superada', 422, 'LIVENESS_FAILED');
        }
        let encryptedTemplate: string;
        try {
            encryptedTemplate = encryptBiometricTemplate(enrolled.templateRef);
        } catch (error) {
            try { await provider.revokeTemplate(enrolled.templateRef, providerContext); } catch { /* best-effort compensation */ }
            throw error;
        }
        const now = new Date();
        const retentionExpiresAt = new Date(now.getTime() + policy.biometricRetentionDays * 86400000);
        try {
            const result = await prisma.$transaction(async (tx) => {
                let saved: Prisma.BiometricProfileGetPayload<{ select: typeof safeProfileSelect }>;
                if (existing) {
                    const updated = await tx.biometricProfile.updateMany({
                        where: {
                            id: existing.id, companyId: input.companyId, userId: input.userId,
                            status: existing.status, updatedAt: existing.updatedAt,
                        },
                        data: {
                            status: 'ACTIVE', consentVersion: input.consentVersion,
                            consentedAt: now, provider: enrolled.provider, model: enrolled.model,
                            templateRef: encryptedTemplate, enrolledAt: now, retentionExpiresAt,
                            purgeRequestedAt: null, revokedAt: null, revocationReason: null,
                        },
                    });
                    if (updated.count !== 1) {
                        throw new HrAttendanceError('El perfil biométrico cambió durante el enrolamiento; repita el proceso', 409, 'BIOMETRIC_PROFILE_CHANGED');
                    }
                    const reloaded = await tx.biometricProfile.findUnique({
                        where: { id: existing.id }, select: safeProfileSelect,
                    });
                    if (!reloaded) throw new HrAttendanceError('Perfil biométrico no encontrado', 404);
                    saved = reloaded;
                } else {
                    saved = await tx.biometricProfile.create({
                        data: {
                            companyId: input.companyId, userId: input.userId, status: 'ACTIVE',
                            consentVersion: input.consentVersion, consentedAt: now,
                            provider: enrolled.provider, model: enrolled.model, templateRef: encryptedTemplate,
                            enrolledAt: now, retentionExpiresAt,
                        },
                        select: safeProfileSelect,
                    });
                }
                const purge = existing?.status === 'ACTIVE' ? await tx.biometricPurgeRequest.create({
                    data: {
                        companyId: input.companyId, biometricProfileId: saved.id, provider: existing.provider,
                        encryptedTemplateRef: existing.templateRef, reason: 'REENROLL_REPLACED', nextAttemptAt: now,
                    },
                    select: { id: true },
                }) : null;
                await AuditLogService.log({
                    companyId: input.companyId, userId: input.userId, entityType: 'BiometricProfile', entityId: saved.id,
                    action: existing ? 'UPDATE' : 'CREATE',
                    details: { consentVersion: input.consentVersion, provider: enrolled.provider, retentionExpiresAt, priorPurgeRequestId: purge?.id || null },
                }, tx);
                return { saved, purgeId: purge?.id || null };
            });
            if (result.purgeId) {
                try { await this.processPurgeRequest(result.purgeId, provider); } catch { /* durable outbox will retry */ }
            }
            return mapBiometricProfile(result.saved);
        } catch (error) {
            try { await provider.revokeTemplate(enrolled.templateRef, providerContext); } catch { /* best-effort compensation */ }
            throw error;
        }
    }

    static async revoke(
        companyId: number,
        userId: number,
        provider: FaceVerificationProvider = createFaceVerificationProvider(),
        options: { actorUserId?: number; reason?: string } = {},
    ) {
        const now = new Date();
        const reason = options.reason || 'SELF_REVOKED';
        const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw(Prisma.sql`
                SELECT id FROM BiometricProfile
                WHERE companyId = ${companyId} AND userId = ${userId}
                FOR UPDATE
            `);
            const current = await tx.biometricProfile.findFirst({ where: { companyId, userId } });
            if (!current) return null;
            if (current.status !== 'ACTIVE') {
                const safe = await tx.biometricProfile.findUnique({ where: { id: current.id }, select: safeProfileSelect });
                return safe ? { profile: safe, purgeId: null as number | null } : null;
            }
            const purge = await tx.biometricPurgeRequest.create({
                data: {
                    companyId, biometricProfileId: current.id, provider: current.provider,
                    encryptedTemplateRef: current.templateRef,
                    reason, status: 'PENDING', attempts: 0, nextAttemptAt: now,
                },
                select: { id: true },
            });
            const saved = await tx.biometricProfile.update({
                where: { id: current.id },
                data: {
                    status: 'REVOKED', templateRef: `REVOKED:${randomUUID()}`, revokedAt: now,
                    purgeRequestedAt: now, revocationReason: reason,
                },
                select: safeProfileSelect,
            });
            await AuditLogService.log({
                companyId, userId: options.actorUserId || userId, entityType: 'BiometricProfile', entityId: current.id,
                action: 'DELETE', details: { reason, purgeRequestId: purge.id, subjectUserId: userId },
            }, tx);
            return { profile: saved, purgeId: purge.id };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        if (!result) return { status: 'NOT_ENROLLED' as const, canEnroll: true };
        if (result.purgeId) {
            try { await this.processPurgeRequest(result.purgeId, provider); } catch { /* durable outbox will retry */ }
        }
        return mapBiometricProfile(result.profile);
    }

    static async processPurgeRequest(id: number, provider: FaceVerificationProvider = createFaceVerificationProvider()) {
        const now = new Date();
        const request = await prisma.biometricPurgeRequest.findFirst({
            where: {
                id,
                status: { in: ['PENDING', 'FAILED'] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            include: { profile: { select: { userId: true } } },
        });
        if (!request) return false;
        if (request.encryptedTemplateRef === 'PURGED') return false;
        const claimedAttempts = request.attempts + 1;
        const claim = await prisma.biometricPurgeRequest.updateMany({
            where: {
                id,
                status: request.status,
                attempts: request.attempts,
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            data: {
                attempts: claimedAttempts,
                nextAttemptAt: new Date(now.getTime() + 60 * 60_000),
                lastError: null,
            },
        });
        if (claim.count !== 1) return false;
        let requestProvider = provider;
        if (request.provider !== provider.name) {
            try {
                requestProvider = createFaceVerificationProviderForName(request.provider);
            } catch (error) {
                await prisma.biometricPurgeRequest.updateMany({
                    where: { id, status: request.status, attempts: claimedAttempts },
                    data: {
                        status: 'FAILED',
                        nextAttemptAt: new Date(Date.now() + 24 * 3600_000),
                        lastError: `Adaptador de purga no disponible para ${request.provider}: ${error instanceof Error ? error.message : 'error desconocido'}`.slice(0, 1000),
                    },
                });
                return false;
            }
        }
        try {
            await requestProvider.revokeTemplate(decryptBiometricTemplate(request.encryptedTemplateRef), {
                tenantRef: String(request.companyId),
                subjectRef: String(request.profile.userId),
            });
            const completed = await prisma.biometricPurgeRequest.updateMany({
                where: { id, status: request.status, attempts: claimedAttempts },
                data: {
                    status: 'COMPLETED', encryptedTemplateRef: 'PURGED',
                    nextAttemptAt: null, lastError: null, completedAt: new Date(),
                },
            });
            return completed.count === 1;
        } catch (error) {
            await prisma.biometricPurgeRequest.updateMany({
                where: { id, status: request.status, attempts: claimedAttempts },
                data: {
                    status: 'FAILED',
                    nextAttemptAt: new Date(Date.now() + Math.min(24 * 3600_000, 2 ** Math.min(claimedAttempts, 10) * 60_000)),
                    lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Provider purge failed',
                },
            });
            return false;
        }
    }

    static async runRetentionMaintenance(
        companyId: number,
        actorUserId: number,
        provider: FaceVerificationProvider = createFaceVerificationProvider(),
        now = new Date(),
    ) {
        const expired = await prisma.biometricProfile.findMany({
            where: { companyId, status: 'ACTIVE', retentionExpiresAt: { lte: now } },
            select: { userId: true }, take: 100,
        });
        let revoked = 0;
        for (const profile of expired) {
            await this.revoke(companyId, profile.userId, provider, { actorUserId, reason: 'RETENTION_EXPIRED' });
            revoked += 1;
        }
        const pending = await prisma.biometricPurgeRequest.findMany({
            where: {
                companyId, status: { in: ['PENDING', 'FAILED'] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            }, select: { id: true }, orderBy: { createdAt: 'asc' }, take: 100,
        });
        let purged = 0;
        for (const request of pending) if (await this.processPurgeRequest(request.id, provider)) purged += 1;
        await AuditLogService.log({
            companyId, userId: actorUserId, entityType: 'BiometricMaintenance', entityId: companyId,
            action: 'UPDATE', details: { expiredProfilesRevoked: revoked, providerTemplatesPurged: purged },
        });
        return { expiredProfilesRevoked: revoked, providerTemplatesPurged: purged, pendingChecked: pending.length };
    }

    static async runScheduledMaintenance(now = new Date()) {
        const candidates = await prisma.user.findMany({
            where: {
                companyId: { not: null }, status: 'ACTIVE',
                OR: [
                    { role: { name: 'SUPERADMIN' } },
                    { userRoles: { some: { role: { name: 'SUPERADMIN' } } } },
                ],
            },
            select: { id: true, companyId: true },
            orderBy: { id: 'asc' },
        });
        const actorByCompany = new Map<number, number>();
        for (const candidate of candidates) {
            if (candidate.companyId && !actorByCompany.has(candidate.companyId)) {
                actorByCompany.set(candidate.companyId, candidate.id);
            }
        }
        const results: Array<{ companyId: number; ok: boolean; error?: string }> = [];
        for (const [companyId, actorUserId] of actorByCompany) {
            try {
                await this.runRetentionMaintenance(companyId, actorUserId, createFaceVerificationProvider(), now);
                results.push({ companyId, ok: true });
            } catch (error) {
                results.push({
                    companyId,
                    ok: false,
                    error: error instanceof Error ? error.message : 'Biometric maintenance failed',
                });
            }
        }
        return results;
    }
}
