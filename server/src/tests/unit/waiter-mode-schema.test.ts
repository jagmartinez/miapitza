import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';
import { Prisma } from '@prisma/client';

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, '../../..', ...p), 'utf8');

describe('waiter mode schema (Task 1)', () => {
    it('Order exposes guests, discountReason and discountAuthorizedById', () => {
        const f = Object.keys(Prisma.OrderScalarFieldEnum);
        expect(f).toEqual(expect.arrayContaining(['guests', 'discountReason', 'discountAuthorizedById']));
    });

    it('OrderItem exposes deliveredAt and deliveredById', () => {
        const f = Object.keys(Prisma.OrderItemScalarFieldEnum);
        expect(f).toEqual(expect.arrayContaining(['deliveredAt', 'deliveredById']));
    });

    it('Role exposes maxDiscountPercent', () => {
        expect(Object.keys(Prisma.RoleScalarFieldEnum)).toContain('maxDiscountPercent');
    });

    it('seed declares both discount permissions with the right roles', () => {
        const seed = read('prisma/seed.ts');
        expect(seed).toContain("'orders.discount.apply'");
        expect(seed).toContain("'orders.discount.authorize'");
        const line = (role: string) => seed.split('\n').find((l) => l.trim().startsWith(`${role}:`)) ?? '';
        expect(line('MESERO')).toContain('orders.discount.apply');
        expect(line('CAJERO')).toContain('orders.discount.apply');
        expect(line('MESERO')).not.toContain('orders.discount.authorize');
        expect(line('CAJERO')).not.toContain('orders.discount.authorize');
        // ADMIN receives them through the shared operational permission list.
        expect(seed).toMatch(/operationalPermissions = \[[\s\S]*'orders\.discount\.apply'[\s\S]*'orders\.discount\.authorize'[\s\S]*\]/);
    });

    it('tenant provisioning grants the same permissions', () => {
        const src = read('src/services/company-provisioning.service.ts');
        expect(src).toContain("'orders.discount.apply'");
        expect(src).toContain("'orders.discount.authorize'");
        const block = (role: string) => {
            const start = src.indexOf(`[ROLES.${role}]: [`);
            return src.slice(start, src.indexOf('],', start));
        };
        expect(block('MESERO')).toContain('orders.discount.apply');
        expect(block('CAJERO')).toContain('orders.discount.apply');
        expect(block('MESERO')).not.toContain('orders.discount.authorize');
    });

    it('migration inserts the permissions and links them to roles; rollback removes them', () => {
        const dir = 'prisma/migrations/20261121_waiter_mode';
        const sql = read(dir, 'migration.sql');
        for (const col of ['guests', 'discountReason', 'discountAuthorizedById', 'deliveredAt', 'deliveredById', 'maxDiscountPercent']) {
            expect(sql).toContain(`\`${col}\``);
        }
        expect(sql).toContain("'orders.discount.apply'");
        expect(sql).toContain("'orders.discount.authorize'");
        expect(sql).toContain('INSERT IGNORE INTO `_PermissionToRole`');
        const rb = read(dir, 'rollback.sql');
        expect(rb).toContain("DELETE FROM `Permission`");
        expect(rb).toContain('DROP COLUMN');
    });
});
