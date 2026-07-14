import { PrismaClient, StorageType, TableStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { bootstrapCentralWarehouses } from './bootstrap-central-warehouses';
import { BCRYPT_ROUNDS } from '../src/utils/password-policy';
import { resolveDemoSeedConfig } from '../src/utils/demo-seed-security';

const prisma = new PrismaClient();

let COMPANY_ID: number;
let PRIMARY_BRANCH_CODE: string;
let SECOND_BRANCH_CODE: string;
let DEMO_PASSWORD_HASH: string;

function minutesAgo(minutes: number) {
    return new Date(Date.now() - minutes * 60_000);
}

function roundCurrency(value: number) {
    return Math.round(value * 100) / 100;
}

function storageTypeForProduct(name: string, sku: string | null) {
    const normalized = `${sku ?? ''} ${name}`.toLowerCase();

    const frozenKeywords = ['helado', 'anchoa', 'pepperoni', 'chorizo', 'tocino', 'prosciutto', 'jamón'];
    if (frozenKeywords.some(keyword => normalized.includes(keyword))) {
        return StorageType.FROZEN;
    }

    const nonPerishableKeywords = [
        'vino',
        'coca',
        'fanta',
        'sprite',
        'agua',
        'té helado',
        'limonada',
        'aceite',
        'vinagre',
        'miel',
        'sal',
        'salsa',
        'vodka',
        'encurtidos',
        'pan rústico',
        'brownie',
        'base cheesecake'
    ];
    if (nonPerishableKeywords.some(keyword => normalized.includes(keyword))) {
        return StorageType.NON_PERISHABLE;
    }

    return StorageType.PERISHABLE;
}

async function ensureBranch(params: {
    companyId: number;
    code: string;
    name: string;
    address: string;
    phone: string;
}) {
    const existing = await prisma.branch.findFirst({
        where: {
            companyId: params.companyId,
            code: params.code
        }
    });

    if (existing) {
        if (existing.status !== 'ACTIVE') {
            throw new Error(`La sucursal demo ${params.code} existe pero esta inactiva`);
        }
        return existing;
    }

    return prisma.branch.create({
        data: {
            companyId: params.companyId,
            code: params.code,
            name: params.name,
            address: params.address,
            phone: params.phone,
            status: 'ACTIVE'
        }
    });
}

async function ensureWarehouse(params: {
    companyId: number;
    branchId: number | null;
    type: 'CENTRAL' | 'BRANCH';
    name: string;
    code: string;
}) {
    const existing = await prisma.warehouse.findFirst({
        where: {
            companyId: params.companyId,
            code: params.code
        }
    });

    if (existing) {
        return existing;
    }

    return prisma.warehouse.create({
        data: params
    });
}

async function ensureCashRegister(params: {
    companyId: number;
    branchId: number;
    name: string;
}) {
    const existing = await prisma.cashRegister.findFirst({
        where: {
            companyId: params.companyId,
            branchId: params.branchId,
            name: params.name
        }
    });

    if (existing) {
        return existing;
    }

    return prisma.cashRegister.create({
        data: {
            ...params,
            status: 'CLOSED'
        }
    });
}

async function ensureTables(branchId: number, numbers: string[]) {
    for (const number of numbers) {
        const existing = await prisma.table.findFirst({
            where: {
                branchId,
                number
            }
        });

        if (existing) {
            continue;
        }

        await prisma.table.create({
            data: {
                companyId: COMPANY_ID,
                branchId,
                number,
                capacity: 4,
                status: 'AVAILABLE'
            }
        });
    }
}

async function ensureUserRole(userId: number, roleId: number) {
    const existing = await prisma.userRole.findFirst({
        where: {
            userId,
            roleId
        }
    });

    if (!existing) {
        await prisma.userRole.create({
            data: {
                userId,
                roleId
            }
        });
    }
}

async function ensureUser(params: {
    username: string;
    email: string;
    name: string;
    companyId: number;
    branchId: number;
    primaryRoleId: number;
    color: string;
}) {
    const existing = await prisma.user.findFirst({
        where: { username: params.username }
    });

    if (existing) {
        if (existing.companyId !== params.companyId) {
            throw new Error(`El usuario demo ${params.username} ya pertenece a otra empresa; no se reasignará automáticamente`);
        }
        const updated = await prisma.user.update({
            where: { id: existing.id },
            data: {
                companyId: params.companyId,
                branchId: params.branchId,
                roleId: params.primaryRoleId,
                color: existing.color ?? params.color,
                password: DEMO_PASSWORD_HASH,
                mustChangePassword: false,
                passwordChangedAt: existing.passwordChangedAt ?? new Date()
            }
        });
        await ensureUserRole(updated.id, params.primaryRoleId);
        return updated;
    }

    const created = await prisma.user.create({
        data: {
            username: params.username,
            email: params.email,
            name: params.name,
            companyId: params.companyId,
            branchId: params.branchId,
            roleId: params.primaryRoleId,
            password: DEMO_PASSWORD_HASH,
            color: params.color,
            status: 'ACTIVE',
            mustChangePassword: false,
            passwordChangedAt: new Date()
        }
    });
    await ensureUserRole(created.id, params.primaryRoleId);
    return created;
}

async function ensureStorageTypes() {
    const products = await prisma.product.findMany({
        where: {
            companyId: COMPANY_ID,
            storageType: null
        },
        select: {
            id: true,
            name: true,
            sku: true
        }
    });

    for (const product of products) {
        await prisma.product.update({
            where: { id: product.id },
            data: {
                storageType: storageTypeForProduct(product.name, product.sku)
            }
        });
    }

    return products.length;
}

async function ensureCentralStock(params: {
    warehouseId: number;
    productId: number;
    userId: number;
    quantity: number;
    reference: string;
    reason: string;
}) {
    const alreadySeeded = await prisma.inventoryMovement.findFirst({
        where: {
            companyId: COMPANY_ID,
            reference: params.reference
        }
    });

    if (alreadySeeded) {
        return;
    }

    const product = await prisma.product.findUnique({
        where: { id: params.productId },
        select: {
            cost: true,
            currentAverageCost: true
        }
    });

    const unitCost = Number(product?.currentAverageCost ?? product?.cost ?? 0);
    const totalCost = roundCurrency(unitCost * params.quantity);

    await prisma.$transaction(async (tx) => {
        const stock = await tx.stock.findUnique({
            where: {
                warehouseId_productId: {
                    warehouseId: params.warehouseId,
                    productId: params.productId
                }
            }
        });

        const currentQty = Number(stock?.quantity ?? 0);
        const nextQty = currentQty + params.quantity;

        if (stock) {
            await tx.stock.update({
                where: {
                    warehouseId_productId: {
                        warehouseId: params.warehouseId,
                        productId: params.productId
                    }
                },
                data: { quantity: nextQty }
            });
        } else {
            await tx.stock.create({
                data: {
                    warehouseId: params.warehouseId,
                    productId: params.productId,
                    companyId: COMPANY_ID,
                    quantity: nextQty
                }
            });
        }

        await tx.inventoryMovement.create({
            data: {
                warehouseId: params.warehouseId,
                productId: params.productId,
                userId: params.userId,
                companyId: COMPANY_ID,
                type: 'IN',
                quantity: params.quantity,
                reason: params.reason,
                reference: params.reference,
                unitCost,
                totalCost,
                balanceQty: nextQty,
                balanceCost: roundCurrency(nextQty * unitCost)
            }
        });
    });
}

async function ensureTransfer(params: {
    fromWarehouseId: number;
    toWarehouseId: number;
    productId: number;
    userId: number;
    quantity: number;
    reference: string;
    transferGroupId: string;
}) {
    const existing = await prisma.inventoryMovement.findFirst({
        where: {
            companyId: COMPANY_ID,
            reference: params.reference,
            transferGroupId: params.transferGroupId
        }
    });

    if (existing) {
        return;
    }

    const product = await prisma.product.findUnique({
        where: { id: params.productId },
        select: {
            cost: true,
            currentAverageCost: true
        }
    });
    const unitCost = Number(product?.currentAverageCost ?? product?.cost ?? 0);
    const totalCost = roundCurrency(unitCost * params.quantity);

    await prisma.$transaction(async (tx) => {
        const sourceStock = await tx.stock.findUnique({
            where: {
                warehouseId_productId: {
                    warehouseId: params.fromWarehouseId,
                    productId: params.productId
                }
            }
        });

        if (!sourceStock || Number(sourceStock.quantity) < params.quantity) {
            throw new Error(`Stock insuficiente para transferir productId=${params.productId}`);
        }

        const sourceNextQty = Number(sourceStock.quantity) - params.quantity;
        await tx.stock.update({
            where: {
                warehouseId_productId: {
                    warehouseId: params.fromWarehouseId,
                    productId: params.productId
                }
            },
            data: { quantity: sourceNextQty }
        });

        let destinationStock = await tx.stock.findUnique({
            where: {
                warehouseId_productId: {
                    warehouseId: params.toWarehouseId,
                    productId: params.productId
                }
            }
        });

        if (!destinationStock) {
            destinationStock = await tx.stock.create({
                data: {
                    warehouseId: params.toWarehouseId,
                    productId: params.productId,
                    companyId: COMPANY_ID,
                    quantity: 0
                }
            });
        }

        const destinationNextQty = Number(destinationStock.quantity) + params.quantity;
        await tx.stock.update({
            where: {
                warehouseId_productId: {
                    warehouseId: params.toWarehouseId,
                    productId: params.productId
                }
            },
            data: { quantity: destinationNextQty }
        });

        await tx.inventoryMovement.create({
            data: {
                warehouseId: params.fromWarehouseId,
                productId: params.productId,
                userId: params.userId,
                companyId: COMPANY_ID,
                type: 'TRANSFER',
                transferGroupId: params.transferGroupId,
                quantity: params.quantity,
                reason: `Salida por traslado a bodega ${params.toWarehouseId}`,
                reference: params.reference,
                unitCost,
                totalCost,
                balanceQty: sourceNextQty,
                balanceCost: roundCurrency(sourceNextQty * unitCost)
            }
        });

        await tx.inventoryMovement.create({
            data: {
                warehouseId: params.toWarehouseId,
                productId: params.productId,
                userId: params.userId,
                companyId: COMPANY_ID,
                type: 'IN',
                transferGroupId: params.transferGroupId,
                quantity: params.quantity,
                reason: `Entrada por traslado desde bodega ${params.fromWarehouseId}`,
                reference: params.reference,
                unitCost,
                totalCost,
                balanceQty: destinationNextQty,
                balanceCost: roundCurrency(destinationNextQty * unitCost)
            }
        });
    });
}

async function ensureDemoOrder(params: {
    customerName: string;
    tableNumber: string;
    branchId: number;
    userId: number;
    status: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED';
    createdAt: Date;
    items: Array<{
        name: string;
        quantity: number;
        status: 'PENDING' | 'IN_PROGRESS' | 'DONE';
        sentAt?: Date;
        startedAt?: Date;
        finishedAt?: Date;
    }>;
}) {
    const existing = await prisma.order.findFirst({
        where: {
            companyId: COMPANY_ID,
            customerName: params.customerName
        }
    });

    const table = await prisma.table.findFirst({
        where: {
            branchId: params.branchId,
            number: params.tableNumber
        }
    });

    if (!table) {
        throw new Error(`Mesa no encontrada para demo: ${params.tableNumber}`);
    }

    await prisma.table.update({
        where: { id: table.id },
        data: {
            status: params.status === 'OPEN' ? TableStatus.OCCUPIED : TableStatus.OCCUPIED
        }
    });

    if (existing) {
        return existing;
    }

    const menuItems = await prisma.menuItem.findMany({
        where: {
            companyId: COMPANY_ID,
            name: {
                in: params.items.map(item => item.name)
            }
        }
    });

    const menuItemMap = new Map(menuItems.map(item => [item.name, item]));
    const resolvedItems = params.items.map(item => {
        const menuItem = menuItemMap.get(item.name);
        if (!menuItem) {
            throw new Error(`MenuItem no encontrado para demo: ${item.name}`);
        }

        const price = Number(menuItem.price);
        return {
            menuItemId: menuItem.id,
            quantity: item.quantity,
            price,
            subtotal: roundCurrency(price * item.quantity),
            status: item.status,
            sentAt: item.sentAt,
            startedAt: item.startedAt,
            finishedAt: item.finishedAt
        };
    });

    const total = roundCurrency(resolvedItems.reduce((sum, item) => sum + item.subtotal, 0));

    return prisma.order.create({
        data: {
            companyId: COMPANY_ID,
            branchId: params.branchId,
            tableId: table.id,
            userId: params.userId,
            customerName: params.customerName,
            orderType: 'DINE_IN',
            status: params.status,
            total,
            discount: 0,
            tipAmount: 0,
            tax: 0,
            createdAt: params.createdAt,
            updatedAt: params.createdAt,
            items: {
                create: resolvedItems
            }
        }
    });
}

async function main() {
    const demoConfig = resolveDemoSeedConfig(process.env, 'features');
    COMPANY_ID = demoConfig.companyId;
    PRIMARY_BRANCH_CODE = demoConfig.primaryBranchCode!;
    SECOND_BRANCH_CODE = demoConfig.secondaryBranchCode!;
    DEMO_PASSWORD_HASH = await bcrypt.hash(demoConfig.password, BCRYPT_ROUNDS);
    console.log('Seeding feature scenarios...');

    const company = await prisma.company.findUnique({
        where: { id: COMPANY_ID },
        select: { id: true, active: true }
    });
    if (!company?.active) {
        throw new Error('No existe una empresa base activa. Ejecute primero seed:base.');
    }

    const primaryBranch = await prisma.branch.findFirst({
        where: {
            companyId: COMPANY_ID,
            code: PRIMARY_BRANCH_CODE,
            status: 'ACTIVE'
        }
    });
    if (!primaryBranch) {
        throw new Error('No existe la sucursal principal. Ejecute primero seed:base.');
    }

    const roles = await prisma.role.findMany({
        where: {
            companyId: COMPANY_ID,
            name: {
                in: ['SUPERADMIN', 'MESERO', 'CAJERO', 'COCINA', 'BODEGA']
            }
        }
    });
    const roleMap = new Map(roles.map(role => [role.name, role]));

    const superAdminRole = roleMap.get('SUPERADMIN');
    const waiterRole = roleMap.get('MESERO');
    const cashierRole = roleMap.get('CAJERO');
    const kitchenRole = roleMap.get('COCINA');
    const warehouseRole = roleMap.get('BODEGA');

    if (!superAdminRole || !waiterRole || !cashierRole || !kitchenRole || !warehouseRole) {
        throw new Error('Faltan roles base para poblar escenarios funcionales.');
    }

    await ensureUser({
        username: 'qaadmin',
        email: 'qaadmin@restaurant.com',
        name: 'QA Super Admin',
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        primaryRoleId: superAdminRole.id,
        color: '#111827'
    });

    const branchNorth = await ensureBranch({
        companyId: COMPANY_ID,
        code: SECOND_BRANCH_CODE,
        name: 'Sucursal Norte',
        address: 'Km 8 carretera norte',
        phone: '555-0202'
    });

    await ensureTables(branchNorth.id, ['N01', 'N02', 'N03', 'N04']);
    await ensureCashRegister({
        companyId: COMPANY_ID,
        branchId: branchNorth.id,
        name: 'Caja Norte'
    });

    await bootstrapCentralWarehouses(prisma);

    const centralWarehouse = await prisma.warehouse.findFirst({
        where: {
            companyId: COMPANY_ID,
            type: 'CENTRAL'
        }
    });
    if (!centralWarehouse) {
        throw new Error('No se pudo inicializar la bodega central.');
    }

    const primaryWarehouse = await ensureWarehouse({
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        type: 'BRANCH',
        name: 'Principal',
        code: 'MAIN-PRINCIPAL'
    });
    const northWarehouse = await ensureWarehouse({
        companyId: COMPANY_ID,
        branchId: branchNorth.id,
        type: 'BRANCH',
        name: 'Norte Principal',
        code: 'NORTH-PRINCIPAL'
    });

    const mesero1 = await ensureUser({
        username: 'mesero1',
        email: 'juan@restaurant.com',
        name: 'Juan Pérez',
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        primaryRoleId: waiterRole.id,
        color: '#2563EB'
    });
    const mesero2 = await ensureUser({
        username: 'mesero2',
        email: 'ana.mesero@restaurant.com',
        name: 'Ana Flores',
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        primaryRoleId: waiterRole.id,
        color: '#F97316'
    });
    const meseroCaja = await ensureUser({
        username: 'meserocaja1',
        email: 'sofia.turnos@restaurant.com',
        name: 'Sofía Torres',
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        primaryRoleId: waiterRole.id,
        color: '#16A34A'
    });
    const bodega1 = await ensureUser({
        username: 'bodega1',
        email: 'luis@restaurant.com',
        name: 'Luis Ramírez',
        companyId: COMPANY_ID,
        branchId: primaryBranch.id,
        primaryRoleId: warehouseRole.id,
        color: '#7C3AED'
    });

    await ensureUserRole(meseroCaja.id, cashierRole.id);

    const classifiedProducts = await ensureStorageTypes();

    const pepperoni = await prisma.menuItem.findFirst({
        where: {
            companyId: COMPANY_ID,
            branchId: null,
            name: 'Pepperoni'
        }
    });
    const sprite = await prisma.menuItem.findFirst({
        where: {
            companyId: COMPANY_ID,
            branchId: null,
            name: 'Sprite'
        }
    });

    if (!pepperoni) {
        throw new Error('No se encontró el menú global Pepperoni para sembrar escenarios.');
    }

    await prisma.menuItemBranchPrice.upsert({
        where: {
            menuItemId_branchId: {
                menuItemId: pepperoni.id,
                branchId: branchNorth.id
            }
        },
        update: {
            price: roundCurrency(Number(pepperoni.price) + 25),
            active: true
        },
        create: {
            menuItemId: pepperoni.id,
            branchId: branchNorth.id,
            price: roundCurrency(Number(pepperoni.price) + 25),
            active: true
        }
    });

    if (sprite) {
        await prisma.menuItemBranchPrice.upsert({
            where: {
                menuItemId_branchId: {
                    menuItemId: sprite.id,
                    branchId: branchNorth.id
                }
            },
            update: {
                price: Number(sprite.price),
                active: false
            },
            create: {
                menuItemId: sprite.id,
                branchId: branchNorth.id,
                price: Number(sprite.price),
                active: false
            }
        });
    }

    const northSpecial = await prisma.menuItem.findFirst({
        where: {
            companyId: COMPANY_ID,
            branchId: branchNorth.id,
            name: 'Pizza Norte Especial'
        }
    });

    if (!northSpecial) {
        await prisma.menuItem.create({
            data: {
                companyId: COMPANY_ID,
                branchId: branchNorth.id,
                categoryId: pepperoni.categoryId,
                name: 'Pizza Norte Especial',
                description: 'Disponible solo en Sucursal Norte para validar menús por sucursal.',
                price: 425,
                active: true,
                type: 'PREPARED'
            }
        });
    }

    await ensureCentralStock({
        warehouseId: centralWarehouse.id,
        productId: 1,
        userId: bodega1.id,
        quantity: 40,
        reference: 'SEED-CENTRAL-STOCK-ING-001',
        reason: 'Carga inicial bodega central para pruebas'
    });
    await ensureCentralStock({
        warehouseId: centralWarehouse.id,
        productId: 3,
        userId: bodega1.id,
        quantity: 25,
        reference: 'SEED-CENTRAL-STOCK-ING-003',
        reason: 'Carga inicial bodega central para pruebas'
    });

    await ensureTransfer({
        fromWarehouseId: centralWarehouse.id,
        toWarehouseId: northWarehouse.id,
        productId: 1,
        userId: bodega1.id,
        quantity: 8,
        reference: 'SEED-TRF-CENTRAL-NORTH-ING-001',
        transferGroupId: 'TRF-SEED-CENTRAL-NORTH-ING-001'
    });
    await ensureTransfer({
        fromWarehouseId: centralWarehouse.id,
        toWarehouseId: primaryWarehouse.id,
        productId: 3,
        userId: bodega1.id,
        quantity: 5,
        reference: 'SEED-TRF-CENTRAL-MAIN-ING-003',
        transferGroupId: 'TRF-SEED-CENTRAL-MAIN-ING-003'
    });

    await ensureDemoOrder({
        customerName: 'DEMO Cocina En Cola',
        tableNumber: 'T17',
        branchId: primaryBranch.id,
        userId: mesero1.id,
        status: 'SENT_TO_KITCHEN',
        createdAt: minutesAgo(35),
        items: [
            { name: 'Pepperoni', quantity: 1, status: 'PENDING', sentAt: minutesAgo(30) },
            { name: 'Coca Cola', quantity: 2, status: 'PENDING', sentAt: minutesAgo(30) }
        ]
    });

    await ensureDemoOrder({
        customerName: 'DEMO Cocina En Proceso',
        tableNumber: 'T18',
        branchId: primaryBranch.id,
        userId: mesero2.id,
        status: 'IN_PREPARATION',
        createdAt: minutesAgo(50),
        items: [
            {
                name: 'Capresse',
                quantity: 1,
                status: 'IN_PROGRESS',
                sentAt: minutesAgo(45),
                startedAt: minutesAgo(25)
            },
            { name: 'Sprite', quantity: 2, status: 'PENDING', sentAt: minutesAgo(45) }
        ]
    });

    await ensureDemoOrder({
        customerName: 'DEMO Cocina Lista',
        tableNumber: 'T19',
        branchId: primaryBranch.id,
        userId: mesero1.id,
        status: 'READY',
        createdAt: minutesAgo(70),
        items: [
            {
                name: 'Maui Pitza',
                quantity: 1,
                status: 'DONE',
                sentAt: minutesAgo(65),
                startedAt: minutesAgo(50),
                finishedAt: minutesAgo(12)
            },
            {
                name: 'Fanta Naranja',
                quantity: 2,
                status: 'DONE',
                sentAt: minutesAgo(65),
                startedAt: minutesAgo(55),
                finishedAt: minutesAgo(14)
            }
        ]
    });

    await ensureDemoOrder({
        customerName: 'DEMO Cuenta Compartida',
        tableNumber: 'T20',
        branchId: primaryBranch.id,
        userId: meseroCaja.id,
        status: 'READY',
        createdAt: minutesAgo(90),
        items: [
            {
                name: 'Pepperoni',
                quantity: 1,
                status: 'DONE',
                sentAt: minutesAgo(85),
                startedAt: minutesAgo(78),
                finishedAt: minutesAgo(42)
            },
            {
                name: 'Capresse',
                quantity: 1,
                status: 'DONE',
                sentAt: minutesAgo(85),
                startedAt: minutesAgo(78),
                finishedAt: minutesAgo(45)
            },
            {
                name: 'Coca Cola',
                quantity: 2,
                status: 'DONE',
                sentAt: minutesAgo(85),
                startedAt: minutesAgo(82),
                finishedAt: minutesAgo(60)
            },
            {
                name: 'Brownie con Helado',
                quantity: 1,
                status: 'DONE',
                sentAt: minutesAgo(85),
                startedAt: minutesAgo(55),
                finishedAt: minutesAgo(32)
            }
        ]
    });

    await ensureDemoOrder({
        customerName: 'DEMO Cancelación Cruzada',
        tableNumber: 'T16',
        branchId: primaryBranch.id,
        userId: mesero2.id,
        status: 'OPEN',
        createdAt: minutesAgo(18),
        items: [
            { name: 'La Bianco', quantity: 1, status: 'PENDING' },
            { name: 'Agua Purificada', quantity: 2, status: 'PENDING' }
        ]
    });

    console.log(
        `Feature scenarios ready. storageType backfilled=${classifiedProducts}, branch=${branchNorth.code}, warehouses=${primaryWarehouse.code}/${northWarehouse.code}/${centralWarehouse.code}`
    );
}

main()
    .catch((error) => {
        console.error('Feature scenario seed failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
