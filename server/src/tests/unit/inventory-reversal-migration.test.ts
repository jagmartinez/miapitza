import fs from 'fs';
import path from 'path';

describe('inventory reversal and cost provenance migration', () => {
    const root = path.resolve(__dirname, '../../..');
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const sql = fs.readFileSync(path.join(
        root,
        'prisma/migrations/20260716_inventory_reversal_cost_provenance/migration.sql'
    ), 'utf8');

    it('keeps reversal history immutable and idempotent', () => {
        expect(schema).toContain('reversalOfId');
        expect(schema).toContain('@@unique([reversalOfId]');
        expect(schema).toContain('reversalKey');
        expect(sql).toContain('InvMove_reversalOf_key');
        expect(sql).toContain('ON DELETE RESTRICT');
    });

    it('links FIFO and cost provenance to both original and compensating movements', () => {
        expect(schema).toContain('sourceMovementId');
        expect(schema).toContain('inventoryMovementId');
        expect(schema).toContain('reversalMovementId');
        expect(schema).toContain('reversedAt');
        expect(sql).toContain('ProdCostHist_reversalMove_fkey');
    });

    it('distinguishes reviewed zero costs from legacy missing values', () => {
        expect(schema).toContain('referenceCostKnown');
        expect(schema).toContain('averageCostKnown');
        expect(sql).toContain('`referenceCostKnown` = (`cost` > 0)');
        expect(sql).toContain('`averageCostKnown` = (`currentAverageCost` > 0)');
    });
});
