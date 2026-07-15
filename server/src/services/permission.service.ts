import prisma from '../utils/prisma';
import { invalidatePermissionCache } from '../middlewares/auth';

export class PermissionServiceError extends Error {
    constructor(message: string, public readonly statusCode = 400) {
        super(message);
        this.name = 'PermissionServiceError';
    }
}

type PermissionActor = { userId: number; companyId: number };

function normalizeName(value: unknown): string {
    if (typeof value !== 'string') throw new PermissionServiceError('El nombre del permiso es obligatorio');
    const name = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name)) {
        throw new PermissionServiceError('El permiso debe usar un nombre estable como modulo.accion');
    }
    return name;
}

export class PermissionService {
    static async getAll() {
        return prisma.permission.findMany({
            include: { _count: { select: { roles: true } } },
            orderBy: { name: 'asc' },
        });
    }

    static async getById(id: number) {
        const permission = await prisma.permission.findUnique({
            where: { id },
            include: { roles: { select: { id: true, name: true } } },
        });
        if (!permission) throw new PermissionServiceError('Permiso no encontrado', 404);
        return permission;
    }

    static async create(data: { name: string; description?: string }, actor: PermissionActor) {
        const name = normalizeName(data.name);
        const description = data.description?.trim() || null;
        const result = await prisma.$transaction(async (tx) => {
            const permission = await tx.permission.create({ data: { name, description } });
            await tx.auditLog.create({
                data: {
                    companyId: actor.companyId,
                    userId: actor.userId,
                    entityType: 'Permission',
                    entityId: permission.id,
                    action: 'CREATE',
                    details: { name },
                },
            });
            return permission;
        });
        invalidatePermissionCache();
        return result;
    }

    static async update(
        id: number,
        data: { name?: string; description?: string },
        actor: PermissionActor,
    ) {
        const existing = await prisma.permission.findUnique({ where: { id } });
        if (!existing) throw new PermissionServiceError('Permiso no encontrado', 404);
        if (data.name !== undefined && normalizeName(data.name) !== existing.name) {
            // Guards refer to names as durable identifiers. Renaming one would
            // make it look absent and reactivate legacy role fallback.
            throw new PermissionServiceError('El identificador de un permiso es inmutable', 409);
        }
        if (data.description === undefined) {
            throw new PermissionServiceError('No hay campos editables para actualizar');
        }
        const description = data.description.trim() || null;
        const result = await prisma.$transaction(async (tx) => {
            const permission = await tx.permission.update({ where: { id }, data: { description } });
            await tx.auditLog.create({
                data: {
                    companyId: actor.companyId,
                    userId: actor.userId,
                    entityType: 'Permission',
                    entityId: id,
                    action: 'UPDATE_DESCRIPTION',
                    details: { previous: existing.description, next: description },
                },
            });
            return permission;
        });
        invalidatePermissionCache();
        return result;
    }

    static async delete(_id: number): Promise<never> {
        // Catalog presence is security-significant: removing a definition would
        // deliberately switch requirePermission back to its legacy role fallback.
        throw new PermissionServiceError(
            'Los permisos son identificadores de seguridad durables; revoque sus asignaciones en lugar de eliminarlos',
            409,
        );
    }
}
