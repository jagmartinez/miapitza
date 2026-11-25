import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../app';
import { BankReconciliationService } from '../../services/bank-reconciliation.service';
import { PaymentService } from '../../services/payment.service';
import { InventoryEngineService } from '../../services/inventory-engine.service';
import prisma from '../../utils/prisma';

describe('Fiscal cancellation and credit-note counterflow', () => {
    const companyId = 986;
    const branchId = 986;
    const username = 'fiscal_counterflow_admin';
    let token: string;
    let userId: number;
    let roleId: number;
    let categoryId: number;
    let menuItemId: number;
    let paymentMethodId: number;
    let registerId: number;
    let shiftId: number;
    let warehouseId: number;
    let productId: number;

    beforeAll(async () => {
        await prisma.company.upsert({
            where: { id: companyId },
            update: { name: 'Fiscal Counterflow Integration', ruc: '12345678901234', active: true },
            create: { id: companyId, name: 'Fiscal Counterflow Integration', ruc: '12345678901234', active: true },
        });
        await prisma.branch.upsert({
            where: { id: branchId },
            update: { companyId, name: 'Fiscal Branch', code: 'FISCAL-IT' },
            create: { id: branchId, companyId, name: 'Fiscal Branch', code: 'FISCAL-IT' },
        });

        // Recover an isolated tenant left by an interrupted local run.
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.fiscalCreditNotePaymentRefund.deleteMany({ where: { fiscalCreditNote: { companyId } } });
        await prisma.fiscalCreditNoteLine.deleteMany({ where: { fiscalCreditNote: { companyId } } });
        await prisma.fiscalCreditNote.deleteMany({ where: { companyId } });
        await prisma.fiscalInvoiceCancellation.deleteMany({ where: { companyId } });
        await prisma.payment.deleteMany({ where: { order: { companyId } } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { companyId } });
        await prisma.role.deleteMany({ where: { companyId } });

        const permissionNames = ['invoices.issue', 'invoices.view', 'invoices.cancel', 'invoices.credit'];
        const permissions = await Promise.all(permissionNames.map((name) => prisma.permission.upsert({
            where: { name }, update: {}, create: { name, description: `Fiscal integration ${name}` },
        })));
        const role = await prisma.role.create({
            data: {
                companyId,
                name: 'ADMIN',
                description: 'Isolated fiscal integration role',
                permissions: { connect: permissions.map(({ id }) => ({ id })) },
            },
        });
        roleId = role.id;
        const user = await prisma.user.create({
            data: {
                companyId,
                branchId,
                roleId,
                name: 'Fiscal Administrator',
                email: 'fiscal-counterflow@example.com',
                username,
                password: await bcrypt.hash('FiscalFlow123!', 10),
                status: 'ACTIVE',
                mustChangePassword: false,
                passwordChangedAt: new Date(),
            },
        });
        userId = user.id;

        for (const [name, value] of Object.entries({
            fiscal_jurisdiction: 'NI',
            credit_note_series: 'NC',
            fiscal_tax_id_length: '14',
            fiscal_tax_id_charset: 'DIGITS',
            tax_rate: '15',
            currency_symbol: 'C$',
        })) {
            await prisma.setting.upsert({
                where: { companyId_name: { companyId, name: `${companyId}_${name}` } },
                update: { value },
                create: { companyId, name: `${companyId}_${name}`, value },
            });
        }

        const category = await prisma.category.upsert({
            where: { companyId_name: { companyId, name: 'Fiscal Integration' } },
            update: {},
            create: { companyId, name: 'Fiscal Integration' },
        });
        categoryId = category.id;
        const method = await prisma.paymentMethod.create({
            data: { companyId, name: 'Fiscal cash', type: 'CASH' },
        });
        paymentMethodId = method.id;
        const register = await prisma.cashRegister.create({
            data: { companyId, branchId, name: 'Fiscal register', status: 'OPEN' },
        });
        registerId = register.id;
        const shift = await prisma.cashShift.create({
            data: { companyId, cashRegisterId: registerId, userId, startAmount: 50 },
        });
        shiftId = shift.id;
        const warehouse = await prisma.warehouse.create({
            data: { companyId, branchId, name: 'Fiscal warehouse', code: 'FISCAL-IT-WH', type: 'BRANCH' },
        });
        warehouseId = warehouse.id;
        const product = await prisma.product.create({
            data: { companyId, categoryId, name: 'Fiscal stock evidence', sku: 'FISCAL-STOCK', unit: 'unit', cost: 10 },
        });
        productId = product.id;
        const menuItem = await prisma.menuItem.create({
            data: {
                companyId, branchId, categoryId, name: 'Fiscal integration item', price: 100, type: 'PREPARED',
                recipes: { create: { productId, quantity: 1, unit: 'unit' } }
            },
        });
        menuItemId = menuItem.id;

        const login = await request(app).post('/api/auth/login').send({ username, password: 'FiscalFlow123!' });
        expect(login.status).toBe(200);
        token = login.body.data.token;
    });

    afterAll(async () => {
        await prisma.cashMovement.deleteMany({ where: { shift: { companyId } } });
        await prisma.cashShift.deleteMany({ where: { companyId } });
        await prisma.fiscalCreditNotePaymentRefund.deleteMany({ where: { fiscalCreditNote: { companyId } } });
        await prisma.fiscalCreditNoteLine.deleteMany({ where: { fiscalCreditNote: { companyId } } });
        await prisma.fiscalCreditNote.deleteMany({ where: { companyId } });
        await prisma.fiscalInvoiceCancellation.deleteMany({ where: { companyId } });
        await prisma.payment.deleteMany({ where: { order: { companyId } } });
        await prisma.inventoryBatch.deleteMany({ where: { companyId } });
        await prisma.inventoryMovement.deleteMany({ where: { companyId } });
        await prisma.stock.deleteMany({ where: { companyId } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.creditNoteSequence.deleteMany({ where: { companyId } });
        await prisma.invoiceSequence.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.recipe.deleteMany({ where: { menuItem: { companyId } } });
        await prisma.menuItem.deleteMany({ where: { companyId } });
        await prisma.product.deleteMany({ where: { companyId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.warehouse.deleteMany({ where: { companyId } });
        await prisma.cashRegister.deleteMany({ where: { companyId } });
        await prisma.paymentMethod.deleteMany({ where: { companyId } });
        await prisma.setting.deleteMany({ where: { companyId } });
        await prisma.user.deleteMany({ where: { id: userId } });
        await prisma.role.deleteMany({ where: { id: roleId } });
        await prisma.branch.deleteMany({ where: { id: branchId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    const createOrder = async (quantity = 1) => {
        return prisma.order.create({
            data: {
                companyId,
                branchId,
                userId,
                orderType: 'TAKEOUT',
                status: 'OPEN',
                financialStatus: 'UNPAID',
                customerName: 'Cliente fiscal',
                customerTaxId: '00112233445566',
                customerTaxIdType: 'RUC',
                customerFiscalAddress: 'Managua',
                total: 115 * quantity,
                tax: 15 * quantity,
                items: { create: { menuItemId, quantity, price: 100, subtotal: 100 * quantity } },
            },
        });
    };

    it('annuls an unpaid pre-delivery invoice and preserves its original fiscal number idempotently', async () => {
        const order = await createOrder();

        const issued = await request(app).post(`/api/invoices/${order.id}/issue`)
            .set('Authorization', `Bearer ${token}`);
        expect(issued.status).toBe(201);
        expect(issued.body.data.customerRuc).toBe('00112233445566');
        const invoiceNumber = issued.body.data.invoiceNumber as string;

        const beforeRead = await request(app).get(`/api/invoices/${order.id}/cancellation`)
            .set('Authorization', `Bearer ${token}`);
        expect(beforeRead.status).toBe(409);
        expect(await prisma.fiscalInvoiceCancellation.count({ where: { orderId: order.id } })).toBe(0);

        const body = { idempotencyKey: `cancel-fiscal-${order.id}`, reason: 'Error detectado antes de entregar' };
        const cancelled = await request(app).post(`/api/invoices/${order.id}/cancel`)
            .set('Authorization', `Bearer ${token}`).send(body);
        expect(cancelled.status).toBe(201);
        expect(cancelled.body.data.originalInvoiceNumber).toBe(invoiceNumber);

        const retried = await request(app).post(`/api/invoices/${order.id}/cancel`)
            .set('Authorization', `Bearer ${token}`).send(body);
        expect(retried.status).toBe(201);
        expect(retried.body.data.cancelledAt).toBe(cancelled.body.data.cancelledAt);
        expect(await prisma.fiscalInvoiceCancellation.count({ where: { orderId: order.id } })).toBe(1);

        const persisted = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(persisted).toEqual(expect.objectContaining({
            status: 'CANCELLED',
            financialStatus: 'UNPAID',
            invoiceNumber,
            invoiceFiscalStatus: 'CANCELLED',
        }));
        const original = await request(app).get(`/api/invoices/${order.id}`)
            .set('Authorization', `Bearer ${token}`);
        expect(original.status).toBe(200);
        expect(original.body.data.invoiceNumber).toBe(invoiceNumber);
    });

    it('credits a delivered paid sale and reconciles cash plus exact stock return once', async () => {
        const order = await createOrder();
        const issued = await request(app).post(`/api/invoices/${order.id}/issue`)
            .set('Authorization', `Bearer ${token}`);
        expect(issued.status).toBe(201);

        const payment = await prisma.payment.create({
            data: {
                orderId: order.id,
                paymentMethodId,
                methodType: 'CASH',
                amount: 115,
                status: 'ACTIVE',
                registeredById: userId,
                idempotencyKey: `fiscal-payment-${order.id}`,
            },
        });
        await prisma.cashMovement.create({
            data: { shiftId, type: 'IN', amount: 115, description: `Pago orden #${order.id}`, reference: `PAY-${payment.id}` },
        });
        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'DELIVERED', financialStatus: 'PAID', deliveredAt: new Date(), closedAt: new Date() },
        });
        await prisma.$transaction(async (tx) => {
            await InventoryEngineService.applyMovement(tx, {
                type: 'IN', companyId, warehouseId, productId, userId,
                quantity: 10, unitCost: 10, sourceType: 'OPENING', reference: 'FISCAL-OPENING',
            });
            await InventoryEngineService.applyMovement(tx, {
                type: 'OUT', companyId, warehouseId, productId, userId,
                quantity: 1, reason: 'Consumo físico de venta', reference: `ORD-${order.id}`,
            });
        });
        expect(Number((await prisma.stock.findUniqueOrThrow({
            where: { warehouseId_productId: { warehouseId, productId } },
        })).quantity)).toBe(9);

        const body = {
            idempotencyKey: `credit-fiscal-${order.id}`,
            reason: 'Devolucion total confirmada por cliente',
            inventoryAction: 'RETURN_TO_STOCK',
            externalRefunds: [],
        };
        const credited = await request(app).post(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`).send(body);
        expect(credited.status).toBe(201);
        expect(credited.body.data.creditNoteNumber).toMatch(/^NC-\d{8}$/);
        expect(credited.body.data.inventoryDisposition).toBe('RETURNED_TO_ORIGINAL_STOCK');

        const retried = await request(app).post(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`).send(body);
        expect(retried.status).toBe(201);
        expect(retried.body.data.creditNoteNumber).toBe(credited.body.data.creditNoteNumber);

        expect(await prisma.fiscalCreditNote.count({ where: { orderId: order.id } })).toBe(1);
        const refundAllocation = await prisma.fiscalCreditNotePaymentRefund.findFirstOrThrow({
            where: { paymentId: payment.id },
        });
        expect(Number(refundAllocation.amount)).toBe(115);
        expect(await prisma.cashMovement.count({ where: { reference: refundAllocation.reference, type: 'OUT' } })).toBe(1);
        expect(await prisma.inventoryMovement.count({ where: { reference: `ORD-${order.id}`, type: 'IN' } })).toBe(1);
        expect(Number((await prisma.stock.findUniqueOrThrow({
            where: { warehouseId_productId: { warehouseId, productId } },
        })).quantity)).toBe(10);
        expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(expect.objectContaining({
            status: 'REVERSED',
        }));
        expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(expect.objectContaining({
            status: 'CANCELLED',
            financialStatus: 'UNPAID',
            invoiceFiscalStatus: 'CREDITED',
        }));

        const immutable = await request(app).get(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`);
        expect(immutable.status).toBe(200);
        expect(immutable.body.data.originalInvoiceNumber).toBe(issued.body.data.invoiceNumber);
    });

    it('issues two quantity-based partial notes without over-refunding money or stock and serializes retries', async () => {
        const order = await createOrder(2);
        const orderItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
        await request(app).post(`/api/invoices/${order.id}/issue`)
            .set('Authorization', `Bearer ${token}`).expect(201);

        const payment = await prisma.payment.create({
            data: {
                orderId: order.id, paymentMethodId, methodType: 'CASH', amount: 230,
                status: 'ACTIVE', registeredById: userId, idempotencyKey: `partial-payment-${order.id}`,
            },
        });
        await prisma.cashMovement.create({
            data: { shiftId, type: 'IN', amount: 230, description: `Pago orden #${order.id}`, reference: `PAY-${payment.id}` },
        });
        await prisma.order.update({
            where: { id: order.id },
            data: { status: 'DELIVERED', financialStatus: 'PAID', deliveredAt: new Date(), closedAt: new Date() },
        });
        await prisma.$transaction((tx) => InventoryEngineService.applyMovement(tx, {
            type: 'OUT', companyId, warehouseId, productId, userId,
            quantity: 2, reason: 'Consumo físico parcial', reference: `ORD-${order.id}`,
        }));

        const firstBody = {
            idempotencyKey: `partial-credit-a-${order.id}`,
            reason: 'Devolución parcial de una unidad',
            inventoryAction: 'RETURN_TO_STOCK',
            externalRefunds: [],
            lines: [{ orderItemId: orderItem.id, quantity: 1 }],
        };
        const first = await request(app).post(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`).send(firstBody);
        expect(first.status).toBe(201);
        expect(first.body.data).toEqual(expect.objectContaining({ total: 115, isFinal: false, creditedTotal: 115 }));
        expect(first.body.data.lines).toEqual([expect.objectContaining({ orderItemId: orderItem.id, quantity: 1, total: 115 })]);

        const retry = await request(app).post(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`).send(firstBody);
        expect(retry.status).toBe(201);
        expect(retry.body.data.creditNoteNumber).toBe(first.body.data.creditNoteNumber);
        expect(await prisma.fiscalCreditNote.count({ where: { orderId: order.id } })).toBe(1);
        expect(Number((await prisma.stock.findUniqueOrThrow({
            where: { warehouseId_productId: { warehouseId, productId } },
        })).quantity)).toBe(9);
        expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(expect.objectContaining({
            status: 'DELIVERED', financialStatus: 'PAID', invoiceFiscalStatus: 'PARTIALLY_CREDITED',
        }));
        expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('ACTIVE');
        await expect(PaymentService.getOrderPaymentSummary(order.id, companyId)).resolves.toMatchObject({
            grossTotal: 230,
            credited: 115,
            netTotal: 115,
            grossPaid: 230,
            refunded: 115,
            netPaid: 115,
            remaining: 0,
            status: 'PAID',
        });
        await expect(PaymentService.create(companyId, {
            orderId: order.id,
            paymentMethodId,
            amount: 1,
        }, userId)).rejects.toThrow(/contraflujo fiscal/i);
        await expect(PaymentService.delete(payment.id, companyId, userId, 'Reverso manual inválido'))
            .rejects.toThrow(/contraflujo fiscal/i);

        const excessive = await request(app).post(`/api/invoices/${order.id}/credit-note`)
            .set('Authorization', `Bearer ${token}`).send({ ...firstBody, idempotencyKey: `partial-excess-${order.id}`, lines: [{ orderItemId: orderItem.id, quantity: 2 }] });
        expect(excessive.status).toBe(400);
        expect(await prisma.fiscalCreditNote.count({ where: { orderId: order.id } })).toBe(1);

        const finalBody = {
            idempotencyKey: `partial-credit-b-${order.id}`,
            reason: 'Devolución final sin retorno físico',
            inventoryAction: 'NO_RETURN',
            externalRefunds: [],
            lines: [{ orderItemId: orderItem.id, quantity: 1 }],
        };
        const concurrent = await Promise.all([
            request(app).post(`/api/invoices/${order.id}/credit-note`).set('Authorization', `Bearer ${token}`).send(finalBody),
            request(app).post(`/api/invoices/${order.id}/credit-note`).set('Authorization', `Bearer ${token}`).send(finalBody),
        ]);
        expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
        expect(concurrent[0].body.data.creditNoteNumber).toBe(concurrent[1].body.data.creditNoteNumber);
        expect(concurrent[0].body.data).toEqual(expect.objectContaining({ total: 115, isFinal: true, creditedTotal: 230 }));
        expect(await prisma.fiscalCreditNote.count({ where: { orderId: order.id } })).toBe(2);
        const persistedNotes = await prisma.fiscalCreditNote.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } });
        const historical = await request(app).get(`/api/invoices/credit-notes/${persistedNotes[0].id}`)
            .set('Authorization', `Bearer ${token}`);
        expect(historical.status).toBe(200);
        expect(historical.body.data.creditNoteNumber).toBe(first.body.data.creditNoteNumber);
        expect(historical.body.data.isFinal).toBe(false);
        expect(Number((await prisma.stock.findUniqueOrThrow({
            where: { warehouseId_productId: { warehouseId, productId } },
        })).quantity)).toBe(9);
        expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(expect.objectContaining({ status: 'REVERSED' }));
        expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(expect.objectContaining({
            status: 'CANCELLED', financialStatus: 'UNPAID', invoiceFiscalStatus: 'CREDITED',
        }));
        const refunds = await prisma.fiscalCreditNotePaymentRefund.findMany({ where: { paymentId: payment.id } });
        expect(refunds.map((refund) => Number(refund.amount))).toEqual([115, 115]);
        expect(await prisma.cashMovement.count({ where: { reference: { in: refunds.map((refund) => refund.reference) }, type: 'OUT' } })).toBe(2);

        const reconciliation = await BankReconciliationService.getReconciliationStatus(
            companyId,
            new Date(Date.now() - 60 * 60 * 1000),
            new Date(Date.now() + 60 * 60 * 1000),
            branchId,
        );
        expect(reconciliation.totals.bySource.pos.netCollected).toBe(0);
        expect(reconciliation.totals.refunded).toBe(reconciliation.totals.grossCollected);
    });
});
