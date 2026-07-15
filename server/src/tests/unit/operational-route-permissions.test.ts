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

    it('separates mutating invoice issuance from immutable invoice reads', () => {
        const routes = readRoute('invoice.routes.ts');

        expect(routes).toContain("requirePermission('invoices.issue', 'SUPERADMIN', 'ADMIN', 'CAJERO')");
        expect(routes).toContain("requirePermission('invoices.view', 'SUPERADMIN', 'ADMIN', 'CAJERO')");
        expect(routes).toContain("router.post('/:id/issue', canIssueInvoice");
        expect(routes).toContain("router.get('/:id', canViewInvoice");
        expect(routes).toContain("router.get('/:id/pdf', canViewInvoice");
        expect(routes).toContain("requirePermission('invoices.cancel', 'SUPERADMIN', 'ADMIN')");
        expect(routes).toContain("requirePermission('invoices.credit', 'SUPERADMIN', 'ADMIN')");
        expect(routes).toContain("router.post('/:id/cancel', canCancelInvoice");
        expect(routes).toContain("router.post('/:id/credit-note', canIssueCreditNote");
        expect(routes).toContain("router.get('/:id/cancellation', canViewInvoice");
        expect(routes).toContain("router.get('/:id/credit-note', canViewInvoice");
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
        const operationalMigration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260714_add_operational_permissions/migration.sql'),
            'utf8'
        );
        const fiscalMigration = fs.readFileSync(
            path.resolve(__dirname, '../../../prisma/migrations/20260714_fiscal_credit_notes_customer_tax/migration.sql'),
            'utf8'
        );
        const migration = `${operationalMigration}\n${fiscalMigration}`;
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
            'invoices.credit',
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
