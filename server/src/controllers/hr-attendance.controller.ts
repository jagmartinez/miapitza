import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AttendanceDeviceService, AttendanceService } from '../services/hr-attendance.service';
import { AttendancePolicyService, BiometricService, HrAttendanceError } from '../services/hr-biometric.service';
import {
    FaceEvidenceRejectedError,
    FaceProviderUnavailableError,
    type FaceCaptureEvidence,
} from '../services/hr-face-provider';
import { BranchScopeError, resolveBranchScope } from '../utils/branch-scope';

function queryId(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function queryText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function branchScope(req: Request, requested?: number): number | undefined {
    return resolveBranchScope(req.user!, requested);
}

function captureEvidence(req: Request): FaceCaptureEvidence | undefined {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const primary = files?.faceImage?.[0] || files?.capture?.[0];
    if (!primary) return undefined;
    const ordered = [primary, ...(files?.faceFrames || [])];
    return {
        frames: ordered.map((file) => ({
            buffer: file.buffer,
            mimeType: file.mimetype as 'image/jpeg' | 'image/png',
        })),
    };
}

function policyForApi(policy: Awaited<ReturnType<typeof AttendancePolicyService.getCurrent>>) {
    return {
        id: policy.id,
        version: policy.version,
        branchId: policy.branchId,
        timezone: policy.timezone,
        requireBiometric: policy.requireBiometric,
        requireLiveness: policy.requireLiveness,
        requireGeolocation: policy.requireGeolocation,
        maxLocationAccuracyM: policy.maxLocationAccuracyM,
        earlyCheckInMinutes: policy.earlyCheckInMinutes,
        lateCheckInToleranceM: policy.lateCheckInToleranceM,
        earlyCheckOutToleranceM: policy.earlyCheckOutToleranceM,
        lateCheckOutMinutes: policy.lateCheckOutMinutes,
        scheduleViolationMode: policy.scheduleViolationMode,
        geofenceViolationMode: policy.geofenceViolationMode,
        biometricViolationMode: policy.biometricViolationMode,
        allowUnscheduledPunch: policy.allowUnscheduledPunch,
        unscheduledViolationMode: policy.unscheduledViolationMode,
        allowManualFallback: policy.allowManualFallback,
        biometricConsentVersion: policy.biometricConsentVersion,
        biometricRetentionDays: policy.biometricRetentionDays,
        biometricRetentionNotice: policy.biometricRetentionNotice,
    };
}

function handleError(error: unknown, res: Response, next: NextFunction): void {
    if (error instanceof HrAttendanceError || error instanceof FaceProviderUnavailableError || error instanceof FaceEvidenceRejectedError || error instanceof BranchScopeError) {
        const code = error instanceof HrAttendanceError
            ? error.code
            : error instanceof FaceEvidenceRejectedError
                ? error.code
            : error instanceof FaceProviderUnavailableError
                ? 'FACE_PROVIDER_UNAVAILABLE'
                : undefined;
        res.status(error.statusCode).json({ success: false, code, message: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
            res.status(409).json({ success: false, message: 'El registro ya existe o fue procesado concurrentemente' });
            return;
        }
        if (error.code === 'P2003') {
            res.status(400).json({ success: false, message: 'La referencia indicada no es válida' });
            return;
        }
    }
    next(error);
}

export class HrAttendanceController {
    static async biometricProviderHealth(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await BiometricService.providerHealth();
            res.status(data.status === 'AVAILABLE' ? 200 : 503).json({ success: data.status === 'AVAILABLE', data });
        } catch (error) { handleError(error, res, next); }
    }

    static async getPolicy(req: Request, res: Response, next: NextFunction) {
        try {
            const requested = queryId(req.query.branchId);
            const data = await AttendancePolicyService.getCurrent(req.user!.companyId, branchScope(req, requested));
            res.json({ success: true, data: policyForApi(data) });
        } catch (error) { handleError(error, res, next); }
    }

    static async updatePolicy(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendancePolicyService.replace(req.user!.companyId, req.body, req.user!.userId, branchScope(req, queryId(req.body.branchId)));
            res.json({ success: true, data: policyForApi(data), message: 'Política de asistencia versionada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async today(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceService.today(req.user!.companyId, req.user!.userId, req.user!.branchId);
            res.json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async createChallenge(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await BiometricService.createChallenge(req.user!.companyId, req.user!.userId, req.body.purpose, req.body.action);
            res.status(201).json({ success: true, data });
        } catch (error) { handleError(error, res, next); }
    }

    static async myBiometrics(req: Request, res: Response, next: NextFunction) {
        try { res.json({ success: true, data: await BiometricService.getMyProfile(req.user!.companyId, req.user!.userId) }); }
        catch (error) { handleError(error, res, next); }
    }

    static async enroll(req: Request, res: Response, next: NextFunction) {
        try {
            const evidence = captureEvidence(req);
            if (!evidence) throw new HrAttendanceError('faceImage es requerido');
            const data = await BiometricService.enroll({
                companyId: req.user!.companyId, userId: req.user!.userId,
                challengeId: String(req.body.challengeId || ''), challengeToken: req.body.challengeToken,
                consentAccepted: req.body.consentAccepted === 'true' || req.body.consentAccepted === true,
                consentVersion: String(req.body.consentVersion || ''), evidence, branchId: req.user!.branchId,
            });
            res.status(201).json({ success: true, data, message: 'Perfil biométrico enrolado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async revokeBiometrics(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await BiometricService.revoke(req.user!.companyId, req.user!.userId);
            res.json({ success: true, data, message: 'Perfil biométrico revocado y plantilla local eliminada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async revokeUserBiometrics(req: Request, res: Response, next: NextFunction) {
        try {
            const targetUserId = Number(req.params.userId);
            const data = await BiometricService.revoke(
                req.user!.companyId, targetUserId, undefined,
                { actorUserId: req.user!.userId, reason: String(req.body.reason || 'OWNER_REVOKED') },
            );
            res.json({ success: true, data, message: 'Perfil biométrico revocado y purga programada' });
        } catch (error) { handleError(error, res, next); }
    }

    static async runBiometricMaintenance(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await BiometricService.runRetentionMaintenance(req.user!.companyId, req.user!.userId);
            res.json({ success: true, data, message: 'Mantenimiento biométrico ejecutado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async punch(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceService.punch({
                companyId: req.user!.companyId, userId: req.user!.userId, activeBranchId: req.user!.branchId,
                idempotencyKey: String(req.get('Idempotency-Key') || ''), action: req.body.action,
                challengeId: String(req.body.challengeId || ''), challengeToken: req.body.challengeToken,
                evidence: captureEvidence(req), latitude: req.body.latitude, longitude: req.body.longitude,
                accuracyM: req.body.accuracyM, locationCapturedAt: req.body.locationCapturedAt,
                deviceId: req.get('X-Attendance-Device-Id'), deviceKey: req.get('X-Attendance-Device-Key') || undefined,
            });
            const { serviceUnavailable, ...payload } = data;
            if (serviceUnavailable) {
                res.status(503).json({ success: false, code: 'FACE_PROVIDER_UNAVAILABLE', message: payload.message, data: payload });
                return;
            }
            // Domain rejection is a successfully recorded immutable attempt; the UI
            // must receive the structured checks instead of an HTTP transport error.
            res.status(201).json({ success: true, data: payload });
        } catch (error) { handleError(error, res, next); }
    }

    static async listEvents(req: Request, res: Response, next: NextFunction) {
        try {
            const result = await AttendanceService.listEvents(req.user!.companyId, {
                dateFrom: queryText(req.query.dateFrom), dateTo: queryText(req.query.dateTo),
                branchId: queryId(req.query.branchId), userId: queryId(req.query.userId),
                action: queryText(req.query.action), decision: queryText(req.query.decision),
                page: queryId(req.query.page), limit: queryId(req.query.limit),
            }, branchScope(req, queryId(req.query.branchId)));
            res.json({ success: true, data: result.items, pagination: result.pagination });
        } catch (error) { handleError(error, res, next); }
    }

    static async reviewEvent(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceService.review(Number(req.params.id), req.user!.companyId, req.user!.userId, req.body.decision, req.body.reason, branchScope(req));
            res.json({ success: true, data, message: 'Revisión registrada sin alterar el evento original' });
        } catch (error) { handleError(error, res, next); }
    }

    static async manual(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceService.manual({
                companyId: req.user!.companyId, actorUserId: req.user!.userId,
                idempotencyKey: String(req.get('Idempotency-Key') || ''),
                userId: req.body.userId, branchId: req.body.branchId, action: req.body.action,
                occurredAt: req.body.occurredAt, reason: req.body.reason,
                scheduleId: req.body.scheduleId, targetEventId: req.body.targetEventId,
            }, branchScope(req));
            res.status(201).json({ success: true, data, message: 'Ajuste manual compensatorio creado' });
        } catch (error) { handleError(error, res, next); }
    }

    static async listDevices(req: Request, res: Response, next: NextFunction) {
        try { res.json({ success: true, data: await AttendanceDeviceService.list(req.user!.companyId, branchScope(req, queryId(req.query.branchId))) }); }
        catch (error) { handleError(error, res, next); }
    }

    static async createDevice(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceDeviceService.create(req.user!.companyId, req.user!.userId, req.body, branchScope(req, queryId(req.body.branchId)));
            res.status(201).json({ success: true, data, message: 'Guarde la clave: no volverá a mostrarse' });
        } catch (error) { handleError(error, res, next); }
    }

    static async revokeDevice(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await AttendanceDeviceService.revoke(Number(req.params.id), req.user!.companyId, req.user!.userId, branchScope(req));
            res.json({ success: true, data, message: 'Dispositivo revocado' });
        } catch (error) { handleError(error, res, next); }
    }
}
