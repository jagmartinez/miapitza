import { describe, expect, it, jest } from '@jest/globals';
import { requireBackupOperator } from '../../routes/backup.routes';

describe('backup global operator guard', () => {
    it('fails closed when the operator company is not configured', () => {
        const previous = process.env.BACKUP_ADMIN_COMPANY_ID;
        delete process.env.BACKUP_ADMIN_COMPANY_ID;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        requireBackupOperator({ user: { companyId: 1 } } as never, { status, json } as never, jest.fn());
        expect(status).toHaveBeenCalledWith(503);
        if (previous === undefined) delete process.env.BACKUP_ADMIN_COMPANY_ID;
        else process.env.BACKUP_ADMIN_COMPANY_ID = previous;
    });

    it('rejects a different tenant', () => {
        process.env.BACKUP_ADMIN_COMPANY_ID = '1';
        const status = jest.fn().mockReturnThis();
        const json = jest.fn();
        const next = jest.fn();
        requireBackupOperator({ user: { companyId: 2 } } as never, { status, json } as never, next);
        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
