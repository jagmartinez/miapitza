import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import prisma from '../../utils/prisma';
import { BranchService } from '../../services/branch.service';
import { HrGeofenceService } from '../../services/hr.service';
import { HrController } from '../../controllers/hr.controller';

const existing = {
    id: 10,
    companyId: 4,
    name: 'Centro',
    code: 'CTR',
    address: null,
    phone: null,
    latitude: null,
    longitude: null,
    geofenceRadiusM: null,
    maxLocationAccuracyM: null,
    timezone: 'America/Managua',
    attendanceEnabled: false,
    geofenceVersion: 0,
    status: 'ACTIVE',
    createdAt: new Date('2026-07-13T00:00:00Z'),
    updatedAt: new Date('2026-07-13T00:00:00Z'),
};

describe('HR branch geofence', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('uses tenant + optimistic version and persists immutable history with audit', async () => {
        jest.spyOn(prisma.branch, 'findFirst')
            .mockResolvedValueOnce(existing as never)
            .mockResolvedValueOnce({
                ...existing,
                latitude: new Prisma.Decimal('12.1363890'),
                longitude: new Prisma.Decimal('-86.2513890'),
                geofenceRadiusM: 120,
                maxLocationAccuracyM: 40,
                attendanceEnabled: true,
                geofenceVersion: 1,
            } as never);
        const tx = {
            branch: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as never) },
            branchGeofenceVersion: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 1 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        const result = await HrGeofenceService.update(10, 4, {
            name: 'Centro renovado',
            code: 'ctr-2',
            address: 'Avenida central',
            latitude: 12.136389,
            longitude: -86.251389,
            geofenceRadiusM: 120,
            maxLocationAccuracyM: 40,
            timezone: 'America/Managua',
            attendanceEnabled: true,
            expectedVersion: 0,
        }, 3);

        expect(tx.branch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 10, companyId: 4, geofenceVersion: 0 },
            data: expect.objectContaining({
                name: 'Centro renovado', code: 'CTR-2', address: 'Avenida central',
                geofenceVersion: 1, attendanceEnabled: true,
            }),
        }));
        expect(tx.branchGeofenceVersion.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 4, branchId: 10, version: 1, changedById: 3 }),
        }));
        expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual(expect.objectContaining({ latitude: 12.136389, version: 1 }));
    });

    it('rejects enabling attendance without a complete geofence', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue(existing as never);
        const transaction = jest.spyOn(prisma, '$transaction');

        await expect(HrGeofenceService.update(10, 4, { attendanceEnabled: true }, 3))
            .rejects.toThrow('No se puede habilitar asistencia');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('centralizes atomic branch creation in BranchService', async () => {
        const create = jest.spyOn(BranchService, 'create').mockResolvedValue({ id: 12, version: 1 } as never);

        await HrGeofenceService.createBranch(4, {
            name: 'Norte', code: 'NOR', latitude: 12.2, longitude: -86.3,
            geofenceRadiusM: 100, maxLocationAccuracyM: 30,
        }, 3);

        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            companyId: 4, name: 'Norte', code: 'NOR', latitude: 12.2, longitude: -86.3,
        }), 3);
    });

    it('denies branch creation to a branch-scoped actor even with the route permission', async () => {
        const create = jest.spyOn(HrGeofenceService, 'createBranch');
        const req = {
            user: { userId: 7, companyId: 4, role: 'CAJERO', roles: ['CAJERO'], branchId: 10, timezone: 'America/Managua' },
            body: {},
        } as never;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn().mockReturnThis();
        const res = { status, json } as never;
        const next = jest.fn();

        await HrController.createBranch(req, res, next);

        expect(create).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a tenant-wide ADMIN to create a branch in its own company', async () => {
        jest.spyOn(HrGeofenceService, 'createBranch').mockResolvedValue({ id: 12 } as never);
        const req = {
            user: { userId: 7, companyId: 4, role: 'ADMIN', roles: ['ADMIN'], branchId: 10, timezone: 'America/Managua' },
            body: { name: 'Norte' },
        } as never;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn().mockReturnThis();
        const res = { status, json } as never;
        const next = jest.fn();

        await HrController.createBranch(req, res, next);

        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(next).not.toHaveBeenCalled();
    });

    it('allows a company-wide Owner to create a branch', async () => {
        jest.spyOn(HrGeofenceService, 'createBranch').mockResolvedValue({ id: 12 } as never);
        const req = {
            user: { userId: 3, companyId: 4, role: 'SUPERADMIN', roles: ['SUPERADMIN'], timezone: 'America/Managua' },
            body: { name: 'Norte' },
        } as never;
        const status = jest.fn().mockReturnThis();
        const json = jest.fn().mockReturnThis();
        const res = { status, json } as never;
        const next = jest.fn();

        await HrController.createBranch(req, res, next);

        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
        expect(next).not.toHaveBeenCalled();
    });

    it('writes Branch, geofence version and audit through the same transaction client', async () => {
        jest.spyOn(prisma.branch, 'findFirst').mockResolvedValue(null);
        const createdBranch = {
            ...existing,
            id: 12,
            latitude: new Prisma.Decimal('12.2000000'),
            longitude: new Prisma.Decimal('-86.3000000'),
            geofenceRadiusM: 100,
            maxLocationAccuracyM: 30,
            geofenceVersion: 1,
        };
        const tx = {
            branch: { create: jest.fn().mockResolvedValue(createdBranch as never) },
            branchGeofenceVersion: { create: jest.fn().mockResolvedValue({ id: 2 } as never) },
            auditLog: { create: jest.fn().mockResolvedValue({ id: 3 } as never) },
        };
        jest.spyOn(prisma, '$transaction').mockImplementation(
            (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never,
        );

        await BranchService.create({
            companyId: 4, name: ' Norte ', code: ' nor ', latitude: 12.2, longitude: -86.3,
            geofenceRadiusM: 100, maxLocationAccuracyM: 30,
        }, 3);

        expect(tx.branch.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: 4, name: 'Norte', code: 'NOR', geofenceVersion: 1 }),
        }));
        expect(tx.branchGeofenceVersion.create).toHaveBeenCalledTimes(1);
        expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('does not start a branch transaction without valid geolocation', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');
        await expect(BranchService.create({
            companyId: 4, name: 'Sin geo', code: 'SG', latitude: Number.NaN, longitude: -86.3,
            geofenceRadiusM: 100, maxLocationAccuracyM: 30,
        }, 3)).rejects.toThrow('Latitud fuera de rango');
        expect(transaction).not.toHaveBeenCalled();
    });

    it('never enables attendance on an inactive new branch', async () => {
        const transaction = jest.spyOn(prisma, '$transaction');
        await expect(BranchService.create({
            companyId: 4,
            name: 'Inactiva',
            code: 'INA',
            latitude: 12.2,
            longitude: -86.3,
            geofenceRadiusM: 100,
            maxLocationAccuracyM: 30,
            status: 'INACTIVE',
            attendanceEnabled: true,
        }, 3)).rejects.toThrow('sucursal inactiva');
        expect(transaction).not.toHaveBeenCalled();
    });
});
