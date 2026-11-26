import { Request, Response, NextFunction } from 'express';
import { normalizeError } from '../utils/error';

/**
 * Central Express error boundary.
 *
 * Contract (every error response): `{ success: false, message, code?, details? }`.
 * - `message` is always Spanish and safe to show to the operator.
 * - `code` is a stable machine-readable identifier when one is known.
 * - `details` only carries field-level validation issues (never internals).
 * - Stack traces and raw driver/ORM messages are only logged server-side.
 */

export const GENERIC_SERVER_ERROR_MESSAGE = 'Error interno del servidor';

/** Messages safe to forward to the client */
const SAFE_ERROR_MESSAGES = new Set([
    'Credenciales inválidas',
    'Token no proporcionado',
    'Sesión revocada o expirada',
    'Usuario no encontrado o inactivo',
    'Token inválido o expirado',
    'Permisos insuficientes',
    'No autenticado',
    'Orden no encontrada',
    'Orden ya pagada',
    'No se pueden pagar órdenes canceladas',
    'Pago no encontrado',
    'Platillo no encontrado',
    'Platillo no está activo',
    'Artículo no encontrado',
    'Usuario no encontrado',
    'Método de pago inválido o inactivo',
    'No se puede enviar una orden vacía a cocina',
    'No se pueden cancelar órdenes pagadas',
    'No se pueden agregar artículos a órdenes pagadas o canceladas',
    'No se pueden eliminar artículos de órdenes pagadas o canceladas',
    'La orden debe estar pagada antes de completar',
    '2FA no configurado',
    '2FA no está habilitado',
    'Código requerido',
    'Usuario y contraseña son requeridos',
    'Contraseña actual y nueva son requeridas',
    'Código 2FA inválido',
    'No se pudo conectar a la base de datos. Arranca MySQL o revisa DATABASE_URL.',
    'Cuenta bloqueada temporalmente',
    'Código inválido',
    'La nueva contraseña debe ser diferente a la actual',
    'Contraseña actual incorrecta',
]);

const SAFE_PREFIXES = [
    'El monto excede',
    'Restante:',
    'No se puede',
    'No se pueden',
    'Stock insuficiente',
    'La contraseña',
    'La nueva contraseña',
    'ID inválido',
    'Cuenta bloqueada temporalmente',
    'No hay turno de caja activo',
    'No autorizado',
    'Su usuario no tiene',
    'Producto ',
    'Transición de estado de orden',
    'La orden tiene pagos existentes',
    'Estado de orden inválido',
    'Solo órdenes con estado',
    'La referencia ',
    'Campos no permitidos en movimiento manual',
    'La fecha del documento ',
    'Tipo de documento inválido',
    // Legacy English prefixes for service-layer errors not yet translated
    'Amount exceeds',
    'Remaining:',
    'Cannot ',
    'Insufficient stock',
    'Invalid ID',
    'No active cash shift',
    'Product ',
    'Order status transition',
    'Order has existing payments',
    'Invalid order status',
    'Only orders with status',
];

/** Fragments that reveal internals (driver, ORM, JS runtime, file paths). */
const INTERNAL_LEAK_PATTERN = /prisma|invocation|ECONN|ETIMEDOUT|ENOTFOUND|EADDR|\bSQL\b|sqlState|stack|at [\w.<>]+ \(|node_modules|[A-Z]:\\|\/src\/|undefined|\bnull\b|\bNaN\b|is not a function|is not iterable|is not defined|is not a constructor|Cannot read propert|Cannot set propert|Cannot destructure|Unexpected token|Unexpected end of JSON input|JSON\.parse|Maximum call stack|JWT_SECRET|DATABASE_URL|environment variable/i;

/**
 * Internal machine identifiers embedded in prose (REVERSAL_PROVENANCE_MISSING,
 * STORAGE_DIR, READINESS_DB_DOWN…). Case-sensitive on purpose: Spanish prose
 * never looks like this, while env vars and internal codes always do.
 */
const INTERNAL_CODE_PATTERN = /\b[A-Z]{3,}_[A-Z_]{3,}/;

/** True when a message carries driver/runtime text or internal identifiers. */
export function leaksInternals(msg: string): boolean {
    return INTERNAL_LEAK_PATTERN.test(msg) || INTERNAL_CODE_PATTERN.test(msg);
}

const MAX_CLIENT_MESSAGE_LENGTH = 300;

/** Machine codes such as `HR_PAYROLL_INVALID` — forwarded as `code`, never as text. */
const STABLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

export function isSafeMessage(msg: string): boolean {
    if (SAFE_ERROR_MESSAGES.has(msg)) return true;
    // Prefixes such as 'Cannot ' also start JS runtime errors
    // ("Cannot read properties of undefined"), so they never whitelist leaks.
    return SAFE_PREFIXES.some(prefix => msg.startsWith(prefix)) && !leaksInternals(msg);
}

/** A message authored by the domain layer that can be shown verbatim. */
function isPresentableMessage(msg: string): boolean {
    const trimmed = msg.trim();
    return trimmed.length > 0
        && trimmed.length <= MAX_CLIENT_MESSAGE_LENGTH
        && !STABLE_CODE_PATTERN.test(trimmed)
        && !leaksInternals(trimmed);
}

export interface ClassifiedError {
    status: number;
    message: string;
    code?: string;
    details?: Array<{ field?: string; message: string }>;
    /** Extra flat fields a domain error wants echoed (e.g. `occupiedBy`). */
    extras?: Record<string, unknown>;
    /** Extra response headers (e.g. `Retry-After` for transient conflicts). */
    headers?: Record<string, string>;
}

type ErrorBag = Record<string, unknown> & { name?: unknown; code?: unknown; message?: unknown };

const asBag = (err: unknown): ErrorBag =>
    (typeof err === 'object' && err !== null ? err as ErrorBag : {});

const stringOrUndefined = (value: unknown): string | undefined =>
    (typeof value === 'string' && value.length > 0 ? value : undefined);

const explicitCode = (bag: ErrorBag): string | undefined => {
    const code = stringOrUndefined(bag.code);
    return code && STABLE_CODE_PATTERN.test(code) ? code : undefined;
};

const explicitStatus = (bag: ErrorBag): number | undefined => {
    const candidate = typeof bag.statusCode === 'number' ? bag.statusCode
        : typeof bag.status === 'number' ? bag.status
            : undefined;
    return candidate && candidate >= 400 && candidate <= 599 ? candidate : undefined;
};

function classifyPrisma(bag: ErrorBag): ClassifiedError | null {
    const name = stringOrUndefined(bag.name) || '';
    const code = stringOrUndefined(bag.code) || '';
    if (name === 'PrismaClientValidationError') {
        return { status: 400, code: 'INVALID_DATA', message: 'Los datos enviados tienen un formato inválido. Revisa los campos e intenta de nuevo.' };
    }
    if (name === 'PrismaClientInitializationError' || /^P10(01|02|17)$/.test(code)) {
        return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'La base de datos no está disponible en este momento. Intenta de nuevo en unos segundos.' };
    }
    if (!/^P\d{4}$/.test(code) || (name && !name.startsWith('PrismaClient'))) return null;
    switch (code) {
        case 'P2002':
            // Never expose column/index names: they are schema internals.
            return { status: 409, code: 'DUPLICATE', message: 'Ya existe un registro con esos datos. Verifica que no esté duplicado.' };
        case 'P2025':
            // Raised by update/delete/connect when the target row vanished,
            // typically because another user deleted or changed it concurrently.
            return { status: 404, code: 'RECORD_NOT_FOUND_OR_CHANGED', message: 'El registro no existe o fue modificado por otro usuario; recargue e intente de nuevo.' };
        case 'P2001':
            return { status: 404, code: 'NOT_FOUND', message: 'El registro solicitado no existe o fue eliminado.' };
        case 'P2003':
        case 'P2014':
            return { status: 409, code: 'RELATED_RECORDS', message: 'No se puede completar la operación porque el registro está relacionado con otros datos.' };
        case 'P2034':
            // Deadlock / write conflict: transient, the transaction was rolled
            // back. 503 + Retry-After lets offline sync and idempotent retries
            // try again instead of treating it as a permanent rejection.
            return {
                status: 503,
                code: 'CONCURRENT_UPDATE',
                message: 'Otro usuario modificó estos datos al mismo tiempo. Intenta de nuevo en unos segundos.',
                headers: { 'Retry-After': '1' },
            };
        case 'P2000':
            return { status: 400, code: 'VALUE_TOO_LONG', message: 'Uno de los valores excede la longitud permitida.' };
        case 'P2011':
        case 'P2012':
            return { status: 400, code: 'MISSING_FIELD', message: 'Falta un dato obligatorio para completar la operación.' };
        case 'P2024':
            return { status: 503, code: 'DATABASE_BUSY', message: 'El servidor está ocupado. Intenta de nuevo en unos segundos.' };
        default:
            return null;
    }
}

function classifyFramework(bag: ErrorBag): ClassifiedError | null {
    const name = stringOrUndefined(bag.name) || '';
    const type = stringOrUndefined(bag.type) || '';
    const code = stringOrUndefined(bag.code) || '';

    // body-parser / express.json
    if (type === 'entity.parse.failed') {
        return { status: 400, code: 'INVALID_JSON', message: 'La solicitud no tiene un formato JSON válido.' };
    }
    if (type === 'entity.too.large') {
        return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'La información enviada es demasiado grande. Reduce el tamaño del archivo o los datos.' };
    }
    if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
        return { status: 415, code: 'UNSUPPORTED_ENCODING', message: 'La codificación de la solicitud no es compatible.' };
    }

    if (name === 'MulterError') {
        if (code === 'LIMIT_FILE_SIZE') {
            return { status: 413, code: 'FILE_TOO_LARGE', message: 'El archivo excede el tamaño máximo permitido.' };
        }
        if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
            return { status: 400, code: 'INVALID_UPLOAD', message: 'Se enviaron más archivos de los permitidos o en un campo no esperado.' };
        }
        return { status: 400, code: 'INVALID_UPLOAD', message: 'No se pudo procesar el archivo enviado.' };
    }

    if (name === 'TokenExpiredError') {
        return { status: 401, code: 'SESSION_EXPIRED', message: 'Tu sesión expiró. Inicia sesión de nuevo.' };
    }
    if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
        return { status: 401, code: 'INVALID_TOKEN', message: 'Sesión inválida. Inicia sesión de nuevo.' };
    }

    if (name === 'ZodError' && Array.isArray(bag.issues)) {
        const details = (bag.issues as Array<{ path?: unknown[]; message?: unknown }>)
            .slice(0, 20)
            .map(issue => ({
                field: Array.isArray(issue.path) && issue.path.length ? issue.path.join('.') : undefined,
                message: typeof issue.message === 'string' ? issue.message : 'Valor inválido',
            }));
        return { status: 400, code: 'VALIDATION_ERROR', message: 'Hay datos inválidos en el formulario. Revisa los campos marcados.', details };
    }

    if (name === 'ExternalHttpTimeoutError') {
        return { status: 504, code: 'EXTERNAL_TIMEOUT', message: 'La integración externa no respondió a tiempo. Intenta de nuevo más tarde.' };
    }

    return null;
}

/**
 * Plain `new Error('...')` thrown by legacy services arrives without a status.
 * Infer a 4xx only for Spanish domain messages that clearly describe a
 * client-side condition; anything else stays a masked 500.
 */
function inferDomainStatus(message: string): number | null {
    if (!isPresentableMessage(message)) return null;
    if (/no encontrad[oa]s?\b|no existe/i.test(message)) return 404;
    if (/ya existe|duplicad[oa]|ya fue|ya está|ya se encuentra|ya tiene/i.test(message)) return 409;
    if (/^(No se puede|No se pueden|Stock insuficiente|Insufficient stock|Cannot |No hay turno de caja activo|No active cash shift|Solo órdenes con estado|Only orders with status|Transición de estado|Order status transition|La orden tiene pagos|Order has existing payments)/i.test(message)) return 409;
    if (/requerid[oa]s?\b|obligatori[oa]|inválid[oa]s?\b|debe ser|debe tener|debe estar|formato|no permitid[oa]|excede|fuera de rango|mayor que|menor que|^Invalid |^Amount exceeds/i.test(message)) return 400;
    return null;
}

/** Plain-object `extras` attached by a typed domain error (never overrides core fields). */
function domainExtras(bag: ErrorBag): Record<string, unknown> | undefined {
    const extras = bag.extras;
    if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) return undefined;
    const { success: _s, message: _m, code: _c, details: _d, ...rest } = extras as Record<string, unknown>;
    return Object.keys(rest).length > 0 ? rest : undefined;
}

export function classifyError(err: unknown): ClassifiedError {
    const bag = asBag(err);
    const framework = classifyFramework(bag) ?? classifyPrisma(bag);
    if (framework) return framework;

    const { statusCode, message: rawMessage } = normalizeError(err);
    const message = (rawMessage || '').trim();
    const status = explicitStatus(bag) ?? statusCode;
    const code = explicitCode(bag);
    const name = stringOrUndefined(bag.name) || '';

    // Some legacy controllers wrap domain errors with a generic 500. Preserve
    // the authorization semantics for branch-scope failures at the boundary.
    if (status === 500 && (message.startsWith('No autorizado') || message.startsWith('Su usuario no tiene una sucursal activa'))) {
        return { status: 403, code: code ?? 'FORBIDDEN', message };
    }

    if (status < 500) {
        // Errors given an explicit 4xx by our own code are intentional domain
        // messages; forward them unless they look like leaked internals.
        if (isSafeMessage(message) || isPresentableMessage(message)) {
            const extras = domainExtras(bag);
            return { status, message, ...(code && { code }), ...(extras && { extras }) };
        }
        return { status, message: defaultMessageForStatus(status), ...(code && { code }) };
    }

    if (status === 500) {
        // Domain validation classes that forgot a statusCode.
        if (/ValidationError$/.test(name)) {
            return {
                status: 400,
                message: isPresentableMessage(message) ? message : defaultMessageForStatus(400),
                code: code ?? (STABLE_CODE_PATTERN.test(message) ? message : 'VALIDATION_ERROR'),
            };
        }
        // Only plain Errors are inferred: TypeError/RangeError/etc are bugs.
        if (name === 'Error' || name === '') {
            const inferred = inferDomainStatus(message);
            if (inferred) return { status: inferred, message, ...(code && { code }) };
        }
        return { status: 500, code: 'INTERNAL_ERROR', message: GENERIC_SERVER_ERROR_MESSAGE };
    }

    // 501-599: forward explicit, presentable availability messages (e.g. 503 provider down).
    if (isSafeMessage(message) || (explicitStatus(bag) && isPresentableMessage(message))) {
        return { status, message, ...(code && { code }) };
    }
    return { status, message: defaultMessageForStatus(status), ...(code && { code }) };
}

export function defaultMessageForStatus(status: number): string {
    switch (status) {
        case 400: return 'La solicitud tiene datos inválidos. Revisa la información e intenta de nuevo.';
        case 401: return 'Tu sesión expiró. Inicia sesión de nuevo.';
        case 403: return 'No tienes permiso para realizar esta acción.';
        case 404: return 'El recurso solicitado no existe.';
        case 409: return 'La operación entra en conflicto con el estado actual de los datos. Recarga e intenta de nuevo.';
        case 413: return 'La información enviada es demasiado grande.';
        case 422: return 'No se pudo procesar la información enviada.';
        case 428: return 'Falta una condición previa para completar la operación. Recarga e intenta de nuevo.';
        case 429: return 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.';
        case 502:
        case 503:
        case 504: return 'El servicio no está disponible en este momento. Intenta de nuevo en unos segundos.';
        default: return status >= 500 ? GENERIC_SERVER_ERROR_MESSAGE : 'Ocurrió un error';
    }
}

/** JSON 404 for unknown API routes (Express' default is an HTML page). */
export const apiNotFoundHandler = (req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: `La ruta solicitada no existe: ${req.method} ${req.baseUrl}${req.path}`.slice(0, 200),
    });
};

export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (res.headersSent) {
        return next(err);
    }

    const classified = classifyError(err);
    const { message: logMessage, stack } = normalizeError(err);

    // Log full error server-side; stack only outside production.
    // Expected cash-domain rejections (CASH_*, 4xx) are not server faults.
    const logError = classified.status < 500 && classified.code?.startsWith('CASH_') ? console.warn : console.error;
    logError('Error:', {
        message: logMessage,
        statusCode: classified.status,
        code: classified.code,
        path: req.path,
        method: req.method,
        ...(process.env.NODE_ENV !== 'production' && stack && { stack }),
    });

    if (classified.headers) {
        for (const [name, value] of Object.entries(classified.headers)) res.setHeader(name, value);
    }
    res.status(classified.status).json({
        success: false,
        message: classified.message,
        ...(classified.code && { code: classified.code }),
        ...(classified.details && classified.details.length > 0 && { details: classified.details }),
        ...(classified.extras && classified.extras),
    });
};
