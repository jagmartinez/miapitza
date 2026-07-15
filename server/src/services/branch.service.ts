import prisma from '../utils/prisma';
import { isValidTimeZone } from '../utils/timezone';
import { AuditLogService } from './audit-log.service';

export class BranchService {
    static async getAll(companyId: number) {
        return await prisma.branch.findMany({
            where: { companyId },
            include: {
                company: true,
                _count: {
                    select: {
                        users: true,
                        tables: true,
                        warehouses: true
                    }
                }
            }
        });
    }

    static async getById(id: number, companyId: number) {
        const branch = await prisma.branch.findFirst({
            where: { id, companyId },
            include: {
                company: true,
                users: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: {
                            select: {
                                name: true
                            }
                        }
                    }
                },
                tables: {
                    select: {
                        id: true,
                        number: true,
                        capacity: true,
                        status: true
                    }
                },
                warehouses: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        if (!branch) {
            throw new Error('Branch not found');
        }

        return branch;
    }

    static async create(data: {
        companyId: number;
        name: string;
        code: string;
        address?: string;
        phone?: string;
        latitude: number;
        longitude: number;
        geofenceRadiusM: number;
        maxLocationAccuracyM: number;
        timezone?: string;
        attendanceEnabled?: boolean;
        status?: 'ACTIVE' | 'INACTIVE';
    }, actorUserId: number) {
        const name = data.name?.trim();
        const code = data.code?.trim().toUpperCase();
        if (!name) throw new Error('El nombre de la sucursal es requerido');
        if (!code) throw new Error('El código de la sucursal es requerido');
        const latitude = Number(data.latitude);
        const longitude = Number(data.longitude);
        const geofenceRadiusM = Number(data.geofenceRadiusM);
        const maxLocationAccuracyM = Number(data.maxLocationAccuracyM);
        const timezone = data.timezone?.trim() || 'America/Managua';
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new Error('Latitud fuera de rango');
        }
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new Error('Longitud fuera de rango');
        }
        if (!Number.isInteger(geofenceRadiusM) || geofenceRadiusM < 10 || geofenceRadiusM > 10000) {
            throw new Error('geofenceRadiusM debe estar entre 10 y 10000 metros');
        }
        if (!Number.isInteger(maxLocationAccuracyM) || maxLocationAccuracyM < 1 || maxLocationAccuracyM > 5000) {
            throw new Error('maxLocationAccuracyM debe estar entre 1 y 5000 metros');
        }
        if (!isValidTimeZone(timezone)) throw new Error('Zona horaria inválida');
        const status = data.status || 'ACTIVE';
        if (status !== 'ACTIVE' && status !== 'INACTIVE') throw new Error('Estado de sucursal inválido');
        const attendanceEnabled = data.attendanceEnabled ?? false;
        if (attendanceEnabled && status !== 'ACTIVE') {
            throw new Error('No se puede habilitar asistencia en una sucursal inactiva');
        }

        // Check if code exists within the same company
        const existing = await prisma.branch.findFirst({
            where: { code, companyId: data.companyId }
        });

        if (existing) {
            throw new Error('Ya existe una sucursal con este código en la empresa');
        }

        const branch = await prisma.$transaction(async (tx) => {
            const created = await tx.branch.create({
                data: {
                    companyId: data.companyId,
                    name,
                    code,
                    address: data.address?.trim() || null,
                    phone: data.phone?.trim() || null,
                    latitude,
                    longitude,
                    geofenceRadiusM,
                    maxLocationAccuracyM,
                    timezone,
                    attendanceEnabled,
                    geofenceVersion: 1,
                    status,
                }
            });
            await tx.branchGeofenceVersion.create({
                data: {
                    companyId: data.companyId,
                    branchId: created.id,
                    version: 1,
                    latitude,
                    longitude,
                    geofenceRadiusM,
                    maxLocationAccuracyM,
                    timezone,
                    attendanceEnabled,
                    changedById: actorUserId,
                }
            });
            await AuditLogService.log({
                companyId: data.companyId,
                userId: actorUserId,
                entityType: 'Branch',
                entityId: created.id,
                action: 'CREATE',
                details: { code: created.code, geofenceVersion: 1, attendanceEnabled: created.attendanceEnabled }
            }, tx);
            return created;
        });
        return { ...branch, latitude: Number(branch.latitude), longitude: Number(branch.longitude), version: branch.geofenceVersion };
    }

    static async update(id: number, companyId: number, data: {
        name?: string;
        code?: string;
        address?: string;
        phone?: string;
        status?: 'ACTIVE' | 'INACTIVE';
    }, actorUserId: number) {
        if (!Number.isInteger(id) || id <= 0) throw new Error('Sucursal inválida');
        if (data.name !== undefined && !data.name.trim()) throw new Error('El nombre de la sucursal es requerido');
        if (data.name !== undefined && data.name.trim().length > 200) throw new Error('El nombre de la sucursal es demasiado largo');
        if (data.code !== undefined && !data.code.trim()) throw new Error('El código de la sucursal es requerido');
        if (data.code !== undefined && data.code.trim().length > 20) throw new Error('El código de la sucursal es demasiado largo');
        if (data.status !== undefined && data.status !== 'ACTIVE' && data.status !== 'INACTIVE') {
            throw new Error('Estado de sucursal inválido');
        }
        if (Object.values(data).every((value) => value === undefined)) throw new Error('No hay campos válidos para actualizar');

        return prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM \`Branch\` WHERE id = ${id} AND companyId = ${companyId} FOR UPDATE`;
            const branch = await tx.branch.findFirst({ where: { id, companyId } });
            if (!branch) throw new Error('Branch not found or unauthorized');

            const normalizedCode = data.code?.trim().toUpperCase();
            if (normalizedCode !== undefined && normalizedCode !== branch.code) {
                const duplicate = await tx.branch.findFirst({
                    where: { companyId, code: normalizedCode, id: { not: id } },
                    select: { id: true }
                });
                if (duplicate) throw new Error('Ya existe una sucursal con este código en la empresa');
            }
            const disablingAttendance = data.status === 'INACTIVE' && branch.attendanceEnabled;
            const updated = await tx.branch.update({
                where: { id },
                data: {
                    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                    ...(normalizedCode !== undefined ? { code: normalizedCode } : {}),
                    ...(data.address !== undefined ? { address: data.address.trim() || null } : {}),
                    ...(data.phone !== undefined ? { phone: data.phone.trim() || null } : {}),
                    ...(data.status !== undefined ? { status: data.status } : {}),
                    ...(disablingAttendance ? {
                        attendanceEnabled: false,
                        geofenceVersion: branch.geofenceVersion + 1,
                    } : {}),
                },
            });
            if (disablingAttendance) {
                await tx.branchGeofenceVersion.create({
                    data: {
                        companyId,
                        branchId: id,
                        version: branch.geofenceVersion + 1,
                        latitude: branch.latitude,
                        longitude: branch.longitude,
                        geofenceRadiusM: branch.geofenceRadiusM,
                        maxLocationAccuracyM: branch.maxLocationAccuracyM,
                        timezone: branch.timezone,
                        attendanceEnabled: false,
                        changedById: actorUserId,
                        reason: 'Sucursal inactivada',
                    },
                });
            }
            await AuditLogService.log({
                companyId,
                userId: actorUserId,
                entityType: 'Branch',
                entityId: id,
                action: 'UPDATE',
                details: { fields: Object.keys(data), attendanceDisabled: disablingAttendance },
            }, tx);
            return updated;
        });
    }

    static async delete(id: number, companyId: number, actorUserId: number) {
        // Soft delete by setting status to INACTIVE
        // Verify ownership
        const branch = await this.getById(id, companyId);
        if (!branch) throw new Error("Branch not found or unauthorized");

        return this.update(id, companyId, { status: 'INACTIVE' }, actorUserId);
    }
}
