/**
 * Safe, tenant-scoped cleanup planner for data created by demo-pizza-cycle.ts.
 *
 * Safety model:
 *   - dry-run is the default;
 *   - every run writes a complete JSON backup before any possible mutation;
 *   - --apply additionally requires ALLOW_DEMO_CLEANUP=1 and an exact company-name confirmation;
 *   - ambiguous/shared dependencies block the whole transaction;
 *   - stock is restored by removing the signed net of identified demo movements;
 *   - weighted-average costs are restored from the first demo cost-history snapshot;
 *   - catalog reference cost is preserved because it may have been maintained
 *     independently after the demo cycle;
 *   - all deletes are company-scoped and performed in one transaction;
 *   - a second run is a no-op (idempotent).
 *
 * This script must be reviewed in dry-run before use. It is intentionally stricter
 * than a general-purpose deletion tool and only recognizes the DEMO-CYCLE marker.
 *
 * Dry-run:
 *   npx ts-node --transpile-only src/scripts/cleanup-demo-data.ts --company-id 1 --out ./backups/demo.json
 *
 * Apply (never run without reviewing the backup and blockers first):
 *   ALLOW_DEMO_CLEANUP=1 node dist/scripts/cleanup-demo-data.js \
 *     --company-id 1 --out ./backups/demo-before-delete.json \
 *     --apply --confirm-company "La Mia Pitza"
 *
 * In nested runners that cannot preserve quoted arguments, the exact company
 * name may be supplied through CONFIRM_DEMO_COMPANY instead.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

const DEMO_PREFIX = 'DEMO-CYCLE';
// The first deployed version of demo-pizza-cycle.ts used this customer name
// before the DEMO-CYCLE prefix was standardized. The menu-item dependency is
// still required; the name alone is never used to select an order for deletion.
const LEGACY_DEMO_CUSTOMERS = new Set(['Cliente Demo Ciclo']);
const EPSILON = 1e-6;

type CleanupOptions = {
    companyId: number;
    out: string;
    apply: boolean;
    confirmCompany?: string;
};

type StockPlan = {
    warehouseId: number;
    productId: number;
    productName: string;
    currentQuantity: number;
    demoNetDelta: number;
    restoredQuantity: number;
    demoProduct: boolean;
};

type CostPlan = {
    productId: number;
    productName: string;
    currentAverageCost: number;
    restoredAverageCost: number;
    currentLastPurchaseCost: number;
    restoredLastPurchaseCost: number;
};

type CleanupInventory = Awaited<ReturnType<typeof collectInventory>>;

function argValue(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
}

function parseArgs(argv = process.argv.slice(2)): CleanupOptions {
    if (argv.includes('--help')) {
        console.log(`
Uso:
  cleanup-demo-data --company-id <id> --out <backup.json> [--apply --confirm-company <nombre>]

Por defecto solo audita. --apply exige ALLOW_DEMO_CLEANUP=1 y coincidencia exacta
del nombre de empresa. CONFIRM_DEMO_COMPANY puede sustituir --confirm-company
cuando el runner no conserva argumentos con espacios. El respaldo se escribe
antes de cualquier mutacion.
`);
        process.exit(0);
    }

    const companyId = Number(argValue(argv, '--company-id'));
    if (!Number.isInteger(companyId) || companyId <= 0) {
        throw new Error('--company-id es obligatorio y debe ser un entero mayor a cero.');
    }
    const out = argValue(argv, '--out');
    if (!out) throw new Error('--out es obligatorio: indique la ruta del respaldo JSON.');
    return {
        companyId,
        out: path.resolve(out),
        apply: argv.includes('--apply'),
        confirmCompany: argValue(argv, '--confirm-company') ?? process.env.CONFIRM_DEMO_COMPANY
    };
}

function ids(rows: Array<{ id: number }>): number[] {
    return rows.map((row) => row.id);
}

function unique(values: number[]): number[] {
    return [...new Set(values)];
}

function numeric(value: Prisma.Decimal | number | string | null | undefined): number {
    return value == null ? 0 : Number(value);
}

function signedMovement(type: string, quantity: unknown): number {
    const value = Number(quantity);
    if (type === 'IN') return value;
    if (type === 'OUT') return -value;
    throw new Error(`Movimiento demo de tipo ${type} no puede revertirse automaticamente.`);
}

function buildEntityWhere(entityType: string, entityIds: number[]): Prisma.AuditLogWhereInput | null {
    if (entityIds.length === 0) return null;
    return { entityType, entityId: { in: entityIds } };
}

async function collectInventory(companyId: number) {
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true, active: true, costingMethod: true }
    });
    if (!company) throw new Error(`No existe la empresa ${companyId}.`);

    const demoProducts = await prisma.product.findMany({
        where: {
            companyId,
            OR: [{ name: { startsWith: DEMO_PREFIX } }, { sku: { startsWith: DEMO_PREFIX } }]
        },
        include: { allowedUnits: true, stocks: true },
        orderBy: { id: 'asc' }
    });
    const demoProductIds = ids(demoProducts);

    const menuWhere: Prisma.MenuItemWhereInput[] = [
        { name: { startsWith: DEMO_PREFIX } },
        { description: { contains: DEMO_PREFIX } }
    ];
    if (demoProductIds.length) menuWhere.push({ recipes: { some: { productId: { in: demoProductIds } } } });
    const menuItems = await prisma.menuItem.findMany({
        where: { companyId, OR: menuWhere },
        include: {
            recipes: true,
            images: true,
            branchPrices: true,
            cateringMenuItems: true,
            pedidosYaMappings: true,
            modifierGroups: { select: { id: true, name: true } }
        },
        orderBy: { id: 'asc' }
    });
    const menuItemIds = ids(menuItems);

    const recipeWhere: Prisma.ProductionRecipeWhereInput[] = [
        { name: { contains: DEMO_PREFIX } },
        { notes: { contains: DEMO_PREFIX } }
    ];
    if (demoProductIds.length) recipeWhere.push({ productId: { in: demoProductIds } });
    const productionRecipes = await prisma.productionRecipe.findMany({
        where: { companyId, OR: recipeWhere },
        include: { components: true },
        orderBy: { id: 'asc' }
    });
    const productionRecipeIds = ids(productionRecipes);

    const productionOrderWhere: Prisma.ProductionOrderWhereInput[] = [{ notes: { contains: DEMO_PREFIX } }];
    if (demoProductIds.length) productionOrderWhere.push({ productId: { in: demoProductIds } });
    if (productionRecipeIds.length) productionOrderWhere.push({ recipeId: { in: productionRecipeIds } });
    const productionOrders = await prisma.productionOrder.findMany({
        where: { companyId, OR: productionOrderWhere },
        include: { items: true, costHistory: true },
        orderBy: { id: 'asc' }
    });
    const productionOrderIds = ids(productionOrders);

    const purchaseOrders = await prisma.purchaseOrder.findMany({
        where: { companyId, notes: { contains: DEMO_PREFIX } },
        include: { items: { include: { costHistory: true } }, payments: true },
        orderBy: { id: 'asc' }
    });
    const purchaseOrderIds = ids(purchaseOrders);
    const purchaseOrderItemIds = purchaseOrders.flatMap((order) => ids(order.items));

    const orderWhere: Prisma.OrderWhereInput[] = [{ customerName: { startsWith: DEMO_PREFIX } }];
    if (menuItemIds.length) orderWhere.push({ items: { some: { menuItemId: { in: menuItemIds } } } });
    const orders = await prisma.order.findMany({
        where: { companyId, OR: orderWhere },
        include: {
            payments: true,
            pedidosYaSyncs: true,
            items: { include: { modifiers: true } }
        },
        orderBy: { id: 'asc' }
    });
    const orderIds = ids(orders);
    const paymentIds = orders.flatMap((order) => ids(order.payments));

    const references = unique([
        ...purchaseOrderIds.map((id) => id),
        ...productionOrderIds.map((id) => id),
        ...orderIds.map((id) => id)
    ]);
    const exactReferences = [
        ...purchaseOrderIds.map((id) => `PO-${id}`),
        ...productionOrderIds.map((id) => `PROD-${id}`),
        ...orderIds.map((id) => `ORD-${id}`)
    ];

    const movementWhere: Prisma.InventoryMovementWhereInput[] = [
        { reference: { startsWith: DEMO_PREFIX } }
    ];
    if (exactReferences.length) movementWhere.push({ reference: { in: exactReferences } });
    if (demoProductIds.length) movementWhere.push({ productId: { in: demoProductIds } });
    const movements = await prisma.inventoryMovement.findMany({
        where: { companyId, OR: movementWhere },
        include: { product: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    const batchWhere: Prisma.InventoryBatchWhereInput[] = [{ sourceRef: { startsWith: DEMO_PREFIX } }];
    if (exactReferences.length) batchWhere.push({ sourceRef: { in: exactReferences } });
    if (demoProductIds.length) batchWhere.push({ productId: { in: demoProductIds } });
    const batches = await prisma.inventoryBatch.findMany({
        where: { companyId, OR: batchWhere },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    const costHistoryWhere: Prisma.ProductCostHistoryWhereInput[] = [];
    if (purchaseOrderItemIds.length) costHistoryWhere.push({ purchaseOrderItemId: { in: purchaseOrderItemIds } });
    if (productionOrderIds.length) costHistoryWhere.push({ productionOrderId: { in: productionOrderIds } });
    if (demoProductIds.length) costHistoryWhere.push({ productId: { in: demoProductIds } });
    const costHistories = costHistoryWhere.length
        ? await prisma.productCostHistory.findMany({
            where: { companyId, OR: costHistoryWhere },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        })
        : [];

    const affectedProductIds = unique([
        ...demoProductIds,
        ...movements.map((movement) => movement.productId),
        ...costHistories.map((history) => history.productId)
    ]);
    const affectedProducts = affectedProductIds.length
        ? await prisma.product.findMany({
            where: { companyId, id: { in: affectedProductIds } },
            include: { stocks: true, allowedUnits: true },
            orderBy: { id: 'asc' }
        })
        : [];

    const cashMovements = paymentIds.length
        ? await prisma.cashMovement.findMany({
            where: { reference: { in: paymentIds.map((id) => `PAY-${id}`) } },
            orderBy: { id: 'asc' }
        })
        : [];
    const cashRegisters = await prisma.cashRegister.findMany({
        where: { companyId, name: { startsWith: DEMO_PREFIX } },
        include: {
            shifts: { include: { movements: true, counts: true } },
            orders: { select: { id: true } }
        },
        orderBy: { id: 'asc' }
    });
    const warehouses = await prisma.warehouse.findMany({
        where: {
            companyId,
            OR: [{ code: { startsWith: 'DEMO-' } }, { name: { startsWith: 'Bodega Demo Ciclo' } }]
        },
        include: { stocks: true, movements: true, inventoryBatches: true, ProductionOrder: true, pedidosYaConfigs: true },
        orderBy: { id: 'asc' }
    });

    const auditWhere = [
        buildEntityWhere('Order', orderIds),
        buildEntityWhere('ProductionOrder', productionOrderIds),
        buildEntityWhere('ProductionRecipe', productionRecipeIds),
        buildEntityWhere('Product', demoProductIds),
        buildEntityWhere('MenuItem', menuItemIds),
        buildEntityWhere('PurchaseOrder', purchaseOrderIds)
    ].filter((value): value is Prisma.AuditLogWhereInput => value !== null);
    const auditLogs = auditWhere.length
        ? await prisma.auditLog.findMany({ where: { companyId, OR: auditWhere }, orderBy: { id: 'asc' } })
        : [];

    // Dependencies that look shared or unmarked are not automatically deletable.
    const external = {
        nonDemoNamedMenuItemsUsingDemoProducts: menuItems.filter((item) => !item.name.startsWith(DEMO_PREFIX)),
        nonDemoNamedOrdersUsingDemoMenu: orders.filter(
            (order) => !order.customerName?.startsWith(DEMO_PREFIX) && !LEGACY_DEMO_CUSTOMERS.has(order.customerName || '')
        ),
        cateringMenuItems: menuItems.flatMap((item) => item.cateringMenuItems),
        pedidosYaMappings: menuItems.flatMap((item) => item.pedidosYaMappings),
        menuModifierGroups: menuItems.flatMap((item) => item.modifierGroups),
        modifiersUsingDemoProducts: demoProductIds.length
            ? await prisma.modifier.findMany({ where: { productId: { in: demoProductIds } } })
            : [],
        nonDemoRecipesUsingDemoProducts: demoProductIds.length
            ? await prisma.recipe.findMany({
                where: { productId: { in: demoProductIds }, menuItemId: { notIn: menuItemIds.length ? menuItemIds : [-1] } }
            })
            : [],
        nonDemoProductionComponentsUsingDemoProducts: demoProductIds.length
            ? await prisma.productionRecipeComponent.findMany({
                where: {
                    componentProductId: { in: demoProductIds },
                    recipeId: { notIn: productionRecipeIds.length ? productionRecipeIds : [-1] }
                }
            })
            : [],
        nonDemoPurchaseItemsUsingDemoProducts: demoProductIds.length
            ? await prisma.purchaseOrderItem.findMany({
                where: {
                    productId: { in: demoProductIds },
                    purchaseOrderId: { notIn: purchaseOrderIds.length ? purchaseOrderIds : [-1] }
                }
            })
            : [],
        nonDemoProductionOrdersUsingDemoProducts: demoProductIds.length
            ? await prisma.productionOrder.findMany({
                where: {
                    companyId,
                    id: { notIn: productionOrderIds.length ? productionOrderIds : [-1] },
                    OR: [
                        { productId: { in: demoProductIds } },
                        { items: { some: { componentProductId: { in: demoProductIds } } } }
                    ]
                }
            })
            : []
    };

    return {
        company,
        references,
        exactReferences,
        demoProducts,
        affectedProducts,
        menuItems,
        productionRecipes,
        productionOrders,
        purchaseOrders,
        orders,
        movements,
        batches,
        costHistories,
        cashMovements,
        cashRegisters,
        warehouses,
        auditLogs,
        external
    };
}

async function buildPlans(inventory: CleanupInventory): Promise<{
    stockPlans: StockPlan[];
    costPlans: CostPlan[];
    blockers: string[];
    warnings: string[];
}> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const companyId = inventory.company.id;
    const demoProductIds = new Set(ids(inventory.demoProducts));
    const demoMovementIds = new Set(ids(inventory.movements));

    if (inventory.company.costingMethod !== 'WEIGHTED_AVERAGE') {
        blockers.push('El metodo de costeo no es WEIGHTED_AVERAGE; la restauracion automatica de costo/FIFO esta bloqueada.');
    }

    for (const [name, rows] of Object.entries(inventory.external)) {
        if (rows.length > 0) blockers.push(`${name}: ${rows.length} dependencia(s) compartida(s) o no marcada(s).`);
    }

    for (const movement of inventory.movements) {
        if (movement.type !== 'IN' && movement.type !== 'OUT') {
            blockers.push(`Movimiento ${movement.id} tiene tipo ${movement.type}; no se puede revertir como delta.`);
        }
    }

    const knownReferences = new Set([
        ...inventory.exactReferences,
        ...inventory.movements
            .map((movement) => movement.reference)
            .filter((reference): reference is string => !!reference && reference.startsWith(DEMO_PREFIX))
    ]);
    for (const movement of inventory.movements) {
        if (
            demoProductIds.has(movement.productId) &&
            (!movement.reference || !knownReferences.has(movement.reference))
        ) {
            blockers.push(
                `Producto demo ${movement.productId} tiene movimiento ${movement.id} con referencia no reconocida (${movement.reference || 'null'}).`
            );
        }
    }

    const movementPairs = new Map<string, { warehouseId: number; productId: number; productName: string; net: number }>();
    for (const movement of inventory.movements) {
        if (movement.type !== 'IN' && movement.type !== 'OUT') continue;
        const key = `${movement.warehouseId}|${movement.productId}`;
        const previous = movementPairs.get(key);
        const delta = signedMovement(movement.type, movement.quantity);
        if (previous) previous.net += delta;
        else movementPairs.set(key, {
            warehouseId: movement.warehouseId,
            productId: movement.productId,
            productName: movement.product.name,
            net: delta
        });
    }

    const stockPlans: StockPlan[] = [];
    for (const pair of movementPairs.values()) {
        const stock = await prisma.stock.findUnique({
            where: { warehouseId_productId: { warehouseId: pair.warehouseId, productId: pair.productId } }
        });
        if (!stock) {
            blockers.push(`No existe Stock para bodega ${pair.warehouseId}, producto ${pair.productId}, pero hay delta demo ${pair.net}.`);
            continue;
        }
        const currentQuantity = numeric(stock.quantity);
        const restoredQuantity = currentQuantity - pair.net;
        const demoProduct = demoProductIds.has(pair.productId);
        if (restoredQuantity < -EPSILON) {
            blockers.push(
                `Revertir demo dejaria stock negativo (${restoredQuantity}) para ${pair.productName} en bodega ${pair.warehouseId}.`
            );
        }
        if (demoProduct && Math.abs(restoredQuantity) > EPSILON) {
            blockers.push(
                `El producto demo ${pair.productName} tendria stock base ${restoredQuantity}; indica uso no-demo o movimientos faltantes.`
            );
        }
        stockPlans.push({
            warehouseId: pair.warehouseId,
            productId: pair.productId,
            productName: pair.productName,
            currentQuantity,
            demoNetDelta: pair.net,
            restoredQuantity: Math.abs(restoredQuantity) <= EPSILON ? 0 : restoredQuantity,
            demoProduct
        });
    }

    const affectedRealProducts = unique(
        inventory.costHistories
            .filter((history) => !demoProductIds.has(history.productId))
            .map((history) => history.productId)
    );
    const costPlans: CostPlan[] = [];
    for (const productId of affectedRealProducts) {
        const demoHistory = inventory.costHistories
            .filter((history) => history.productId === productId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
        const first = demoHistory[0];
        if (!first) continue;
        const laterNonDemo = await prisma.productCostHistory.count({
            where: {
                companyId,
                productId,
                createdAt: { gt: first.createdAt },
                id: { notIn: ids(demoHistory) }
            }
        });
        if (laterNonDemo > 0) {
            blockers.push(
                `Producto ${productId} tiene ${laterNonDemo} cambios de costo no-demo posteriores; requiere reconstruccion manual antes de limpiar.`
            );
            continue;
        }
        const laterNonDemoOutflows = await prisma.inventoryMovement.count({
            where: {
                companyId,
                productId,
                type: 'OUT',
                createdAt: { gt: first.createdAt },
                id: { notIn: [...demoMovementIds] }
            }
        });
        if (laterNonDemoOutflows > 0) {
            blockers.push(
                `Producto ${productId} tiene ${laterNonDemoOutflows} salida(s) no-demo posteriores al costo demo; ` +
                'sus COGS historicos requieren revaluacion manual antes de limpiar.'
            );
            continue;
        }
        const previousPurchase = await prisma.productCostHistory.findFirst({
            where: {
                companyId,
                productId,
                createdAt: { lt: first.createdAt },
                purchaseOrderItemId: { not: null }
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { unitCost: true }
        });
        const product = await prisma.product.findFirst({
            where: { id: productId, companyId },
            select: { id: true, name: true, currentAverageCost: true, lastPurchaseCost: true }
        });
        if (!product) {
            blockers.push(`Producto real ${productId} del historial demo ya no existe.`);
            continue;
        }
        costPlans.push({
            productId,
            productName: product.name,
            currentAverageCost: numeric(product.currentAverageCost),
            restoredAverageCost: numeric(first.previousAvgCost),
            currentLastPurchaseCost: numeric(product.lastPurchaseCost),
            restoredLastPurchaseCost: numeric(previousPurchase?.unitCost)
        });
    }

    const paymentRefs = new Set(inventory.cashMovements.map((movement) => movement.reference));
    for (const register of inventory.cashRegisters) {
        for (const shift of register.shifts) {
            const extraMovements = shift.movements.filter((movement) => !paymentRefs.has(movement.reference));
            if (extraMovements.length > 0 || shift.counts.length > 0) {
                blockers.push(
                    `Caja demo ${register.id}/turno ${shift.id} contiene actividad no-demo o conteos; no se eliminara automaticamente.`
                );
            }
        }
        const extraOrders = register.orders.filter((order) => !inventory.orders.some((candidate) => candidate.id === order.id));
        if (extraOrders.length > 0) blockers.push(`Caja demo ${register.id} esta vinculada a ${extraOrders.length} orden(es) no-demo.`);
    }

    for (const warehouse of inventory.warehouses) {
        const extraMovement = warehouse.movements.some((movement) => !demoMovementIds.has(movement.id));
        const demoProductionIds = new Set(ids(inventory.productionOrders));
        const extraProduction = warehouse.ProductionOrder.some((order) => !demoProductionIds.has(order.id));
        if (extraMovement || extraProduction || warehouse.pedidosYaConfigs.length > 0) {
            blockers.push(`Bodega demo ${warehouse.id} tiene actividad/configuracion no-demo y no puede eliminarse.`);
        }
        const planned = new Map(stockPlans.filter((plan) => plan.warehouseId === warehouse.id).map((plan) => [plan.productId, plan]));
        const nonZeroAfter = warehouse.stocks.filter((stock) => {
            const plan = planned.get(stock.productId);
            return Math.abs(plan ? plan.restoredQuantity : numeric(stock.quantity)) > EPSILON;
        });
        if (nonZeroAfter.length > 0) blockers.push(`Bodega demo ${warehouse.id} conservaria ${nonZeroAfter.length} stock(s) no cero.`);
    }

    if (inventory.batches.length > 0) {
        warnings.push(
            `${inventory.batches.length} lote(s) FIFO demo se eliminaran y los lotes restantes de los pares afectados se reconstruiran desde movimientos OUT.`
        );
    }

    return { stockPlans, costPlans, blockers: uniqueStrings(blockers), warnings: uniqueStrings(warnings) };
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
}

async function rebuildRemainingBatches(
    tx: Prisma.TransactionClient,
    companyId: number,
    pairs: Array<{ warehouseId: number; productId: number }>
): Promise<void> {
    for (const pair of pairs) {
        const batches = await tx.inventoryBatch.findMany({
            where: { companyId, warehouseId: pair.warehouseId, productId: pair.productId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
        });
        for (const batch of batches) {
            await tx.inventoryBatch.update({ where: { id: batch.id }, data: { remainingQty: batch.originalQty } });
        }

        const outflows = await tx.inventoryMovement.findMany({
            where: { companyId, warehouseId: pair.warehouseId, productId: pair.productId, type: 'OUT' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { createdAt: true, quantity: true }
        });
        const remaining = batches.map((batch) => ({
            id: batch.id,
            createdAt: batch.createdAt,
            quantity: numeric(batch.originalQty)
        }));
        for (const outflow of outflows) {
            let needed = numeric(outflow.quantity);
            for (const batch of remaining) {
                if (needed <= EPSILON) break;
                if (batch.createdAt > outflow.createdAt || batch.quantity <= EPSILON) continue;
                const consumed = Math.min(batch.quantity, needed);
                batch.quantity -= consumed;
                needed -= consumed;
            }
        }
        for (const batch of remaining) {
            await tx.inventoryBatch.update({ where: { id: batch.id }, data: { remainingQty: batch.quantity } });
        }
    }
}

async function applyCleanup(inventory: CleanupInventory, stockPlans: StockPlan[], costPlans: CostPlan[]): Promise<void> {
    const companyId = inventory.company.id;
    const menuItemIds = ids(inventory.menuItems);
    const orderIds = ids(inventory.orders);
    const orderItemIds = inventory.orders.flatMap((order) => ids(order.items));
    const paymentIds = inventory.orders.flatMap((order) => ids(order.payments));
    const productionOrderIds = ids(inventory.productionOrders);
    const productionRecipeIds = ids(inventory.productionRecipes);
    const purchaseOrderIds = ids(inventory.purchaseOrders);
    const purchaseOrderItemIds = inventory.purchaseOrders.flatMap((order) => ids(order.items));
    const demoProductIds = ids(inventory.demoProducts);
    const warehouseIds = ids(inventory.warehouses);
    const auditLogIds = ids(inventory.auditLogs);
    const batchIds = ids(inventory.batches);
    const movementIds = ids(inventory.movements);
    const costHistoryIds = ids(inventory.costHistories);
    const cashMovementIds = ids(inventory.cashMovements);

    await prisma.$transaction(async (tx) => {
        for (const plan of stockPlans) {
            await tx.stock.update({
                where: { warehouseId_productId: { warehouseId: plan.warehouseId, productId: plan.productId } },
                data: { quantity: plan.restoredQuantity }
            });
        }

        if (movementIds.length) await tx.inventoryMovement.deleteMany({ where: { id: { in: movementIds }, companyId } });
        if (batchIds.length) await tx.inventoryBatch.deleteMany({ where: { id: { in: batchIds }, companyId } });

        const affectedPairs = uniquePairs(stockPlans.map((plan) => ({ warehouseId: plan.warehouseId, productId: plan.productId })));
        await rebuildRemainingBatches(tx, companyId, affectedPairs);

        if (costHistoryIds.length) await tx.productCostHistory.deleteMany({ where: { id: { in: costHistoryIds }, companyId } });
        for (const plan of costPlans) {
            await tx.product.update({
                where: { id: plan.productId },
                data: {
                    currentAverageCost: plan.restoredAverageCost,
                    lastPurchaseCost: plan.restoredLastPurchaseCost
                }
            });
        }

        if (cashMovementIds.length) await tx.cashMovement.deleteMany({ where: { id: { in: cashMovementIds } } });
        if (paymentIds.length) await tx.payment.deleteMany({ where: { id: { in: paymentIds }, order: { companyId } } });
        if (orderItemIds.length) await tx.orderItemModifier.deleteMany({ where: { orderItemId: { in: orderItemIds } } });
        if (orderIds.length) await tx.pedidosYaOrderSync.deleteMany({ where: { orderId: { in: orderIds }, companyId } });
        if (orderItemIds.length) await tx.orderItem.deleteMany({ where: { id: { in: orderItemIds }, order: { companyId } } });
        if (orderIds.length) await tx.order.deleteMany({ where: { id: { in: orderIds }, companyId } });

        if (productionOrderIds.length) {
            await tx.productionOrderItem.deleteMany({ where: { productionOrderId: { in: productionOrderIds } } });
            await tx.productionOrder.deleteMany({ where: { id: { in: productionOrderIds }, companyId } });
        }
        if (productionRecipeIds.length) {
            await tx.productionRecipeComponent.deleteMany({ where: { recipeId: { in: productionRecipeIds } } });
            await tx.productionRecipe.deleteMany({ where: { id: { in: productionRecipeIds }, companyId } });
        }

        if (purchaseOrderItemIds.length) {
            await tx.purchaseOrderItem.deleteMany({ where: { id: { in: purchaseOrderItemIds }, purchaseOrder: { companyId } } });
        }
        if (purchaseOrderIds.length) {
            await tx.purchaseOrderPayment.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
            await tx.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds }, companyId } });
        }

        if (menuItemIds.length) {
            await tx.menuItemImage.deleteMany({ where: { menuItemId: { in: menuItemIds } } });
            await tx.menuItemBranchPrice.deleteMany({ where: { menuItemId: { in: menuItemIds } } });
            await tx.recipe.deleteMany({ where: { menuItemId: { in: menuItemIds } } });
            for (const menuItemId of menuItemIds) {
                await tx.menuItem.update({ where: { id: menuItemId }, data: { modifierGroups: { set: [] } } });
            }
            await tx.menuItem.deleteMany({ where: { id: { in: menuItemIds }, companyId } });
        }

        if (auditLogIds.length) await tx.auditLog.deleteMany({ where: { id: { in: auditLogIds }, companyId } });

        if (demoProductIds.length) {
            await tx.recipe.deleteMany({ where: { productId: { in: demoProductIds } } });
            await tx.productUnit.deleteMany({ where: { productId: { in: demoProductIds }, companyId } });
            await tx.stock.deleteMany({ where: { productId: { in: demoProductIds }, companyId } });
            await tx.inventoryBatch.deleteMany({ where: { productId: { in: demoProductIds }, companyId } });
            await tx.inventoryMovement.deleteMany({ where: { productId: { in: demoProductIds }, companyId } });
            await tx.productCostHistory.deleteMany({ where: { productId: { in: demoProductIds }, companyId } });
            await tx.product.deleteMany({ where: { id: { in: demoProductIds }, companyId } });
        }

        for (const register of inventory.cashRegisters) {
            const shiftIds = ids(register.shifts);
            if (shiftIds.length) {
                await tx.cashCount.deleteMany({ where: { shiftId: { in: shiftIds } } });
                await tx.cashMovement.deleteMany({ where: { shiftId: { in: shiftIds } } });
                await tx.cashShift.deleteMany({ where: { id: { in: shiftIds }, companyId } });
            }
            await tx.cashRegister.deleteMany({ where: { id: register.id, companyId } });
        }

        for (const warehouseId of warehouseIds) {
            await tx.stock.deleteMany({ where: { warehouseId, companyId, quantity: 0 } });
            await tx.warehouse.deleteMany({ where: { id: warehouseId, companyId } });
        }
    }, { maxWait: 10_000, timeout: 120_000 });
}

function uniquePairs(values: Array<{ warehouseId: number; productId: number }>) {
    const seen = new Set<string>();
    return values.filter((value) => {
        const key = `${value.warehouseId}|${value.productId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function counts(inventory: CleanupInventory) {
    return {
        products: inventory.demoProducts.length,
        menuItems: inventory.menuItems.length,
        menuRecipeLines: inventory.menuItems.reduce((sum, item) => sum + item.recipes.length, 0),
        productionRecipes: inventory.productionRecipes.length,
        productionComponents: inventory.productionRecipes.reduce((sum, item) => sum + item.components.length, 0),
        productionOrders: inventory.productionOrders.length,
        purchaseOrders: inventory.purchaseOrders.length,
        salesOrders: inventory.orders.length,
        payments: inventory.orders.reduce((sum, order) => sum + order.payments.length, 0),
        inventoryMovements: inventory.movements.length,
        inventoryBatches: inventory.batches.length,
        costHistories: inventory.costHistories.length,
        cashRegisters: inventory.cashRegisters.length,
        warehouses: inventory.warehouses.length,
        auditLogs: inventory.auditLogs.length
    };
}

async function writeBackup(output: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const handle = await fs.open(output, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
        await handle.close();
    }
}

export async function runDemoCleanup(options: CleanupOptions) {
    const inventory = await collectInventory(options.companyId);
    const plans = await buildPlans(inventory);
    const backup = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        marker: DEMO_PREFIX,
        mode: options.apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
        company: inventory.company,
        counts: counts(inventory),
        stockPlans: plans.stockPlans,
        costPlans: plans.costPlans,
        blockers: plans.blockers,
        warnings: plans.warnings,
        data: inventory
    };
    await writeBackup(options.out, backup);

    if (!options.apply) {
        return { applied: false, backup: options.out, ...backup };
    }
    if (process.env.ALLOW_DEMO_CLEANUP !== '1') {
        throw new Error('Ejecucion bloqueada: defina ALLOW_DEMO_CLEANUP=1 despues de revisar el dry-run.');
    }
    if (options.confirmCompany !== inventory.company.name) {
        throw new Error(
            `Confirmacion invalida. --confirm-company debe coincidir exactamente con "${inventory.company.name}".`
        );
    }
    if (plans.blockers.length > 0) {
        throw new Error(`Limpieza bloqueada por ${plans.blockers.length} condicion(es):\n- ${plans.blockers.join('\n- ')}`);
    }

    await applyCleanup(inventory, plans.stockPlans, plans.costPlans);
    const after = await collectInventory(options.companyId);
    const afterCounts = counts(after);
    const remaining = Object.values(afterCounts).reduce((sum, value) => sum + value, 0);
    if (remaining > 0) {
        throw new Error(`La transaccion termino, pero la verificacion encontro ${remaining} registros demo restantes.`);
    }
    return { applied: true, backup: options.out, before: backup.counts, after: afterCounts };
}

async function main(): Promise<void> {
    const options = parseArgs();
    const result = await runDemoCleanup(options);
    console.log(JSON.stringify(result, null, 2));
    if (!options.apply && 'blockers' in result && result.blockers.length > 0) process.exitCode = 2;
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
