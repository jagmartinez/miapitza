import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { bootstrapCentralWarehouses } from './bootstrap-central-warehouses';

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
    const permissions = [
        'view_users', 'create_user', 'edit_user', 'delete_user',
        'view_branches', 'create_branch', 'edit_branch', 'delete_branch',
        'view_orders', 'create_order', 'edit_order', 'delete_order',
        'view_menu', 'create_menu', 'edit_menu', 'delete_menu',
        'view_inventory', 'create_inventory', 'edit_inventory',
        'view_reports'
    ];

    for (const permName of permissions) {
        await prisma.permission.upsert({
            where: { name: permName },
            update: {},
            create: { name: permName }
        });
    }
    console.log('Permissions created');

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
    const superAdminPassword = process.env.SEED_SUPERADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

    await findOrCreate<any>(prisma.user, { username: 'admin' }, {
        name: 'Super Administrator',
        email: 'admin@restaurant.com',
        password: hashedPassword,
        roleId: roles['SUPERADMIN'].id,
        branchId: branch.id,
        companyId,
        status: 'ACTIVE'
    });

    console.log('Super admin user created');
    if (process.env.SEED_SUPERADMIN_PASSWORD) {
        console.log('  Login: admin / [SEED_SUPERADMIN_PASSWORD]');
    } else {
        console.log(`  Login: admin / ${superAdminPassword}`);
        console.log('  WARNING: Store this generated password securely and rotate it immediately.');
    }

    // 6. Create Payment Methods
    console.log('Creating payment methods...');
    for (const method of ['Efectivo', 'Tarjeta', 'Transferencia']) {
        await findOrCreate<any>(prisma.paymentMethod, { name: method }, {
            companyId,
            active: true
        });
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
