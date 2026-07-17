import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { SettingService } from '../../services/setting.service';

/**
 * Real MySQL integration flow (no service/database mocks).
 * Requires .env.test with a DATABASE_URL whose database name contains `_test`.
 */
describe('POS operational flow', () => {
    const companyId = 990;
    const branchId = 990;
    const username = 'pos_flow_admin';
    const requiredPermissionNames = [
        'orders.view',
        'orders.create',
        'orders.edit',
        'orders.cancel',
        'orders.deliver',
        'kds.manage',
        'invoices.issue',
        'invoices.view',
        'payments.process',
        'payments.reverse',
        'bills.split'
    ] as const;
    let token: string;
    let userId: number;
    let tableId: number;
    let menuItemId: number;
    let directMenuItemId: number;
    let ingredientProductId: number;
    let paymentMethodId: number;
    let registerId: number;
    let shiftId: number;
    let warehouseId: number;
    let paidOrderId: number;
    let cancelledOrderId: number;
    let splitOrderId: number;
    let reservationId: number;

    beforeAll(async () => {
        await prisma.company.upsert({
            where: { id: companyId },
            update: { active: true },
            create: { id: companyId, name: 'POS Flow Integration', active: true }
        });
        const requiredPermissions = await Promise.all(requiredPermissionNames.map((name) =>
            prisma.permission.upsert({
                where: { name },
                update: {},
                create: { name, description: `POS integration ${name}` }
            })
        ));
        const role = await prisma.role.upsert({
            where: { companyId_name: { companyId, name: 'ADMIN' } },
            update: {
                description: 'POS integration administrator',
                permissions: { set: requiredPermissions.map(({ id }) => ({ id })) }
            },
            create: {
                companyId,
                name: 'ADMIN',
                description: 'POS integration administrator',
                permissions: { connect: requiredPermissions.map(({ id }) => ({ id })) }
            }
        });
        await prisma.branch.upsert({
            where: { id: branchId },
            update: { companyId, code: 'POS-IT', name: 'POS Flow Branch' },
            create: { id: branchId, companyId, code: 'POS-IT', name: 'POS Flow Branch' }
        });
        // Recover cleanly when a previous interrupted integration run left this
        // isolated tenant behind (notifications now restrict order/user deletes).
        await prisma.kitchenNotification.deleteMany({ where: { companyId } });
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.payment.deleteMany({ where: { order: { companyId } } });
        await prisma.orderItemModifier.deleteMany({ where: { orderItem: { order: { companyId } } } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.reservation.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        const staleUsers = await prisma.user.findMany({ where: { username }, select: { id: true } });
        if (staleUsers.length) {
            await prisma.auditLog.deleteMany({ where: { userId: { in: staleUsers.map((user) => user.id) } } });
            await prisma.user.deleteMany({ where: { id: { in: staleUsers.map((user) => user.id) } } });
        }
        const user = await prisma.user.create({
            data: {
                companyId, branchId, roleId: role.id, name: 'POS Flow Admin',
                email: 'pos_flow_admin@example.com', username,
                password: await bcrypt.hash('PosFlow123!', 10), status: 'ACTIVE',
                mustChangePassword: false, passwordChangedAt: new Date()
            }
        });
        userId = user.id;
        const category = await prisma.category.upsert({
            where: { companyId_name: { companyId, name: 'POS Integration Menu' } },
            update: {},
            create: { companyId, name: 'POS Integration Menu' }
        });
        const ingredient = await prisma.product.create({
            data: {
                companyId,
                categoryId: category.id,
                name: 'Integration Ingredient',
                sku: 'POS-IT-INGREDIENT',
                unit: 'unit',
                type: 'INGREDIENT',
                cost: 5,
                currentAverageCost: 5
            }
        });
        ingredientProductId = ingredient.id;
        const menuItem = await prisma.menuItem.create({
            data: {
                companyId,
                branchId,
                categoryId: category.id,
                name: 'Integration Plate',
                price: 100,
                type: 'PREPARED',
                recipes: {
                    create: { productId: ingredientProductId, quantity: 1, unit: 'unit' }
                }
            }
        });
        menuItemId = menuItem.id;
        const directMenuItem = await prisma.menuItem.create({
            data: { companyId, branchId, categoryId: category.id, name: 'Integration Direct Item', price: 100, type: 'DIRECT' }
        });
        directMenuItemId = directMenuItem.id;
        const table = await prisma.table.upsert({
            where: { branchId_number: { branchId, number: 'IT-1' } },
            update: { companyId, capacity: 4, status: 'AVAILABLE' },
            create: { companyId, branchId, number: 'IT-1', capacity: 4 }
        });
        tableId = table.id;
        const method = await prisma.paymentMethod.create({ data: { companyId, name: 'EFECTIVO', type: 'CASH' } });
        paymentMethodId = method.id;
        const register = await prisma.cashRegister.create({ data: { companyId, branchId, name: 'Integration Register' } });
        registerId = register.id;
        const warehouse = await prisma.warehouse.upsert({
            where: { companyId_code: { companyId, code: 'POS-IT-WH' } },
            update: { branchId, name: 'Integration Warehouse' },
            create: { companyId, branchId, name: 'Integration Warehouse', code: 'POS-IT-WH' }
        });
        warehouseId = warehouse.id;
        await prisma.stock.create({
            data: { companyId, warehouseId, productId: ingredientProductId, quantity: 10 }
        });
        await prisma.promotion.deleteMany({ where: { companyId } });
        await prisma.promotion.create({
            data: { companyId, code: 'POS10', name: 'POS integration 10%', type: 'PERCENTAGE', value: 10, usageLimit: 1 }
        });

        const login = await request(app).post('/api/auth/login').send({ username, password: 'PosFlow123!' });
        expect(login.status).toBe(200);
        token = login.body.data.token;
    });

    afterAll(async () => {
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.kitchenNotification.deleteMany({ where: { companyId } });
        await prisma.payment.deleteMany({ where: { order: { companyId } } });
        await prisma.orderItemModifier.deleteMany({ where: { orderItem: { order: { companyId } } } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.reservation.deleteMany({ where: { companyId } });
        await prisma.promotion.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.table.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.cashRegister.deleteMany({ where: { companyId } });
        await prisma.paymentMethod.deleteMany({ where: { companyId } });
        await prisma.invoiceSequence.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.setting.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { id: userId } });
        await prisma.role.deleteMany({ where: { companyId, name: 'ADMIN' } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it('keeps a prepaid prepared order operational through KDS until paid delivery', async () => {
        const opened = await request(app).post('/api/cash-shifts/open').set('Authorization', `Bearer ${token}`)
            .send({ cashRegisterId: registerId, startAmount: 50 });
        expect(opened.status).toBe(201);
        shiftId = opened.body.data.id;

        const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
            .send({ branchId, tableId, orderType: 'DINE_IN' });
        expect(created.status).toBe(201);
        paidOrderId = created.body.data.id;
        expect((await prisma.table.findUnique({ where: { id: tableId } }))?.status).toBe('OCCUPIED');

        const added = await request(app).post(`/api/orders/${paidOrderId}/items`).set('Authorization', `Bearer ${token}`)
            .send({ menuItemId, quantity: 1 });
        expect(added.status).toBe(201);
        const itemId = added.body.data.id as number;

        const promo = await request(app).post('/api/promotions/validate').set('Authorization', `Bearer ${token}`)
            .send({ code: 'POS10', orderTotal: 100 });
        expect(promo.status).toBe(200);
        expect(promo.body.data.discount).toBe(10);

        const priced = await request(app).patch(`/api/orders/${paidOrderId}/pricing`).set('Authorization', `Bearer ${token}`)
            .send({ discount: 99, discountCode: 'pos10' });
        expect(priced.status).toBe(200);
        expect(Number(priced.body.data.discount)).toBe(10);
        expect(priced.body.data.discountCode).toBe('POS10');
        expect(Number(priced.body.data.tax)).toBe(13.5);
        expect(Number(priced.body.data.total)).toBe(103.5);

        const issuedInvoice = await request(app).post(`/api/invoices/${paidOrderId}/issue`).set('Authorization', `Bearer ${token}`);
        expect(issuedInvoice.status).toBe(201);
        expect(issuedInvoice.body.data.invoiceNumber).toMatch(/^FAC-/);

        const paid = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`)
            .send({ orderId: paidOrderId, paymentMethodId, amount: 103.5 });
        expect(paid.status).toBe(201);
        expect(await prisma.order.findUnique({ where: { id: paidOrderId } })).toEqual(expect.objectContaining({
            status: 'OPEN',
            financialStatus: 'PAID'
        }));
        expect((await prisma.table.findUnique({ where: { id: tableId } }))?.status).toBe('OCCUPIED');
        const activeAfterPrepay = await request(app).get('/api/orders/active').set('Authorization', `Bearer ${token}`)
            .query({ branchId });
        expect(activeAfterPrepay.status).toBe(200);
        expect(activeAfterPrepay.body.data.map((order: { id: number }) => order.id)).toContain(paidOrderId);
        expect((await prisma.promotion.findFirst({ where: { companyId, code: 'POS10' } }))?.usageCount).toBe(1);
        expect(await prisma.cashMovement.count({ where: { shiftId, reference: `PAY-${paid.body.data.id}` } })).toBe(1);

        const invoice = await request(app).get(`/api/invoices/${paidOrderId}`).set('Authorization', `Bearer ${token}`);
        expect(invoice.status).toBe(200);
        expect(invoice.body.data.invoiceNumber).toMatch(/^FAC-/);

        await request(app).post(`/api/orders/${paidOrderId}/send-to-kitchen`).set('Authorization', `Bearer ${token}`).expect(200);
        await request(app).patch(`/api/orders/${paidOrderId}/items/${itemId}/start`).set('Authorization', `Bearer ${token}`).expect(200);
        await request(app).patch(`/api/orders/${paidOrderId}/items/${itemId}/finish`).set('Authorization', `Bearer ${token}`).expect(200);
        expect(await prisma.order.findUnique({ where: { id: paidOrderId } })).toEqual(expect.objectContaining({
            status: 'READY',
            financialStatus: 'PAID'
        }));
        expect((await prisma.table.findUnique({ where: { id: tableId } }))?.status).toBe('OCCUPIED');

        await request(app).post(`/api/orders/${paidOrderId}/complete`).set('Authorization', `Bearer ${token}`)
            .send({ warehouseId }).expect(200);
        expect(await prisma.order.findUnique({ where: { id: paidOrderId } })).toEqual(expect.objectContaining({
            status: 'DELIVERED',
            financialStatus: 'PAID'
        }));
        expect((await prisma.table.findUnique({ where: { id: tableId } }))?.status).toBe('AVAILABLE');
    });

    it('cancels an occupied table order without leaving an orphan state', async () => {
        const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
            .send({ branchId, tableId, orderType: 'DINE_IN' });
        cancelledOrderId = created.body.data.id;
        const cancelled = await request(app).post(`/api/orders/${cancelledOrderId}/cancel`).set('Authorization', `Bearer ${token}`)
            .send({ reason: 'integration reversal' });
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.status).toBe('CANCELLED');
        expect((await prisma.table.findUnique({ where: { id: tableId } }))?.status).toBe('AVAILABLE');
    });

    it('moves an order through the kitchen line item flow and cancels it safely', async () => {
        const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
            .send({ branchId, tableId, orderType: 'DINE_IN' });
        expect(created.status).toBe(201);
        const orderId = created.body.data.id;
        const added = await request(app).post(`/api/orders/${orderId}/items`).set('Authorization', `Bearer ${token}`)
            .send({ menuItemId, quantity: 1 });
        expect(added.status).toBe(201);
        const itemId = added.body.data.id;

        await request(app).post(`/api/orders/${orderId}/send-to-kitchen`).set('Authorization', `Bearer ${token}`).expect(200);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('SENT_TO_KITCHEN');
        await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
            .send({ status: 'READY' }).expect(400);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('SENT_TO_KITCHEN');
        await request(app).patch(`/api/orders/${orderId}/items/${itemId}/start`).set('Authorization', `Bearer ${token}`).expect(200);
        expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe('IN_PROGRESS');
        const finished = await request(app).patch(`/api/orders/${orderId}/items/${itemId}/finish`).set('Authorization', `Bearer ${token}`);
        expect(finished.status).toBe(200);
        expect(finished.body.data.allDone).toBe(true);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');

        await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
            .send({ status: 'DELIVERED' }).expect(400);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');
        expect((await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status).toBe('OCCUPIED');

        // Generic status writes must not bypass the cancellation counterflow.
        await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
            .send({ status: 'CANCELLED' }).expect(400);
        expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');
        expect((await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status).toBe('OCCUPIED');

        await request(app).post(`/api/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`)
            .send({ cancelReason: 'Kitchen certification rollback', warehouseId }).expect(200);
        expect((await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status).toBe('AVAILABLE');
    });

    it('supports charging a DIRECT item and reverses finance without corrupting operations', async () => {
        const invalidLegacyType = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
            .send({ branchId, orderType: 'TAKEAWAY' });
        expect(invalidLegacyType.status).toBe(400);

        const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
            .send({ branchId, orderType: 'TAKEOUT' });
        expect(created.status).toBe(201);
        expect(created.body.data.orderType).toBe('TAKEOUT');
        splitOrderId = created.body.data.id;
        await request(app).post(`/api/orders/${splitOrderId}/items`).set('Authorization', `Bearer ${token}`)
            .send({ menuItemId: directMenuItemId, quantity: 1 }).expect(201);
        const priced = await request(app).patch(`/api/orders/${splitOrderId}/pricing`).set('Authorization', `Bearer ${token}`)
            .send({ tax: 0.01, tipAmount: 0.02 });
        expect(Number(priced.body.data.tax)).toBe(15);
        expect(Number(priced.body.data.total)).toBe(115.02);

        const split = await request(app).post(`/api/split-bill/${splitOrderId}/evenly`).set('Authorization', `Bearer ${token}`)
            .send({ numberOfPeople: 3 });
        expect(split.status).toBe(200);
        expect(split.body.data.splits.map((entry: { amount: number }) => entry.amount)).toEqual([38.34, 38.34, 38.34]);
        expect(split.body.data.splits.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0)).toBeCloseTo(115.02, 2);

        await request(app).post(`/api/invoices/${splitOrderId}/issue`).set('Authorization', `Bearer ${token}`).expect(201);

        const first = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`)
            .send({ orderId: splitOrderId, paymentMethodId, amount: 40 });
        expect(first.status).toBe(201);
        expect(await prisma.order.findUnique({ where: { id: splitOrderId } })).toEqual(expect.objectContaining({
            status: 'OPEN', financialStatus: 'PARTIAL'
        }));
        const summary = await request(app).get(`/api/payments/order/${splitOrderId}/summary`).set('Authorization', `Bearer ${token}`);
        expect(summary.body.data.remaining).toBeCloseTo(75.02, 2);

        const second = await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`)
            .send({ orderId: splitOrderId, paymentMethodId, amount: 75.02 });
        expect(second.status).toBe(201);
        expect(await prisma.order.findUnique({ where: { id: splitOrderId } })).toEqual(expect.objectContaining({
            status: 'OPEN', financialStatus: 'PAID'
        }));

        await request(app).delete(`/api/payments/${second.body.data.id}`).set('Authorization', `Bearer ${token}`)
            .send({ reason: '   ' }).expect(400);
        const reversed = await request(app).delete(`/api/payments/${second.body.data.id}`).set('Authorization', `Bearer ${token}`)
            .send({ reason: 'Customer refund integration' });
        expect(reversed.status).toBe(200);
        expect(await prisma.order.findUnique({ where: { id: splitOrderId } })).toEqual(expect.objectContaining({
            status: 'OPEN', financialStatus: 'PARTIAL'
        }));
        expect(await prisma.cashMovement.count({ where: { reference: `PAY-${second.body.data.id}`, type: 'IN' } })).toBe(1);
        expect(await prisma.cashMovement.count({ where: { reference: `REV-PAY-${second.body.data.id}`, type: 'OUT' } })).toBe(1);
        expect((await prisma.payment.findUnique({ where: { id: second.body.data.id } }))?.status).toBe('REVERSED');
        expect((await prisma.payment.findUnique({ where: { id: second.body.data.id } }))?.reversalReason).toBe('Customer refund integration');

        const rejectedCancellation = await request(app).post(`/api/orders/${splitOrderId}/cancel`).set('Authorization', `Bearer ${token}`)
            .send({ cancelReason: 'partial payment reversal integration' });
        expect(rejectedCancellation.status).toBe(400);
        expect(rejectedCancellation.body.message).toContain('nota de cr');
        await request(app).delete(`/api/payments/${first.body.data.id}`).set('Authorization', `Bearer ${token}`)
            .send({ reason: 'Refund remaining partial payment' }).expect(200);
        const cancelled = await request(app).post(`/api/orders/${splitOrderId}/cancel`).set('Authorization', `Bearer ${token}`)
            .send({ cancelReason: 'partial payment reversal integration' });
        expect(cancelled.status).toBe(400);
        expect(cancelled.body.message).toContain('nota de cr');
        expect((await prisma.order.findUniqueOrThrow({ where: { id: splitOrderId } })).invoiceNumber).toMatch(/^FAC-/);
    });

    it('creates and cancels a real reservation scoped to its branch', async () => {
        const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const created = await request(app).post('/api/reservations').set('Authorization', `Bearer ${token}`)
            .send({ branchId, customerName: 'Reservation Flow', peopleCount: 2, date });
        expect(created.status).toBe(201);
        reservationId = created.body.data.id;
        expect(created.body.data.table.id).toBe(tableId);
        expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.tableId).toBe(tableId);
        const conflict = await request(app).post('/api/reservations').set('Authorization', `Bearer ${token}`)
            .send({ branchId, customerName: 'Conflicting Reservation', peopleCount: 2, date });
        expect(conflict.status).toBe(400);
        expect(await prisma.reservation.count({ where: { companyId, branchId, date: new Date(date) } })).toBe(1);
        const cancelled = await request(app).patch(`/api/reservations/${reservationId}/status`).set('Authorization', `Bearer ${token}`)
            .send({ status: 'CANCELLED' });
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data.status).toBe('CANCELLED');
    });

    it('atomically enforces a promotion limit across concurrent order payments', async () => {
        const racePromotion = await prisma.promotion.create({
            data: { companyId, code: 'RACE1', name: 'Single concurrent use', type: 'FIXED_AMOUNT', value: 1, usageLimit: 1 }
        });
        const normalized = await request(app).put(`/api/promotions/${racePromotion.id}`).set('Authorization', `Bearer ${token}`)
            .send({ code: 'race1' });
        expect(normalized.status).toBe(200);
        expect(normalized.body.data.code).toBe('RACE1');
        const orderIds: number[] = [];
        for (let index = 0; index < 2; index += 1) {
            const created = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`)
                .send({ branchId, orderType: 'TAKEOUT' });
            const orderId = created.body.data.id as number;
            orderIds.push(orderId);
            await request(app).post(`/api/orders/${orderId}/items`).set('Authorization', `Bearer ${token}`)
                .send({ menuItemId, quantity: 1 }).expect(201);
            await request(app).patch(`/api/orders/${orderId}/pricing`).set('Authorization', `Bearer ${token}`)
                .send({ discount: 1, discountCode: 'RACE1' }).expect(200);
            await request(app).post(`/api/invoices/${orderId}/issue`).set('Authorization', `Bearer ${token}`).expect(201);
        }

        const attempts = await Promise.all(orderIds.map((orderId) =>
            request(app).post('/api/payments').set('Authorization', `Bearer ${token}`)
                .send({ orderId, paymentMethodId, amount: 113.85 })
        ));
        expect(attempts.map((response) => response.status).sort()).toEqual([201, 400]);
        expect((await prisma.promotion.findFirst({ where: { companyId, code: 'RACE1' } }))?.usageCount).toBe(1);
        expect(await prisma.payment.count({ where: { orderId: { in: orderIds } } })).toBe(1);

        const successfulPaymentId = attempts.find((response) => response.status === 201)!.body.data.id as number;
        await request(app).delete(`/api/payments/${successfulPaymentId}`).set('Authorization', `Bearer ${token}`)
            .send({ reason: 'Promotion concurrency cleanup' }).expect(200);
        expect((await prisma.promotion.findFirst({ where: { companyId, code: 'RACE1' } }))?.usageCount).toBe(0);
        for (const orderId of orderIds) {
            await request(app).post(`/api/orders/${orderId}/cancel`).set('Authorization', `Bearer ${token}`)
                .send({ cancelReason: 'invoiced concurrency fixture' }).expect(400);
        }
    });

    it('closes the cash shift with an auditable expected balance', async () => {
        const otherCompany = await prisma.company.create({ data: { name: 'Tolerance Isolation', active: true } });
        await SettingService.update(companyId, { cash_reconciliation_tolerance: '0.25' });
        await SettingService.update(otherCompany.id, { cash_reconciliation_tolerance: '2.50' });
        expect(await SettingService.getCashReconciliationTolerance(companyId)).toBe(0.25);
        expect(await SettingService.getCashReconciliationTolerance(otherCompany.id)).toBe(2.5);
        await prisma.setting.deleteMany({ where: { companyId: otherCompany.id } });
        await prisma.company.delete({ where: { id: otherCompany.id } });
        // Operational delivery must not make a financially collected payment disappear
        // from reconciliation; financialStatus/payment.createdAt are authoritative.
        const deliveredInvoice = await request(app).get(`/api/invoices/${paidOrderId}`).set('Authorization', `Bearer ${token}`);
        expect(deliveredInvoice.status).toBe(200);
        expect(deliveredInvoice.body.data.invoiceNumber).toMatch(/^FAC-/);
        const summary = await request(app).get(`/api/cash-shifts/${shiftId}/summary`).set('Authorization', `Bearer ${token}`);
        expect(summary.status).toBe(200);
        const expectedBalance = Number(summary.body.data.summary.expectedBalance);
        const closed = await request(app).post(`/api/cash-shifts/${shiftId}/close`).set('Authorization', `Bearer ${token}`)
            .send({ closingBalance: expectedBalance, notes: 'integration close' });
        expect(closed.status).toBe(200);
        expect(Number(closed.body.data.difference)).toBe(0);
        expect(closed.body.data.endDate).toBeTruthy();
        const reconciliation = await BankReconciliationService.getReconciliationStatus(
            companyId,
            new Date(Date.now() - 60 * 60 * 1000),
            new Date(Date.now() + 60 * 60 * 1000)
        );
        expect(reconciliation.totals.totalSales).toBe(103.5);
        expect(reconciliation.totals.byMethod.cash).toBe(103.5);
        expect(reconciliation.reconciliation.cashExpected).toBe(153.5);
        expect(reconciliation.reconciliation.cashActual).toBe(153.5);
    });
});
