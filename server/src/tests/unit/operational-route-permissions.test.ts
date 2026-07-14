import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const readRoute = (name: string) => fs.readFileSync(
    path.resolve(__dirname, `../../routes/${name}`),
    'utf8'
);

describe('Operational route permission contract', () => {
    it('protects the order lifecycle with granular permissions and leaves KDS guards unchanged', () => {
        const routes = readRoute('order.routes.ts');

        expect(routes).toContain("requirePermission('orders.view'");
        expect(routes).toContain("requirePermission('orders.create', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO')");
        expect(routes).toContain("requirePermission('orders.edit'");
        expect(routes).toContain("requirePermission('orders.cancel', 'SUPERADMIN', 'ADMIN', 'MESERO')");
        expect(routes).toContain("requirePermission('orders.deliver', 'SUPERADMIN', 'ADMIN', 'MESERO', 'CAJERO')");
        expect(routes).toContain("requirePermission('kds.view', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF')");
        expect(routes).toContain("requirePermission('kds.manage', 'SUPERADMIN', 'ADMIN', 'COCINA', 'CHEF')");
        expect(routes).not.toContain('requireRole(');
    });

    it('treats existing invoice generation endpoints as issuance and exposes no fake cancellation route', () => {
        const routes = readRoute('invoice.routes.ts');

        expect(routes).toContain("requirePermission('invoices.issue', 'SUPERADMIN', 'ADMIN', 'CAJERO')");
        expect(routes).toContain("router.get('/:id', canIssueInvoice");
        expect(routes).toContain("router.get('/:id/pdf', canIssueInvoice");
        expect(routes).not.toMatch(/router\.(post|patch|delete)\([^\n]*cancel/i);
        expect(routes).not.toContain('requireRole(');
    });

    it('separates payment processing, reversal and bill splitting authority', () => {
        const payments = readRoute('payment.routes.ts');
        const splitBill = readRoute('split-bill.routes.ts');

        expect(payments).toContain("requirePermission('payments.process'");
        expect(payments).toContain("requirePermission('payments.reverse', 'SUPERADMIN', 'ADMIN')");
        expect(payments).not.toContain('requireRole(');
        expect(splitBill).toContain("requirePermission('bills.split', 'SUPERADMIN', 'ADMIN', 'CAJERO', 'MESERO')");
        expect(splitBill).not.toContain('requireRole(');
    });

    it('ships every operational permission and production grants in an additive migration', () => {
        const migration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260714_add_operational_permissions/migration.sql'),
            'utf8'
        );
        const seed = fs.readFileSync(path.resolve(__dirname, '../../../prisma/seed.ts'), 'utf8');
        const permissions = [
            'orders.view',
            'orders.create',
            'orders.edit',
            'orders.cancel',
            'orders.deliver',
            'invoices.issue',
            'invoices.view',
            'invoices.cancel',
            'payments.process',
            'payments.reverse',
            'bills.split',
        ];

        for (const permission of permissions) {
            expect(seed).toContain(`'${permission}'`);
            expect(migration).toContain(`'${permission}'`);
        }
        expect(migration).toContain('INSERT IGNORE INTO `Permission`');
        expect(migration).toContain('INSERT IGNORE INTO `_PermissionToRole`');
    });
});
