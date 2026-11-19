import type { NextFunction, Request, Response } from 'express';
import {
    apiNotFoundHandler,
    classifyError,
    errorHandler,
    GENERIC_SERVER_ERROR_MESSAGE,
} from '../../middlewares/errorHandler';

function mockRes() {
    const res = {
        headersSent: false,
        statusCode: 200,
        body: undefined as unknown,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) { this.headers[name] = value; return this; },
        status(code: number) { this.statusCode = code; return this; },
        json(payload: unknown) { this.body = payload; return this; },
    };
    return res;
}

const req = { path: '/api/x', method: 'POST', baseUrl: '' } as unknown as Request;

function run(err: unknown) {
    const res = mockRes();
    errorHandler(err, req, res as unknown as Response, jest.fn() as NextFunction);
    return res;
}

describe('errorHandler', () => {
    let errorSpy: jest.SpyInstance;
    const originalEnv = process.env.NODE_ENV;
    beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
    afterEach(() => { errorSpy.mockRestore(); process.env.NODE_ENV = originalEnv; });

    it('returns a consistent JSON shape and masks unexpected 500s', () => {
        process.env.NODE_ENV = 'production';
        const res = run(new TypeError("Cannot read properties of undefined (reading 'id')"));
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ success: false, message: GENERIC_SERVER_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(res.body)).not.toMatch(/stack|reading/);
        const logged = errorSpy.mock.calls[0][1] as Record<string, unknown>;
        expect(logged.stack).toBeUndefined();
    });

    it('forwards intentional 4xx domain messages and their code', () => {
        const err = Object.assign(new Error('Nombre del concepto es requerido'), { statusCode: 400, code: 'HR_PAYROLL_INVALID' });
        const res = run(err);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ success: false, message: 'Nombre del concepto es requerido', code: 'HR_PAYROLL_INVALID' });
    });

    it('does not forward 4xx messages that leak internals', () => {
        const err = Object.assign(new Error('Invalid `prisma.order.update()` invocation'), { statusCode: 400 });
        const res = run(err);
        expect(res.statusCode).toBe(400);
        expect((res.body as { message: string }).message).not.toMatch(/prisma/i);
    });

    it.each([
        ['Orden no encontrada', 404],
        ['La sucursal ya existe', 409],
        ['No se puede anular una factura pagada', 409],
        ['Stock insuficiente para Pollo', 409],
        ['El campo nombre es requerido', 400],
        ['Cantidad inválida', 400],
    ])('maps plain Error "%s" to %d', (message, status) => {
        const res = run(new Error(message));
        expect(res.statusCode).toBe(status);
        expect((res.body as { message: string }).message).toBe(message);
    });

    it('keeps branch-scope authorization failures as 403', () => {
        const res = run(new Error('No autorizado para esta sucursal'));
        expect(res.statusCode).toBe(403);
    });

    it('maps Prisma known errors to Spanish 4xx', () => {
        const duplicate = classifyError({ name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: ['email'] } });
        expect(duplicate).toMatchObject({ status: 409, code: 'DUPLICATE', message: 'Ya existe un registro con esos datos. Verifica que no esté duplicado.' });
        expect(duplicate.message).not.toMatch(/email/);
        expect(classifyError({ name: 'PrismaClientKnownRequestError', code: 'P2002', meta: { target: 'User_email_companyId_key' } }).message)
            .not.toMatch(/User|email|_key/);
        expect(classifyError({ name: 'PrismaClientKnownRequestError', code: 'P2025' })).toMatchObject({
            status: 404,
            code: 'RECORD_NOT_FOUND_OR_CHANGED',
            message: expect.stringContaining('El registro no existe o fue modificado por otro usuario; recargue'),
        });
        expect(classifyError({ name: 'PrismaClientKnownRequestError', code: 'P2003' }))
            .toMatchObject({ status: 409 });
        expect(classifyError({ name: 'PrismaClientInitializationError', message: 'Can\'t reach database server' }))
            .toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    });

    it('maps P2034 deadlocks to a retryable 503 with Retry-After', () => {
        const res = run({ name: 'PrismaClientKnownRequestError', code: 'P2034', message: 'Transaction failed due to a write conflict or a deadlock' });
        expect(res.statusCode).toBe(503);
        expect(res.headers['Retry-After']).toBe('1');
        expect(res.body).toMatchObject({ success: false, code: 'CONCURRENT_UPDATE' });
        expect((res.body as { message: string }).message).not.toMatch(/deadlock|write conflict/i);
    });

    it.each([
        'REVERSAL_PROVENANCE_MISSING en la línea 3',
        'Falta configurar STORAGE_DIR',
        'READINESS_DB_DOWN: base no lista',
    ])('masks plain Errors embedding internal codes as 500: %s', (message) => {
        const res = run(new Error(message));
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ success: false, message: GENERIC_SERVER_ERROR_MESSAGE, code: 'INTERNAL_ERROR' });
    });

    it.each([
        "Cannot read properties of undefined (reading 'id')",
        'items is not iterable',
        'Unexpected end of JSON input',
        'El valor es undefined',
        'Cliente null no válido',
        'Falta STORAGE_DIR válido',
    ])('masks JS runtime text even when forwarded as 400: %s', (message) => {
        const res = run(Object.assign(new Error(message), { statusCode: 400 }));
        expect(res.statusCode).toBe(400);
        expect((res.body as { message: string }).message).not.toBe(message);
        expect((res.body as { message: string }).message).toMatch(/datos inválidos/);
    });

    it('still forwards legitimate legacy "Cannot " domain messages', () => {
        const res = run(Object.assign(new Error('Cannot delete a category with products'), { statusCode: 409 }));
        expect((res.body as { message: string }).message).toBe('Cannot delete a category with products');
    });

    it('maps body-parser, multer, jwt and zod errors', () => {
        expect(classifyError({ type: 'entity.parse.failed', status: 400, message: 'Unexpected token' }))
            .toMatchObject({ status: 400, code: 'INVALID_JSON' });
        expect(classifyError({ type: 'entity.too.large', status: 413 })).toMatchObject({ status: 413 });
        expect(classifyError({ name: 'MulterError', code: 'LIMIT_FILE_SIZE' })).toMatchObject({ status: 413 });
        expect(classifyError({ name: 'TokenExpiredError', message: 'jwt expired' })).toMatchObject({ status: 401 });
        const zod = classifyError({ name: 'ZodError', issues: [{ path: ['items', 0, 'qty'], message: 'Debe ser positivo' }] });
        expect(zod).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: [{ field: 'items.0.qty', message: 'Debe ser positivo' }] });
    });

    it('treats *ValidationError without status as 400 and never shows code-only messages', () => {
        class PromotionValidationError extends Error { constructor(public readonly code: string) { super(code); this.name = 'PromotionValidationError'; } }
        const res = run(new PromotionValidationError('EXPIRED'));
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ code: 'EXPIRED' });
        expect((res.body as { message: string }).message).not.toBe('EXPIRED');
    });

    it('forwards explicit 503 availability messages', () => {
        const err = Object.assign(new Error('El proveedor biométrico no está disponible'), { statusCode: 503 });
        expect(run(err).body).toMatchObject({ message: 'El proveedor biométrico no está disponible' });
    });

    it('delegates when headers were already sent', () => {
        const res = mockRes();
        res.headersSent = true;
        const next = jest.fn();
        const err = new Error('x');
        errorHandler(err, req, res as unknown as Response, next);
        expect(next).toHaveBeenCalledWith(err);
    });

    it('answers unknown API routes with JSON 404', () => {
        const res = mockRes();
        apiNotFoundHandler({ method: 'GET', baseUrl: '/api', path: '/nope' } as unknown as Request, res as unknown as Response);
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ success: false, code: 'ROUTE_NOT_FOUND' });
    });
});
