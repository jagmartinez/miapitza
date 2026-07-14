import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Branch, Company, Order } from '@prisma/client';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';

describe('Order to Invoice Flow & Multi-tenancy Isolation', () => {
    let adminToken1: string;
    let adminToken2: string;
    let company1: Company;
    let company2: Company;
    let branch1: Branch;
    let branch2: Branch;
    let order1: Order;
    let adminRoleId: number;
    let user1Id: number;
    let user2Id: number;
    let categoryId: number;
    let menuItemId: number;

    beforeAll(async () => {
        const existingAdminRole = await prisma.role.findFirst({
            where: { companyId: null, name: 'ADMIN' }
        });

        if (existingAdminRole) {
            adminRoleId = existingAdminRole.id;
        } else {
            const createdRole = await prisma.role.create({
                data: { name: 'ADMIN', description: 'Global admin role for invoice integration tests' }
            });
            adminRoleId = createdRole.id;
        }

        company1 = await prisma.company.upsert({
            where: { id: 998 },
            update: { name: 'Test company 1', active: true },
            create: { id: 998, name: 'Test company 1', active: true }
        });

        company2 = await prisma.company.upsert({
            where: { id: 999 },
            update: { name: 'Test company 2', active: true },
            create: { id: 999, name: 'Test company 2', active: true }
        });

        branch1 = await prisma.branch.upsert({
            where: { id: 998 },
            update: {
                companyId: company1.id,
                name: 'Test Branch 1',
                code: 'TB1'
            },
            create: {
                id: 998,
                companyId: company1.id,
                name: 'Test Branch 1',
                code: 'TB1'
            }
        });

        branch2 = await prisma.branch.upsert({
            where: { id: 999 },
            update: {
                companyId: company2.id,
                name: 'Test Branch 2',
                code: 'TB2'
            },
            create: {
                id: 999,
                companyId: company2.id,
                name: 'Test Branch 2',
                code: 'TB2'
            }
        });

        await prisma.user.deleteMany({
            where: {
                username: { in: ['invoice_admin_1', 'invoice_admin_2'] }
            }
        });

        const user1 = await prisma.user.create({
            data: {
                name: 'Invoice Admin 1',
                email: 'invoice_admin_1@test.com',
                username: 'invoice_admin_1',
                password: await bcrypt.hash('InvoicePass123!', 10),
                roleId: adminRoleId,
                branchId: branch1.id,
                companyId: company1.id,
                status: 'ACTIVE',
                mustChangePassword: false,
                passwordChangedAt: new Date()
            }
        });
        user1Id = user1.id;

        const user2 = await prisma.user.create({
            data: {
                name: 'Invoice Admin 2',
                email: 'invoice_admin_2@test.com',
                username: 'invoice_admin_2',
                password: await bcrypt.hash('InvoicePass123!', 10),
                roleId: adminRoleId,
                branchId: branch2.id,
                companyId: company2.id,
                status: 'ACTIVE',
                mustChangePassword: false,
                passwordChangedAt: new Date()
            }
        });
        user2Id = user2.id;

        const category = await prisma.category.upsert({
            where: { companyId_name: { companyId: company1.id, name: 'Invoice Integration' } },
            update: {},
            create: { companyId: company1.id, name: 'Invoice Integration' }
        });
        categoryId = category.id;
        const menuItem = await prisma.menuItem.create({
            data: {
                companyId: company1.id,
                branchId: branch1.id,
                categoryId,
                name: `Invoice integration item ${Date.now()}`,
                price: 100,
                type: 'DIRECT'
            }
        });
        menuItemId = menuItem.id;

        order1 = await prisma.order.create({
            data: {
                companyId: company1.id,
                branchId: branch1.id,
                userId: user1.id,
                status: 'OPEN',
                financialStatus: 'UNPAID',
                total: 100,
                customerName: 'Test customer',
                items: {
                    create: {
                        menuItemId,
                        quantity: 1,
                        price: 100,
                        subtotal: 100
                    }
                }
            }
        });

        const [login1, login2] = await Promise.all([
            request(app).post('/api/auth/login').send({ username: 'invoice_admin_1', password: 'InvoicePass123!' }),
            request(app).post('/api/auth/login').send({ username: 'invoice_admin_2', password: 'InvoicePass123!' })
        ]);

        expect(login1.status).toBe(200);
        expect(login2.status).toBe(200);

        adminToken1 = login1.body.data.token;
        adminToken2 = login2.body.data.token;
    });

    afterAll(async () => {
        await prisma.payment.deleteMany({ where: { order: { companyId: { in: [998, 999] } } } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId: { in: [998, 999] } } } });
        await prisma.order.deleteMany({ where: { companyId: { in: [998, 999] } } });
        await prisma.menuItem.deleteMany({ where: { id: menuItemId } });
        await prisma.category.deleteMany({ where: { id: categoryId } });
        await prisma.invoiceSequence.deleteMany({ where: { companyId: { in: [998, 999] } } });
        await prisma.user.deleteMany({ where: { id: { in: [user1Id, user2Id] } } });
        await prisma.branch.deleteMany({ where: { id: { in: [998, 999] } } });
        await prisma.company.deleteMany({ where: { id: { in: [998, 999] } } });
    });

    describe('GET /api/invoices/:id', () => {
        it('should return invoice data for authorized company', async () => {
            const response = await request(app)
                .get(`/api/invoices/${order1.id}`)
                .set('Authorization', `Bearer ${adminToken1}`);

            expect(response.status).toBe(200);
            expect(response.body.data.orderId).toBe(order1.id);
            expect(response.body.data.companyName).toBe(company1.name);
            expect(response.body.data.invoiceNumber).toMatch(/^FAC-/);
        });

        it('should return 404 for order belonging to another company', async () => {
            const response = await request(app)
                .get(`/api/invoices/${order1.id}`)
                .set('Authorization', `Bearer ${adminToken2}`);

            expect(response.status).toBe(404);
        });
    });
});
