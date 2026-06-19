/**
 * demo-pizza-cycle.ts
 *
 * Demostración end-to-end del flujo operativo:
 *   Compra insumos → Recetas de producción → Orden de producción →
 *   Plato en menú con receta → Venta + pago → Descargue de inventario.
 *
 * Usa ingredientes REALES del catálogo (Harina, Tomate, Aceite, Orégano, Mozzarella)
 * y crea productos DEMO intermedios (Masa / Salsa) para no alterar datos operativos.
 *
 * Ejecución:
 *   npx ts-node --transpile-only src/scripts/demo-pizza-cycle.ts
 *   npx ts-node --transpile-only src/scripts/demo-pizza-cycle.ts --dry-run
 *
 * En Railway (producción, desde el contenedor API):
 *   node dist/scripts/demo-pizza-cycle.js
 */

import prisma from '../utils/prisma';
import { ProductService } from '../services/product.service';
import { PurchaseOrderService } from '../services/purchase-order.service';
import { ProductionRecipeService } from '../services/production-recipe.service';
import { ProductionOrderService } from '../services/production-order.service';
import { MenuItemService } from '../services/menu-item.service';
import { OrderService } from '../services/order.service';
import { PaymentService } from '../services/payment.service';
import { UnitConversionService } from '../services/unit-conversion.service';
import { WasteReportService } from '../services/waste-report.service';
import { InvoiceService } from '../services/invoice.service';

const DRY_RUN = process.argv.includes('--dry-run');
const DEMO_PREFIX = 'DEMO-CYCLE';

const RAW = {
    HARINA: { match: 'Harina', sku: 'PRD-000001' },
    TOMATE_LATA: { match: 'LATA DE TOMATE NAPOLI', sku: 'MIS-000015' },
    ACEITE: { match: 'ACEITE DE OLIVA', sku: 'MIS-000001' },
    OREGANO: { match: 'ORÉGANO', sku: 'MIS-000023' },
    MOZZARELLA: { match: 'MOZZARELLA', sku: 'CON-000019' },
} as const;

const DEMO = {
    MASA_SKU: `${DEMO_PREFIX}-MASA`,
    MASA_NAME: `${DEMO_PREFIX} Masa pizza`,
    SALSA_SKU: `${DEMO_PREFIX}-SALSA`,
    SALSA_NAME: `${DEMO_PREFIX} Salsa roja`,
    MENU_NAME: `${DEMO_PREFIX} Pizza Margarita`,
} as const;

type StepLog = { step: string; detail: string; data?: unknown };

const log: StepLog[] = [];

function step(name: string, detail: string, data?: unknown) {
    log.push({ step: name, detail, data });
    console.log(`\n▶ ${name}: ${detail}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

async function findProduct(companyId: number, opts: { sku?: string; nameContains?: string }) {
    if (opts.sku) {
        const bySku = await prisma.product.findFirst({
            where: { companyId, sku: opts.sku, active: true },
        });
        if (bySku) return bySku;
    }
    if (opts.nameContains) {
        return prisma.product.findFirst({
            where: { companyId, active: true, name: { contains: opts.nameContains } },
            orderBy: { id: 'asc' },
        });
    }
    return null;
}

async function ensureBranchWarehouse(companyId: number, branchId: number) {
    let wh = await prisma.warehouse.findFirst({ where: { companyId, branchId } });
    if (wh) return wh;

    const central = await prisma.warehouse.findFirst({ where: { companyId, branchId: null } });
    if (central) {
        if (!DRY_RUN) {
            wh = await prisma.warehouse.update({
                where: { id: central.id },
                data: { branchId, name: central.name || 'Bodega Sucursal' },
            });
        } else {
            return { ...central, branchId };
        }
        step('Setup', `Almacén central vinculado a sucursal ${branchId}`, { warehouseId: wh!.id });
        return wh!;
    }

    if (DRY_RUN) return { id: -1, name: 'DRY', branchId, companyId };

    wh = await prisma.warehouse.create({
        data: { companyId, branchId, name: 'Bodega Demo Ciclo', code: `DEMO-${branchId}` },
    });
    step('Setup', `Almacén creado para sucursal ${branchId}`, { warehouseId: wh.id });
    return wh;
}

async function ensureDemoProduct(
    companyId: number,
    userId: number,
    sku: string,
    name: string,
    type: 'INGREDIENT' | 'INTERMEDIATE' | 'PRODUCT_FOR_SALE',
    unit: string,
    categoryId?: number | null
) {
    const existing = await prisma.product.findFirst({ where: { companyId, sku } });
    if (existing) {
        if (existing.type !== type && !DRY_RUN) {
            await prisma.product.update({ where: { id: existing.id }, data: { type } });
        }
        return existing;
    }
    if (DRY_RUN) return { id: -1, name, sku, type, unit } as never;

    const created = await ProductService.create(
        companyId,
        { name, sku, unit, type, categoryId: categoryId ?? undefined, cost: 0, minStock: 0 },
        userId
    );
    await UnitConversionService.autoConfigureProduct(created.id, companyId, unit);
    step('Producto', `Creado ${name}`, { id: created.id, sku, type, unit });
    return created;
}

async function resolveRawIngredient(
    companyId: number,
    userId: number,
    spec: { match: string; sku?: string },
    fallback: { sku: string; name: string; unit: string },
    categoryId?: number | null
) {
    let product = await findProduct(companyId, { sku: spec.sku, nameContains: spec.match });
    if (!product) {
        product = await prisma.product.findFirst({
            where: { companyId, active: true, name: { contains: spec.match } },
            orderBy: { id: 'asc' },
        });
    }
    if (product) return { product, created: false as const };

    product = await ensureDemoProduct(
        companyId,
        userId,
        fallback.sku,
        fallback.name,
        'INGREDIENT',
        fallback.unit,
        categoryId
    );
    step('Insumo demo', `Creado porque no existía en catálogo: ${fallback.name}`, { sku: fallback.sku });
    return { product, created: true as const };
}

async function stockQty(companyId: number, warehouseId: number, productId: number) {
    const s = await prisma.stock.findUnique({
        where: { warehouseId_productId: { warehouseId, productId } },
    });
    return s ? Number(s.quantity) : 0;
}

async function productCostSummary(companyId: number, productId: number) {
    const p = await prisma.product.findFirst({
        where: { id: productId, companyId },
        select: { name: true, cost: true, currentAverageCost: true, lastPurchaseCost: true, unit: true },
    });
    return p;
}

async function main() {
    step('Inicio', DRY_RUN ? 'MODO DRY-RUN (sin escrituras)' : 'Ejecutando ciclo completo en BD');

    const company = await prisma.company.findFirst();
    if (!company) throw new Error('No hay empresa configurada');
    const companyId = company.id;

    const branch = await prisma.branch.findFirst({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    if (!branch) throw new Error('No hay sucursal');
    const branchId = branch.id;

    const user = await prisma.user.findFirst({ where: { companyId: company.id, status: 'ACTIVE' } });
    if (!user) throw new Error('No hay usuario activo');
    const userId = user.id;

    const supplier = await prisma.supplier.findFirst({ where: { companyId: company.id } });
    if (!supplier) throw new Error('No hay proveedor');

    const warehouse = await ensureBranchWarehouse(companyId, branch.id);
    const warehouseId = warehouse.id;

    const invCategory = await prisma.category.findFirst({
        where: { companyId: company.id, showInInventory: true },
        orderBy: { id: 'asc' },
    });
    const menuCategory = await prisma.category.findFirst({
        where: { companyId: company.id, showInMenu: true },
        orderBy: { id: 'asc' },
    });
    if (!menuCategory) throw new Error('No hay categoría de menú');

    // ── Resolver insumos (catálogo real o crear DEMO si faltan) ─────────────
    const rawSpecs = [
        {
            key: 'harina' as const,
            spec: RAW.HARINA,
            fallback: { sku: `${DEMO_PREFIX}-HARINA`, name: `${DEMO_PREFIX} Harina`, unit: 'kg' },
        },
        {
            key: 'tomate' as const,
            spec: RAW.TOMATE_LATA,
            fallback: { sku: `${DEMO_PREFIX}-TOMATE`, name: `${DEMO_PREFIX} Lata tomate`, unit: 'unidad' },
        },
        {
            key: 'aceite' as const,
            spec: RAW.ACEITE,
            fallback: { sku: `${DEMO_PREFIX}-ACEITE`, name: `${DEMO_PREFIX} Aceite oliva`, unit: 'unidad' },
        },
        {
            key: 'oregano' as const,
            spec: RAW.OREGANO,
            fallback: { sku: `${DEMO_PREFIX}-OREGANO`, name: `${DEMO_PREFIX} Orégano`, unit: 'unidad' },
        },
        {
            key: 'mozzarella' as const,
            spec: RAW.MOZZARELLA,
            fallback: { sku: `${DEMO_PREFIX}-MOZZ`, name: `${DEMO_PREFIX} Mozzarella`, unit: 'unidad' },
        },
    ];

    const resolved = await Promise.all(
        rawSpecs.map((r) => resolveRawIngredient(companyId, userId, r.spec, r.fallback, invCategory?.id))
    );
    const [harinaR, tomateR, aceiteR, oreganoR, mozzarellaR] = resolved;
    const harina = harinaR.product;
    const tomate = tomateR.product;
    const aceite = aceiteR.product;
    const oregano = oreganoR.product;
    const mozzarella = mozzarellaR.product;

    step('Insumos', 'Productos base listos', {
        harina: { id: harina.id, name: harina.name, unit: harina.unit, created: harinaR.created },
        tomate: { id: tomate.id, name: tomate.name, unit: tomate.unit, created: tomateR.created },
        aceite: { id: aceite.id, name: aceite.name, unit: aceite.unit, created: aceiteR.created },
        oregano: { id: oregano.id, name: oregano.name, unit: oregano.unit, created: oreganoR.created },
        mozzarella: { id: mozzarella.id, name: mozzarella.name, unit: mozzarella.unit, created: mozzarellaR.created },
    });

    // ── Productos intermedios DEMO ──────────────────────────────────────────
    const masaProduct = await ensureDemoProduct(
        companyId, userId, DEMO.MASA_SKU, DEMO.MASA_NAME, 'INTERMEDIATE', 'unidad', invCategory?.id
    );
    const salsaProduct = await ensureDemoProduct(
        companyId, userId, DEMO.SALSA_SKU, DEMO.SALSA_NAME, 'INTERMEDIATE', 'g', invCategory?.id
    );

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 1: COMPRAS (insumos crudos)
    // ═══════════════════════════════════════════════════════════════════════
    const purchaseItems = [
        { productId: harina.id, quantity: 10, cost: 25, purchaseUnit: 'kg' },
        { productId: tomate.id, quantity: 24, cost: 45, purchaseUnit: 'unidad' },
        { productId: aceite.id, quantity: 6, cost: 120, purchaseUnit: 'unidad' },
        { productId: oregano.id, quantity: 2, cost: 80, purchaseUnit: 'unidad' },
        { productId: mozzarella.id, quantity: 30, cost: 35, purchaseUnit: 'unidad' },
    ];

    let poId: number | null = null;
    if (!DRY_RUN) {
        const po = await PurchaseOrderService.create(companyId, {
            branchId,
            supplierId: supplier.id,
            notes: `${DEMO_PREFIX} Compra insumos demo`,
            invoiceType: 'CASH',
            items: purchaseItems,
        });
        if (!po) throw new Error('No se pudo crear la orden de compra');
        poId = po.id;
        await PurchaseOrderService.update(po.id, companyId, { status: 'ISSUED' });
        await PurchaseOrderService.receive(po.id, companyId, userId, warehouseId);
        step('Compra', `OC #${po.id} recibida en almacén ${warehouse.id}`, {
            total: Number(po.total),
            items: purchaseItems.map((i) => ({
                productId: i.productId,
                qty: i.quantity,
                unit: i.purchaseUnit,
                cost: i.cost,
            })),
        });
    } else {
        step('Compra', 'Simulada (dry-run)', purchaseItems);
    }

    const costsAfterPurchase = {
        harina: await productCostSummary(company.id, harina.id),
        tomate: await productCostSummary(company.id, tomate.id),
        mozzarella: await productCostSummary(company.id, mozzarella.id),
    };
    step('Costeo post-compra', 'Promedio ponderado tras recepción', costsAfterPurchase);

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 2: RECETAS DE PRODUCCIÓN
    // ═══════════════════════════════════════════════════════════════════════
    const unitUnidad = await prisma.unitOfMeasure.findFirst({
        where: { companyId: company.id, abbreviation: 'unidad' },
    });
    const unitG = await prisma.unitOfMeasure.findFirst({
        where: { companyId: company.id, abbreviation: 'g' },
    });

    async function upsertProductionRecipe(
        productId: number,
        name: string,
        yieldQuantity: number,
        yieldUnitId: number | null | undefined,
        components: Array<{ componentProductId: number; quantity: number; unit?: string; unitId?: number }>
    ) {
        const existing = await prisma.productionRecipe.findFirst({
            where: { companyId, productId, status: { in: ['ACTIVE', 'DRAFT'] } },
            orderBy: { version: 'desc' },
        });
        if (existing) {
            step('Receta producción', `Ya existe v${existing.version} para producto ${productId}`, { id: existing.id, status: existing.status });
            if (existing.status !== 'ACTIVE' && !DRY_RUN) {
                await ProductionRecipeService.setStatus(existing.id, companyId, 'ACTIVE', userId);
            }
            return existing;
        }
        if (DRY_RUN) return { id: -1, productId, name };

        const recipe = await ProductionRecipeService.create(
            companyId,
            {
                productId,
                name,
                yieldQuantity,
                yieldUnitId: yieldUnitId ?? undefined,
                activate: true,
                components,
            },
            userId
        );
        step('Receta producción', `Creada y activada: ${name}`, {
            id: recipe.id,
            yieldQuantity,
            components,
        });
        return recipe;
    }

    // Masa: por cada 10 unidades → 2500 g harina + 1 aceite
    const masaRecipe = await upsertProductionRecipe(
        masaProduct.id,
        `Receta ${DEMO.MASA_NAME}`,
        10,
        unitUnidad?.id,
        [
            { componentProductId: harina.id, quantity: 2500, unit: 'g' },
            { componentProductId: aceite.id, quantity: 1, unit: 'unidad' },
        ]
    );

    // Salsa: por cada 5000 g → 6 latas tomate + 0.5 aceite + 50 g orégano
    const salsaRecipe = await upsertProductionRecipe(
        salsaProduct.id,
        `Receta ${DEMO.SALSA_NAME}`,
        5000,
        unitG?.id,
        [
            { componentProductId: tomate.id, quantity: 6, unit: 'unidad' },
            { componentProductId: aceite.id, quantity: 0.5, unit: 'unidad' },
            { componentProductId: oregano.id, quantity: 0.1, unit: 'unidad' },
        ]
    );

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 3: ÓRDENES DE PRODUCCIÓN
    // ═══════════════════════════════════════════════════════════════════════
    async function runProduction(productId: number, plannedQty: number, label: string) {
        if (DRY_RUN) {
            step('Producción', `[dry-run] ${label}: ${plannedQty} unidades`, { productId });
            return null;
        }

        const before = await stockQty(companyId, warehouseId, productId);

        const order = await ProductionOrderService.create(
            companyId,
            {
                productId,
                plannedQuantity: plannedQty,
                warehouseId,
                branchId,
                status: 'PENDING',
                notes: `${DEMO_PREFIX} ${label}`,
            },
            userId
        );
        await ProductionOrderService.setStatus(order.id, companyId, 'IN_PROGRESS', userId);
        const finished = await ProductionOrderService.finish(order.id, companyId, userId, {
            producedQuantity: plannedQty,
            allowNegative: false,
        });

        const after = await stockQty(companyId, warehouseId, productId);
        const outCost = await productCostSummary(companyId, productId);

        step('Producción', `${label} finalizada (${order.code})`, {
            orderId: order.id,
            plannedQty,
            realCost: Number(finished.realCost),
            realUnitCost: Number(finished.realUnitCost),
            stockAntes: before,
            stockDespués: after,
            costoProducto: outCost,
        });
        return finished;
    }

    await runProduction(masaProduct.id, 20, 'Lote masa (20 unidades)');
    await runProduction(salsaProduct.id, 10000, 'Lote salsa (10 kg)');

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 4: PLATO EN MENÚ + RECETA (costeo del plato)
    // ═══════════════════════════════════════════════════════════════════════
    let menuItemId: number;
    const existingMenu = await prisma.menuItem.findFirst({
        where: { companyId: company.id, name: DEMO.MENU_NAME },
    });

    if (existingMenu) {
        menuItemId = existingMenu.id;
        step('Menú', 'Plato demo ya existía', { id: menuItemId, price: Number(existingMenu.price) });
    } else if (DRY_RUN) {
        menuItemId = -1;
        step('Menú', '[dry-run] Crear plato demo', { name: DEMO.MENU_NAME, price: 450 });
    } else {
        const mi = await MenuItemService.create(company.id, {
            name: DEMO.MENU_NAME,
            description: 'Pizza demo: ciclo compra → producción → venta',
            price: 450,
            categoryId: menuCategory.id,
            branchId: branch.id,
            type: 'PREPARED',
        });
        menuItemId = mi.id;
        step('Menú', 'Plato creado', { id: menuItemId, price: 450 });
    }

    const menuRecipes: Array<{ productId: number; quantity: number; unit: string }> = [
        { productId: masaProduct.id, quantity: 1, unit: 'unidad' },
        { productId: salsaProduct.id, quantity: 150, unit: 'g' },
        { productId: mozzarella.id, quantity: 0.15, unit: 'unidad' },
    ];

    if (!DRY_RUN && menuItemId > 0) {
        for (const r of menuRecipes) {
            const exists = await prisma.recipe.findFirst({
                where: { menuItemId, productId: r.productId },
            });
            if (exists) {
                await MenuItemService.updateRecipe(exists.id, company.id, {
                    quantity: r.quantity,
                    unit: r.unit,
                });
            } else {
                await MenuItemService.addRecipe(menuItemId, company.id, r);
            }
        }
        const menuDetail = await MenuItemService.getById(menuItemId, company.id);
        step('Costeo plato', 'Receta del menú + margen calculado', {
            plato: menuDetail.name,
            precioVenta: Number(menuDetail.price),
            costoMP: menuDetail.totalCost,
            margen: menuDetail.margin,
            margenPct: menuDetail.totalCost
                ? `${((Number(menuDetail.margin) / Number(menuDetail.price)) * 100).toFixed(1)}%`
                : 'N/A',
            ingredientes: menuDetail.recipes.map((rec) => ({
                producto: rec.product.name,
                cantidad: Number(rec.quantity),
                unidad: rec.unit || rec.product.unit,
                costoUnit: Number(rec.product.currentAverageCost ?? rec.product.cost),
            })),
        });
    } else {
        step('Menú receta', '[dry-run] Ingredientes del plato', menuRecipes);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 5: VENTA + PAGO → DESCARGUE INVENTARIO
    // ═══════════════════════════════════════════════════════════════════════
    const stockBeforeSale = !DRY_RUN
        ? {
              masa: await stockQty(company.id, warehouse.id, masaProduct.id),
              salsa: await stockQty(company.id, warehouse.id, salsaProduct.id),
              mozzarella: await stockQty(company.id, warehouse.id, mozzarella.id),
          }
        : null;

    let orderId: number | null = null;
    if (!DRY_RUN && menuItemId > 0) {
        const saleOrder = await OrderService.create(company.id, {
            branchId: branch.id,
            userId: user.id,
            customerName: `${DEMO_PREFIX} Cliente Demo`,
            items: [{ menuItemId, quantity: 2, price: 450 }],
        });
        if (!saleOrder) throw new Error('No se pudo crear la orden de venta');
        orderId = saleOrder.id;

        const paymentMethod = await prisma.paymentMethod.findFirst({
            where: { OR: [{ companyId: company.id }, { companyId: null }], active: true, name: { contains: 'Tarjeta' } },
        });
        if (!paymentMethod) throw new Error('No hay método de pago Tarjeta');

        await PaymentService.create(
            company.id,
            { orderId: saleOrder.id, paymentMethodId: paymentMethod.id, amount: Number(saleOrder.total) },
            user.id
        );

        const stockAfterSale = {
            masa: await stockQty(company.id, warehouse.id, masaProduct.id),
            salsa: await stockQty(company.id, warehouse.id, salsaProduct.id),
            mozzarella: await stockQty(company.id, warehouse.id, mozzarella.id),
        };

        const movements = await prisma.inventoryMovement.findMany({
            where: { companyId: company.id, reference: `ORD-${saleOrder.id}`, type: 'OUT' },
            include: { product: { select: { name: true } } },
            orderBy: { id: 'asc' },
        });

        step('Venta', `Orden #${saleOrder.id} pagada — descargue inventario`, {
            total: Number(saleOrder.total),
            cantidadPizzas: 2,
            stockAntes: stockBeforeSale,
            stockDespués: stockAfterSale,
            movimientosOUT: movements.map((m) => ({
                producto: m.product.name,
                cantidadBase: Number(m.quantity),
                costoTotal: Number(m.totalCost),
                unidadOriginal: m.originalUnit,
                cantidadOriginal: m.originalQuantity ? Number(m.originalQuantity) : null,
            })),
        });

        const invoice = await InvoiceService.generateInvoice(saleOrder.id, companyId);
        step('Factura', `Número fiscal asignado`, {
            orderId: saleOrder.id,
            invoiceNumber: invoice.invoiceNumber,
            total: invoice.total,
        });
    } else {
        step('Venta', '[dry-run] 2 pizzas × C$450 = C$900', { menuItemId });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FASE 6: MERMA (desperdicio de salsa demo)
    // ═══════════════════════════════════════════════════════════════════════
    if (!DRY_RUN) {
        const stockBeforeWaste = await stockQty(companyId, warehouseId, salsaProduct.id);
        await WasteReportService.recordWaste(companyId, {
            warehouseId,
            productId: salsaProduct.id,
            userId,
            quantity: 200,
            unit: 'g',
            reason: 'Vencimiento',
            notes: `${DEMO_PREFIX} merma demo post-producción`,
        });
        const stockAfterWaste = await stockQty(companyId, warehouseId, salsaProduct.id);
        step('Merma', '200 g salsa registrada (Vencimiento)', {
            producto: DEMO.SALSA_NAME,
            stockAntes: stockBeforeWaste,
            stockDespués: stockAfterWaste,
        });
    } else {
        step('Merma', '[dry-run] 200 g salsa — Vencimiento', { productId: salsaProduct.id });
    }

    // ── Resumen final ───────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('RESUMEN DEL CICLO DEMO');
    console.log('═'.repeat(60));
    console.log(`
1. COMPRA: OC ${poId ?? '(dry-run)'} — insumos crudos con conversión a unidad base
   • Harina 10 kg @ C$25/kg → stock en gramos, costo/g actualizado
   • Tomate lata, aceite, orégano, mozzarella

2. PRODUCCIÓN — Receta Masa (rendimiento 10 uds):
   • 2500 g harina + 1 aceite → 10 masas
   • Producidas: 20 unidades de "${DEMO.MASA_NAME}"

3. PRODUCCIÓN — Receta Salsa (rendimiento 5000 g):
   • 6 latas tomate + 0.5 aceite + 50 g orégano → 5 kg salsa
   • Producidas: 10 000 g de "${DEMO.SALSA_NAME}"

4. MENÚ — "${DEMO.MENU_NAME}" @ C$450
   • 1 masa + 150 g salsa + 0.15 mozzarella por pizza
   • Costo MP y margen calculados en pestaña Costos

5. VENTA — 2 pizzas → Orden ${orderId ?? '(dry-run)'}
   • Cliente: ${DEMO_PREFIX} Cliente Demo
   • Al pagar: descuenta receta del MENÚ + genera factura fiscal
   • Ver en: Órdenes, Facturas, Reportes → Ventas

6. MERMA — 200 g salsa (${DEMO.SALSA_NAME})
   • Motivo: Vencimiento
   • Ver en: Reporte Mermas → pestaña Ver Reporte
`);
    console.log('═'.repeat(60));
}

main()
    .catch((err) => {
        console.error('\n❌ Error:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
