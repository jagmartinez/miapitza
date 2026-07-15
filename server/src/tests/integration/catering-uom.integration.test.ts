import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { CateringService } from '../../services/catering.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';

describe('Catering recipe UOM atomicity (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let companyId: number, branchId: number, roleId: number, userId: number;
    let categoryId: number, warehouseId: number, gramId: number, kgId: number;
    let validProductId: number, invalidProductId: number, validMenuId: number, invalidMenuId: number;
    let paymentMethodId: number, cashPaymentMethodId: number, cashRegisterId: number;

    beforeAll(async () => {
        const company = await prisma.company.create({ data: { name: `Catering UOM ${suffix}`, costingMethod: 'FIFO' } });
        companyId = company.id;
        const branch = await prisma.branch.create({ data: { companyId, name: `Branch ${suffix}`, code: `CU-${suffix}` } });
        branchId = branch.id;
        const role = await prisma.role.create({ data: { companyId, name: `CU_ROLE_${suffix}` } });
        roleId = role.id;
        const user = await prisma.user.create({ data: {
            companyId, branchId, roleId, name: 'Catering UOM', email: `cu-${suffix}@test.local`,
            username: `cu_${suffix}`, password: 'test', mustChangePassword: false, status: 'ACTIVE'
        } });
        userId = user.id;
        const category = await prisma.category.create({ data: {
            companyId, name: `CU category ${suffix}`, codePrefix: `CU${companyId}`, showInMenu: true, showInInventory: true
        } });
        categoryId = category.id;
        const warehouse = await prisma.warehouse.create({ data: {
            companyId, branchId, name: `CU warehouse ${suffix}`, code: `CUW-${suffix}`
        } });
        warehouseId = warehouse.id;
        const gram = await prisma.unitOfMeasure.create({ data: { companyId, name: 'Gramo', abbreviation: 'g', measurementType: 'MASS', systemFactor: 1 } });
        gramId = gram.id;
        const kg = await prisma.unitOfMeasure.create({ data: { companyId, name: 'Kilogramo', abbreviation: 'kg', measurementType: 'MASS', systemFactor: 1000 } });
        kgId = kg.id;
        const [validProduct, invalidProduct] = await Promise.all([
            prisma.product.create({ data: { companyId, categoryId, name: `Valid ${suffix}`, sku: `CU-V-${suffix}`, unit: 'g', baseUnitId: gramId, currentAverageCost: 0.5 } }),
            prisma.product.create({ data: { companyId, categoryId, name: `Invalid ${suffix}`, sku: `CU-I-${suffix}`, unit: 'g', baseUnitId: gramId, currentAverageCost: 0.5 } })
        ]);
        validProductId = validProduct.id; invalidProductId = invalidProduct.id;
        await prisma.productUnit.createMany({ data: [
            { companyId, productId: validProductId, unitId: gramId, conversionFactor: 1 },
            { companyId, productId: validProductId, unitId: kgId, conversionFactor: 1000 }
        ] });
        const [validMenu, invalidMenu] = await Promise.all([
            prisma.menuItem.create({ data: { companyId, branchId, categoryId, name: `Valid menu ${suffix}`, price: 10, type: 'PREPARED', recipes: { create: { productId: validProductId, quantity: 0.25, unit: 'kg' } } } }),
            prisma.menuItem.create({ data: { companyId, branchId, categoryId, name: `Invalid menu ${suffix}`, price: 10, type: 'PREPARED', recipes: { create: { productId: invalidProductId, quantity: 1, unit: 'l' } } } })
        ]);
        validMenuId = validMenu.id; invalidMenuId = invalidMenu.id;
        paymentMethodId = (await prisma.paymentMethod.create({ data: {
            companyId, name: `CU payment ${suffix}`, type: 'OTHER'
        } })).id;
        cashPaymentMethodId = (await prisma.paymentMethod.create({ data: {
            companyId, name: `CU cash ${suffix}`, type: 'CASH'
        } })).id;
        cashRegisterId = (await prisma.cashRegister.create({ data: {
            companyId, branchId, name: `CU register ${suffix}`
        } })).id;
        await prisma.$transaction(async (tx) => {
            for (const productId of [validProductId, invalidProductId]) {
                await InventoryEngineService.applyMovement(tx, { type: 'IN', companyId, warehouseId, productId, userId, quantity: 2000, unitCost: 0.5, sourceType: 'OPENING', reference: `CU-OPEN-${productId}` });
            }
        });
    });

    afterAll(async () => {
        if (!companyId) return;
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashCount.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.cashRegister.deleteMany({ where: { companyId } });
        await prisma.cateringPayment.deleteMany({ where: { event: { companyId } } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.cateringMenuItem.deleteMany({ where: { event: { companyId } } });
        await prisma.cateringEvent.deleteMany({ where: { companyId } });
        await prisma.customer.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.recipe.deleteMany({ where: { menuItem: { companyId } } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.productUnit.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.unitOfMeasure.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.paymentMethod.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } }); await prisma.role.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } }); await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    const eventData = (menuItemId: number, status: 'QUOTED' | 'FINISHED') => ({
        branchId,
        customerName: `Cliente ${menuItemId}`,
        title: `Event ${menuItemId} ${status}`,
        date: new Date(Date.now() + 86400000),
        peopleCount: 4, status, menuItems: [{ menuItemId, quantity: 4, unitPrice: 10 }]
    });

    it('converts kg recipe to base grams and records exact FIFO COGS', async () => {
        const quoted = await CateringService.createEvent(companyId, userId, eventData(validMenuId, 'QUOTED'));
        // Payment lifecycle is covered separately; this test starts from its PAID precondition.
        await prisma.cateringEvent.update({ where: { id: quoted.id }, data: { status: 'PAID' } });
        const event = await CateringService.updateEvent(quoted.id, companyId, userId, { status: 'FINISHED', warehouseId });
        const [stock, movements, batches] = await Promise.all([
            prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId: validProductId } } }),
            prisma.inventoryMovement.findMany({ where: { companyId, reference: `EVT-${event.id}` } }),
            prisma.inventoryBatch.findMany({ where: { companyId, warehouseId, productId: validProductId, remainingQty: { gt: 0 } } })
        ]);
        // 0.25 kg/plate * 4 plates * 1000 g/kg = 1000 g; COGS=1000*.5=500.
        expect(Number(stock.quantity)).toBe(1000);
        expect(movements).toHaveLength(1);
        expect(Number(movements[0].quantity)).toBe(1000);
        expect(Number(movements[0].totalCost)).toBe(500);
        expect(batches.reduce((sum, b) => sum + Number(b.remainingQty), 0)).toBe(1000);
    });

    it('rolls back status, stock, layers, movements and balance on incompatible unit', async () => {
        const event = await CateringService.createEvent(companyId, userId, eventData(invalidMenuId, 'QUOTED'));
        await prisma.cateringEvent.update({ where: { id: event.id }, data: { status: 'PAID' } });
        const before = await Promise.all([
            prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId: invalidProductId } } }),
            prisma.inventoryBatch.findMany({ where: { companyId, warehouseId, productId: invalidProductId } }),
            prisma.inventoryMovement.count({ where: { companyId, productId: invalidProductId } }),
            prisma.cateringPayment.count({ where: { cateringEventId: event.id } })
        ]);
        await expect(CateringService.updateEvent(event.id, companyId, userId, { status: 'FINISHED', warehouseId })).rejects.toThrow(/no permitida|compatible/i);
        const [afterEvent, stock, batches, movementCount, paymentCount] = await Promise.all([
            prisma.cateringEvent.findUniqueOrThrow({ where: { id: event.id } }),
            prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId: invalidProductId } } }),
            prisma.inventoryBatch.findMany({ where: { companyId, warehouseId, productId: invalidProductId } }),
            prisma.inventoryMovement.count({ where: { companyId, productId: invalidProductId } }),
            prisma.cateringPayment.count({ where: { cateringEventId: event.id } })
        ]);
        expect(afterEvent.status).toBe('PAID');
        expect(Number(afterEvent.balance)).toBe(Number(event.balance));
        expect(Number(stock.quantity)).toBe(Number(before[0].quantity));
        expect(batches.map((b) => [b.id, Number(b.remainingQty)])).toEqual(before[1].map((b) => [b.id, Number(b.remainingQty)]));
        expect(movementCount).toBe(before[2]); expect(paymentCount).toBe(before[3]);
    });

    it('reverses a catering payment immutably and reopens the balance', async () => {
        const event = await CateringService.createEvent(companyId, userId, eventData(validMenuId, 'QUOTED'));
        await CateringService.updateEvent(event.id, companyId, userId, { status: 'RESERVED' });
        const payment = await CateringService.addPayment(event.id, companyId, userId, {
            amount: 40,
            paymentMethodId,
            reference: `CU-PAY-${event.id}`
        });
        expect((await prisma.cateringEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PAID');

        const reversed = await CateringService.reversePayment(
            event.id, payment.id, companyId, userId, 'Pago duplicado de prueba'
        );
        expect(reversed.status).toBe('REVERSED');
        const reopened = await prisma.cateringEvent.findUniqueOrThrow({ where: { id: event.id } });
        expect(reopened.status).toBe('RESERVED');
        expect(Number(reopened.balance)).toBe(40);
        expect(await prisma.cateringPayment.count({ where: { id: payment.id } })).toBe(1);

        const replay = await CateringService.reversePayment(
            event.id, payment.id, companyId, userId, 'Reintento idempotente'
        );
        expect(replay.id).toBe(payment.id);
        expect(await prisma.auditLog.count({ where: { companyId, entityType: 'CateringPayment', entityId: payment.id, action: 'REVERSE' } })).toBe(1);
    });

    it('posts catering cash to the actor branch shift and reverses in a new open shift exactly once', async () => {
        const event = await CateringService.createEvent(companyId, userId, eventData(validMenuId, 'QUOTED'));
        await CateringService.updateEvent(event.id, companyId, userId, { status: 'RESERVED' });

        await expect(CateringService.addPayment(event.id, companyId, userId, {
            amount: 40,
            paymentMethodId: cashPaymentMethodId,
            reference: `CU-CASH-${event.id}`
        })).rejects.toThrow(/turno de caja/i);

        const wrongBranch = await prisma.branch.create({ data: {
            companyId, name: `Wrong branch ${suffix}`, code: `CU-W-${suffix}`
        } });
        const wrongRegister = await prisma.cashRegister.create({ data: {
            companyId, branchId: wrongBranch.id, name: `Wrong register ${suffix}`
        } });
        const wrongShift = await prisma.cashShift.create({ data: {
            companyId, cashRegisterId: wrongRegister.id, userId, startAmount: 0
        } });
        await expect(CateringService.addPayment(event.id, companyId, userId, {
            amount: 40,
            paymentMethodId: cashPaymentMethodId,
            reference: `CU-CASH-${event.id}`
        })).rejects.toThrow(/sucursal del evento/i);
        await prisma.cashShift.update({ where: { id: wrongShift.id }, data: { endDate: new Date(), endAmount: 0, difference: 0 } });

        const collectionShift = await prisma.cashShift.create({ data: {
            companyId, cashRegisterId, userId, startAmount: 0
        } });
        const payment = await CateringService.addPayment(event.id, companyId, userId, {
            amount: 40,
            paymentMethodId: cashPaymentMethodId,
            reference: `CU-CASH-${event.id}`
        });
        const paymentReplay = await CateringService.addPayment(event.id, companyId, userId, {
            amount: 40,
            paymentMethodId: cashPaymentMethodId,
            reference: `CU-CASH-${event.id}`
        });
        expect(paymentReplay.id).toBe(payment.id);
        expect(await prisma.cateringPayment.count({ where: { cateringEventId: event.id } })).toBe(1);
        expect(await prisma.cashMovement.findMany({ where: { reference: `CAT-PAY-${payment.id}` } }))
            .toEqual([expect.objectContaining({ shiftId: collectionShift.id, type: 'IN', amount: expect.anything() })]);
        expect(await prisma.cashMovement.count({ where: { reference: `CAT-PAY-${payment.id}` } })).toBe(1);

        await prisma.cashShift.update({
            where: { id: collectionShift.id },
            data: { endDate: new Date(), endAmount: 40, difference: 0 }
        });
        const refundShift = await prisma.cashShift.create({ data: {
            companyId, cashRegisterId, userId, startAmount: 40
        } });
        const reversed = await CateringService.reversePayment(
            event.id, payment.id, companyId, userId, 'Reembolso en efectivo de prueba'
        );
        expect(reversed.status).toBe('REVERSED');
        expect(await prisma.cashMovement.findMany({ where: { reference: `REV-CAT-PAY-${payment.id}` } }))
            .toEqual([expect.objectContaining({ shiftId: refundShift.id, type: 'OUT', amount: expect.anything() })]);

        await CateringService.reversePayment(event.id, payment.id, companyId, userId, 'Replay idempotente');
        expect(await prisma.cashMovement.count({ where: { reference: `REV-CAT-PAY-${payment.id}` } })).toBe(1);
        expect((await prisma.cashShift.findUniqueOrThrow({ where: { id: collectionShift.id } })).endDate).not.toBeNull();

        const compensation = await prisma.cashMovement.findFirstOrThrow({
            where: { reference: `REV-CAT-PAY-${payment.id}` }
        });
        await prisma.cashMovement.delete({ where: { id: compensation.id } });
        await expect(CateringService.reversePayment(
            event.id, payment.id, companyId, userId, 'Replay sobre histórico incompleto'
        )).rejects.toThrow(/REV-CAT-PAY.*remediación/i);
    });
});
