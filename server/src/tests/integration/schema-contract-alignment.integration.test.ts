import { describe, expect, it } from '@jest/globals';
import prisma from '../../utils/prisma';

interface ColumnContractRow {
    tableName: string;
    columnName: string;
    columnDefault: string | null;
    columnType: string;
}

describe('deployed schema contracts', () => {
    it('requires explicit payment method snapshots and supports partial Catering credits', async () => {
        const rows = await prisma.$queryRaw<ColumnContractRow[]>`
            SELECT
                LOWER(TABLE_NAME) AS tableName,
                COLUMN_NAME AS columnName,
                COLUMN_DEFAULT AS columnDefault,
                COLUMN_TYPE AS columnType
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND (
                (LOWER(TABLE_NAME) IN ('payment', 'cateringpayment') AND COLUMN_NAME = 'methodType')
                OR (LOWER(TABLE_NAME) = 'cateringfiscalinvoice' AND COLUMN_NAME = 'status')
              )
            ORDER BY LOWER(TABLE_NAME), COLUMN_NAME
        `;

        expect(rows).toHaveLength(3);
        const byTable = new Map(rows.map(row => [row.tableName, row]));
        expect(byTable.get('payment')?.columnDefault).toBeNull();
        expect(byTable.get('cateringpayment')?.columnDefault).toBeNull();
        expect(byTable.get('cateringfiscalinvoice')?.columnType).toContain('PARTIALLY_CREDITED');
    });
});
