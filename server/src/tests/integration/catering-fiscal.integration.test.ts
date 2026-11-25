import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';
import { CateringService } from '../../services/catering.service';
import { CateringFiscalService } from '../../services/catering-fiscal.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';

describe('Catering fiscal document and full counterflow (integration)', () => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    let companyId = 0;
    let branchId = 0;
    let userId = 0;
    let menuItemId = 0;
    let productId = 0;
    let warehouseId = 0;
    let paymentMethodId = 0;
    let cashPaymentMethodId = 0;
    let cashRegisterId = 0;

    beforeAll(async () => {
        const company = await prisma.company.create({ data: {
            name: `Catering fiscal ${suffix}`,
            ruc: `${Date.now()}`.slice(-13).padStart(14, '1'),
            costingMethod: 'FIFO'
        } });
        companyId = company.id;
        const branch = await prisma.branch.create({ data: { companyId, name: `Fiscal branch ${suffix}`, code: `CF-${suffix}` } });
        branchId = branch.id;
        const role = await prisma.role.create({ data: { companyId, name: `CF_ROLE_${suffix}` } });
        const user = await prisma.user.create({ data: {
            companyId,
            branchId,
            roleId: role.id,
            name: 'Catering Fiscal',
            email: `catering-fiscal-${suffix}@test.local`,
            username: `cf_${suffix}`,
            password: 'test',
            mustChangePassword: false,
            status: 'ACTIVE'
        } });
        userId = user.id;
        const category = await prisma.category.create({ data: {
            companyId,
            name: `CF category ${suffix}`,
            codePrefix: `CF${companyId}`,
            showInMenu: true,
            showInInventory: true
        } });
        const product = await prisma.product.create({ data: {
            companyId,
            categoryId: category.id,
            name: `CF ingredient ${suffix}`,
            sku: `CF-P-${suffix}`,
            unit: 'unit',
            cost: 3,
            currentAverageCost: 3
        } });
        productId = product.id;
        const menuItem = await prisma.menuItem.create({ data: {
            companyId,
            branchId,
            categoryId: category.id,
            name: `CF prepared ${suffix}`,
            price: 100,
            type: 'PREPARED',
            recipes: { create: { productId, quantity: 2, unit: 'unit' } }
        } });
        menuItemId = menuItem.id;
        warehouseId = (await prisma.warehouse.create({ data: {
            companyId,
            branchId,
            name: `CF warehouse ${suffix}`,
            code: `CFW-${suffix}`
        } })).id;
        paymentMethodId = (await prisma.paymentMethod.create({ data: {
            companyId,
            name: `CF transfer ${suffix}`,
            type: 'BANK_TRANSFER'
        } })).id;
        cashPaymentMethodId = (await prisma.paymentMethod.create({ data: {
            companyId,
            name: `CF cash ${suffix}`,
            type: 'CASH'
        } })).id;
        cashRegisterId = (await prisma.cashRegister.create({ data: {
            companyId,
            branchId,
            name: `CF register ${suffix}`
        } })).id;
        await prisma.setting.createMany({ data: [
            { companyId, name: `${companyId}_fiscal_jurisdiction`, value: 'NI' },
            { companyId, name: `${companyId}_credit_note_series`, value: `CNC${companyId}` },
            { companyId, name: `${companyId}_tax_rate`, value: '15' },
            { companyId, name: `${companyId}_currency_symbol`, value: 'C$' },
            { companyId, name: `${companyId}_fiscal_tax_id_length`, value: '14' },
            { companyId, name: `${companyId}_fiscal_tax_id_charset`, value: 'DIGITS' }
        ] });
        await prisma.$transaction((tx) => InventoryEngineService.applyMovement(tx, {
            type: 'IN',
            companyId,
            warehouseId,
            productId,
            userId,
            quantity: 20,
            unitCost: 3,
            sourceType: 'OPENING',
            reference: `CF-OPEN-${suffix}`
        }));
    });

    afterAll(async () => {
        if (!companyId) return;
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashCount.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.cashRegister.deleteMany({ where: { companyId } });
        await prisma.cateringFiscalCreditNote.deleteMany({ where: { companyId } });
        await prisma.cateringFiscalInvoice.deleteMany({ where: { companyId } });
        await prisma.cateringPayment.deleteMany({ where: { event: { companyId } } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.cateringMenuItem.deleteMany({ where: { event: { companyId } } });
        await prisma.cateringEvent.deleteMany({ where: { companyId } });
        await prisma.customer.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId, reversalOfId: { not: null } } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.recipe.deleteMany({ where: { menuItem: { companyId } } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.paymentMethod.deleteMany({ where: { companyId } });
        await prisma.invoiceSequence.deleteMany({ where: { companyId } });
        await prisma.creditNoteSequence.deleteMany({ where: { companyId } });
        await prisma.setting.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.branch.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    async function createPaidEvent(label: string) {
        const event = await CateringService.createEvent(companyId, userId, {
            branchId,
            customerName: `Cliente ${label}`,
            title: `Evento ${label}`,
            date: new Date(Date.now() + 86_400_000),
            peopleCount: 10,
            menuItems: [{ menuItemId, quantity: 1, unitPrice: 100 }]
        });
        await CateringService.updateEvent(event.id, companyId, userId, { status: 'RESERVED' });
        const payment = await CateringService.addPayment(event.id, companyId, userId, {
            amount: 100,
            paymentMethodId,
            reference: `CF-PAY-${event.id}`
        });
        return { event, payment };
    }

    it('freezes an immutable idempotent invoice and fully credits payment without repricing', async () => {
        const { event, payment } = await createPaidEvent('invoice');
        const invoiceKey = `cf-invoice-${event.id}`;
        const invoice = await CateringFiscalService.issueInvoice(event.id, companyId, userId, invoiceKey);
        expect(await CateringFiscalService.issueInvoice(event.id, companyId, userId, invoiceKey)).toEqual(invoice);
        expect(invoice).toEqual(expect.objectContaining({ subtotal: 86.96, tax: 13.04, total: 100, taxRatePercent: 15 }));
        expect(await prisma.cateringFiscalInvoice.count({ where: { cateringEventId: event.id } })).toBe(1);

        // Mutable catalog and tax settings must not alter the emitted snapshot.
        await prisma.menuItem.update({ where: { id: menuItemId }, data: { name: 'RENAMED AFTER INVOICE', price: 999 } });
        await prisma.setting.update({ where: { companyId_name: { companyId, name: `${companyId}_tax_rate` } }, data: { value: '30' } });
        expect(await CateringFiscalService.getInvoice(event.id, companyId)).toEqual(invoice);
        await expect(CateringService.reversePayment(
            event.id,
            payment.id,
            companyId,
            userId,
            'Intento fuera del contraflujo fiscal'
        )).rejects.toThrow(/nota de crédito total/i);

        const creditInput = {
            idempotencyKey: `cf-credit-${event.id}`,
            reason: 'Cancelacion total autorizada',
            inventoryAction: 'NO_RETURN',
            externalRefunds: [{ paymentId: payment.id, reference: `BANK-REF-${payment.id}` }]
        };
        const credit = await CateringFiscalService.issueFullCreditNote(event.id, companyId, userId, creditInput);
        expect(await CateringFiscalService.issueFullCreditNote(event.id, companyId, userId, creditInput)).toEqual(credit);
        expect(credit.inventoryDisposition).toBe('NOT_CONSUMED');
        expect(credit.refunds).toEqual([expect.objectContaining({ paymentId: payment.id, amount: 100 })]);
        const [persistedEvent, persistedPayment, persistedInvoice] = await Promise.all([
            prisma.cateringEvent.findUniqueOrThrow({ where: { id: event.id } }),
            prisma.cateringPayment.findUniqueOrThrow({ where: { id: payment.id } }),
            prisma.cateringFiscalInvoice.findUniqueOrThrow({ where: { cateringEventId: event.id } })
        ]);
        expect(persistedEvent.status).toBe('CANCELLED');
        expect(Number(persistedEvent.balance)).toBe(100);
        expect(persistedPayment.status).toBe('REVERSED');
        expect(persistedInvoice.status).toBe('CREDITED');
    });

    it('restores exact EVT FIFO quantity and cost for a full physical return', async () => {
        // Restore the quote-visible master data; fiscal issuance still reads the
        // event snapshot captured when this event is created.
        await prisma.menuItem.update({ where: { id: menuItemId }, data: { name: `CF prepared ${suffix}`, price: 100 } });
        await prisma.setting.update({ where: { companyId_name: { companyId, name: `${companyId}_tax_rate` } }, data: { value: '15' } });
        const { event, payment } = await createPaidEvent('finished');
        const stockBefore = await prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });
        await CateringService.updateEvent(event.id, companyId, userId, { status: 'FINISHED', warehouseId });
        const out = await prisma.inventoryMovement.findFirstOrThrow({ where: { companyId, reference: `EVT-${event.id}`, type: 'OUT' } });
        await CateringFiscalService.issueInvoice(event.id, companyId, userId, `cf-finished-invoice-${event.id}`);
        const credit = await CateringFiscalService.issueFullCreditNote(event.id, companyId, userId, {
            idempotencyKey: `cf-finished-credit-${event.id}`,
            reason: 'Devolucion total con retorno fisico',
            inventoryAction: 'RETURN_TO_STOCK',
            externalRefunds: [{ paymentId: payment.id, reference: `BANK-FIN-${payment.id}` }]
        });
        expect(credit.inventoryDisposition).toBe('RETURNED_TO_ORIGINAL_STOCK');
        const [stockAfter, inbound] = await Promise.all([
            prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } }),
            prisma.inventoryMovement.findFirstOrThrow({ where: { reference: `CAT-NC-${credit.creditNoteNumber}-MOV-${out.id}`, direction: 'IN', origin: 'REVERSAL' } })
        ]);
        expect(Number(stockAfter.quantity)).toBe(Number(stockBefore.quantity));
        expect(Number(inbound.quantity)).toBe(Number(out.quantity));
        expect(Number(inbound.totalCost)).toBe(Number(out.totalCost));
    });

    it('posts a cash credit-note refund in the actor shift and nets the catering sale to zero', async () => {
        const event = await CateringService.createEvent(companyId, userId, {
            branchId,
            customerName: 'Cliente efectivo',
            title: 'Evento efectivo',
            date: new Date(Date.now() + 86_400_000),
            peopleCount: 5,
            menuItems: [{ menuItemId, quantity: 1, unitPrice: 100 }]
        });
        await CateringService.updateEvent(event.id, companyId, userId, { status: 'RESERVED' });
        const shift = await prisma.cashShift.create({ data: {
            companyId,
            cashRegisterId,
            userId,
            startAmount: 100
        } });
        const payment = await CateringService.addPayment(event.id, companyId, userId, {
            amount: 100,
            paymentMethodId: cashPaymentMethodId,
            reference: `CF-CASH-${event.id}`
        });
        await CateringFiscalService.issueInvoice(event.id, companyId, userId, `cf-cash-invoice-${event.id}`);
        const credit = await CateringFiscalService.issueFullCreditNote(event.id, companyId, userId, {
            idempotencyKey: `cf-cash-credit-${event.id}`,
            reason: 'Devolucion total en efectivo',
            inventoryAction: 'NO_RETURN',
            externalRefunds: []
        });
        expect(credit.refunds).toEqual([expect.objectContaining({ paymentId: payment.id, methodType: 'CASH', amount: 100 })]);
        const movements = await prisma.cashMovement.findMany({
            where: { shiftId: shift.id, reference: { in: [`CAT-PAY-${payment.id}`, `REV-CAT-PAY-${payment.id}`] } },
            orderBy: { id: 'asc' }
        });
        expect(movements.map((movement) => [movement.type, Number(movement.amount)])).toEqual([['IN', 100], ['OUT', 100]]);
        expect(movements.reduce((sum, movement) => sum + (movement.type === 'IN' ? 1 : -1) * Number(movement.amount), 0)).toBe(0);
    });
});
