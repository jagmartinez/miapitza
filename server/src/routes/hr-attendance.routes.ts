import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { HrAttendanceController } from '../controllers/hr-attendance.controller';
import { ROLES } from '../constants/roles';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();
const ownerManage = requirePermission('hr.attendance.manage', ROLES.SUPERADMIN);
const ownerReview = requirePermission('hr.attendance.review', ROLES.SUPERADMIN);
const selfAttendance = requirePermission('hr.attendance.self', ...Object.values(ROLES));
const selfBiometric = requirePermission('hr.biometric.self', ...Object.values(ROLES));
const biometricManage = requirePermission('hr.biometric.manage', ROLES.SUPERADMIN);
const deviceManage = requirePermission('hr.attendance.device.manage', ROLES.SUPERADMIN);
const idParam = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const actions = ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT'];

const biometricLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiados intentos biométricos; intente más tarde' },
});

const faceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 12, parts: 14 },
    fileFilter: (_req, file, callback) => {
        if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
            callback(new Error('La captura debe ser JPEG o PNG'));
            return;
        }
        callback(null, true);
    },
}).fields([{ name: 'faceImage', maxCount: 1 }, { name: 'capture', maxCount: 1 }]);

const memoryFaceUpload: RequestHandler = (req, res, next) => {
    faceUpload(req, res, (error) => {
        if (!error) { next(); return; }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ success: false, message: 'La captura excede 2 MB' });
            return;
        }
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Captura inválida' });
    });
};

const policyFields = [
    'branchId', 'timezone', 'requireBiometric', 'requireLiveness', 'requireGeolocation',
    'maxLocationAccuracyM', 'earlyCheckInMinutes', 'lateCheckInToleranceM',
    'earlyCheckOutToleranceM', 'lateCheckOutMinutes', 'scheduleViolationMode',
    'geofenceViolationMode', 'biometricViolationMode', 'allowUnscheduledPunch',
    'unscheduledViolationMode', 'allowManualFallback', 'biometricConsentVersion',
    'biometricRetentionDays', 'biometricRetentionNotice',
] as const;

router.get('/attendance/policy', selfAttendance, validate({ query: {
    branchId: { type: 'number', integer: true, min: 1 },
} }), HrAttendanceController.getPolicy);
router.put('/attendance/policy', ownerManage, allowHrBodyFields(policyFields), validate({ body: {
    branchId: { type: 'number', integer: true, min: 1 }, timezone: { type: 'string', max: 64 },
    requireBiometric: { type: 'boolean' }, requireLiveness: { type: 'boolean' }, requireGeolocation: { type: 'boolean' },
    maxLocationAccuracyM: { type: 'number', integer: true, min: 1, max: 5000 },
    earlyCheckInMinutes: { type: 'number', integer: true, min: 0, max: 1440 },
    lateCheckInToleranceM: { type: 'number', integer: true, min: 0, max: 1440 },
    earlyCheckOutToleranceM: { type: 'number', integer: true, min: 0, max: 1440 },
    lateCheckOutMinutes: { type: 'number', integer: true, min: 0, max: 2880 },
    scheduleViolationMode: { type: 'string', enum: ['BLOCK', 'REVIEW', 'WARN'] },
    geofenceViolationMode: { type: 'string', enum: ['BLOCK', 'REVIEW', 'WARN'] },
    biometricViolationMode: { type: 'string', enum: ['BLOCK', 'REVIEW', 'WARN'] },
    allowUnscheduledPunch: { type: 'boolean' }, unscheduledViolationMode: { type: 'string', enum: ['BLOCK', 'REVIEW', 'WARN'] },
    allowManualFallback: { type: 'boolean' }, biometricConsentVersion: { type: 'string', max: 64 },
    biometricRetentionDays: { type: 'number', integer: true, min: 1, max: 3650 },
    biometricRetentionNotice: { type: 'string', max: 5000 },
} }), HrAttendanceController.updatePolicy);

router.get('/me/attendance/today', selfAttendance, HrAttendanceController.today);
router.post('/biometrics/challenges', selfBiometric, biometricLimiter,
    allowHrBodyFields(['purpose', 'action']), validate({ body: {
        purpose: { type: 'string', required: true, enum: ['ATTENDANCE_PUNCH', 'BIOMETRIC_ENROLLMENT'] },
        action: { type: 'string', enum: actions },
    } }), HrAttendanceController.createChallenge);
router.get('/biometrics/me', selfBiometric, HrAttendanceController.myBiometrics);
router.post('/biometrics/enroll', selfBiometric, biometricLimiter, memoryFaceUpload,
    allowHrBodyFields(['challengeId', 'challengeToken', 'consentAccepted', 'consentVersion']),
    validate({ body: {
        challengeId: { type: 'string', required: true, max: 191 }, challengeToken: { type: 'string', max: 191 },
        consentAccepted: { type: 'string', required: true, enum: ['true'] }, consentVersion: { type: 'string', required: true, max: 64 },
    } }), HrAttendanceController.enroll);
router.delete('/biometrics/me', selfBiometric, biometricLimiter, HrAttendanceController.revokeBiometrics);
router.post('/biometrics/users/:userId/revoke', biometricManage,
    allowHrBodyFields(['reason']), validate({ params: {
        userId: { type: 'number', required: true, integer: true, min: 1 },
    }, body: { reason: { type: 'string', required: true, min: 3, max: 500 } } }),
    HrAttendanceController.revokeUserBiometrics);
router.post('/biometrics/maintenance/run', biometricManage, allowHrBodyFields([]), HrAttendanceController.runBiometricMaintenance);
router.get('/biometrics/provider/health', biometricManage, HrAttendanceController.biometricProviderHealth);

router.post('/attendance/punches', selfAttendance, biometricLimiter, memoryFaceUpload,
    allowHrBodyFields(['action', 'challengeId', 'challengeToken', 'latitude', 'longitude', 'accuracyM', 'locationCapturedAt']),
    validate({ body: {
        action: { type: 'string', required: true, enum: actions }, challengeId: { type: 'string', required: true, max: 191 },
        challengeToken: { type: 'string', max: 191 }, latitude: { type: 'number', min: -90, max: 90 },
        longitude: { type: 'number', min: -180, max: 180 }, accuracyM: { type: 'number', min: 0, max: 100000 },
        locationCapturedAt: { type: 'date' },
    } }), HrAttendanceController.punch);

router.get('/attendance/events', ownerManage, validate({ query: {
    dateFrom: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ }, dateTo: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
    branchId: { type: 'number', integer: true, min: 1 }, userId: { type: 'number', integer: true, min: 1 },
    action: { type: 'string', enum: actions }, decision: { type: 'string', enum: ['ACCEPTED', 'REVIEW_REQUIRED', 'REJECTED'] },
    page: { type: 'number', integer: true, min: 1 }, limit: { type: 'number', integer: true, min: 1, max: 100 },
} }), HrAttendanceController.listEvents);
router.post('/attendance/events/:id/review', ownerReview, allowHrBodyFields(['decision', 'reason']), validate({
    params: idParam, body: {
        decision: { type: 'string', required: true, enum: ['APPROVED', 'REJECTED'] },
        reason: { type: 'string', required: true, min: 3, max: 2000 },
    },
}), HrAttendanceController.reviewEvent);
router.post('/attendance/manual', ownerManage, allowHrBodyFields(['userId', 'branchId', 'action', 'occurredAt', 'reason', 'scheduleId', 'targetEventId']), validate({ body: {
    userId: { type: 'number', required: true, integer: true, min: 1 }, branchId: { type: 'number', required: true, integer: true, min: 1 },
    action: { type: 'string', required: true, enum: actions }, occurredAt: { type: 'date', required: true },
    reason: { type: 'string', required: true, min: 3, max: 2000 }, scheduleId: { type: 'number', integer: true, min: 1 },
    targetEventId: { type: 'number', integer: true, min: 1 },
} }), HrAttendanceController.manual);

router.get('/attendance/devices', deviceManage, validate({ query: { branchId: { type: 'number', integer: true, min: 1 } } }), HrAttendanceController.listDevices);
router.post('/attendance/devices', deviceManage, allowHrBodyFields(['branchId', 'name', 'code']), validate({ body: {
    branchId: { type: 'number', required: true, integer: true, min: 1 }, name: { type: 'string', required: true, min: 1, max: 100 },
    code: { type: 'string', required: true, min: 1, max: 50 },
} }), HrAttendanceController.createDevice);
router.post('/attendance/devices/:id/revoke', deviceManage, allowHrBodyFields([]), validate({ params: idParam }), HrAttendanceController.revokeDevice);

export default router;
