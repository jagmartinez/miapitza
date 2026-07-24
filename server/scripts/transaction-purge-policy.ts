export type PurgeScope = 'restaurant-operations' | 'master-only';
export type TableClassification = 'MASTER' | 'SYSTEM' | 'RESTAURANT_TRANSACTION' | 'HR_TRANSACTION';

export const TRANSACTION_PURGE_POLICY_VERSION = '2026-07-23.master-only.v2';

const MASTER_TABLES = new Set([
  'apikey',
  'attendancedevice',
  'attendancepolicy',
  'biometricprofile',
  'branch',
  'branchgeofenceversion',
  'cashregister',
  'category',
  'cateringservice',
  'company',
  'compensationhistory',
  'costcenter',
  'creditnotesequence',
  'customer',
  'department',
  'employee',
  'employeebranchassignment',
  'employeedocument',
  'employmentcontract',
  'face_templates',
  'floorarea',
  'holiday',
  'holidaycalendar',
  'hrbenefitpolicyversion',
  'invoicesequence',
  'jobposition',
  'leavetype',
  'menubrand',
  'menuitem',
  'menuitembranchprice',
  'menuitemimage',
  'modifier',
  'modifiergroup',
  'paymentmethod',
  'payrollruleconfigurationreview',
  'payrollruleconfigurationrevision',
  'payrollruleversion',
  'pedidosyaconfig',
  'pedidosyaproductmapping',
  'permission',
  'product',
  'productionrecipe',
  'productionrecipecomponent',
  'productunit',
  'promotion',
  'recipe',
  'role',
  'saleschannelconfig',
  'setting',
  'shifttemplate',
  'stock',
  'supplier',
  'table',
  'tablefloorplan',
  'unitofmeasure',
  'user',
  'userbranch',
  'userrole',
  'warehouse',
  '_menuitemtomodifiergroup',
  '_permissiontorole',
]);

const SYSTEM_TABLES = new Set([
  'storageidentity',
  '_prisma_migrations',
]);

const RESTAURANT_TRANSACTION_TABLES = new Set([
  'auditlog',
  'bankdeposit',
  'bankdepositshift',
  'cashcount',
  'cashmovement',
  'cashshift',
  'cateringevent',
  'cateringfiscalcreditnote',
  'cateringfiscalinvoice',
  'cateringmenuitem',
  'cateringpayment',
  'cateringserviceitem',
  'filecleanuptask',
  'fiscalcreditnote',
  'fiscalcreditnoteline',
  'fiscalcreditnotepaymentrefund',
  'fiscalinvoicecancellation',
  'idempotencyrecord',
  'inventorybatch',
  'inventorymovement',
  'kitchennotification',
  'legacytableconsolidationreview',
  'loginattempt',
  'order',
  'orderitem',
  'orderitemmodifier',
  'payment',
  'pedidosyaordersync',
  'pedidosyawebhooklog',
  'productcosthistory',
  'productionorder',
  'productionorderitem',
  'purchaseorder',
  'purchaseorderitem',
  'purchaseorderpayment',
  'reservation',
  'tableconsolidation',
  'tableconsolidationitem',
  'tableconsolidationorder',
  'tablegroup',
  'usersession',
]);

const HR_TRANSACTION_TABLES = new Set([
  'attendancecorrection',
  'attendancedailysummary',
  'attendanceevent',
  'attendanceincident',
  'attendanceperiod',
  'attendancepunchrequest',
  'attendancereview',
  'biometricchallenge',
  'biometricpurgerequest',
  'hrbenefitidempotencyrecord',
  'hrbenefittrace',
  'hrdeduction',
  'hrdeductionapplication',
  'hrdeductionversion',
  'hremploymentsettlement',
  'hremploymentsettlementline',
  'hrloan',
  'hrloaninstallment',
  'hrloanledgerentry',
  'hrloanscheduleversion',
  'hrtravelexpense',
  'hrtravelledgerentry',
  'hrtravelrequest',
  'leaverequest',
  'overtimerequest',
  'payrollaguinaldosourcedependency',
  'payrollanomaly',
  'payrollattendancedependency',
  'payrollcomponent',
  'payrollcomponentreversal',
  'payrollcoverageclaim',
  'payrollcoveragerelease',
  'payrollemployercontribution',
  'payrollidempotencyrecord',
  'payrollpaymentrecord',
  'payrollperiod',
  'payrollreceipt',
  'payrollrun',
  'payrollrunreversal',
  'payrollsnapshotline',
  'payrollstatutorycalculation',
  'payrolltrace',
  'scheduleacknowledgement',
  'scheduledshift',
  'shiftassignmentoverride',
  'shiftswaprequest',
  'shiftswapreservation',
  'vacationbalance',
  'vacationledgerentry',
  'weeklyschedule',
  'workforceidempotencyrecord',
]);

export function normalizeTableName(value: string): string {
  return value.toLowerCase();
}

export function classifyTransactionPurgeTable(table: string): TableClassification | undefined {
  const key = normalizeTableName(table);
  if (MASTER_TABLES.has(key)) return 'MASTER';
  if (SYSTEM_TABLES.has(key)) return 'SYSTEM';
  if (RESTAURANT_TRANSACTION_TABLES.has(key)) return 'RESTAURANT_TRANSACTION';
  if (HR_TRANSACTION_TABLES.has(key)) return 'HR_TRANSACTION';
  return undefined;
}

export function isPurgeTarget(table: string, scope: PurgeScope): boolean {
  const classification = classifyTransactionPurgeTable(table);
  return classification === 'RESTAURANT_TRANSACTION'
    || (scope === 'master-only' && classification === 'HR_TRANSACTION');
}

export function sanitizePreservedRow(table: string, original: Record<string, unknown>): Record<string, unknown> {
  const row = { ...original };
  const zeroLike = (value: unknown): string | number => {
    if (typeof value === 'string' && value.includes('.')) {
      return `0.${'0'.repeat(value.length - value.indexOf('.') - 1)}`;
    }
    return 0;
  };
  switch (normalizeTableName(table)) {
    case 'table':
      row.status = 'AVAILABLE';
      if ('activeTableGroupId' in row) row.activeTableGroupId = null;
      break;
    case 'cashregister':
      row.status = 'CLOSED';
      break;
    case 'promotion':
      row.usageCount = 0;
      break;
    case 'stock':
      row.quantity = zeroLike(row.quantity);
      break;
    case 'product':
      if ('currentAverageCost' in row) row.currentAverageCost = zeroLike(row.currentAverageCost);
      if ('averageCostKnown' in row) row.averageCostKnown = 0;
      if ('lastPurchaseCost' in row) row.lastPurchaseCost = zeroLike(row.lastPurchaseCost);
      if ('lastPurchaseCostKnown' in row) row.lastPurchaseCostKnown = 0;
      break;
    case 'saleschannelconfig':
    case 'pedidosyaconfig':
      if ('lastSyncAt' in row) row.lastSyncAt = null;
      break;
    default:
      break;
  }
  return row;
}
