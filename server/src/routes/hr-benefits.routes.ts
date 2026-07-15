import { Router } from 'express';
import { HrBenefitsController } from '../controllers/hr-benefits.controller';
import { ROLES } from '../constants/roles';
import { requirePermission } from '../middlewares/auth';
import { allowHrBodyFields } from '../middlewares/hr-dto';
import { validate } from '../middlewares/validate';

const router = Router();
const ownerRead = requirePermission('hr.benefits.read', ROLES.SUPERADMIN);
const ownerManage = requirePermission('hr.benefits.manage', ROLES.SUPERADMIN);
const ownerApprove = requirePermission('hr.benefits.approve', ROLES.SUPERADMIN);
const selfBenefits = requirePermission('hr.benefits.self', ...Object.values(ROLES));
const idParam = { id: { type: 'number' as const, required: true, integer: true, min: 1 } };
const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const listQuery = {
    status: { type: 'string' as const, max: 32 }, userId: { type: 'number' as const, integer: true, min: 1 },
    branchId: { type: 'number' as const, integer: true, min: 1 }, dateFrom: { type: 'string' as const, pattern: datePattern },
    dateTo: { type: 'string' as const, pattern: datePattern }, page: { type: 'number' as const, integer: true, min: 1 },
    limit: { type: 'number' as const, integer: true, min: 1, max: 100 },
};
const travelFields = ['userId', 'branchId', 'destination', 'purpose', 'departureDate', 'returnDate', 'currency', 'requestedAmount'] as const;
const travelUpdateFields = [...travelFields, 'expectedRevision'] as const;
const travelBody = {
    userId: { type: 'number' as const, integer: true, min: 1 }, branchId: { type: 'number' as const, integer: true, min: 1 },
    destination: { type: 'string' as const, required: true, min: 1, max: 160 }, purpose: { type: 'string' as const, required: true, min: 1, max: 900 },
    departureDate: { type: 'string' as const, required: true, pattern: datePattern }, returnDate: { type: 'string' as const, required: true, pattern: datePattern },
    currency: { type: 'string' as const, required: true, pattern: /^[A-Za-z]{3}$/ }, requestedAmount: { type: 'string' as const, required: true, pattern: moneyPattern },
};
const transitionFields = ['reason', 'confirmed', 'expectedRevision', 'effectiveDate', 'reference'] as const;
const transitionBody = {
    reason: { type: 'string' as const, required: true, min: 1, max: 900 }, confirmed: { type: 'boolean' as const, required: true },
    expectedRevision: { type: 'number' as const, required: true, integer: true, min: 0 }, effectiveDate: { type: 'string' as const, pattern: datePattern },
    reference: { type: 'string' as const, max: 160 },
};
const expenseFields = ['category', 'description', 'occurredOn', 'currency', 'claimedAmount', 'receiptReference', 'evidenceId'] as const;
const expenseBody = {
    category: { type: 'string' as const, required: true, min: 1, max: 64 }, description: { type: 'string' as const, required: true, min: 1, max: 600 },
    occurredOn: { type: 'string' as const, required: true, pattern: datePattern }, currency: { type: 'string' as const, required: true, pattern: /^[A-Za-z]{3}$/ },
    claimedAmount: { type: 'string' as const, required: true, pattern: moneyPattern }, receiptReference: { type: 'string' as const, max: 160 },
    evidenceId: { type: 'number' as const, integer: true, min: 1 },
};
const loanFields = ['userId', 'purpose', 'currency', 'requestedAmount', 'preferredInstallments', 'payrollDeductionRequested', 'firstPreferredDeductionDate'] as const;
const loanBody = {
    userId: { type: 'number' as const, integer: true, min: 1 }, purpose: { type: 'string' as const, required: true, min: 1, max: 900 },
    currency: { type: 'string' as const, required: true, pattern: /^[A-Za-z]{3}$/ }, requestedAmount: { type: 'string' as const, required: true, pattern: moneyPattern },
    preferredInstallments: { type: 'number' as const, required: true, integer: true, min: 1, max: 120 }, payrollDeductionRequested: { type: 'boolean' as const, required: true },
    firstPreferredDeductionDate: { type: 'string' as const, pattern: datePattern },
};
const deductionFields = ['userId', 'name', 'reason', 'currency', 'frequency', 'requestedAmount', 'perPeriodLimit', 'priority', 'effectiveFrom', 'effectiveTo'] as const;
const deductionUpdateFields = [...deductionFields, 'expectedRevision'] as const;
const deductionBody = {
    userId: { type: 'number' as const, required: true, integer: true, min: 1 }, name: { type: 'string' as const, required: true, min: 1, max: 120 },
    reason: { type: 'string' as const, required: true, min: 1, max: 900 }, currency: { type: 'string' as const, required: true, pattern: /^[A-Za-z]{3}$/ },
    frequency: { type: 'string' as const, required: true, enum: ['ONCE', 'RECURRING'] }, requestedAmount: { type: 'string' as const, required: true, pattern: moneyPattern },
    perPeriodLimit: { type: 'string' as const, pattern: moneyPattern }, priority: { type: 'number' as const, required: true, integer: true, min: 1, max: 9999 },
    effectiveFrom: { type: 'string' as const, required: true, pattern: datePattern }, effectiveTo: { type: 'string' as const, pattern: datePattern },
};

router.get('/travel-requests', ownerRead, validate({ query: listQuery }), HrBenefitsController.travelList);
router.get('/travel-requests/:id', ownerRead, validate({ params: idParam }), HrBenefitsController.travelGet);
router.post('/travel-requests', ownerManage, allowHrBodyFields(travelFields), validate({ body: { ...travelBody, userId: { ...travelBody.userId, required: true } } }), HrBenefitsController.travelCreate);
router.put('/travel-requests/:id', ownerManage, allowHrBodyFields(travelUpdateFields), validate({ params: idParam, body: { ...travelBody, expectedRevision: transitionBody.expectedRevision } }), HrBenefitsController.travelUpdate);
router.post('/travel-requests/:id/expenses', ownerManage, allowHrBodyFields(expenseFields), validate({ params: idParam, body: expenseBody }), HrBenefitsController.travelExpense);

function travelTransition(path: string, action: string, permission: ReturnType<typeof requirePermission>, extraFields: readonly string[] = [], extraBody: Record<string, any> = {}) {
    router.post(`/travel-requests/:id/${path}`, permission, allowHrBodyFields([...transitionFields, ...extraFields] as any), validate({ params: idParam, body: { ...transitionBody, ...extraBody } }), HrBenefitsController.travelTransition(action));
}
travelTransition('submit', 'submit', ownerManage);
travelTransition('approve', 'approve', ownerApprove, ['approvedAmount'], { approvedAmount: { type: 'string', required: true, pattern: moneyPattern } });
travelTransition('reject', 'reject', ownerApprove);
travelTransition('advance', 'advance', ownerApprove, ['advanceReference'], { advanceReference: { type: 'string', required: true, min: 1, max: 160 } });
travelTransition('start-settlement', 'start-settlement', ownerManage);
travelTransition('settle', 'settle', ownerApprove, ['settlementReference'], { settlementReference: { type: 'string', required: true, min: 1, max: 160 } });
travelTransition('cancel', 'cancel', ownerApprove);
travelTransition('reverse', 'reverse', ownerApprove);

router.get('/loans', ownerRead, validate({ query: listQuery }), HrBenefitsController.loanList);
router.get('/loans/:id', ownerRead, validate({ params: idParam }), HrBenefitsController.loanGet);
router.post('/loan-requests', ownerManage, allowHrBodyFields(loanFields), validate({ body: { ...loanBody, userId: { ...loanBody.userId, required: true } } }), HrBenefitsController.loanCreate);
function loanTransition(path: string, action: string, extraFields: readonly string[] = [], extraBody: Record<string, any> = {}) {
    router.post(`/loans/:id/${path}`, ownerApprove, allowHrBodyFields([...transitionFields, ...extraFields] as any), validate({ params: idParam, body: { ...transitionBody, ...extraBody } }), HrBenefitsController.loanTransition(action));
}
loanTransition('approve', 'approve', ['approvedAmount', 'installmentCount', 'firstDueDate'], { approvedAmount: { type: 'string', required: true, pattern: moneyPattern }, installmentCount: { type: 'number', required: true, integer: true, min: 1, max: 120 }, firstDueDate: { type: 'string', required: true, pattern: datePattern } });
loanTransition('reject', 'reject');
loanTransition('disburse', 'disburse', ['disbursementReference'], { disbursementReference: { type: 'string', required: true, min: 1, max: 160 } });
loanTransition('payments', 'payments', ['paymentReference', 'receivedAmount'], { paymentReference: { type: 'string', required: true, min: 1, max: 160 }, receivedAmount: { type: 'string', required: true, pattern: moneyPattern } });
loanTransition('close', 'close'); loanTransition('cancel', 'cancel'); loanTransition('reverse', 'reverse');

router.get('/deductions', ownerRead, validate({ query: listQuery }), HrBenefitsController.deductionList);
router.get('/deductions/:id', ownerRead, validate({ params: idParam }), HrBenefitsController.deductionGet);
router.post('/deductions', ownerManage, allowHrBodyFields(deductionFields), validate({ body: deductionBody }), HrBenefitsController.deductionCreate);
router.put('/deductions/:id', ownerManage, allowHrBodyFields(deductionUpdateFields), validate({ params: idParam, body: { ...deductionBody, expectedRevision: transitionBody.expectedRevision } }), HrBenefitsController.deductionUpdate);
for (const [path, action, permission] of [['activate', 'activate', ownerApprove], ['pause', 'pause', ownerManage], ['resume', 'resume', ownerManage], ['cancel', 'cancel', ownerApprove], ['reverse', 'reverse', ownerApprove]] as const) {
    router.post(`/deductions/:id/${path}`, permission, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrBenefitsController.deductionTransition(action));
}

router.get('/me/travel-requests', selfBenefits, validate({ query: listQuery }), HrBenefitsController.myTravelList);
router.get('/me/travel-requests/:id', selfBenefits, validate({ params: idParam }), HrBenefitsController.myTravelGet);
router.post('/me/travel-requests', selfBenefits, allowHrBodyFields(travelFields.filter(field => field !== 'userId')), validate({ body: travelBody }), HrBenefitsController.myTravelCreate);
router.post('/me/travel-requests/:id/expenses', selfBenefits, allowHrBodyFields(expenseFields), validate({ params: idParam, body: expenseBody }), HrBenefitsController.myTravelExpense);
for (const [path, action] of [['submit', 'submit'], ['start-settlement', 'start-settlement'], ['cancel', 'cancel']] as const) {
    router.post(`/me/travel-requests/:id/${path}`, selfBenefits, allowHrBodyFields(transitionFields), validate({ params: idParam, body: transitionBody }), HrBenefitsController.myTravelTransition(action));
}
router.get('/me/loans', selfBenefits, validate({ query: listQuery }), HrBenefitsController.myLoanList);
router.get('/me/loans/:id', selfBenefits, validate({ params: idParam }), HrBenefitsController.myLoanGet);
router.post('/me/loan-requests', selfBenefits, allowHrBodyFields(loanFields.filter(field => field !== 'userId')), validate({ body: loanBody }), HrBenefitsController.myLoanCreate);
router.get('/me/deductions', selfBenefits, validate({ query: listQuery }), HrBenefitsController.myDeductionList);
router.get('/me/deductions/:id', selfBenefits, validate({ params: idParam }), HrBenefitsController.myDeductionGet);

export default router;
