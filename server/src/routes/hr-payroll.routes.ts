import { Router } from 'express';
import { HrPayrollController } from '../controllers/hr-payroll.controller';
import { ROLES } from '../constants/roles';
import { requirePermission } from '../middlewares/auth';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { validate } from '../middlewares/validate';

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store, private, max-age=0'); res.setHeader('Pragma', 'no-cache'); next(); });
const ownerRead = requirePermission('hr.payroll.read', ROLES.SUPERADMIN);
const ownerManage = requirePermission('hr.payroll.manage', ROLES.SUPERADMIN);
const ownerApprove = requirePermission('hr.payroll.approve', ROLES.SUPERADMIN);
const selfPayroll = requirePermission('hr.payroll.self', ...Object.values(ROLES));
const idParam = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const listQuery = {
    status: { type: 'string' as const, max: 32 }, periodId: { type: 'number' as const, integer: true, min: 1 },
    year: { type: 'number' as const, integer: true, min: 2000, max: 2200 },
    dateFrom: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ }, dateTo: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    page: { type: 'number' as const, integer: true, min: 1 }, limit: { type: 'number' as const, integer: true, min: 1, max: 100 },
};
const ruleFields = ['name', 'effectiveFrom', 'effectiveTo', 'sourceReference', 'description'] as const;
const ruleBody = {
    name: { type: 'string' as const, required: true, min: 1, max: 120 }, effectiveFrom: { type: 'string' as const, required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    effectiveTo: { type: 'string' as const, pattern: /^\d{4}-\d{2}-\d{2}$/ }, sourceReference: { type: 'string' as const, required: true, min: 3, max: 500 },
    description: { type: 'string' as const, max: 2000 },
};
const transitionFields = ['reason', 'confirmed', 'expectedRevision'] as const;
const transitionBody = {
    reason: { type: 'string' as const, required: true, min: 3, max: 2000 }, confirmed: { type: 'boolean' as const, required: true },
    expectedRevision: { type: 'number' as const, required: true, integer: true, min: 0 },
};

router.get('/rules', ownerRead, validate({ query: listQuery }), HrPayrollController.rules);
router.post('/rules', ownerManage, allowHrBodyFields(ruleFields), validate({ body: ruleBody }), HrPayrollController.createRule);
router.put('/rules/:id', ownerManage, allowHrBodyFields(ruleFields), validate({ params: idParam, body: ruleBody }), HrPayrollController.updateRule);
router.get('/rules/:id/configuration-revisions', ownerRead, validate({ params: idParam }), HrPayrollController.ruleConfigurations);
router.post('/rules/:id/configuration-revisions', ownerManage, allowHrBodyFields(['configuration', 'sourceReference', 'evidenceReference', 'reason', 'expectedRevision']), validate({ params: idParam, body: {
    configuration: { type: 'object', required: true }, sourceReference: { type: 'string', required: true, min: 3, max: 500 }, evidenceReference: { type: 'string', required: true, min: 3, max: 500 },
    reason: { type: 'string', required: true, min: 3, max: 2000 }, expectedRevision: { type: 'number', required: true, integer: true, min: 0 },
} }), HrPayrollController.uploadRuleConfiguration);
router.post('/rules/:id/configuration-reviews', ownerApprove, allowHrBodyFields(['configurationRevisionId', 'decision', 'reason', 'expectedRevision']), validate({ params: idParam, body: {
    configurationRevisionId: { type: 'number', required: true, integer: true, min: 1 }, decision: { type: 'string', required: true, enum: ['VALIDATED', 'REJECTED'] },
    reason: { type: 'string', required: true, min: 3, max: 2000 }, expectedRevision: { type: 'number', required: true, integer: true, min: 0 },
} }), HrPayrollController.reviewRuleConfiguration);
router.post('/rules/:id/activate', ownerApprove, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.activateRule);
router.post('/rules/:id/retire', ownerApprove, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.retireRule);

router.get('/periods', ownerRead, validate({ query: listQuery }), HrPayrollController.periods);
router.post('/periods', ownerManage, allowHrBodyFields(['code', 'dateFrom', 'dateTo', 'payDate', 'timezone', 'reason']), validate({ body: {
    code: { type: 'string', required: true, min: 1, max: 64 }, dateFrom: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    dateTo: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ }, payDate: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    timezone: { type: 'string', max: 64 }, reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrPayrollController.createPeriod);

router.get('/me/receipts', selfPayroll, validate({ query: listQuery }), HrPayrollController.myReceipts);
router.get('/me/receipts/:id', selfPayroll, validate({ params: idParam }), HrPayrollController.myReceipt);
router.get('/me/receipts/:id/pdf', selfPayroll, validate({ params: idParam }), HrPayrollController.myReceiptPdf);

const regularPayload = ['periodId', 'ruleVersionId', 'branchIds', 'reason'] as const;
router.get('/runs', ownerRead, validate({ query: listQuery }), HrPayrollController.runs);
router.post('/runs', ownerManage, allowHrBodyFields(regularPayload), validate({ body: {
    periodId: { type: 'number', required: true, integer: true, min: 1 }, ruleVersionId: { type: 'number', required: true, integer: true, min: 1 },
    branchIds: { type: 'array' }, reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrPayrollController.createRun);

router.get('/aguinaldo/runs', ownerRead, validate({ query: listQuery }), HrPayrollController.runs);
router.post('/aguinaldo/runs', ownerManage, allowHrBodyFields(['year', 'cutoffDate', 'ruleVersionId', 'employeeIds', 'reason']), validate({ body: {
    year: { type: 'number', required: true, integer: true, min: 2000, max: 2200 }, cutoffDate: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    ruleVersionId: { type: 'number', required: true, integer: true, min: 1 }, employeeIds: { type: 'array' },
    reason: { type: 'string', required: true, min: 3, max: 2000 },
} }), HrPayrollController.createAguinaldo);

function runContract(prefix: '/runs' | '/aguinaldo/runs') {
    router.get(`${prefix}/:id`, ownerRead, validate({ params: idParam }), HrPayrollController.run);
    router.post(`${prefix}/:id/reconciliation`, ownerRead,
        allowHrBodyFields(['expectedGrossIncome', 'expectedTotalDeductions', 'expectedNetPay', 'expectedEmployeeCount', 'controlSource', 'evidenceReference']),
        validate({ params: idParam, body: {
            expectedGrossIncome: { type: 'string', required: true, pattern: /^\d+(?:\.\d{1,2})?$/ },
            expectedTotalDeductions: { type: 'string', required: true, pattern: /^\d+(?:\.\d{1,2})?$/ },
            expectedNetPay: { type: 'string', required: true, pattern: /^\d+(?:\.\d{1,2})?$/ },
            expectedEmployeeCount: { type: 'number', required: true, integer: true, min: 0 },
            controlSource: { type: 'string', required: true, min: 3, max: 160 },
            evidenceReference: { type: 'string', required: true, min: 3, max: 500 },
        } }), HrPayrollController.reconcileParallelControl);
    router.post(`${prefix}/:id/calculate`, ownerManage, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.transition('calculate'));
    router.post(`${prefix}/:id/recalculate`, ownerManage, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.transition('recalculate'));
    router.post(`${prefix}/:id/submit-review`, ownerManage, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.transition('submit-review'));
    router.post(`${prefix}/:id/approve`, ownerApprove, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrPayrollController.transition('approve'));
    router.post(`${prefix}/:id/pay`, ownerApprove, allowHrBodyFields([...transitionFields, 'paymentReference', 'paymentDate', 'paymentMethod', 'batchReference', 'evidenceReference']), validate({ params: idParam, body: {
        ...transitionBody, paymentReference: { type: 'string', required: true, min: 3, max: 160 }, paymentDate: { type: 'string', required: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        paymentMethod: { type: 'string', required: true, min: 2, max: 80 }, batchReference: { type: 'string', max: 160 }, evidenceReference: { type: 'string', required: true, min: 3, max: 500 },
    } }), HrPayrollController.transition('pay'));
    router.post(`${prefix}/:id/void`, ownerApprove, allowHrBodyFields([...transitionFields, 'reversalReference', 'reversalDate', 'reversalMethod', 'evidenceReference']), validate({ params: idParam, body: {
        ...transitionBody, reversalReference: { type: 'string', min: 3, max: 160 }, reversalDate: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
        reversalMethod: { type: 'string', min: 2, max: 80 }, evidenceReference: { type: 'string', min: 3, max: 500 },
    } }), HrPayrollController.transition('void'));
    router.get(`${prefix}/:id/anomalies`, ownerRead, validate({ params: idParam }), HrPayrollController.listPart('anomalies'));
    router.get(`${prefix}/:id/snapshot`, ownerRead, validate({ params: idParam }), HrPayrollController.listPart('snapshots'));
    router.get(`${prefix}/:id/components`, ownerRead, validate({ params: idParam }), HrPayrollController.listPart('components'));
    router.post(`${prefix}/:id/components`, ownerManage, allowHrBodyFields(['userId', 'code', 'type', 'inputAmount', 'reason', 'reference']), validate({ params: idParam, body: {
        userId: { type: 'number', required: true, integer: true, min: 1 }, code: { type: 'string', required: true, min: 1, max: 64 },
        type: { type: 'string', required: true, enum: ['INCOME', 'DEDUCTION'] }, inputAmount: { type: 'string', required: true, pattern: /^\d+(?:\.\d{1,2})?$/ },
        reason: { type: 'string', required: true, min: 3, max: 2000 }, reference: { type: 'string', max: 500 },
    } }), HrPayrollController.addComponent);
    router.get(`${prefix}/:id/receipts`, ownerRead, validate({ params: idParam }), HrPayrollController.listPart('receipts'));
    router.get(`${prefix}/:id/receipts/:receiptId/pdf`, ownerRead, validate({ params: { ...idParam, receiptId: { type: 'number', required: true, integer: true, min: 1 } } }), HrPayrollController.runReceiptPdf);
    router.get(`${prefix}/:id/export`, ownerRead, validate({ params: idParam, query: { format: { type: 'string', required: true, enum: ['csv', 'xlsx'] } } }), HrPayrollController.export);
}

runContract('/runs');
runContract('/aguinaldo/runs');

export default router;
