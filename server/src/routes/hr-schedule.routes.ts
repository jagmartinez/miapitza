import { Router } from 'express';
import { HrScheduleController } from '../controllers/hr-schedule.controller';
import { ROLES } from '../constants/roles';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { requirePermission } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

const router = Router();
const ownerRead = requirePermission('hr.schedule.read', ROLES.SUPERADMIN);
const ownerManage = requirePermission('hr.schedule.manage', ROLES.SUPERADMIN);
const ownerPublish = requirePermission('hr.schedule.publish', ROLES.SUPERADMIN);
const selfSchedule = requirePermission('hr.schedule.self', ...Object.values(ROLES));
const idParam = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const weekRule = { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ };

const templateFields = [
    'branchId', 'jobPositionId', 'name', 'code', 'startTime', 'endTime',
    'breakMinutes', 'paidBreak', 'notes', 'active',
] as const;
const templateBody = {
    branchId: { type: 'number' as const, integer: true, min: 1 },
    jobPositionId: { type: 'number' as const, integer: true, min: 1 },
    name: { type: 'string' as const, min: 1, max: 100 },
    code: { type: 'string' as const, min: 1, max: 30 },
    startTime: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
    endTime: { type: 'string' as const, pattern: /^\d{2}:\d{2}$/ },
    breakMinutes: { type: 'number' as const, integer: true, min: 0, max: 2880 },
    paidBreak: { type: 'boolean' as const },
    notes: { type: 'string' as const, max: 5000 },
    active: { type: 'boolean' as const },
};

router.get('/shift-templates', ownerRead, validate({ query: {
    branchId: { type: 'number', integer: true, min: 1 }, active: { type: 'boolean' },
} }), HrScheduleController.listTemplates);
router.get('/shift-templates/:id', ownerRead, validate({ params: idParam }), HrScheduleController.getTemplate);
router.post('/shift-templates', ownerManage, allowHrBodyFields(templateFields), validate({ body: {
    ...templateBody,
    branchId: { ...templateBody.branchId, required: true },
    name: { ...templateBody.name, required: true }, code: { ...templateBody.code, required: true },
    startTime: { ...templateBody.startTime, required: true }, endTime: { ...templateBody.endTime, required: true },
} }), HrScheduleController.createTemplate);
router.put('/shift-templates/:id', ownerManage, allowHrBodyFields(templateFields), validate({ params: idParam, body: templateBody }), HrScheduleController.updateTemplate);
router.patch('/shift-templates/:id/status', ownerManage, allowHrBodyFields(['active']), validate({ params: idParam, body: {
    active: { type: 'boolean', required: true },
} }), HrScheduleController.updateTemplate);

router.get('/schedules', ownerRead, validate({ query: {
    weekStart: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
    status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED'] },
    branchId: { type: 'number', integer: true, min: 1 }, userId: { type: 'number', integer: true, min: 1 },
    jobPositionId: { type: 'number', integer: true, min: 1 },
} }), HrScheduleController.listSchedules);
router.get('/schedules/lookups', ownerRead, validate({ query: {
    weekStart: weekRule,
} }), HrScheduleController.scheduleLookups);
router.get('/schedules/:id', ownerRead, validate({ params: idParam }), HrScheduleController.getSchedule);
router.post('/schedules', ownerManage, allowHrBodyFields(['weekStart', 'notes', 'shifts']), validate({ body: {
    weekStart: weekRule, notes: { type: 'string', max: 5000 }, shifts: { type: 'array', max: 500 },
} }), HrScheduleController.createDraft);
const replaceSchedule = [
    ownerManage,
    allowHrBodyFields(['expectedRevision', 'shifts', 'notes']),
    validate({ params: idParam, body: {
        expectedRevision: { type: 'number', required: true, integer: true, min: 0 },
        shifts: { type: 'array', required: true, max: 500 }, notes: { type: 'string', max: 5000 },
    } }),
    HrScheduleController.replaceShifts,
] as const;
router.put('/schedules/:id', ...replaceSchedule);
router.put('/schedules/:id/shifts', ...replaceSchedule);
router.post('/schedules/:id/copy', ownerManage, allowHrBodyFields(['targetWeekStart']), validate({ params: idParam, body: {
    targetWeekStart: weekRule,
} }), HrScheduleController.copySchedule);
router.post('/schedules/:id/publish', ownerPublish, allowHrBodyFields(['expectedRevision']), validate({ params: idParam, body: {
    expectedRevision: { type: 'number', required: true, integer: true, min: 0 },
} }), HrScheduleController.publishSchedule);
router.post('/schedules/:id/cancel', ownerPublish, allowHrBodyFields(['expectedRevision']), validate({ params: idParam, body: {
    expectedRevision: { type: 'number', required: true, integer: true, min: 0 },
} }), HrScheduleController.cancelSchedule);
router.post('/schedules/:id/acknowledge', selfSchedule, allowHrBodyFields([]), validate({ params: idParam }), HrScheduleController.acknowledge);
router.get('/me/schedule', selfSchedule, validate({ query: { weekStart: weekRule } }), HrScheduleController.mySchedule);
router.get('/team/schedule', selfSchedule, validate({ query: { weekStart: weekRule } }), HrScheduleController.teamSchedule);

router.get('/swaps', ownerRead, validate({ query: {
    status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'APPROVED', 'REJECTED', 'CANCELLED'] },
    userId: { type: 'number', integer: true, min: 1 },
} }), HrScheduleController.listSwaps);
router.get('/me/swaps', selfSchedule, validate({ query: {
    status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'APPROVED', 'REJECTED', 'CANCELLED'] },
} }), HrScheduleController.mySwaps);
router.post('/swaps', selfSchedule, allowHrBodyFields(['requesterShiftId', 'targetUserId', 'offeredShiftId', 'reason']), validate({ body: {
    requesterShiftId: { type: 'number', required: true, integer: true, min: 1 },
    targetUserId: { type: 'number', required: true, integer: true, min: 1 },
    offeredShiftId: { type: 'number', integer: true, min: 1 }, reason: { type: 'string', max: 1000 },
} }), HrScheduleController.createSwap);
router.post('/swaps/:id/respond', selfSchedule, allowHrBodyFields(['decision']), validate({ params: idParam, body: {
    decision: { type: 'string', required: true, enum: ['ACCEPT', 'REJECT'] },
} }), HrScheduleController.respondSwap);
router.post('/swaps/:id/cancel', selfSchedule, allowHrBodyFields([]), validate({ params: idParam }), HrScheduleController.cancelMySwap);
router.post('/swaps/:id/approve', ownerPublish, allowHrBodyFields(['notes']), validate({ params: idParam, body: {
    notes: { type: 'string', max: 1000 },
} }), HrScheduleController.approveSwap);
router.post('/swaps/:id/manager-cancel', ownerManage, allowHrBodyFields([]), validate({ params: idParam }), HrScheduleController.cancelManagedSwap);

router.get('/holiday-calendars', ownerRead, HrScheduleController.listCalendars);
router.get('/holidays', ownerRead, validate({ query: {
    calendarId: { type: 'number', integer: true, min: 1 }, branchId: { type: 'number', integer: true, min: 1 },
    weekStart: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
    dateFrom: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ }, dateTo: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
} }), HrScheduleController.listHolidays);
router.post('/holiday-calendars', ownerManage, allowHrBodyFields(['name', 'timezone', 'active']), validate({ body: {
    name: { type: 'string', required: true, min: 1, max: 100 }, timezone: { type: 'string', max: 64 }, active: { type: 'boolean' },
} }), HrScheduleController.createCalendar);
router.put('/holiday-calendars/:id', ownerManage, allowHrBodyFields(['name', 'timezone', 'active']), validate({ params: idParam, body: {
    name: { type: 'string', min: 1, max: 100 }, timezone: { type: 'string', max: 64 }, active: { type: 'boolean' },
} }), HrScheduleController.updateCalendar);
router.post('/holiday-calendars/:id/holidays', ownerManage, allowHrBodyFields(['name', 'date', 'branchId', 'paid', 'payMultiplier', 'notes']), validate({ params: idParam, body: {
    name: { type: 'string', required: true, min: 1, max: 100 }, date: weekRule,
    branchId: { type: 'number', integer: true, min: 1 }, paid: { type: 'boolean' },
    payMultiplier: { type: 'number', min: 0.01, max: 99.99 }, notes: { type: 'string', max: 1000 },
} }), HrScheduleController.createHoliday);
router.put('/holidays/:id', ownerManage, allowHrBodyFields(['name', 'paid', 'payMultiplier', 'notes', 'active']), validate({ params: idParam, body: {
    name: { type: 'string', min: 1, max: 100 }, paid: { type: 'boolean' },
    payMultiplier: { type: 'number', min: 0.01, max: 99.99 }, notes: { type: 'string', max: 1000 }, active: { type: 'boolean' },
} }), HrScheduleController.updateHoliday);

export default router;
