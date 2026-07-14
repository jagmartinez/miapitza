/**
 * Read-only certification audit for the menu-recipe and production flows.
 *
 * This script never calls a mutation service and never opens a write transaction.
 * It verifies configuration and reconciles existing order/production movements.
 *
 * Examples:
 *   npx ts-node --transpile-only src/scripts/verify-recipe-e2e.ts --company-id 1
 *   node dist/scripts/verify-recipe-e2e.js --company-id 1 --since 2026-07-10 --out ./recipe-e2e-report.json
 *
 * Exit codes:
 *   0 = no blocking findings
 *   2 = one or more blocking findings
 *   1 = invalid arguments / unexpected execution error
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { UnitConversionService } from '../services/unit-conversion.service';
import { effectiveUnitCost } from '../utils/product-cost';

const DEMO_PREFIX = 'DEMO-CYCLE';
const EPSILON = 1e-6;

type Severity = 'ERROR' | 'WARNING' | 'INFO';

export type VerificationFinding = {
    severity: Severity;
    code: string;
    scope: string;
    message: string;
    details?: Record<string, unknown>;
};

type CliOptions = {
    companyId: number;
    since?: Date;
    out?: string;
    expectedMenuItems: number;
    expectedProductionRecipes: number;
};

type QuantityMap = Map<number, number>;

function parsePositiveInt(value: string | undefined, option: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${option} debe ser un entero mayor a cero.`);
    }
    return parsed;
}

function parseArgs(argv = process.argv.slice(2)): CliOptions {
    const get = (name: string): string | undefined => {
        const index = argv.indexOf(name);
        return index >= 0 ? argv[index + 1] : undefined;
    };

    if (argv.includes('--help')) {
        console.log(`
Uso:
  verify-recipe-e2e --company-id <id> [opciones]

Opciones:
  --since <ISO>                    Audita ventas/produccion desde esta fecha.
  --out <reporte.json>             Guarda el mismo reporte mostrado en consola.
  --expected-menu-items <n>        Esperado de platos activos con receta (default 13).
  --expected-production-recipes <n> Esperado de recetas de produccion activas (default 8).
`);
        process.exit(0);
    }

    const companyId = parsePositiveInt(get('--company-id'), '--company-id');
    const expectedMenuItems = get('--expected-menu-items')
        ? parsePositiveInt(get('--expected-menu-items'), '--expected-menu-items')
        : 13;
    const expectedProductionRecipes = get('--expected-production-recipes')
        ? parsePositiveInt(get('--expected-production-recipes'), '--expected-production-recipes')
        : 8;

    const sinceRaw = get('--since');
    let since: Date | undefined;
    if (sinceRaw) {
        since = new Date(sinceRaw);
        if (Number.isNaN(since.getTime())) throw new Error('--since no es una fecha ISO valida.');
    }

    return { companyId, since, out: get('--out'), expectedMenuItems, expectedProductionRecipes };
}

function add(map: QuantityMap, productId: number, quantity: number): void {
    map.set(productId, (map.get(productId) || 0) + quantity);
}

function closeEnough(actual: number, expected: number): boolean {
    return Math.abs(actual - expected) <= Math.max(EPSILON, Math.abs(expected) * 1e-6);
}

function numeric(value: Prisma.Decimal | number | string | null | undefined): number {
    return value == null ? 0 : Number(value);
}

function finding(
    findings: VerificationFinding[],
    severity: Severity,
    code: string,
    scope: string,
    message: string,
    details?: Record<string, unknown>
): void {
    findings.push({ severity, code, scope, message, ...(details ? { details } : {}) });
}

async function verifyNoDemoData(companyId: number, findings: VerificationFinding[]): Promise<Record<string, number>> {
    const [products, menuItems, productionRecipes, productionOrders, purchases, orders, movements, registers] =
        await Promise.all([
            prisma.product.count({
                where: { companyId, OR: [{ name: { startsWith: DEMO_PREFIX } }, { sku: { startsWith: DEMO_PREFIX } }] }
            }),
            prisma.menuItem.count({
                where: { companyId, OR: [{ name: { startsWith: DEMO_PREFIX } }, { description: { contains: DEMO_PREFIX } }] }
            }),
            prisma.productionRecipe.count({
                where: { companyId, OR: [{ name: { contains: DEMO_PREFIX } }, { notes: { contains: DEMO_PREFIX } }] }
            }),
            prisma.productionOrder.count({ where: { companyId, notes: { contains: DEMO_PREFIX } } }),
            prisma.purchaseOrder.count({ where: { companyId, notes: { contains: DEMO_PREFIX } } }),
            prisma.order.count({ where: { companyId, customerName: { startsWith: DEMO_PREFIX } } }),
            prisma.inventoryMovement.count({ where: { companyId, reference: { contains: DEMO_PREFIX } } }),
            prisma.cashRegister.count({ where: { companyId, name: { startsWith: DEMO_PREFIX } } })
        ]);

    const counts = { products, menuItems, productionRecipes, productionOrders, purchases, orders, movements, registers };
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (total > 0) {
        finding(
            findings,
            'ERROR',
            'DEMO_DATA_PRESENT',
            'cleanup',
            `Quedan ${total} registros marcados ${DEMO_PREFIX}; la limpieza no esta certificada.`,
            counts
        );
    } else {
        finding(findings, 'INFO', 'DEMO_DATA_ABSENT', 'cleanup', 'No quedan marcadores DEMO-CYCLE en las entidades auditadas.');
    }
    return counts;
}

async function verifyMenuRecipes(
    companyId: number,
    expectedCount: number,
    findings: VerificationFinding[]
): Promise<{ menuItems: number; recipeLines: number; zeroCostProducts: number; zeroStockProducts: number }> {
    const [branches, warehouses] = await Promise.all([
        prisma.branch.findMany({
            where: { companyId, status: 'ACTIVE' },
            select: { id: true, name: true }
        }),
        prisma.warehouse.findMany({
            where: { companyId },
            select: { id: true, name: true, branchId: true },
            orderBy: { id: 'asc' }
        })
    ]);
    const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
    for (const branch of branches) {
        const candidates = warehouses.filter((warehouse) => warehouse.branchId === branch.id);
        if (candidates.length === 0) {
            finding(
                findings,
                'ERROR',
                'BRANCH_WITHOUT_WAREHOUSE',
                `branch:${branch.id}`,
                `${branch.name} no tiene bodega; un pago no puede descargar inventario.`
            );
        } else if (candidates.length > 1) {
            finding(
                findings,
                'WARNING',
                'MULTIPLE_BRANCH_WAREHOUSES',
                `branch:${branch.id}`,
                `${branch.name} tiene ${candidates.length} bodegas y el cobro usa findFirst sin seleccion explicita.`,
                { warehouses: candidates }
            );
        }
    }

    const menuItems = await prisma.menuItem.findMany({
        where: { companyId, active: true, recipes: { some: {} } },
        select: {
            id: true,
            name: true,
            branchId: true,
            recipes: {
                select: {
                    id: true,
                    productId: true,
                    quantity: true,
                    unit: true,
                    unitOfMeasure: { select: { abbreviation: true } },
                    product: {
                        select: {
                            name: true,
                            unit: true,
                            active: true,
                            currentAverageCost: true,
                            cost: true,
                            stocks: { select: { warehouseId: true, quantity: true } }
                        }
                    }
                }
            }
        },
        orderBy: { id: 'asc' }
    });

    if (menuItems.length !== expectedCount) {
        finding(
            findings,
            'ERROR',
            'MENU_RECIPE_COUNT_MISMATCH',
            'menu',
            `Se esperaban ${expectedCount} platos activos con receta y existen ${menuItems.length}.`,
            { expected: expectedCount, actual: menuItems.length }
        );
    }

    let recipeLines = 0;
    const costProducts = new Set<number>();
    const stockProducts = new Set<number>();

    for (const menuItem of menuItems) {
        if (menuItem.recipes.length === 0) {
            finding(findings, 'ERROR', 'MENU_WITHOUT_COMPONENTS', `menuItem:${menuItem.id}`, `${menuItem.name} no tiene componentes.`);
            continue;
        }
        recipeLines += menuItem.recipes.length;

        for (const recipe of menuItem.recipes) {
            const scope = `menuItem:${menuItem.id}/recipe:${recipe.id}`;
            const quantity = numeric(recipe.quantity);
            if (!(quantity > 0)) {
                finding(findings, 'ERROR', 'INVALID_RECIPE_QUANTITY', scope, 'La cantidad debe ser mayor a cero.', { quantity });
            }
            if (!recipe.product.active) {
                finding(findings, 'ERROR', 'INACTIVE_RECIPE_PRODUCT', scope, `${recipe.product.name} esta inactivo.`);
            }

            const unit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.unit;
            try {
                const converted = await UnitConversionService.convert(recipe.productId, companyId, quantity, unit);
                if (!(converted.baseQuantity > 0)) {
                    finding(findings, 'ERROR', 'INVALID_BASE_QUANTITY', scope, 'La conversion produce una cantidad base no positiva.');
                }
            } catch (error) {
                finding(findings, 'ERROR', 'RECIPE_UNIT_NOT_CONVERTIBLE', scope, error instanceof Error ? error.message : String(error), {
                    product: recipe.product.name,
                    unit
                });
            }

            if (effectiveUnitCost(recipe.product.currentAverageCost, recipe.product.cost) <= 0) {
                costProducts.add(recipe.productId);
                finding(
                    findings,
                    'ERROR',
                    'RECIPE_PRODUCT_WITHOUT_COST',
                    scope,
                    `${recipe.product.name} no tiene costo promedio positivo.`
                );
            }
            const totalStock = recipe.product.stocks.reduce((sum, row) => sum + numeric(row.quantity), 0);
            if (totalStock <= 0) {
                stockProducts.add(recipe.productId);
                finding(
                    findings,
                    'ERROR',
                    'RECIPE_PRODUCT_WITHOUT_STOCK',
                    scope,
                    `${recipe.product.name} no tiene existencia disponible en ninguna bodega.`
                );
            }

            const targetBranchIds = menuItem.branchId ? [menuItem.branchId] : branches.map((branch) => branch.id);
            for (const targetBranchId of targetBranchIds) {
                const branchWarehouses = warehouses.filter((warehouse) => warehouse.branchId === targetBranchId);
                for (const warehouse of branchWarehouses) {
                    const branchStock = recipe.product.stocks
                        .filter((row) => row.warehouseId === warehouse.id)
                        .reduce((sum, row) => sum + numeric(row.quantity), 0);
                    if (branchStock <= 0) {
                        finding(
                            findings,
                            'ERROR',
                            'RECIPE_PRODUCT_WITHOUT_BRANCH_STOCK',
                            scope,
                            `${recipe.product.name} no tiene stock en ${warehouse.name} (${branchName.get(targetBranchId) || targetBranchId}).`,
                            { branchId: targetBranchId, warehouseId: warehouse.id, stock: branchStock }
                        );
                    }
                }
            }
        }
    }

    return {
        menuItems: menuItems.length,
        recipeLines,
        zeroCostProducts: costProducts.size,
        zeroStockProducts: stockProducts.size
    };
}

async function expectedForOrder(
    companyId: number,
    items: Array<{
        quantity: number;
        menuItem: {
            recipes: Array<{
                productId: number;
                quantity: Prisma.Decimal;
                unit: string | null;
                unitOfMeasure: { abbreviation: string } | null;
                product: { unit: string };
            }>;
        };
    }>
): Promise<QuantityMap> {
    const expected = new Map<number, number>();
    for (const item of items) {
        for (const recipe of item.menuItem.recipes) {
            const unit = recipe.unit || recipe.unitOfMeasure?.abbreviation || recipe.product.unit;
            const converted = await UnitConversionService.convert(
                recipe.productId,
                companyId,
                numeric(recipe.quantity),
                unit
            );
            add(expected, recipe.productId, converted.baseQuantity * item.quantity);
        }
    }
    return expected;
}

async function verifySales(
    companyId: number,
    since: Date | undefined,
    findings: VerificationFinding[]
): Promise<{ audited: number; paidOrDelivered: number; cancelled: number }> {
    const orders = await prisma.order.findMany({
        where: {
            companyId,
            OR: [
                { financialStatus: 'PAID', status: { not: 'CANCELLED' } },
                { status: 'CANCELLED' }
            ],
            ...(since ? { createdAt: { gte: since } } : {})
        },
        select: {
            id: true,
            status: true,
            financialStatus: true,
            total: true,
            createdAt: true,
            payments: {
                where: { status: 'ACTIVE' },
                select: {
                    id: true,
                    amount: true,
                    paymentMethod: { select: { type: true } }
                }
            },
            items: {
                select: {
                    quantity: true,
                    menuItem: {
                        select: {
                            recipes: {
                                select: {
                                    productId: true,
                                    quantity: true,
                                    unit: true,
                                    unitOfMeasure: { select: { abbreviation: true } },
                                    product: { select: { unit: true } }
                                }
                            }
                        }
                    }
                }
            }
        },
        orderBy: { id: 'asc' }
    });

    if (orders.length === 0) {
        finding(
            findings,
            'ERROR',
            'NO_SALE_EVIDENCE',
            'sales',
            'No hay ventas financieramente pagadas o anuladas en el periodo para certificar el descargue y la reversa.',
            { since: since?.toISOString() || null }
        );
        return { audited: 0, paidOrDelivered: 0, cancelled: 0 };
    }

    let paidOrDelivered = 0;
    let cancelled = 0;
    let reversedCancelled = 0;
    for (const order of orders) {
        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `ORD-${order.id}`, type: { in: ['OUT', 'IN'] } },
            select: { productId: true, type: true, quantity: true }
        });
        const actual = new Map<number, number>();
        for (const movement of movements) {
            add(actual, movement.productId, (movement.type === 'OUT' ? 1 : -1) * numeric(movement.quantity));
        }

        if (order.status === 'CANCELLED') {
            cancelled++;
            let fullyReversed = movements.some((movement) => movement.type === 'OUT');
            for (const [productId, quantity] of actual) {
                if (!closeEnough(quantity, 0)) {
                    fullyReversed = false;
                    finding(
                        findings,
                        'ERROR',
                        'CANCELLED_SALE_NOT_REVERSED',
                        `order:${order.id}`,
                        `La orden anulada conserva consumo neto del producto ${productId}.`,
                        { productId, netConsumed: quantity }
                    );
                }
            }
            if (fullyReversed) reversedCancelled++;
            const paidOnCancelled = order.payments.reduce((sum, payment) => sum + numeric(payment.amount), 0);
            if (paidOnCancelled > EPSILON) {
                finding(
                    findings,
                    'ERROR',
                    'CANCELLED_SALE_HAS_PAYMENTS',
                    `order:${order.id}`,
                    'La orden anulada conserva pagos positivos sin una compensacion financiera modelada.',
                    { paidAmount: paidOnCancelled }
                );
            }
            continue;
        }

        paidOrDelivered++;
        const paidAmount = order.payments.reduce((sum, payment) => sum + numeric(payment.amount), 0);
        if (!closeEnough(paidAmount, numeric(order.total))) {
            finding(
                findings,
                'ERROR',
                'TERMINAL_SALE_PAYMENT_MISMATCH',
                `order:${order.id}`,
                `La orden con estado financiero ${order.financialStatus} no esta completamente respaldada por pagos activos.`,
                { total: numeric(order.total), paidAmount }
            );
        }
        for (const payment of order.payments) {
            if (payment.paymentMethod.type !== 'CASH') continue;
            const cashRows = await prisma.cashMovement.count({ where: { reference: `PAY-${payment.id}`, type: 'IN' } });
            if (cashRows !== 1) {
                finding(
                    findings,
                    'ERROR',
                    'CASH_PAYMENT_MOVEMENT_MISMATCH',
                    `order:${order.id}/payment:${payment.id}`,
                    'Un pago en efectivo debe tener exactamente un movimiento IN de caja.',
                    { actual: cashRows }
                );
            }
        }
        let expected: QuantityMap;
        try {
            expected = await expectedForOrder(companyId, order.items);
        } catch (error) {
            finding(
                findings,
                'ERROR',
                'SALE_EXPECTATION_FAILED',
                `order:${order.id}`,
                error instanceof Error ? error.message : String(error)
            );
            continue;
        }

        for (const [productId, expectedQuantity] of expected) {
            const actualQuantity = actual.get(productId) || 0;
            if (!closeEnough(actualQuantity, expectedQuantity)) {
                finding(
                    findings,
                    'ERROR',
                    'SALE_CONSUMPTION_MISMATCH',
                    `order:${order.id}`,
                    `El consumo de producto ${productId} no coincide con la receta.`,
                    { productId, expected: expectedQuantity, actual: actualQuantity }
                );
            }
        }
    }

    if (paidOrDelivered === 0) {
        finding(findings, 'ERROR', 'NO_PAID_SALE_EVIDENCE', 'sales', 'Falta al menos una venta pagada con consumo conciliado.');
    }
    if (reversedCancelled === 0) {
        finding(
            findings,
            'WARNING',
            'NO_CANCELLED_SALE_EVIDENCE',
            'sales',
            'No existe evidencia en el periodo de una venta consumida y posteriormente revertida (OUT + IN con neto cero).'
        );
    }

    return { audited: orders.length, paidOrDelivered, cancelled };
}

async function verifyProduction(
    companyId: number,
    since: Date | undefined,
    expectedActiveRecipes: number,
    findings: VerificationFinding[]
): Promise<{ activeRecipes: number; auditedOrders: number; finished: number; cancelled: number }> {
    const activeRecipes = await prisma.productionRecipe.findMany({
        where: { companyId, status: 'ACTIVE' },
        select: {
            id: true,
            productId: true,
            name: true,
            yieldQuantity: true,
            yieldUnit: { select: { abbreviation: true } },
            product: { select: { unit: true, active: true } },
            components: {
                select: {
                    id: true,
                    componentProductId: true,
                    quantity: true,
                    unit: true,
                    unitOfMeasure: { select: { abbreviation: true } },
                    componentProduct: { select: { name: true, unit: true, active: true, currentAverageCost: true, cost: true } }
                }
            }
        },
        orderBy: { id: 'asc' }
    });

    if (activeRecipes.length !== expectedActiveRecipes) {
        finding(
            findings,
            'ERROR',
            'PRODUCTION_RECIPE_COUNT_MISMATCH',
            'production-recipes',
            `Se esperaban ${expectedActiveRecipes} recetas activas y existen ${activeRecipes.length}.`,
            { expected: expectedActiveRecipes, actual: activeRecipes.length }
        );
    }

    const activePerProduct = new Map<number, number>();
    for (const recipe of activeRecipes) {
        activePerProduct.set(recipe.productId, (activePerProduct.get(recipe.productId) || 0) + 1);
        const scope = `productionRecipe:${recipe.id}`;
        if (!recipe.product.active) {
            finding(findings, 'ERROR', 'INACTIVE_OUTPUT_PRODUCT', scope, 'El producto de salida esta inactivo.');
        }
        if (recipe.components.length === 0) {
            finding(findings, 'ERROR', 'PRODUCTION_RECIPE_WITHOUT_COMPONENTS', scope, `${recipe.name} no tiene componentes.`);
        }
        try {
            await UnitConversionService.convert(
                recipe.productId,
                companyId,
                numeric(recipe.yieldQuantity),
                recipe.yieldUnit?.abbreviation || recipe.product.unit
            );
        } catch (error) {
            finding(findings, 'ERROR', 'YIELD_UNIT_NOT_CONVERTIBLE', scope, error instanceof Error ? error.message : String(error));
        }
        for (const component of recipe.components) {
            const componentScope = `${scope}/component:${component.id}`;
            if (!component.componentProduct.active) {
                finding(findings, 'ERROR', 'INACTIVE_PRODUCTION_COMPONENT', componentScope, `${component.componentProduct.name} esta inactivo.`);
            }
            if (effectiveUnitCost(component.componentProduct.currentAverageCost, component.componentProduct.cost) <= 0) {
                finding(findings, 'ERROR', 'PRODUCTION_COMPONENT_WITHOUT_COST', componentScope, `${component.componentProduct.name} no tiene costo positivo.`);
            }
            try {
                await UnitConversionService.convert(
                    component.componentProductId,
                    companyId,
                    numeric(component.quantity),
                    component.unit || component.unitOfMeasure?.abbreviation || component.componentProduct.unit
                );
            } catch (error) {
                finding(findings, 'ERROR', 'PRODUCTION_UNIT_NOT_CONVERTIBLE', componentScope, error instanceof Error ? error.message : String(error));
            }
        }
    }
    for (const [productId, count] of activePerProduct) {
        if (count > 1) {
            finding(findings, 'ERROR', 'MULTIPLE_ACTIVE_RECIPES', `product:${productId}`, 'Hay mas de una receta de produccion activa.', { count });
        }
    }

    const orders = await prisma.productionOrder.findMany({
        where: {
            companyId,
            status: { in: ['FINISHED', 'CANCELLED'] },
            ...(since ? { createdAt: { gte: since } } : {})
        },
        select: {
            id: true,
            code: true,
            status: true,
            productId: true,
            producedQuantity: true,
            realCost: true,
            realUnitCost: true,
            items: { select: { componentProductId: true, consumedQuantity: true, totalCost: true } },
            costHistory: { select: { id: true } }
        },
        orderBy: { id: 'asc' }
    });

    let finished = 0;
    let cancelled = 0;
    let reversedCancelled = 0;
    for (const order of orders) {
        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId, reference: `PROD-${order.id}`, type: { in: ['OUT', 'IN'] } },
            select: { productId: true, type: true, quantity: true }
        });
        const net = new Map<number, number>();
        for (const movement of movements) {
            add(net, movement.productId, (movement.type === 'IN' ? 1 : -1) * numeric(movement.quantity));
        }

        if (order.status === 'CANCELLED') {
            cancelled++;
            let fullyReversed = movements.some((movement) => movement.type === 'OUT') && numeric(order.producedQuantity) > 0;
            for (const [productId, quantity] of net) {
                if (!closeEnough(quantity, 0)) {
                    fullyReversed = false;
                    finding(findings, 'ERROR', 'CANCELLED_PRODUCTION_NOT_REVERSED', `productionOrder:${order.id}`, 'La orden anulada conserva movimiento neto.', {
                        productId,
                        netQuantity: quantity
                    });
                }
            }
            if (order.costHistory.length > 0) {
                fullyReversed = false;
                finding(findings, 'ERROR', 'CANCELLED_PRODUCTION_COST_NOT_REVERSED', `productionOrder:${order.id}`, 'La orden anulada conserva historial de costo.');
            }
            if (fullyReversed) reversedCancelled++;
            continue;
        }

        finished++;
        const outputNet = net.get(order.productId) || 0;
        if (!closeEnough(outputNet, numeric(order.producedQuantity))) {
            finding(findings, 'ERROR', 'PRODUCTION_OUTPUT_MISMATCH', `productionOrder:${order.id}`, 'La entrada de producto no coincide con la cantidad producida.', {
                expected: numeric(order.producedQuantity),
                actual: outputNet
            });
        }
        for (const item of order.items) {
            const actualConsumed = -(net.get(item.componentProductId) || 0);
            if (!closeEnough(actualConsumed, numeric(item.consumedQuantity))) {
                finding(findings, 'ERROR', 'PRODUCTION_INPUT_MISMATCH', `productionOrder:${order.id}`, 'El movimiento de insumo no coincide con el consumo registrado.', {
                    componentProductId: item.componentProductId,
                    expected: numeric(item.consumedQuantity),
                    actual: actualConsumed
                });
            }
        }
        const itemCost = order.items.reduce((sum, item) => sum + numeric(item.totalCost), 0);
        if (!closeEnough(itemCost, numeric(order.realCost))) {
            finding(findings, 'ERROR', 'PRODUCTION_REAL_COST_MISMATCH', `productionOrder:${order.id}`, 'La suma de costos de insumos no coincide con el costo real.', {
                expected: itemCost,
                actual: numeric(order.realCost)
            });
        }
        const calculated = numeric(order.producedQuantity) * numeric(order.realUnitCost);
        if (!closeEnough(calculated, numeric(order.realCost))) {
            finding(findings, 'ERROR', 'PRODUCTION_UNIT_COST_MISMATCH', `productionOrder:${order.id}`, 'Costo unitario x cantidad no coincide con el costo real.', {
                calculated,
                realCost: numeric(order.realCost)
            });
        }
        if (order.costHistory.length !== 1) {
            finding(findings, 'ERROR', 'PRODUCTION_COST_HISTORY_MISMATCH', `productionOrder:${order.id}`, 'Una orden finalizada debe tener exactamente una entrada de costo.', {
                actual: order.costHistory.length
            });
        }
    }

    if (finished === 0) {
        finding(findings, 'ERROR', 'NO_FINISHED_PRODUCTION_EVIDENCE', 'production-orders', 'Falta una produccion finalizada conciliada en el periodo.');
    }
    if (reversedCancelled === 0) {
        finding(findings, 'WARNING', 'NO_CANCELLED_PRODUCTION_EVIDENCE', 'production-orders', 'Falta evidencia de anulacion y reversa de una produccion terminada.');
    }

    return { activeRecipes: activeRecipes.length, auditedOrders: orders.length, finished, cancelled };
}

export async function runRecipeE2EVerification(options: CliOptions) {
    const company = await prisma.company.findUnique({
        where: { id: options.companyId },
        select: { id: true, name: true, active: true, costingMethod: true }
    });
    if (!company) throw new Error(`No existe la empresa ${options.companyId}.`);

    const findings: VerificationFinding[] = [];
    if (!company.active) finding(findings, 'ERROR', 'COMPANY_INACTIVE', 'company', 'La empresa esta inactiva.');

    const demo = await verifyNoDemoData(options.companyId, findings);
    const menu = await verifyMenuRecipes(options.companyId, options.expectedMenuItems, findings);
    const sales = await verifySales(options.companyId, options.since, findings);
    const production = await verifyProduction(
        options.companyId,
        options.since,
        options.expectedProductionRecipes,
        findings
    );

    const errors = findings.filter((item) => item.severity === 'ERROR').length;
    const warnings = findings.filter((item) => item.severity === 'WARNING').length;
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        company,
        period: { since: options.since?.toISOString() || null },
        expected: {
            menuItemsWithRecipe: options.expectedMenuItems,
            activeProductionRecipes: options.expectedProductionRecipes
        },
        summary: {
            certified: errors === 0,
            errors,
            warnings,
            menu,
            sales,
            production,
            demo
        },
        criteria: {
            noDemoData: 'No existe ningun marcador DEMO-CYCLE.',
            menu: '13 platos activos con receta; componentes activos, convertibles, con costo y stock positivos.',
            sales: 'Venta pagada/entregada conciliada por ORD-id y evidencia de reversa sin consumo neto.',
            production: '8 recetas activas y ordenes PROD-id conciliadas en cantidad/costo; anulaciones con neto y costo en cero.'
        },
        findings
    };

    if (options.out) {
        const output = path.resolve(options.out);
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }

    return report;
}

async function main(): Promise<void> {
    const options = parseArgs();
    const report = await runRecipeE2EVerification(options);
    console.log(JSON.stringify(report, null, 2));
    if (!report.summary.certified) process.exitCode = 2;
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
