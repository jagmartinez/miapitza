import { describe, expect, it } from '@jest/globals';
import { Prisma, OperationalDeviceType, OperationalDeviceStatus } from '@prisma/client';

describe('operational device schema', () => {
    it('exposes OperationalDevice enums and User pin fields', () => {
        expect(OperationalDeviceType.KITCHEN_TABLET).toBe('KITCHEN_TABLET');
        expect(OperationalDeviceType.SERVICE_TABLET).toBe('SERVICE_TABLET');
        expect(OperationalDeviceStatus.REVOKED).toBe('REVOKED');
        expect(OperationalDeviceStatus.ACTIVE).toBe('ACTIVE');
        expect(Prisma.UserScalarFieldEnum.pinHash).toBe('pinHash');
        expect(Prisma.UserScalarFieldEnum.pinUpdatedAt).toBe('pinUpdatedAt');
    });
});
