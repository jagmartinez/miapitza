import { Router } from 'express';
import { HrWorkforceController } from '../controllers/hr-workforce.controller';
import { ROLES } from '../constants/roles';
import { requirePermission } from '../middlewares/auth';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { validate } from '../middlewares/validate';

const router = Router();
const ownerRead = requirePermission('hr.workforce.read', ROLES.SUPERADMIN);
const ownerManage = requirePermission('hr.workforce.manage', ROLES.SUPERADMIN);
const ownerApprove = requirePermission('hr.workforce.approve', ROLES.SUPERADMIN);
const selfWorkforce = requirePermission('hr.workforce.self', ...Object.values(ROLES));
const idParam = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const date = { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ };
const commonQuery = {
    date,
    dateFrom: date,
    dateTo: date,
    branchId: { type: 'number' as const, integer: true, min: 1 },
    userId: { type: 'number' as const, integer: true, min: 1 },
    status: { type: 'string' as const, max: 32 },
    page: { type: 'number' as const, integer: true, min: 1 },
    limit: { type: 'number' as const, integer: true, min: 1, max: 100 },
};

router.get('/attendance/daily-summaries', ownerRead, validate({ query: commonQuery }), HrWorkforceController.dailySummaries);
router.get('/attendance/incidents', ownerRead, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['OPEN', 'RESOLVED', 'DISMISSED'] },
} }), HrWorkforceController.incidents);

const correctionFields = [
    'userId', 'dailySummaryId', 'incidentId', 'targetEventId', 'type',
    'requestedAction', 'requestedOccurredAt', 'requestedTimezone', 'requestedBranchId', 'reason',
] as const;
router.get('/attendance/corrections', selfWorkforce, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLIED'] },
} }), HrWorkforceController.corrections);
router.post('/attendance/corrections', selfWorkforce, allowHrBodyFields(correctionFields), validate({ body: {
    userId: { type: 'number', integer: true, min: 1 },
    dailySummaryId: { type: 'number', integer: true, min: 1 },
    incidentId: { type: 'number', integer: true, min: 1 },
    targetEventId: { type: 'number', integer: true, min: 1 },
    type: { type: 'string', required: true, enum: ['ADD_PUNCH', 'VOID_PUNCH', 'CHANGE_TIME', 'ASSIGN_BRANCH', 'OTHER'] },
    requestedAction: { type: 'string', enum: ['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT'] },
    requestedOccurredAt: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/ },
    requestedTimezone: { type: 'string', max: 64 },
    requestedBranchId: { type: 'number', integer: true, min: 1 },
    reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrWorkforceController.createCorrection);
router.post('/attendance/corrections/:id/decide', ownerApprove, allowHrBodyFields(['decision', 'reason']), validate({
    params: idParam,
    body: {
        decision: { type: 'string', required: true, enum: ['APPROVED', 'REJECTED'] },
        reason: { type: 'string', required: true, min: 3, max: 2000 },
    },
}), HrWorkforceController.decideCorrection);

router.get('/attendance/periods', ownerRead, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['OPEN', 'CLOSED', 'REOPENED'] },
} }), HrWorkforceController.periods);
router.post('/attendance/periods', ownerManage, allowHrBodyFields(['dateFrom', 'dateTo', 'timezone', 'reason']), validate({ body: {
    dateFrom: { ...date, required: true },
    dateTo: { ...date, required: true },
    timezone: { type: 'string', max: 64 },
    reason: { type: 'string', max: 2000 },
} }), HrWorkforceController.createPeriod);
router.post('/attendance/periods/:id/close', ownerApprove, allowHrBodyFields(['reason']), validate({
    params: idParam,
    body: { reason: { type: 'string', required: true, min: 3, max: 2000 } },
}), HrWorkforceController.closePeriod);
router.post('/attendance/periods/:id/reopen', ownerApprove, allowHrBodyFields(['reason']), validate({
    params: idParam,
    body: { reason: { type: 'string', required: true, min: 3, max: 2000 } },
}), HrWorkforceController.reopenPeriod);

router.get('/overtime/requests', selfWorkforce, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
} }), HrWorkforceController.overtime);
router.post('/overtime/requests', selfWorkforce, allowHrBodyFields(['userId', 'dailySummaryId', 'date', 'requestedMinutes', 'reason']), validate({ body: {
    userId: { type: 'number', integer: true, min: 1 },
    dailySummaryId: { type: 'number', integer: true, min: 1 },
    date: { ...date, required: true },
    requestedMinutes: { type: 'number', required: true, integer: true, min: 1, max: 10080 },
    reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrWorkforceController.createOvertime);
router.post('/overtime/requests/:id/decide', ownerApprove, allowHrBodyFields(['decision', 'approvedMinutes', 'reason']), validate({
    params: idParam,
    body: {
        decision: { type: 'string', required: true, enum: ['APPROVED', 'REJECTED'] },
        approvedMinutes: { type: 'number', integer: true, min: 1, max: 10080 },
        reason: { type: 'string', required: true, min: 3, max: 2000 },
    },
}), HrWorkforceController.decideOvertime);
router.post('/overtime/requests/:id/cancel', selfWorkforce, allowHrBodyFields(['reason']), validate({
    params: idParam,
    body: { reason: { type: 'string', required: true, min: 3, max: 2000 } },
}), HrWorkforceController.cancelOvertime);

const leaveTypeFields = ['code', 'name', 'description', 'paid', 'active', 'balanceTracked', 'unit', 'requiresAttachment'] as const;
const leaveTypeBody = {
    code: { type: 'string' as const, min: 1, max: 50 },
    name: { type: 'string' as const, min: 1, max: 100 },
    description: { type: 'string' as const, max: 5000 },
    paid: { type: 'boolean' as const },
    active: { type: 'boolean' as const },
    balanceTracked: { type: 'boolean' as const },
    unit: { type: 'string' as const, enum: ['DAYS', 'HOURS', 'MINUTES'] },
    requiresAttachment: { type: 'boolean' as const },
};
router.get('/leave/types', selfWorkforce, validate({ query: { active: { type: 'boolean' } } }), HrWorkforceController.leaveTypes);
router.post('/leave/types', ownerManage, allowHrBodyFields(leaveTypeFields), validate({ body: {
    ...leaveTypeBody,
    code: { ...leaveTypeBody.code, required: true },
    name: { ...leaveTypeBody.name, required: true },
    paid: { ...leaveTypeBody.paid, required: true },
    active: { ...leaveTypeBody.active, required: true },
    balanceTracked: { ...leaveTypeBody.balanceTracked, required: true },
    unit: { ...leaveTypeBody.unit, required: true },
} }), HrWorkforceController.createLeaveType);
router.put('/leave/types/:id', ownerManage, allowHrBodyFields(leaveTypeFields), validate({
    params: idParam,
    body: leaveTypeBody,
}), HrWorkforceController.updateLeaveType);

const leaveRequestFields = [
    'userId', 'leaveTypeId', 'startDate', 'endDate', 'fraction',
    'startTime', 'endTime', 'requestedAmount', 'reason',
] as const;
router.get('/leave/requests', selfWorkforce, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
} }), HrWorkforceController.leaveRequests);
router.post('/leave/requests', selfWorkforce, allowHrBodyFields(leaveRequestFields), validate({ body: {
    userId: { type: 'number', integer: true, min: 1 },
    leaveTypeId: { type: 'number', required: true, integer: true, min: 1 },
    startDate: { ...date, required: true },
    endDate: { ...date, required: true },
    fraction: { type: 'string', required: true, enum: ['FULL_DAY', 'HALF_DAY', 'HOURS'] },
    startTime: { type: 'string', pattern: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: 'string', pattern: /^([01]\d|2[0-3]):[0-5]\d$/ },
    requestedAmount: { type: 'number', min: 0 },
    reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrWorkforceController.createLeaveRequest);
router.post('/leave/requests/:id/submit', selfWorkforce, allowHrBodyFields([]), validate({ params: idParam }), HrWorkforceController.submitLeaveRequest);
router.post('/leave/requests/:id/decide', ownerApprove, allowHrBodyFields(['decision', 'reason']), validate({
    params: idParam,
    body: {
        decision: { type: 'string', required: true, enum: ['APPROVED', 'REJECTED'] },
        reason: { type: 'string', required: true, min: 3, max: 2000 },
    },
}), HrWorkforceController.decideLeaveRequest);
router.post('/leave/requests/:id/cancel', selfWorkforce, allowHrBodyFields(['reason']), validate({
    params: idParam,
    body: { reason: { type: 'string', required: true, min: 3, max: 2000 } },
}), HrWorkforceController.cancelLeaveRequest);
router.get('/leave/calendar', ownerRead, validate({ query: {
    ...commonQuery,
    status: { type: 'string', enum: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
} }), HrWorkforceController.leaveCalendar);

router.get('/vacation/balances', ownerRead, validate({ query: commonQuery }), HrWorkforceController.vacationBalances);
router.get('/vacation/ledger', ownerRead, validate({ query: commonQuery }), HrWorkforceController.vacationLedger);
router.post('/vacation/adjustments', ownerManage, allowHrBodyFields(['userId', 'balanceId', 'effectiveDate', 'amount', 'unit', 'reason', 'reference']), validate({ body: {
    userId: { type: 'number', required: true, integer: true, min: 1 },
    balanceId: { type: 'number', integer: true, min: 1 },
    effectiveDate: { ...date, required: true },
    amount: { type: 'number', required: true, min: -1000000, max: 1000000 },
    unit: { type: 'string', required: true, enum: ['DAYS', 'HOURS', 'MINUTES'] },
    reason: { type: 'string', required: true, min: 3, max: 2000 },
    reference: { type: 'string', max: 191 },
} }), HrWorkforceController.createVacationAdjustment);

router.get('/me/attendance/summary', selfWorkforce, validate({ query: commonQuery }), HrWorkforceController.myAttendanceSummaries);
router.get('/me/workforce', selfWorkforce, validate({ query: commonQuery }), HrWorkforceController.myWorkforce);

export default router;
