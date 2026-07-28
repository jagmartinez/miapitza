import { afterEach, describe, expect, it, jest } from '@jest/globals';
import prisma from '../../utils/prisma';
import { transactionWithP2034Retry } from '../../utils/transaction-retry';

describe('transactionWithP2034Retry', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('stops at the configured attempt limit and returns the original P2034', async () => {
        const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
        const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValue(conflict as never);

        await expect(transactionWithP2034Retry(async () => 'never', undefined, 2))
            .rejects.toBe(conflict);

        expect(transaction).toHaveBeenCalledTimes(2);
    });
});
