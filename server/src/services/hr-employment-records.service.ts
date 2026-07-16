import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type EmployeeDocumentStatus, type EmploymentContractStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { AuditLogService } from './audit-log.service';
import { HrDomainError } from './hr.service';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENTS = {
    'application/pdf': { extension: '.pdf', signature: (buffer: Buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' },
    'image/jpeg': { extension: '.jpg', signature: (buffer: Buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
    'image/png': { extension: '.png', signature: (buffer: Buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
} as const;

type DocumentMimeType = keyof typeof ALLOWED_DOCUMENTS;

export class HrDocumentStorageUnavailableError extends HrDomainError {
    constructor(message = 'La custodia documental de RH no está configurada') {
        super(message, 503);
        this.name = 'HrDocumentStorageUnavailableError';
    }
}

export interface HrDocumentStorage {
    readonly provider: string;
    healthCheck(): Promise<{ provider: string; status: 'AVAILABLE' | 'UNAVAILABLE'; checkedAt: string; detail?: string }>;
    put(storageKey: string, content: Buffer): Promise<void>;
    get(storageKey: string): Promise<Buffer>;
    delete(storageKey: string): Promise<void>;
}

function assertSafeStorageKey(storageKey: string): string[] {
    const segments = storageKey.split('/');
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._-]+$/.test(segment))) {
        throw new HrDocumentStorageUnavailableError('La referencia documental almacenada no es segura');
    }
    return segments;
}

class DisabledHrDocumentStorage implements HrDocumentStorage {
    readonly provider = 'disabled';
    async healthCheck() {
        return { provider: this.provider, status: 'UNAVAILABLE' as const, checkedAt: new Date().toISOString(), detail: 'Proveedor deshabilitado' };
    }
    async put(): Promise<never> { throw new HrDocumentStorageUnavailableError(); }
    async get(): Promise<never> { throw new HrDocumentStorageUnavailableError(); }
    async delete(): Promise<never> { throw new HrDocumentStorageUnavailableError(); }
}

class FilesystemHrDocumentStorage implements HrDocumentStorage {
    readonly provider = 'filesystem';
    private readonly root: string;

    constructor(env: NodeJS.ProcessEnv) {
        if (env.NODE_ENV === 'production' && !env.STORAGE_DIR?.trim()) {
            throw new HrDocumentStorageUnavailableError('STORAGE_DIR es obligatorio para custodia documental filesystem en producción');
        }
        this.root = path.resolve(env.STORAGE_DIR?.trim() || process.cwd(), 'uploads', 'hr-documents');
    }

    private resolve(storageKey: string): string {
        const candidate = path.resolve(this.root, ...assertSafeStorageKey(storageKey));
        if (candidate === this.root || !candidate.startsWith(`${this.root}${path.sep}`)) {
            throw new HrDocumentStorageUnavailableError('La referencia documental sale del directorio autorizado');
        }
        return candidate;
    }

    async healthCheck() {
        const probe = path.join(this.root, `.health-${randomUUID()}.tmp`);
        try {
            await mkdir(this.root, { recursive: true });
            await writeFile(probe, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
            await unlink(probe);
            return { provider: this.provider, status: 'AVAILABLE' as const, checkedAt: new Date().toISOString() };
        } catch {
            await unlink(probe).catch(() => undefined);
            return { provider: this.provider, status: 'UNAVAILABLE' as const, checkedAt: new Date().toISOString(), detail: 'Directorio no disponible' };
        }
    }

    async put(storageKey: string, content: Buffer): Promise<void> {
        const destination = this.resolve(storageKey);
        await mkdir(path.dirname(destination), { recursive: true });
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
            await rename(temporary, destination);
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw new HrDocumentStorageUnavailableError(error instanceof Error ? `No fue posible custodiar el documento: ${error.message}` : undefined);
        }
    }

    async get(storageKey: string): Promise<Buffer> {
        try {
            return await readFile(this.resolve(storageKey));
        } catch (error) {
            throw new HrDocumentStorageUnavailableError(error instanceof Error ? `No fue posible leer el documento: ${error.message}` : undefined);
        }
    }

    async delete(storageKey: string): Promise<void> {
        try {
            await unlink(this.resolve(storageKey));
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            if (code !== 'ENOENT') {
                throw new HrDocumentStorageUnavailableError(error instanceof Error ? `No fue posible purgar el documento: ${error.message}` : undefined);
            }
        }
    }
}

export function createHrDocumentStorage(env: NodeJS.ProcessEnv = process.env): HrDocumentStorage {
    const provider = env.HR_DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase() || 'disabled';
    if (provider === 'disabled') return new DisabledHrDocumentStorage();
    if (provider === 'filesystem') return new FilesystemHrDocumentStorage(env);
    throw new HrDocumentStorageUnavailableError(`Proveedor de custodia documental no soportado: ${provider}`);
}

function requiredText(value: unknown, field: string, max = 191): string {
    if (typeof value !== 'string' || !value.trim()) throw new HrDomainError(`${field} es requerido`);
    const normalized = value.trim();
    if (normalized.length > max) throw new HrDomainError(`${field} excede ${max} caracteres`);
    return normalized;
}

function optionalText(value: unknown, field: string, max = 191): string | null {
    if (value === undefined || value === null || value === '') return null;
    return requiredText(value, field, max);
}

function positiveId(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new HrDomainError(`${field} debe ser un entero positivo`);
    return parsed;
}

function dateOnly(value: unknown, field: string): Date {
    const text = requiredText(value, field, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HrDomainError(`${field} debe usar YYYY-MM-DD`);
    const result = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== text) throw new HrDomainError(`${field} no es una fecha válida`);
    return result;
}

function previousDay(date: Date): Date {
    return new Date(date.getTime() - 86_400_000);
}

function normalizedFileName(value: string): string {
    const base = [...path.basename(value).normalize('NFKC')]
        .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
        .join('')
        .trim();
    if (!base || base.length > 191) throw new HrDomainError('fileName no es válido');
    return base;
}

async function assertEmployeeScope(companyId: number, employeeId: number, branchId?: number) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const employee = await prisma.employee.findFirst({
        where: {
            id: employeeId,
            companyId,
            ...(branchId ? { branchAssignments: { some: {
                branchId, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
            } } } : {}),
        },
        select: { id: true, userId: true, hireDate: true, terminationDate: true, status: true },
    });
    if (!employee) throw new HrDomainError('Empleado no encontrado en el alcance autorizado', 404);
    return employee;
}

const documentSelect = {
    id: true, employeeId: true, documentType: true, fileName: true, contentHash: true,
    mimeType: true, sizeBytes: true, expiresAt: true, status: true, createdAt: true, updatedAt: true,
    uploadedBy: { select: { id: true, name: true, username: true } },
} satisfies Prisma.EmployeeDocumentSelect;

export class HrEmployeeDocumentService {
    static async list(companyId: number, employeeId: number, branchId?: number) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        return prisma.employeeDocument.findMany({
            where: { companyId, employeeId }, select: documentSelect,
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        });
    }

    static async upload(input: {
        companyId: number; employeeId: number; actorUserId: number; branchId?: number;
        documentType: unknown; expiresAt?: unknown; fileName: string; mimeType: string; content: Buffer;
    }, storage: HrDocumentStorage = createHrDocumentStorage()) {
        await assertEmployeeScope(input.companyId, input.employeeId, input.branchId);
        const documentType = requiredText(input.documentType, 'documentType', 100).toUpperCase();
        const fileName = normalizedFileName(input.fileName);
        if (!input.content.length) throw new HrDomainError('El documento está vacío');
        if (input.content.length > MAX_DOCUMENT_BYTES) throw new HrDomainError('El documento excede 10 MB', 413);
        const format = ALLOWED_DOCUMENTS[input.mimeType as DocumentMimeType];
        if (!format || !format.signature(input.content)) throw new HrDomainError('El contenido no coincide con un PDF, JPEG o PNG permitido');
        const expiresAt = input.expiresAt ? dateOnly(input.expiresAt, 'expiresAt') : null;
        if (expiresAt && expiresAt <= new Date()) throw new HrDomainError('expiresAt debe ser una fecha futura');
        const contentHash = createHash('sha256').update(input.content).digest('hex');
        const storageKey = `${input.companyId}/${input.employeeId}/${randomUUID()}${format.extension}`;
        await storage.put(storageKey, input.content);
        try {
            return await prisma.$transaction(async (tx) => {
                const document = await tx.employeeDocument.create({
                    data: {
                        companyId: input.companyId, employeeId: input.employeeId, uploadedById: input.actorUserId,
                        documentType, fileName, storageKey, contentHash, mimeType: input.mimeType,
                        sizeBytes: input.content.length, expiresAt,
                    },
                    select: documentSelect,
                });
                await AuditLogService.log({
                    companyId: input.companyId, userId: input.actorUserId, entityType: 'EmployeeDocument', entityId: document.id,
                    action: 'CREATE', details: { employeeId: input.employeeId, documentType, contentHash, sizeBytes: input.content.length, expiresAt: expiresAt?.toISOString().slice(0, 10) ?? null, storageProvider: storage.provider },
                }, tx);
                return document;
            });
        } catch (error) {
            await storage.delete(storageKey).catch(() => undefined);
            throw error;
        }
    }

    static async download(companyId: number, employeeId: number, documentId: number, actorUserId: number, branchId?: number, storage: HrDocumentStorage = createHrDocumentStorage()) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        const document = await prisma.employeeDocument.findFirst({ where: { id: documentId, companyId, employeeId } });
        if (!document) throw new HrDomainError('Documento no encontrado', 404);
        if (document.status !== 'ACTIVE') throw new HrDomainError('El documento ya no está activo', 410);
        if (document.expiresAt && document.expiresAt <= new Date()) {
            await prisma.employeeDocument.updateMany({ where: { id: document.id, companyId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
            await storage.delete(document.storageKey);
            throw new HrDomainError('El documento expiró y fue retirado de custodia', 410);
        }
        const content = await storage.get(document.storageKey);
        const actualHash = createHash('sha256').update(content).digest('hex');
        if (content.length !== document.sizeBytes || actualHash !== document.contentHash) {
            throw new HrDocumentStorageUnavailableError('Falló la verificación de integridad del documento');
        }
        await AuditLogService.log({
            companyId, userId: actorUserId, entityType: 'EmployeeDocument', entityId: document.id,
            action: 'UPDATE', details: { operation: 'DOWNLOAD', employeeId, contentHash: document.contentHash },
        });
        return { content, mimeType: document.mimeType, fileName: document.fileName, contentHash: document.contentHash };
    }

    static async revoke(companyId: number, employeeId: number, documentId: number, actorUserId: number, reasonValue: unknown, branchId?: number, storage: HrDocumentStorage = createHrDocumentStorage()) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        const reason = requiredText(reasonValue, 'reason', 500);
        const document = await prisma.employeeDocument.findFirst({ where: { id: documentId, companyId, employeeId, status: 'ACTIVE' } });
        if (!document) throw new HrDomainError('Documento activo no encontrado', 404);
        await storage.delete(document.storageKey);
        await prisma.$transaction(async (tx) => {
            const changed = await tx.employeeDocument.updateMany({ where: { id: document.id, companyId, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
            if (changed.count !== 1) throw new HrDomainError('El documento cambió concurrentemente', 409);
            await AuditLogService.log({ companyId, userId: actorUserId, entityType: 'EmployeeDocument', entityId: document.id, action: 'DELETE', details: { operation: 'REVOKE_AND_PURGE', employeeId, reason, contentHash: document.contentHash } }, tx);
        });
        return { id: document.id, status: 'REVOKED' as EmployeeDocumentStatus };
    }

    static async runRetentionMaintenance(companyId: number, actorUserId: number, storage: HrDocumentStorage = createHrDocumentStorage(), now = new Date()) {
        const due = await prisma.employeeDocument.findMany({ where: { companyId, status: { in: ['ACTIVE', 'EXPIRED'] }, expiresAt: { lte: now } } });
        const failures: Array<{ id: number; message: string }> = [];
        let purged = 0;
        let newlyExpired = 0;
        for (const document of due) {
            if (document.status === 'ACTIVE') {
                const changed = await prisma.employeeDocument.updateMany({ where: { id: document.id, companyId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
                if (changed.count !== 1) continue;
                newlyExpired += 1;
            }
            try {
                await storage.delete(document.storageKey);
                purged += 1;
            } catch (error) {
                failures.push({ id: document.id, message: error instanceof Error ? error.message : 'Error de purga' });
            }
            await AuditLogService.log({ companyId, userId: actorUserId, entityType: 'EmployeeDocument', entityId: document.id, action: 'DELETE', details: { operation: 'RETENTION_EXPIRED', purgeSucceeded: failures[failures.length - 1]?.id !== document.id, contentHash: document.contentHash } });
        }
        return { examined: due.length, newlyExpired, purged, failures };
    }
}

const contractSelect = {
    id: true, employeeId: true, contractNumber: true, employmentType: true, startDate: true, endDate: true,
    status: true, signedAt: true, notes: true, createdAt: true, updatedAt: true,
    jobPosition: { select: { id: true, name: true, code: true } },
    costCenter: { select: { id: true, name: true, code: true } },
} satisfies Prisma.EmploymentContractSelect;

export class HrEmploymentContractService {
    static async list(companyId: number, employeeId: number, branchId?: number) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        return prisma.employmentContract.findMany({ where: { companyId, employeeId }, select: contractSelect, orderBy: [{ startDate: 'desc' }, { id: 'desc' }] });
    }

    static async create(companyId: number, employeeId: number, actorUserId: number, input: Record<string, unknown>, branchId?: number) {
        const employee = await assertEmployeeScope(companyId, employeeId, branchId);
        if (employee.status === 'TERMINATED') throw new HrDomainError('No se puede crear un contrato para un expediente terminado', 409);
        const contractNumber = requiredText(input.contractNumber, 'contractNumber', 80).toUpperCase();
        const startDate = dateOnly(input.startDate, 'startDate');
        const endDate = input.endDate ? dateOnly(input.endDate, 'endDate') : null;
        if (startDate < employee.hireDate) throw new HrDomainError('El contrato no puede iniciar antes del alta del empleado');
        if (endDate && endDate < startDate) throw new HrDomainError('endDate no puede ser anterior a startDate');
        const employmentType = requiredText(input.employmentType, 'employmentType', 32);
        if (!['FULL_TIME', 'PART_TIME', 'TEMPORARY', 'CONTRACTOR', 'INTERN'].includes(employmentType)) throw new HrDomainError('employmentType inválido');
        const jobPositionId = input.jobPositionId == null ? null : positiveId(input.jobPositionId, 'jobPositionId');
        const costCenterId = input.costCenterId == null ? null : positiveId(input.costCenterId, 'costCenterId');
        const [position, costCenter] = await Promise.all([
            jobPositionId ? prisma.jobPosition.findFirst({ where: { id: jobPositionId, companyId }, select: { id: true } }) : null,
            costCenterId ? prisma.costCenter.findFirst({ where: { id: costCenterId, companyId }, select: { id: true } }) : null,
        ]);
        if (jobPositionId && !position) throw new HrDomainError('Puesto no encontrado en la empresa', 404);
        if (costCenterId && !costCenter) throw new HrDomainError('Centro de costo no encontrado en la empresa', 404);
        return prisma.$transaction(async (tx) => {
            const item = await tx.employmentContract.create({ data: { companyId, employeeId, contractNumber, employmentType: employmentType as never, startDate, endDate, jobPositionId, costCenterId, notes: optionalText(input.notes, 'notes', 5000) }, select: contractSelect });
            await AuditLogService.log({ companyId, userId: actorUserId, entityType: 'EmploymentContract', entityId: item.id, action: 'CREATE', details: { employeeId, contractNumber, status: 'DRAFT' } }, tx);
            return item;
        });
    }

    static async transition(companyId: number, employeeId: number, contractId: number, actorUserId: number, actionValue: unknown, input: Record<string, unknown>, branchId?: number) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        const action = requiredText(actionValue, 'action', 20).toUpperCase();
        if (!['ACTIVATE', 'TERMINATE', 'EXPIRE'].includes(action)) throw new HrDomainError('Transición de contrato inválida');
        const reason = requiredText(input.reason, 'reason', 500);
        return prisma.$transaction(async (tx) => {
            const lockedEmployees = await tx.$queryRaw<Array<{ id: number; status: string }>>(Prisma.sql`SELECT id, status FROM Employee WHERE id = ${employeeId} AND companyId = ${companyId} FOR UPDATE`);
            if (lockedEmployees.length !== 1) throw new HrDomainError('Empleado no encontrado', 404);
            if (lockedEmployees[0].status === 'TERMINATED') throw new HrDomainError('No se puede cambiar el contrato de un expediente terminado', 409);
            const current = await tx.employmentContract.findFirst({ where: { id: contractId, companyId, employeeId } });
            if (!current) throw new HrDomainError('Contrato no encontrado', 404);
            let next: EmploymentContractStatus;
            let data: Prisma.EmploymentContractUpdateManyMutationInput;
            if (action === 'ACTIVATE') {
                if (current.status !== 'DRAFT') throw new HrDomainError('Sólo un contrato DRAFT puede activarse', 409);
                const signedAt = input.signedAt ? new Date(requiredText(input.signedAt, 'signedAt', 40)) : null;
                if (!signedAt || Number.isNaN(signedAt.getTime()) || signedAt > new Date()) throw new HrDomainError('signedAt debe ser una fecha/hora válida no futura');
                const overlap = await tx.employmentContract.findFirst({ where: { companyId, employeeId, id: { not: contractId }, status: 'ACTIVE', startDate: { lte: current.endDate ?? new Date('9999-12-31T00:00:00.000Z') }, OR: [{ endDate: null }, { endDate: { gte: current.startDate } }] }, select: { id: true } });
                if (overlap) throw new HrDomainError('El período del contrato se solapa con otro contrato activo', 409);
                next = 'ACTIVE'; data = { status: next, signedAt };
            } else {
                if (current.status !== 'ACTIVE') throw new HrDomainError('Sólo un contrato ACTIVE puede finalizarse', 409);
                const endDate = dateOnly(input.endDate, 'endDate');
                if (endDate < current.startDate) throw new HrDomainError('endDate no puede ser anterior a startDate');
                if (endDate > new Date()) throw new HrDomainError('Un contrato no puede finalizarse con fecha futura');
                next = action === 'EXPIRE' ? 'EXPIRED' : 'TERMINATED'; data = { status: next, endDate };
            }
            const changed = await tx.employmentContract.updateMany({ where: { id: contractId, companyId, employeeId, status: current.status }, data });
            if (changed.count !== 1) throw new HrDomainError('El contrato cambió concurrentemente', 409);
            await AuditLogService.log({ companyId, userId: actorUserId, entityType: 'EmploymentContract', entityId: contractId, action: 'UPDATE', details: { employeeId, transition: `${current.status}->${next}`, reason } }, tx);
            return tx.employmentContract.findUniqueOrThrow({ where: { id: contractId }, select: contractSelect });
        });
    }
}

const compensationSelect = {
    id: true, employeeId: true, contractId: true, compensationType: true, payFrequency: true,
    amount: true, currency: true, effectiveFrom: true, effectiveTo: true, reason: true, createdAt: true,
    changedBy: { select: { id: true, name: true, username: true } },
} satisfies Prisma.CompensationHistorySelect;

export class HrCompensationService {
    static async list(companyId: number, employeeId: number, branchId?: number) {
        await assertEmployeeScope(companyId, employeeId, branchId);
        return prisma.compensationHistory.findMany({ where: { companyId, employeeId }, select: compensationSelect, orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }] });
    }

    static async append(companyId: number, employeeId: number, actorUserId: number, input: Record<string, unknown>, branchId?: number) {
        const employee = await assertEmployeeScope(companyId, employeeId, branchId);
        if (employee.status === 'TERMINATED') throw new HrDomainError('No se puede cambiar compensación de un expediente terminado', 409);
        const effectiveFrom = dateOnly(input.effectiveFrom, 'effectiveFrom');
        if (effectiveFrom < employee.hireDate) throw new HrDomainError('La compensación no puede iniciar antes del alta del empleado');
        const compensationType = requiredText(input.compensationType, 'compensationType', 20);
        const payFrequency = requiredText(input.payFrequency, 'payFrequency', 20);
        if (!['SALARY', 'HOURLY'].includes(compensationType)) throw new HrDomainError('compensationType inválido');
        if (!['WEEKLY', 'BIWEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(payFrequency)) throw new HrDomainError('payFrequency inválido');
        const amountText = requiredText(input.amount, 'amount', 40);
        if (!/^\d+(?:\.\d{1,2})?$/.test(amountText) || !new Prisma.Decimal(amountText).greaterThan(0)) throw new HrDomainError('amount debe ser positivo con máximo dos decimales');
        const currency = requiredText(input.currency ?? 'NIO', 'currency', 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw new HrDomainError('currency debe ser ISO 4217 de tres letras');
        const contractId = input.contractId == null ? null : positiveId(input.contractId, 'contractId');
        return prisma.$transaction(async (tx) => {
            const lockedEmployees = await tx.$queryRaw<Array<{ id: number; status: string }>>(Prisma.sql`SELECT id, status FROM Employee WHERE id = ${employeeId} AND companyId = ${companyId} FOR UPDATE`);
            if (lockedEmployees.length !== 1) throw new HrDomainError('Empleado no encontrado', 404);
            if (lockedEmployees[0].status === 'TERMINATED') throw new HrDomainError('No se puede cambiar compensación de un expediente terminado', 409);
            if (contractId && !await tx.employmentContract.findFirst({ where: { id: contractId, companyId, employeeId }, select: { id: true } })) throw new HrDomainError('Contrato no encontrado para el empleado', 404);
            const later = await tx.compensationHistory.findFirst({ where: { companyId, employeeId, effectiveFrom: { gte: effectiveFrom } }, select: { id: true } });
            if (later) throw new HrDomainError('La compensación debe agregarse en orden cronológico y no puede duplicar effectiveFrom', 409);
            const current = await tx.compensationHistory.findFirst({ where: { companyId, employeeId, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } });
            if (current) {
                const changed = await tx.compensationHistory.updateMany({ where: { id: current.id, companyId, employeeId, effectiveTo: null }, data: { effectiveTo: previousDay(effectiveFrom) } });
                if (changed.count !== 1) throw new HrDomainError('La compensación cambió concurrentemente', 409);
            }
            const item = await tx.compensationHistory.create({ data: { companyId, employeeId, contractId, changedById: actorUserId, compensationType: compensationType as never, payFrequency: payFrequency as never, amount: new Prisma.Decimal(amountText), currency, effectiveFrom, reason: requiredText(input.reason, 'reason', 500) }, select: compensationSelect });
            await AuditLogService.log({ companyId, userId: actorUserId, entityType: 'CompensationHistory', entityId: item.id, action: 'CREATE', details: { employeeId, effectiveFrom: effectiveFrom.toISOString().slice(0, 10), compensationType, payFrequency, currency, priorEntryId: current?.id ?? null } }, tx);
            return item;
        });
    }
}
