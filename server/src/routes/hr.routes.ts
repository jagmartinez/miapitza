import { Router } from 'express';
import multer from 'multer';
import { HrController } from '../controllers/hr.controller';
import { authMiddleware, requirePermission } from '../middlewares/auth';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { validate } from '../middlewares/validate';
import { ROLES } from '../constants/roles';
import hrScheduleRoutes from './hr-schedule.routes';
import hrAttendanceRoutes from './hr-attendance.routes';
import hrWorkforceRoutes from './hr-workforce.routes';
import hrPayrollRoutes from './hr-payroll.routes';
import hrBenefitsRoutes from './hr-benefits.routes';

const router = Router();

const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 6 },
    fileFilter: (_req, file, callback) => {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)) {
            callback(new Error('El documento debe ser PDF, JPEG o PNG'));
            return;
        }
        callback(null, true);
    },
}).fields([{ name: 'document', maxCount: 1 }]);

const memoryDocumentUpload: import('express').RequestHandler = (req, res, next) => {
    documentUpload(req, res, (error) => {
        if (!error) { next(); return; }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ success: false, message: 'El documento excede 10 MB' });
            return;
        }
        res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Documento inválido' });
    });
};

const employeeFields = [
    'userId', 'employeeCode', 'legalName', 'preferredName', 'documentType', 'documentNumber',
    'socialSecurityNumber', 'taxId', 'workEmail', 'workPhone', 'address',
    'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
    'hireDate', 'employmentType', 'departmentId', 'jobPositionId', 'costCenterId',
    'supervisorEmployeeId', 'notes', 'branchIds', 'primaryBranchId',
] as const;

const employeeBodySchema = {
    userId: { type: 'number' as const, integer: true, min: 1 },
    employeeCode: { type: 'string' as const, min: 1, max: 50 },
    legalName: { type: 'string' as const, min: 1, max: 191 },
    preferredName: { type: 'string' as const, max: 191 },
    documentType: { type: 'string' as const, max: 191 },
    documentNumber: { type: 'string' as const, max: 191 },
    socialSecurityNumber: { type: 'string' as const, max: 191 },
    taxId: { type: 'string' as const, max: 191 },
    workEmail: { type: 'email' as const, max: 191 },
    workPhone: { type: 'string' as const, max: 191 },
    address: { type: 'string' as const, max: 191 },
    emergencyContactName: { type: 'string' as const, max: 191 },
    emergencyContactPhone: { type: 'string' as const, max: 191 },
    emergencyContactRelationship: { type: 'string' as const, max: 191 },
    hireDate: { type: 'date' as const },
    employmentType: {
        type: 'string' as const,
        enum: ['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'],
    },
    departmentId: { type: 'number' as const, integer: true, min: 1 },
    jobPositionId: { type: 'number' as const, integer: true, min: 1 },
    costCenterId: { type: 'number' as const, integer: true, min: 1 },
    supervisorEmployeeId: { type: 'number' as const, integer: true, min: 1 },
    notes: { type: 'string' as const, max: 5000 },
    branchIds: { type: 'array' as const, max: 100 },
    primaryBranchId: { type: 'number' as const, integer: true, min: 1 },
};

router.use(authMiddleware);
router.use('/', hrScheduleRoutes);
router.use('/', hrAttendanceRoutes);
router.use('/', hrWorkforceRoutes);
router.use('/payroll', hrPayrollRoutes);
router.use('/benefits', hrBenefitsRoutes);

router.get('/dashboard', requirePermission('hr.dashboard.read', ROLES.SUPERADMIN), HrController.dashboard);
router.get('/lookups', requirePermission('hr.employee.read', ROLES.SUPERADMIN), HrController.lookups);

router.get('/employees',
    requirePermission('hr.employee.read', ROLES.SUPERADMIN),
    validate({
        query: {
            search: { type: 'string', max: 191 },
            status: { type: 'string', enum: ['ACTIVE', 'ON_LEAVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'] },
            departmentId: { type: 'number', integer: true, min: 1 },
            jobPositionId: { type: 'number', integer: true, min: 1 },
            costCenterId: { type: 'number', integer: true, min: 1 },
            branchId: { type: 'number', integer: true, min: 1 },
            page: { type: 'number', integer: true, min: 1 },
            limit: { type: 'number', integer: true, min: 1, max: 100 },
        },
    }),
    HrController.listEmployees,
);

router.get('/employees/:id',
    requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN),
    validate({ params: { id: { type: 'number', required: true, integer: true, min: 1 } } }),
    HrController.getEmployee,
);

router.post('/employees',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(employeeFields),
    validate({
        body: {
            ...employeeBodySchema,
            userId: { ...employeeBodySchema.userId, required: true },
            employeeCode: { ...employeeBodySchema.employeeCode, required: true },
            legalName: { ...employeeBodySchema.legalName, required: true },
            hireDate: { ...employeeBodySchema.hireDate, required: true },
        },
    }),
    HrController.createEmployee,
);

router.put('/employees/:id',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(employeeFields.filter((field) => field !== 'userId')),
    validate({
        params: { id: { type: 'number', required: true, integer: true, min: 1 } },
        body: employeeBodySchema,
    }),
    HrController.updateEmployee,
);

router.patch('/employees/:id/status',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(['status', 'terminationDate', 'reason']),
    validate({
        params: { id: { type: 'number', required: true, integer: true, min: 1 } },
        body: {
            status: {
                type: 'string', required: true,
                enum: ['ACTIVE', 'ON_LEAVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'],
            },
            terminationDate: { type: 'date' },
            reason: { type: 'string', max: 500 },
        },
    }),
    HrController.setEmployeeStatus,
);

const employeeIdParams = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const employeeChildParams = {
    ...employeeIdParams,
    contractId: { type: 'number' as const, required: true, integer: true, min: 1 },
};
const employeeDocumentParams = {
    ...employeeIdParams,
    documentId: { type: 'number' as const, required: true, integer: true, min: 1 },
};

router.get('/employees/:id/contracts', requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN), validate({ params: employeeIdParams }), HrController.employeeContracts);
router.post('/employees/:id/contracts',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(['contractNumber', 'employmentType', 'startDate', 'endDate', 'jobPositionId', 'costCenterId', 'notes']),
    validate({ params: employeeIdParams, body: {
        contractNumber: { type: 'string', required: true, min: 1, max: 80 },
        employmentType: { type: 'string', required: true, enum: ['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'] },
        startDate: { type: 'date', required: true }, endDate: { type: 'date' },
        jobPositionId: { type: 'number', integer: true, min: 1 }, costCenterId: { type: 'number', integer: true, min: 1 },
        notes: { type: 'string', max: 5000 },
    } }),
    HrController.createEmployeeContract,
);
router.post('/employees/:id/contracts/:contractId/transition',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(['action', 'signedAt', 'endDate', 'reason']),
    validate({ params: employeeChildParams, body: {
        action: { type: 'string', required: true, enum: ['ACTIVATE', 'TERMINATE', 'EXPIRE'] },
        signedAt: { type: 'string', max: 40 }, endDate: { type: 'date' }, reason: { type: 'string', required: true, min: 3, max: 500 },
    } }),
    HrController.transitionEmployeeContract,
);

router.get('/employees/:id/compensations', requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN), validate({ params: employeeIdParams }), HrController.employeeCompensations);
router.post('/employees/:id/compensations',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(['contractId', 'compensationType', 'payFrequency', 'amount', 'currency', 'effectiveFrom', 'reason']),
    validate({ params: employeeIdParams, body: {
        contractId: { type: 'number', integer: true, min: 1 },
        compensationType: { type: 'string', required: true, enum: ['SALARY', 'HOURLY'] },
        payFrequency: { type: 'string', required: true, enum: ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] },
        amount: { type: 'string', required: true, pattern: /^\d+(?:\.\d{1,2})?$/ },
        currency: { type: 'string', pattern: /^[A-Z]{3}$/ }, effectiveFrom: { type: 'date', required: true },
        reason: { type: 'string', required: true, min: 3, max: 500 },
    } }),
    HrController.appendEmployeeCompensation,
);

router.get('/employees/:id/documents', requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN), validate({ params: employeeIdParams }), HrController.employeeDocuments);
router.post('/employees/:id/documents',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN), memoryDocumentUpload,
    allowHrBodyFields(['documentType', 'expiresAt']),
    validate({ params: employeeIdParams, body: { documentType: { type: 'string', required: true, min: 1, max: 100 }, expiresAt: { type: 'date' } } }),
    HrController.uploadEmployeeDocument,
);
router.get('/employees/:id/documents/:documentId/download', requirePermission('hr.employee.sensitive.view', ROLES.SUPERADMIN), validate({ params: employeeDocumentParams }), HrController.downloadEmployeeDocument);
router.post('/employees/:id/documents/:documentId/revoke',
    requirePermission('hr.employee.manage', ROLES.SUPERADMIN), allowHrBodyFields(['reason']),
    validate({ params: employeeDocumentParams, body: { reason: { type: 'string', required: true, min: 3, max: 500 } } }),
    HrController.revokeEmployeeDocument,
);
router.get('/documents/storage/health', requirePermission('hr.employee.manage', ROLES.SUPERADMIN), HrController.employeeDocumentStorageHealth);
router.post('/documents/retention/run', requirePermission('hr.employee.manage', ROLES.SUPERADMIN), allowHrBodyFields([]), HrController.runEmployeeDocumentRetention);

const catalogFields = ['name', 'code', 'description', 'departmentId'] as const;
const catalogUpdateFields = [...catalogFields, 'active'] as const;
const catalogBodySchema = {
    name: { type: 'string' as const, min: 1, max: 100 },
    code: { type: 'string' as const, min: 1, max: 30 },
    description: { type: 'string' as const, max: 191 },
    departmentId: { type: 'number' as const, integer: true, min: 1 },
};

for (const [path, kind] of [
    ['departments', 'department'],
    ['positions', 'jobPosition'],
    ['cost-centers', 'costCenter'],
] as const) {
    router.get(`/${path}`, requirePermission('hr.catalog.read', ROLES.SUPERADMIN), HrController.listCatalog(kind));
    router.post(`/${path}`,
        requirePermission('hr.catalog.manage', ROLES.SUPERADMIN),
        allowHrBodyFields(catalogFields),
        validate({ body: {
            ...catalogBodySchema,
            name: { ...catalogBodySchema.name, required: true },
            code: { ...catalogBodySchema.code, required: true },
        } }),
        HrController.createCatalog(kind),
    );
    router.put(`/${path}/:id`,
        requirePermission('hr.catalog.manage', ROLES.SUPERADMIN),
        allowHrBodyFields(catalogUpdateFields),
        validate({
            params: { id: { type: 'number', required: true, integer: true, min: 1 } },
            body: { ...catalogBodySchema, active: { type: 'boolean' } },
        }),
        HrController.updateCatalog(kind),
    );
    router.patch(`/${path}/:id/status`,
        requirePermission('hr.catalog.manage', ROLES.SUPERADMIN),
        allowHrBodyFields(['active']),
        validate({
            params: { id: { type: 'number', required: true, integer: true, min: 1 } },
            body: { active: { type: 'boolean', required: true } },
        }),
        HrController.updateCatalog(kind),
    );
}

const branchCreateFields = [
    'name', 'code', 'address', 'phone', 'latitude', 'longitude', 'geofenceRadiusM',
    'maxLocationAccuracyM', 'timezone', 'attendanceEnabled', 'status',
] as const;

router.post('/branches',
    requirePermission('hr.geofence.manage', ROLES.SUPERADMIN),
    allowHrBodyFields(branchCreateFields),
    validate({ body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        code: { type: 'string', required: true, min: 1, max: 20 },
        address: { type: 'string', max: 191 },
        phone: { type: 'string', max: 191 },
        latitude: { type: 'number', required: true, min: -90, max: 90 },
        longitude: { type: 'number', required: true, min: -180, max: 180 },
        geofenceRadiusM: { type: 'number', required: true, integer: true, min: 10, max: 10000 },
        maxLocationAccuracyM: { type: 'number', required: true, integer: true, min: 1, max: 5000 },
        timezone: { type: 'string', max: 64 },
        attendanceEnabled: { type: 'boolean' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    } }),
    HrController.createBranch,
);

router.get('/branches/:id/geofence',
    requirePermission('hr.geofence.read', ROLES.SUPERADMIN),
    validate({ params: { id: { type: 'number', required: true, integer: true, min: 1 } } }),
    HrController.getBranchGeofence,
);

router.put('/branches/:id/geofence',
    requirePermission('hr.geofence.manage', ROLES.SUPERADMIN),
    allowHrBodyFields([
        'name', 'code', 'address', 'phone', 'status',
        'latitude', 'longitude', 'geofenceRadiusM', 'maxLocationAccuracyM',
        'timezone', 'attendanceEnabled', 'expectedVersion',
    ]),
    validate({
        params: { id: { type: 'number', required: true, integer: true, min: 1 } },
        body: {
            name: { type: 'string', min: 1, max: 200 },
            code: { type: 'string', min: 1, max: 20 },
            address: { type: 'string', max: 191 },
            phone: { type: 'string', max: 191 },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
            latitude: { type: 'number', min: -90, max: 90 },
            longitude: { type: 'number', min: -180, max: 180 },
            geofenceRadiusM: { type: 'number', integer: true, min: 10, max: 10000 },
            maxLocationAccuracyM: { type: 'number', integer: true, min: 1, max: 5000 },
            timezone: { type: 'string', max: 64 },
            attendanceEnabled: { type: 'boolean' },
            expectedVersion: { type: 'number', integer: true, min: 0 },
        },
    }),
    HrController.updateBranchGeofence,
);

export default router;
