import type { Prisma } from '@prisma/client';
import { ROLES } from '../constants/roles';

type Tx = Prisma.TransactionClient;

/**
 * Baseline roles provisioned for every new tenant company.
 * SUPERADMIN is intentionally omitted: that role is platform-operator only
 * (seeded on the operator company). Tenant top role is ADMIN.
 */
const TENANT_ROLE_DEFS: Array<{ name: string; description: string }> = [
    { name: ROLES.ADMIN, description: 'Branch Administrator' },
    { name: ROLES.MESERO, description: 'Waiter/Server' },
    { name: ROLES.HOST, description: 'Host/Receptionist' },
    { name: ROLES.COCINA, description: 'Kitchen Staff' },
    { name: ROLES.CHEF, description: 'Kitchen and recipe lead' },
    { name: ROLES.BODEGA, description: 'Warehouse and inventory staff' },
    { name: ROLES.CAJERO, description: 'Cashier' },
];

const BASE_PERMISSIONS = [
    'view_users', 'create_user', 'edit_user', 'delete_user',
    'view_branches', 'create_branch', 'edit_branch', 'delete_branch',
    'view_orders', 'create_order', 'edit_order', 'delete_order',
    'view_menu', 'create_menu', 'edit_menu', 'delete_menu',
    'view_inventory', 'create_inventory', 'edit_inventory',
    'view_reports',
];

const TABLE_PERMISSIONS = [
    'tables.map.view', 'tables.map.edit', 'tables.create', 'tables.edit',
    'tables.status.manage', 'tables.delete', 'tables.transfer', 'tables.consolidate', 'tables.group.manage',
];

const KDS_PERMISSIONS = ['kds.view', 'kds.manage'];

const OPERATIONAL_PERMISSIONS = [
    'orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.deliver',
    'invoices.issue', 'invoices.view', 'invoices.cancel', 'invoices.credit',
    'payments.process', 'payments.reverse', 'bills.split',
];

const SELF_SERVICE_HR = [
    'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self',
    'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self',
];

// Tenant ADMIN is the highest role created inside a customer company. It must
// be able to operate RH without borrowing a platform SUPERADMIN identity.
// Sensitive transitions still enforce dual control by actor in the services.
const TENANT_ADMIN_HR = [
    'hr.dashboard.read',
    'hr.employee.read', 'hr.employee.manage', 'hr.employee.sensitive.view',
    'hr.catalog.read', 'hr.catalog.manage',
    'hr.geofence.read', 'hr.geofence.manage',
    'hr.schedule.read', 'hr.schedule.manage', 'hr.schedule.publish',
    'hr.attendance.manage', 'hr.attendance.review',
    'hr.biometric.manage', 'hr.attendance.device.manage',
    'hr.workforce.read', 'hr.workforce.manage', 'hr.workforce.approve',
    'hr.payroll.read', 'hr.payroll.manage', 'hr.payroll.approve',
    'hr.benefits.read', 'hr.benefits.manage', 'hr.benefits.approve',
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
    [ROLES.ADMIN]: [
        ...BASE_PERMISSIONS, ...TABLE_PERMISSIONS, ...KDS_PERMISSIONS, ...OPERATIONAL_PERMISSIONS,
        ...TENANT_ADMIN_HR, ...SELF_SERVICE_HR,
    ],
    [ROLES.CAJERO]: [
        'view_orders', 'create_order', 'edit_order', 'view_menu', 'view_reports',
        'tables.map.view', 'tables.consolidate', 'orders.view', 'orders.create', 'orders.deliver',
        'invoices.issue', 'invoices.view', 'payments.process', 'bills.split', ...SELF_SERVICE_HR,
    ],
    [ROLES.MESERO]: [
        'view_orders', 'create_order', 'edit_order', 'view_menu',
        'tables.map.view', 'tables.transfer', 'tables.status.manage', 'tables.group.manage',
        'orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.deliver', 'bills.split',
        ...SELF_SERVICE_HR,
    ],
    [ROLES.COCINA]: [
        'view_orders', 'view_menu', 'orders.view', ...KDS_PERMISSIONS, ...SELF_SERVICE_HR,
    ],
    [ROLES.CHEF]: [
        'view_orders', 'view_menu', 'create_menu', 'edit_menu',
        'view_inventory', 'create_inventory', 'edit_inventory', 'view_reports',
        'orders.view', ...KDS_PERMISSIONS, ...SELF_SERVICE_HR,
    ],
    [ROLES.BODEGA]: [
        'view_menu', 'view_inventory', 'create_inventory', 'edit_inventory', 'view_reports',
        'orders.view', ...SELF_SERVICE_HR,
    ],
    [ROLES.HOST]: [
        'view_orders', 'view_menu', 'tables.map.view', 'tables.edit', 'tables.status.manage', 'tables.group.manage',
        'orders.view', ...SELF_SERVICE_HR,
    ],
};

export class CompanyProvisioningService {
    /**
     * Create the standard per-tenant roles and attach permissions that already
     * exist in the global Permission catalog. Missing permission names are skipped
     * so provisioning stays compatible with partially migrated databases.
     */
    static async provisionTenantRoles(companyId: number, tx: Tx): Promise<void> {
        const desiredNames = Array.from(new Set(Object.values(ROLE_PERMISSION_MAP).flat()));
        const existingPermissions = await tx.permission.findMany({
            where: { name: { in: desiredNames } },
            select: { id: true, name: true },
        });
        const permissionIdByName = new Map(existingPermissions.map((p) => [p.name, p.id]));

        for (const def of TENANT_ROLE_DEFS) {
            const permissionIds = (ROLE_PERMISSION_MAP[def.name] ?? [])
                .map((name) => permissionIdByName.get(name))
                .filter((id): id is number => typeof id === 'number');

            await tx.role.create({
                data: {
                    companyId,
                    name: def.name,
                    description: def.description,
                    permissions: permissionIds.length > 0
                        ? { connect: permissionIds.map((id) => ({ id })) }
                        : undefined,
                },
            });
        }
    }
}
