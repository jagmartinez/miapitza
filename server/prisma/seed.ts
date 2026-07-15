import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { bootstrapCentralWarehouses } from './bootstrap-central-warehouses';
import {
    assertStrongPassword,
    BCRYPT_ROUNDS,
    generateStrongRandomPassword
} from '../src/utils/password-policy';

const prisma = new PrismaClient();

/** Helper: findFirst or create (safe for compound unique constraints) */
async function findOrCreate<T>(
    model: any,
    where: Record<string, any>,
    data: Record<string, any>
): Promise<T> {
    const existing = await model.findFirst({ where });
    if (existing) return existing;
    return await model.create({ data: { ...where, ...data } });
}

async function main() {
    console.log('Starting database seed...');

    // 1. Create Company first (needed for FK relations)
    console.log('Creating company...');
    const company = await findOrCreate<any>(prisma.company, { name: 'Mi Restaurante' }, {
        ruc: null,
        active: true
    });
    const companyId = company.id;

    // 2. Create Roles (compound unique: companyId + name)
    console.log('Creating roles...');
    const roleData = [
        { name: 'SUPERADMIN', description: 'Super Administrator - Full system access' },
        { name: 'ADMIN', description: 'Branch Administrator' },
        { name: 'MESERO', description: 'Waiter/Server' },
        { name: 'HOST', description: 'Host/Receptionist' },
        { name: 'COCINA', description: 'Kitchen Staff' },
        { name: 'CHEF', description: 'Kitchen and recipe lead' },
        { name: 'BODEGA', description: 'Warehouse and inventory staff' },
        { name: 'CAJERO', description: 'Cashier' },
    ];

    const roles: Record<string, any> = {};
    for (const r of roleData) {
        roles[r.name] = await findOrCreate<any>(prisma.role, { companyId, name: r.name }, {
            description: r.description
        });
    }
    console.log('Roles created');

    // 3. Create Permissions
    console.log('Creating permissions...');
    const basePermissions = [
        'view_users', 'create_user', 'edit_user', 'delete_user',
        'view_branches', 'create_branch', 'edit_branch', 'delete_branch',
        'view_orders', 'create_order', 'edit_order', 'delete_order',
        'view_menu', 'create_menu', 'edit_menu', 'delete_menu',
        'view_inventory', 'create_inventory', 'edit_inventory',
        'view_reports'
    ];
    const hrPermissions = [
        'hr.dashboard.read',
        'hr.employee.read',
        'hr.employee.manage',
        'hr.employee.sensitive.view',
        'hr.catalog.read',
        'hr.catalog.manage',
        'hr.geofence.read',
        'hr.geofence.manage',
        'hr.schedule.read',
        'hr.schedule.manage',
        'hr.schedule.publish',
        'hr.schedule.self',
        'hr.attendance.manage',
        'hr.attendance.review',
        'hr.attendance.self',
        'hr.biometric.self',
        'hr.biometric.manage',
        'hr.attendance.device.manage',
        'hr.workforce.read',
        'hr.workforce.manage',
        'hr.workforce.approve',
        'hr.workforce.self',
        'hr.payroll.read',
        'hr.payroll.manage',
        'hr.payroll.approve',
        'hr.payroll.self',
        'hr.benefits.read',
        'hr.benefits.manage',
        'hr.benefits.approve',
        'hr.benefits.self',
    ];
    const tablePermissions = [
        'tables.map.view',
        'tables.map.edit',
        'tables.create',
        'tables.edit',
        'tables.status.manage',
        'tables.delete',
        'tables.transfer',
        'tables.consolidate',
    ];
    const kdsPermissions = ['kds.view', 'kds.manage'];
    const operationalPermissions = [
        'orders.view',
        'orders.create',
        'orders.edit',
        'orders.cancel',
        'orders.deliver',
        'invoices.issue',
        'invoices.view',
        'invoices.cancel',
        'invoices.credit',
        'payments.process',
        'payments.reverse',
        'bills.split',
    ];
    const permissions = [
        ...basePermissions,
        ...tablePermissions,
        ...kdsPermissions,
        ...operationalPermissions,
        ...hrPermissions,
    ];

    for (const permName of permissions) {
        await prisma.permission.upsert({
            where: { name: permName },
            update: {},
            create: { name: permName }
        });
    }
    console.log('Permissions created');

    // 3b. Link permissions to roles so the permission model is actually usable.
    // Without these connections every role would have zero permissions.
    console.log('Linking permissions to roles...');
    const rolePermissionMap: Record<string, string[]> = {
        // Full access
        SUPERADMIN: permissions,
        // Branch administrators receive only non-sensitive HR visibility by
        // default. Employee mutation/read and geofence mutation remain explicit.
        ADMIN: [...basePermissions, ...tablePermissions, ...kdsPermissions, ...operationalPermissions, 'hr.dashboard.read', 'hr.catalog.read', 'hr.geofence.read', 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Cashier: manage orders + read-only menu/reports
        CAJERO: ['view_orders', 'create_order', 'edit_order', 'view_menu', 'view_reports', 'tables.map.view', 'tables.consolidate', 'orders.view', 'orders.create', 'orders.deliver', 'invoices.issue', 'invoices.view', 'payments.process', 'bills.split', 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Waiter: take and edit orders
        MESERO: ['view_orders', 'create_order', 'edit_order', 'view_menu', 'tables.map.view', 'tables.transfer', 'tables.status.manage', 'orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.deliver', 'bills.split', 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Kitchen: read orders only
        COCINA: ['view_orders', 'view_menu', 'orders.view', ...kdsPermissions, 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Chef: kitchen execution plus recipe/menu and stock maintenance.
        CHEF: ['view_orders', 'view_menu', 'create_menu', 'edit_menu', 'view_inventory', 'create_inventory', 'edit_inventory', 'view_reports', 'orders.view', ...kdsPermissions, 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Warehouse: inventory custody without access to users, orders or destructive catalog operations.
        BODEGA: ['view_menu', 'view_inventory', 'create_inventory', 'edit_inventory', 'view_reports', 'orders.view', 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
        // Host/receptionist: read orders + menu
        HOST: ['view_orders', 'view_menu', 'tables.map.view', 'tables.edit', 'tables.status.manage', 'orders.view', 'hr.schedule.self', 'hr.attendance.self', 'hr.biometric.self', 'hr.workforce.self', 'hr.payroll.self', 'hr.benefits.self'],
    };

    for (const [roleName, permNames] of Object.entries(rolePermissionMap)) {
        const role = roles[roleName];
        if (!role) continue;
        await prisma.role.update({
            where: { id: role.id },
            data: {
                permissions: {
                    // `set` makes re-seeding idempotent (resets to the defined list).
                    set: permNames.map((name) => ({ name })),
                },
            },
        });
    }
    console.log('Role permissions linked');

    // 4. Create Branch (compound unique: companyId + code)
    console.log('Creating branch...');
    const branch = await findOrCreate<any>(prisma.branch, { companyId, code: 'MAIN' }, {
        name: 'Sucursal Principal',
        address: 'Av. Principal #123, Centro',
        phone: '555-1234',
        status: 'ACTIVE'
    });
    console.log('Branch created');

    const centralWarehouses = await bootstrapCentralWarehouses(prisma);
    console.log(`Central warehouse bootstrap completed (${centralWarehouses.length} company scan(s))`);

    // 5. Create Super Admin User
    console.log('Creating super admin user...');
    const existingAdmin = await prisma.user.findUnique({
        where: { username: 'admin' },
        select: { id: true, companyId: true, roleId: true }
    });

    if (existingAdmin) {
        console.log('Super admin user already exists; password and assignments were left unchanged.');
        if (existingAdmin.companyId !== companyId || existingAdmin.roleId !== roles['SUPERADMIN'].id) {
            console.warn('  WARNING: Existing username "admin" is not assigned to the seeded company/SUPERADMIN role. Review it manually.');
        }
    } else {
        const configuredPassword = process.env.SEED_SUPERADMIN_PASSWORD?.trim();
        const superAdminPassword = configuredPassword || generateStrongRandomPassword();
        assertStrongPassword(superAdminPassword);
        const hashedPassword = await bcrypt.hash(superAdminPassword, BCRYPT_ROUNDS);

        const createdAdmin = await prisma.user.create({
            data: {
                name: 'Super Administrator',
                email: 'admin@restaurant.com',
                username: 'admin',
                password: hashedPassword,
                mustChangePassword: true,
                passwordChangedAt: null,
                roleId: roles['SUPERADMIN'].id,
                branchId: branch.id,
                companyId,
                status: 'ACTIVE'
            }
        });
        await prisma.userBranch.create({
            data: { userId: createdAdmin.id, branchId: branch.id }
        });

        console.log('Super admin user created; password change is required on first login.');
        if (configuredPassword) {
            console.log('  Login: admin / [SEED_SUPERADMIN_PASSWORD]');
        } else {
            console.log(`  One-time login: admin / ${superAdminPassword}`);
            console.log('  WARNING: Store this generated password securely; it will not be printed on later seed runs.');
        }
    }

    // 6. Create Payment Methods
    console.log('Creating payment methods...');
    const paymentMethods = [
        { name: 'Efectivo', type: 'CASH' as const },
        { name: 'Tarjeta', type: 'CARD' as const },
        { name: 'Transferencia', type: 'BANK_TRANSFER' as const }
    ];
    for (const method of paymentMethods) {
        const existing = await prisma.paymentMethod.findFirst({
            where: { companyId, name: method.name }
        });
        if (existing) {
            await prisma.paymentMethod.update({
                where: { id: existing.id },
                data: { type: method.type }
            });
        } else {
            await prisma.paymentMethod.create({
                data: { companyId, name: method.name, type: method.type, active: true }
            });
        }
    }
    console.log('Payment methods created');

    // 7. Create Menu Categories (compound unique: companyId + name)
    console.log('Creating categories...');
    const categories = [
        { name: 'Entradas', description: 'Appetizers' },
        { name: 'Platos Fuertes', description: 'Main Courses' },
        { name: 'Bebidas', description: 'Drinks' },
        { name: 'Postres', description: 'Desserts' }
    ];

    for (const cat of categories) {
        await findOrCreate<any>(prisma.category, { companyId, name: cat.name }, {
            description: cat.description
        });
    }
    console.log('Categories created');

    console.log('\nDatabase seeded successfully!');
}

main()
    .catch((e) => {
        console.error('Error seeding database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
