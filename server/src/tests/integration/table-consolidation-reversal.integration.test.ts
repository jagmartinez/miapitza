import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../app';
import prisma from '../../utils/prisma';

/**
 * Real MySQL integration coverage for the full financial consolidation
 * counterflow. The migrated-test runner creates and drops an isolated database.
 */
describe('table consolidation reversal flow', () => {
    const username = 'table_reverse_it_admin';
    const password = 'TableReverse123!';
    let companyId: number;
    let branchId: number;
    let roleId: number;
    let userId: number;
    let destinationTableId: number;
    let sourceTableId: number;
    let menuItemId: number;
    let primaryOrderId: number;
    let sourceOrderId: number;
    let primaryItemId: number;
    let sourceItemId: number;
    let token: string;

    beforeAll(async () => {
        const company = await prisma.company.create({
            data: { name: 'Table Reversal Integration', active: true }
        });
        companyId = company.id;
        const branch = await prisma.branch.create({
            data: { companyId, name: 'Table Reversal Branch', code: `TR-${companyId}` }
        });
        branchId = branch.id;
        const permission = await prisma.permission.upsert({
            where: { name: 'tables.consolidate' },
            update: {},
            create: { name: 'tables.consolidate', description: 'Consolidar y revertir cuentas de mesas' }
        });
        const role = await prisma.role.create({
            data: {
                companyId,
                name: 'ADMIN',
                description: 'Table reversal integration administrator',
                permissions: { connect: { id: permission.id } }
            }
        });
        roleId = role.id;
        const user = await prisma.user.create({
            data: {
                companyId,
                branchId,
                roleId,
                name: 'Table Reversal Admin',
                email: `table-reverse-${companyId}@example.com`,
                username,
                password: await bcrypt.hash(password, 10),
                status: 'ACTIVE',
                mustChangePassword: false,
                passwordChangedAt: new Date()
            }
        });
        userId = user.id;
        const category = await prisma.category.create({
            data: { companyId, name: 'Table Reversal Menu' }
        });
        const menuItem = await prisma.menuItem.create({
            data: {
                companyId,
                branchId,
                categoryId: category.id,
                name: 'Reversible plate',
                price: 20,
                type: 'DIRECT'
            }
        });
        menuItemId = menuItem.id;
        const [destination, source] = await Promise.all([
            prisma.table.create({
                data: { companyId, branchId, number: 'TR-1', capacity: 4, status: 'OCCUPIED' }
            }),
            prisma.table.create({
                data: { companyId, branchId, number: 'TR-2', capacity: 4, status: 'OCCUPIED' }
            })
        ]);
        destinationTableId = destination.id;
        sourceTableId = source.id;
        const primary = await prisma.order.create({
            data: {
                companyId,
                branchId,
                tableId: destinationTableId,
                userId,
                status: 'OPEN',
                financialStatus: 'UNPAID',
                total: 20
            }
        });
        const sourceOrder = await prisma.order.create({
            data: {
                companyId,
                branchId,
                tableId: sourceTableId,
                userId,
                status: 'OPEN',
                financialStatus: 'UNPAID',
                total: 30
            }
        });
        primaryOrderId = primary.id;
        sourceOrderId = sourceOrder.id;
        const [primaryItem, sourceItem] = await Promise.all([
            prisma.orderItem.create({
                data: { orderId: primaryOrderId, menuItemId, quantity: 1, price: 20, subtotal: 20 }
            }),
            prisma.orderItem.create({
                data: { orderId: sourceOrderId, menuItemId, quantity: 1, price: 30, subtotal: 30 }
            })
        ]);
        primaryItemId = primaryItem.id;
        sourceItemId = sourceItem.id;

        const login = await request(app).post('/api/auth/login').send({ username, password });
        expect(login.status).toBe(200);
        token = login.body.data.token;
    });

    afterAll(async () => {
        await prisma.tableConsolidationItem.deleteMany({ where: { consolidation: { companyId } } });
        await prisma.tableConsolidationOrder.deleteMany({ where: { consolidation: { companyId } } });
        await prisma.tableConsolidation.deleteMany({ where: { companyId } });
        await prisma.orderItemModifier.deleteMany({ where: { orderItem: { order: { companyId } } } });
        await prisma.orderItem.deleteMany({ where: { order: { companyId } } });
        await prisma.order.deleteMany({ where: { companyId } });
        await prisma.auditLog.deleteMany({ where: { companyId } });
        await prisma.userSession.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
        await prisma.role.delete({ where: { id: roleId } });
        await prisma.menuItem.delete({ where: { id: menuItemId } });
        await prisma.category.deleteMany({ where: { companyId } });
        await prisma.table.deleteMany({ where: { companyId } });
        await prisma.branch.delete({ where: { id: branchId } });
        await prisma.company.delete({ where: { id: companyId } });
        await prisma.$disconnect();
    });

    async function consolidate() {
        return request(app)
            .post('/api/tables/consolidate')
            .set('Authorization', `Bearer ${token}`)
            .send({
                destinationTableId,
                sourceTableIds: [sourceTableId],
                primaryOrderId,
                reason: 'Cuenta familiar'
            });
    }

    async function reverse(consolidationId: number, version: number, key: string) {
        return request(app)
            .post(`/api/tables/consolidations/${consolidationId}/reverse`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                expectedVersion: version,
                reversalKey: key,
                reason: 'Separación solicitada antes de cobrar'
            });
    }

    it('deprecates the unsafe cash close without touching a shift', async () => {
        const response = await request(app)
            .post('/api/cash-shifts/999999/close')
            .set('Authorization', `Bearer ${token}`)
            .send({ closingBalance: 500 });

        expect(response.status).toBe(410);
        expect(response.headers.deprecation).toBe('true');
        expect(response.headers.link).toContain('/api/cash-arqueo/999999/close');
    });

    it('consolidates, rediscovers and reverses all financial ownership atomically', async () => {
        const consolidated = await consolidate();
        expect(consolidated.status).toBe(200);
        expect(Number(consolidated.body.data.total)).toBe(50);
        const consolidationId = consolidated.body.data.consolidationId as number;
        const version = consolidated.body.data.consolidationVersion as number;

        const discoveredByOrder = await request(app)
            .get('/api/tables/consolidations/active')
            .set('Authorization', `Bearer ${token}`)
            .query({ orderId: sourceOrderId });
        expect(discoveredByOrder.status).toBe(200);
        expect(discoveredByOrder.body.data).toEqual(expect.objectContaining({
            id: consolidationId,
            version,
            primaryOrderId,
            affectedOrderIds: [primaryOrderId, sourceOrderId]
        }));
        expect(discoveredByOrder.body.data).not.toHaveProperty('orderSnapshots');

        const discoveredByTable = await request(app)
            .get('/api/tables/consolidations/active')
            .set('Authorization', `Bearer ${token}`)
            .query({ tableId: sourceTableId });
        expect(discoveredByTable.status).toBe(200);
        expect(discoveredByTable.body.data.id).toBe(consolidationId);

        const reversed = await reverse(consolidationId, version, 'table-reverse-first');
        expect(reversed.status).toBe(200);
        expect(reversed.body.data.idempotent).toBe(false);
        expect(reversed.body.data.version).toBe(version + 1);

        const [primary, source, primaryItem, sourceItem, tables, auditCount] = await Promise.all([
            prisma.order.findUnique({ where: { id: primaryOrderId } }),
            prisma.order.findUnique({ where: { id: sourceOrderId } }),
            prisma.orderItem.findUnique({ where: { id: primaryItemId } }),
            prisma.orderItem.findUnique({ where: { id: sourceItemId } }),
            prisma.table.findMany({
                where: { id: { in: [destinationTableId, sourceTableId] } },
                orderBy: { id: 'asc' }
            }),
            prisma.auditLog.count({
                where: {
                    companyId,
                    entityType: 'TableConsolidation',
                    entityId: consolidationId,
                    action: 'TABLE_CONSOLIDATION_REVERSE'
                }
            })
        ]);
        expect(primary).toEqual(expect.objectContaining({
            tableId: destinationTableId,
            status: 'OPEN',
            financialStatus: 'UNPAID'
        }));
        expect(Number(primary?.total)).toBe(20);
        expect(source).toEqual(expect.objectContaining({
            tableId: sourceTableId,
            status: 'OPEN',
            financialStatus: 'UNPAID',
            consolidatedIntoOrderId: null,
            cancelledById: null,
            cancelledAt: null,
            closedAt: null,
            cancelReason: null
        }));
        expect(Number(source?.total)).toBe(30);
        expect(primaryItem?.orderId).toBe(primaryOrderId);
        expect(sourceItem).toEqual(expect.objectContaining({
            orderId: sourceOrderId,
            originOrderId: null,
            originTableId: null
        }));
        expect(tables.map((table) => table.status)).toEqual(['OCCUPIED', 'OCCUPIED']);
        expect(auditCount).toBe(1);

        const replay = await reverse(consolidationId, version, 'table-reverse-first');
        expect(replay.status).toBe(200);
        expect(replay.body.data.idempotent).toBe(true);
        expect(await prisma.auditLog.count({
            where: {
                companyId,
                entityType: 'TableConsolidation',
                entityId: consolidationId,
                action: 'TABLE_CONSOLIDATION_REVERSE'
            }
        })).toBe(1);
        const noLongerActive = await request(app)
            .get('/api/tables/consolidations/active')
            .set('Authorization', `Bearer ${token}`)
            .query({ orderId: sourceOrderId });
        expect(noLongerActive.status).toBe(200);
        expect(noLongerActive.body.data).toBeNull();
    });

    it('rejects post-consolidation item changes without partially restoring data', async () => {
        const consolidated = await consolidate();
        expect(consolidated.status).toBe(200);
        const consolidationId = consolidated.body.data.consolidationId as number;
        const version = consolidated.body.data.consolidationVersion as number;
        const extraItem = await prisma.orderItem.create({
            data: { orderId: primaryOrderId, menuItemId, quantity: 1, price: 5, subtotal: 5 }
        });

        const rejected = await reverse(consolidationId, version, 'table-reverse-mutated');
        expect(rejected.status).toBe(409);
        expect(rejected.body).toEqual(expect.objectContaining({ success: false }));
        expect(await prisma.tableConsolidation.findUnique({ where: { id: consolidationId } }))
            .toEqual(expect.objectContaining({ status: 'ACTIVE', version }));
        expect(await prisma.order.findUnique({ where: { id: sourceOrderId } }))
            .toEqual(expect.objectContaining({
                status: 'CANCELLED',
                consolidatedIntoOrderId: primaryOrderId
            }));
        expect((await prisma.orderItem.findUnique({ where: { id: sourceItemId } }))?.orderId)
            .toBe(primaryOrderId);

        await prisma.orderItem.delete({ where: { id: extraItem.id } });
        const repaired = await reverse(consolidationId, version, 'table-reverse-mutated');
        expect(repaired.status).toBe(200);
        expect(repaired.body.data.idempotent).toBe(false);
    });

    it('serializes concurrent retries into one reversal and one idempotent response', async () => {
        const consolidated = await consolidate();
        expect(consolidated.status).toBe(200);
        const consolidationId = consolidated.body.data.consolidationId as number;
        const version = consolidated.body.data.consolidationVersion as number;

        const results = await Promise.all([
            reverse(consolidationId, version, 'table-reverse-race'),
            reverse(consolidationId, version, 'table-reverse-race')
        ]);
        expect(results.map((response) => response.status)).toEqual([200, 200]);
        expect(results.map((response) => response.body.data.idempotent).sort())
            .toEqual([false, true]);
        expect(await prisma.auditLog.count({
            where: {
                companyId,
                entityType: 'TableConsolidation',
                entityId: consolidationId,
                action: 'TABLE_CONSOLIDATION_REVERSE'
            }
        })).toBe(1);
    });
});
