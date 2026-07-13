import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';
import bcrypt from 'bcryptjs';

describe('Auth API Integration Tests', () => {
    const testUser = {
        username: 'test_auth_user',
        email: 'test_auth@example.com',
        password: 'TestPassword123!',
        name: 'Test Auth User'
    };

    let testRoleId: number;
    let testCompanyId: number;
    beforeAll(async () => {
        let company = await prisma.company.findFirst({ where: { name: 'TEST_AUTH_COMPANY' } });
        if (!company) company = await prisma.company.create({ data: { name: 'TEST_AUTH_COMPANY' } });
        testCompanyId = company.id;

        // Get or create a test role
        let role = await prisma.role.findFirst({
            where: { name: 'TEST_ROLE', companyId: testCompanyId }
        });
        if (!role) {
            role = await prisma.role.create({
                data: { name: 'TEST_ROLE', description: 'Test role for auth tests', companyId: testCompanyId }
            });
        }
        testRoleId = role.id;

        // Cleanup any existing test user
        await prisma.user.deleteMany({ where: { username: testUser.username } });

        // Create a user for login tests
        const hashedPassword = await bcrypt.hash(testUser.password, 10);
        await prisma.user.create({
            data: {
                name: testUser.name,
                email: testUser.email,
                username: testUser.username,
                password: hashedPassword,
                roleId: testRoleId,
                companyId: testCompanyId,
                status: 'ACTIVE'
            }
        });
    });

    afterAll(async () => {
        // Cleanup
        await prisma.user.deleteMany({ where: { username: testUser.username } });
        await prisma.role.deleteMany({ where: { name: 'TEST_ROLE', companyId: testCompanyId } });
        await prisma.company.delete({ where: { id: testCompanyId } });
    });

    describe('POST /api/auth/login', () => {
        it('should return 401 for invalid credentials', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    username: 'nonexistent_user',
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
        });

        it('should login with valid credentials and return a token', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    username: testUser.username,
                    password: testUser.password
                });

            expect(response.status).toBe(200);
            expect(response.body.data.token).toBeDefined();
            expect(response.body.data.user).toBeDefined();
            expect(response.body.data.user.username).toBe(testUser.username);
        });
    });
});
