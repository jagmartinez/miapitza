import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';

describe('Order API Integration Tests', () => {
    const credentials = {
        username: 'order_it_admin',
        email: 'order_it_admin@example.com',
        password: 'OrderIntegration123!',
        name: 'Order Integration Admin'
    };

    let authToken: string;
    let adminRoleId: number;
    let testCompanyId: number;
    let testBranchId: number;
    let testUserId: number;
    let createdOrderId: number | null = null;

    beforeAll(async () => {
        const existingAdminRole = await prisma.role.findFirst({
            where: { companyId: null, name: 'ADMIN' }
        });

        if (existingAdminRole) {
            adminRoleId = existingAdminRole.id;
        } else {
            const createdRole = await prisma.role.create({
                data: { name: 'ADMIN', description: 'Global admin role for integration tests' }
            });
            adminRoleId = createdRole.id;
        }

        const company = await prisma.company.upsert({
            where: { id: 991 },
            update: { name: 'Integration Orders Company', active: true },
            create: { id: 991, name: 'Integration Orders Company', active: true }
        });
        testCompanyId = company.id;

        const branch = await prisma.branch.upsert({
            where: { id: 991 },
            update: {
                companyId: company.id,
                name: 'Integration Orders Branch',
                code: 'IT-ORD'
            },
            create: {
                id: 991,
                companyId: company.id,
                name: 'Integration Orders Branch',
                code: 'IT-ORD'
            }
        });
        testBranchId = branch.id;

        await prisma.user.deleteMany({ where: { username: credentials.username } });

        const user = await prisma.user.create({
            data: {
                name: credentials.name,
                email: credentials.email,
                username: credentials.username,
                password: await bcrypt.hash(credentials.password, 10),
                roleId: adminRoleId,
                branchId: branch.id,
                companyId: company.id,
                status: 'ACTIVE',
                mustChangePassword: false,
                passwordChangedAt: new Date()
            }
        });
        testUserId = user.id;

        const loginResponse = await request(app)
            .post('/api/auth/login')
            .send({
                username: credentials.username,
                password: credentials.password
            });

        expect(loginResponse.status).toBe(200);
        authToken = loginResponse.body.data.token;
    });

    afterAll(async () => {
        if (createdOrderId) {
            await prisma.payment.deleteMany({ where: { orderId: createdOrderId } });
            await prisma.orderItem.deleteMany({ where: { orderId: createdOrderId } });
            await prisma.order.deleteMany({ where: { id: createdOrderId } });
        }

        await prisma.user.deleteMany({ where: { id: testUserId } });
        await prisma.branch.deleteMany({ where: { id: testBranchId } });
        await prisma.company.deleteMany({ where: { id: testCompanyId } });
    });

    describe('POST /api/orders', () => {
        it('should create a new order', async () => {
            const response = await request(app)
                .post('/api/orders')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    branchId: testBranchId,
                    customerName: 'Test Customer'
                });

            expect(response.status).toBe(201);
            expect(response.body.data).toBeDefined();
            expect(response.body.data.id).toBeDefined();
            expect(response.body.data.userId).toBe(testUserId);
            createdOrderId = response.body.data.id;
        });

        it('should return 401 without authentication', async () => {
            const response = await request(app)
                .post('/api/orders')
                .send({
                    branchId: testBranchId,
                    customerName: 'Unauthorized Test'
                });

            expect(response.status).toBe(401);
        });
    });

    describe('GET /api/orders', () => {
        it('should return list of orders', async () => {
            const response = await request(app)
                .get('/api/orders')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(true);
            expect(response.body.data.some((order: { id: number }) => order.id === createdOrderId)).toBe(true);
        });
    });

    describe('GET /api/orders/:id', () => {
        it('should return a specific order', async () => {
            expect(createdOrderId).not.toBeNull();

            const response = await request(app)
                .get(`/api/orders/${createdOrderId}`)
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body.data.id).toBe(createdOrderId);
            expect(response.body.data.branchId).toBe(testBranchId);
        });

        it('should return 404 for non-existent order', async () => {
            const response = await request(app)
                .get('/api/orders/999999')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(404);
        });
    });
});
