import fs from 'fs';
import path from 'path';

describe('PaymentMethod semantic type migration', () => {
    it('backfills only normalized exact legacy labels without fuzzy matching', () => {
        const migration = fs.readFileSync(
            path.resolve(process.cwd(), 'prisma/migrations/20260713_add_payment_method_types/migration.sql'),
            'utf8'
        );

        expect(migration).toContain("UPPER(TRIM(`name`)) IN ('EFECTIVO', 'CASH')");
        expect(migration).toContain("UPPER(TRIM(`name`)) IN ('TARJETA', 'CARD', 'POS')");
        expect(migration).toContain("UPPER(TRIM(`name`)) IN ('TRANSFERENCIA', 'BANK TRANSFER')");
        expect(migration).not.toMatch(/\bLIKE\b/i);
        expect(migration).not.toContain('BINARY TRIM');
        expect(migration).toContain("ELSE 'OTHER'");
    });
});
