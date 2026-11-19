import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';
import bcrypt from 'bcryptjs';
import { LoginAttemptService } from '../../services/login-attempt.service';

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
        const user = await prisma.user.findUnique({
            where: { username: testUser.username },
            select: { id: true },
        });
        if (user) {
            await prisma.userSession.deleteMany({ where: { userId: user.id } });
            await prisma.auditLog.deleteMany({ where: { userId: user.id } });
        }
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

        it('shares the authoritative lockout across independent service instances', async () => {
            const user = await prisma.user.findUniqueOrThrow({
                where: { username: testUser.username },
                select: { id: true },
            });
            const replicaA = new LoginAttemptService();
            const replicaB = new LoginAttemptService();

            // supertest connects from loopback; the per-IP row is keyed on it.
            const clientIp = '127.0.0.1';
            await Promise.all([
                replicaA.recordFailure(user.id, clientIp),
                replicaB.recordFailure(user.id, clientIp),
                replicaA.recordFailure(user.id, clientIp),
                replicaB.recordFailure(user.id, clientIp),
                replicaA.recordFailure(user.id, clientIp),
            ]);

            await expect(replicaB.assertAllowed(user.id, clientIp)).rejects.toThrow('temporarily locked');
            // A lock earned from one IP must not lock the account for other IPs.
            await expect(replicaB.assertAllowed(user.id, '203.0.113.9')).resolves.toBeUndefined();
            const response = await request(app)
                .post('/api/auth/login')
                .send({
                    username: testUser.username,
                    password: testUser.password,
                });
            expect(response.status).toBe(401);
            expect(response.body.message).toMatch(/Credenciales inválidas/i);
        });
    });
});
