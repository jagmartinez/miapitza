export type HrEmploymentStatus =
    | 'ACTIVE'
    | 'ON_LEAVE'
    | 'INACTIVE'
    | 'SUSPENDED'
    | 'TERMINATED';

export type HrAccountType = 'INTERNAL' | 'EXTERNAL';
export type HrPayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';

export interface HrNamedEntity {
    id: number;
    name: string;
    code?: string | null;
    active?: boolean;
    status?: string;
    departmentId?: number | null;
}

export interface HrUserSummary {
    id: number;
    name: string;
    username: string;
    email?: string | null;
    status?: string;
    accountType?: HrAccountType;
    employeeId?: number | null;
    employee?: {
        id: number;
        employeeCode: string;
        status: HrEmploymentStatus;
    } | null;
    branchId?: number | null;
    branch?: HrNamedEntity | null;
    allowedBranches?: Array<{ branch: HrNamedEntity }>;
}

export interface HrBranchAssignment {
    id?: number;
    branchId: number;
    branch?: HrNamedEntity | null;
    isPrimary: boolean;
    activeFrom?: string | null;
    activeTo?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
}

export interface HrContractSummary {
    id?: number;
    contractType?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    workdayType?: string | null;
    payFrequency?: string | null;
    status?: string | null;
}

export interface HrEmploymentContract {
    id: number;
    employeeId: number;
    contractNumber: string;
    employmentType: string;
    startDate: string;
    endDate?: string | null;
    status: 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
    signedAt?: string | null;
    notes?: string | null;
    jobPosition?: HrNamedEntity | null;
    costCenter?: HrNamedEntity | null;
}

export interface HrCompensationRecord {
    id: number;
    employeeId: number;
    contractId?: number | null;
    compensationType: 'SALARY' | 'HOURLY';
    payFrequency: HrPayFrequency;
    amount: string;
    currency: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    reason?: string | null;
    changedBy?: Pick<HrUserSummary, 'id' | 'name' | 'username'> | null;
}

export interface HrEmployeeDocument {
    id: number;
    employeeId: number;
    documentType: string;
    fileName: string;
    contentHash: string;
    mimeType: string;
    sizeBytes: number;
    expiresAt?: string | null;
    status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
    createdAt: string;
    uploadedBy?: Pick<HrUserSummary, 'id' | 'name' | 'username'> | null;
}

export interface HrEmployee {
    id: number;
    companyId?: number;
    userId: number;
    user?: HrUserSummary | null;
    employeeCode: string;
    legalName: string;
    preferredName?: string | null;
    employmentType?: string | null;
    documentType?: string | null;
    documentNumber?: string | null;
    socialSecurityNumber?: string | null;
    taxId?: string | null;
    email?: string | null;
    phone?: string | null;
    workEmail?: string | null;
    workPhone?: string | null;
    address?: string | null;
    notes?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelationship?: string | null;
    status: HrEmploymentStatus;
    hireDate: string;
    terminationDate?: string | null;
    departmentId?: number | null;
    department?: HrNamedEntity | null;
    jobPositionId?: number | null;
    jobPosition?: HrNamedEntity | null;
    costCenterId?: number | null;
    costCenter?: HrNamedEntity | null;
    supervisorEmployeeId?: number | null;
    supervisor?: Pick<HrEmployee, 'id' | 'legalName' | 'employeeCode'> | null;
    primaryBranchId?: number | null;
    primaryBranch?: HrNamedEntity | null;
    branchAssignments?: HrBranchAssignment[];
    currentContract?: HrContractSummary | null;
    /** Present only when the caller may read sensitive employee compensation. */
    compensation?: HrCompensationRecord[];
    createdAt?: string;
    updatedAt?: string;
}

export interface HrEmployeeFilters {
    search?: string;
    status?: HrEmploymentStatus | 'ALL';
    branchId?: number;
    departmentId?: number;
    jobPositionId?: number;
    costCenterId?: number;
    page?: number;
    limit?: number;
}

export interface HrPagination {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

export interface HrEmployeeListResult {
    items: HrEmployee[];
    pagination?: HrPagination;
}

export interface HrOrganizationCatalogs {
    departments: HrNamedEntity[];
    positions: HrNamedEntity[];
    costCenters: HrNamedEntity[];
    branches?: HrNamedEntity[];
    users?: HrUserSummary[];
    employees?: HrEmployee[];
    enums?: {
        employeeStatuses: HrEmploymentStatus[];
        employmentTypes: string[];
        accountTypes: HrAccountType[];
    };
}

export interface HrEmployeePayload {
    /** Required when creating; immutable and omitted when editing an employee. */
    userId?: number;
    employeeCode: string;
    legalName: string;
    preferredName?: string | null;
    employmentType?: string | null;
    documentType?: string | null;
    documentNumber?: string | null;
    socialSecurityNumber?: string | null;
    taxId?: string | null;
    workEmail?: string | null;
    workPhone?: string | null;
    address?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelationship?: string | null;
    notes?: string | null;
    hireDate: string;
    departmentId?: number | null;
    jobPositionId?: number | null;
    costCenterId?: number | null;
    branchIds?: number[];
    primaryBranchId?: number | null;
    /** Required only for creation; compensation changes remain append-only afterwards. */
    initialCompensation?: {
        compensationType: 'SALARY' | 'HOURLY';
        payFrequency: HrPayFrequency;
        amount: string;
        currency: string;
        reason: string;
    };
}

export interface HrDashboardData {
    employees: {
        total: number;
        active: number;
        onLeave: number;
        inactive: number;
        suspended: number;
        terminated: number;
        internalAccounts: number;
    };
    catalogs: {
        departments: number;
        jobPositions: number;
        costCenters: number;
    };
    branches: {
        total: number;
        geofenceConfigured: number;
        attendanceEnabled: number;
    };
    attention: {
        leaveRequests: number;
        overtimeRequests: number;
        attendanceCorrections: number;
        attendanceIncidents: number;
        loanRequests: number;
    };
    payroll: {
        activeRule: boolean;
        draftRuns: number;
        reviewRuns: number;
        approvedRuns: number;
    };
}

export interface HrEnvelope<T> {
    success: boolean;
    data: T;
    message?: string;
}
