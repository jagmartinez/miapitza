import { describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
    doesOrderHoldTableAccount,
    tableOpenAccountWhere,
    tableOperationalOrderWhere,
} from '../../services/table-occupancy-policy';

describe('table occupancy policy', () => {
    it.each([
        ['OPEN', 'UNPAID', true],
        ['READY', 'PARTIAL', true],
        ['DELIVERED', 'UNPAID', true],
        ['OPEN', 'PAID', false],
        ['DELIVERED', 'PAID', false],
        ['CANCELLED', 'UNPAID', false],
    ])(
        'derives table ownership from order %s with financial status %s',
        (status, financialStatus, expected) => {
            expect(doesOrderHoldTableAccount({ status, financialStatus })).toBe(expected);
        },
    );

    it('keeps fiscal issuance out of the operational-order predicate', () => {
        expect(tableOperationalOrderWhere()).toEqual({
            status: {
                in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY'],
            },
            financialStatus: { not: 'PAID' },
        });
    });

    it('keeps delivered legacy debt visible without using invoice fields as settlement', () => {
        const where = tableOpenAccountWhere();

        expect(where).toEqual({
            status: {
                in: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED'],
            },
            financialStatus: { not: 'PAID' },
        });
        expect(JSON.stringify(where)).not.toMatch(/invoiceNumber|invoiceFiscalStatus|invoicedAt/);
    });

    it('ships a one-directional repair for false-available tables with debt', () => {
        const sql = fs.readFileSync(
            path.resolve(
                __dirname,
                '../../../prisma/migrations/20260727_hold_unpaid_table_accounts/migration.sql',
            ),
            'utf8',
        );

        expect(sql).toMatch(/SET t\.`status` = 'OCCUPIED'/);
        expect(sql).toMatch(/o\.`financialStatus` IN \('UNPAID', 'PARTIAL'\)/);
        expect(sql).toMatch(/'DELIVERED'/);
        expect(sql).not.toMatch(/SET .*\bAVAILABLE\b/i);
    });
});
