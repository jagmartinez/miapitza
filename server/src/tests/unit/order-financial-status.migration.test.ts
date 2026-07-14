import { readFileSync } from 'fs';
import path from 'path';

describe('order financial lifecycle migration', () => {
    const sql = readFileSync(
        path.resolve(__dirname, '../../../prisma/migrations/20260713_separate_order_financial_status/migration.sql'),
        'utf8'
    );

    it('backfills settlement only from active payment rows and normalizes closedAt', () => {
        expect(sql).toContain("WHERE `status` = 'ACTIVE'");
        expect(sql).toContain('SUM(`amount`) AS `activePaid`');
        expect(sql).toMatch(/o\.`financialStatus`\s*=\s*CASE/);
        expect(sql).toMatch(/o\.`closedAt`\s*=\s*CASE/);
        expect(sql).toContain('ELSE NULL');
    });

    it('preserves the legacy terminal fact before removing PAID from Order.status', () => {
        const backfillPosition = sql.indexOf("WHERE `status` = 'PAID'");
        const enumRemovalPosition = sql.indexOf('MODIFY COLUMN `status` ENUM');
        expect(backfillPosition).toBeGreaterThan(0);
        expect(enumRemovalPosition).toBeGreaterThan(backfillPosition);
        expect(sql).toContain("SET `status` = 'DELIVERED'");
        expect(sql).toContain('`deliveredAt` = COALESCE(`deliveredAt`, `updatedAt`)');
        expect(sql.slice(enumRemovalPosition)).not.toContain("'PAID'");
    });
});
