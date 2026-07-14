import fs from 'fs';
import path from 'path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.resolve(
    __dirname,
    '../../../prisma/migrations/20260714_harden_financial_payment_audit/migration.sql'
);
const schemaPath = path.resolve(__dirname, '../../../prisma/schema.prisma');

describe('financial payment audit migration contract', () => {
    it('snapshots method semantics and gives POS actors restrictive audit relations', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        expect(sql).toContain('UPDATE `Payment` p');
        expect(sql).toContain('UPDATE `CateringPayment` cp');
        expect(sql).toContain('Payment_registeredById_fkey');
        expect(sql).toContain('Payment_reversedById_fkey');
        expect(sql).toContain('CateringPayment_registeredById_fkey');
        expect(sql.match(/ON DELETE RESTRICT/g)?.length).toBe(3);
        expect(sql).not.toMatch(/SET\s+[^;]*registeredById\s*=\s*NULL/i);
    });

    it('adds per-document domain idempotency keys without globally colliding tenants', () => {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        expect(sql).toContain('Payment_orderId_idempotencyKey_key');
        expect(sql).toContain('CateringPayment_cateringEventId_idempotencyKey_key');

        const schema = fs.readFileSync(schemaPath, 'utf8');
        expect(schema).toContain('@@unique([orderId, idempotencyKey])');
        expect(schema).toContain('@@unique([cateringEventId, idempotencyKey])');
        expect(schema).toContain('@relation("PaymentRegisteredBy"');
        expect(schema).toContain('@relation("PaymentReversedBy"');
    });
});
