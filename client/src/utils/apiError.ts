/**
 * Turns any thrown value (axios error, offline queue marker, JS Error, string)
 * into a Spanish, operator-facing description. Pure: no DOM/React access other
 * than an optional `navigator.onLine` read, so it is safe in tests and workers.
 */

export type ApiErrorKind =
    | 'offline'
    | 'network'
    | 'timeout'
    | 'canceled'
    | 'validation'
    | 'auth'
    | 'forbidden'
    | 'notFound'
    | 'conflict'
    | 'payloadTooLarge'
    | 'precondition'
    | 'rateLimit'
    | 'server'
    | 'unavailable'
    | 'chunkLoad'
    | 'client'
    | 'unknown';

export interface DescribedError {
    /** Final message to show (already includes context and validation details). */
    message: string;
    kind: ApiErrorKind;
    status?: number;
    code?: string;
    /** Server/field level details, already formatted as "campo: mensaje". */
    details: string[];
    /** True when trying again later can plausibly succeed. */
    retryable: boolean;
}

export const GENERIC_ERROR_MESSAGE = 'Ocurrió un error inesperado. Intenta de nuevo; si se repite, recarga la página.';

export const STATUS_MESSAGES: Record<number, string> = {
    400: 'La solicitud tiene datos inválidos. Revisa la información e intenta de nuevo.',
    401: 'Tu sesión expiró. Inicia sesión de nuevo.',
    403: 'No tienes permiso para realizar esta acción. Solicita acceso a un administrador.',
    404: 'El registro solicitado no existe o fue eliminado. Recarga la página.',
    408: 'El servidor tardó demasiado en responder. Intenta de nuevo.',
    409: 'Los datos cambiaron mientras trabajabas o la operación ya se realizó. Recarga e intenta de nuevo.',
    413: 'El archivo o la información enviada es demasiado grande. Reduce el tamaño e intenta de nuevo.',
    415: 'El tipo de archivo o formato enviado no es compatible.',
    422: 'No se pudo procesar la información enviada. Revisa los datos.',
    428: 'La operación requiere confirmar que los datos están actualizados. Recarga e intenta de nuevo.',
    429: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
    500: 'Error interno del servidor. Intenta de nuevo; si persiste, contacta al administrador.',
    502: 'El servidor no está disponible en este momento. Intenta de nuevo en unos segundos.',
    503: 'El servidor no está disponible en este momento. Intenta de nuevo en unos segundos.',
    504: 'El servidor tardó demasiado en responder. Intenta de nuevo en unos segundos.',
};

export const OFFLINE_MESSAGE = 'Sin conexión a internet. Verifica la red; la operación no se completó.';
export const NETWORK_MESSAGE = 'No se pudo conectar con el servidor. Verifica tu conexión o que el servidor esté en línea.';
export const TIMEOUT_MESSAGE = STATUS_MESSAGES[408];
export const CHUNK_LOAD_MESSAGE = 'No se pudo cargar esta sección (posible nueva versión o conexión inestable). Recarga la página.';

/** Server texts that are placeholders rather than an explanation. */
const GENERIC_SERVER_TEXTS = new Set([
    'error interno del servidor',
    'internal server error',
    'ocurrió un error',
    'error',
    'network error',
    'request failed',
    'error de validación',
    'validation error',
    'bad request',
    'not found',
    'forbidden',
    'unauthorized',
]);

/** Legacy English server messages still emitted by some endpoints. */
const ENGLISH_TRANSLATIONS: Array<[RegExp, string]> = [
    [/^insufficient permissions?$/i, STATUS_MESSAGES[403]],
    [/^too many (requests|attempts|webhook requests)/i, STATUS_MESSAGES[429]],
    [/^invalid id/i, 'El identificador enviado no es válido.'],
    [/^(invalid|expired) token|^jwt expired/i, STATUS_MESSAGES[401]],
    [/^route not found|^cannot (get|post|put|patch|delete) \//i, 'La función solicitada no existe en el servidor. Actualiza la aplicación.'],
    [/^insufficient stock/i, 'Stock insuficiente para completar la operación.'],
    [/^no active cash shift/i, 'No hay turno de caja activo. Abre un turno antes de continuar.'],
];

/** Looks like a JS/runtime/driver message rather than something written for a person. */
const TECHNICAL_MESSAGE_PATTERN = /is not a function|is not defined|Cannot read propert|undefined|\bnull\b|Unexpected token|JSON\.parse|NetworkError|Failed to fetch|Load failed|prisma|ECONN|ETIMEDOUT|stack|at [\w.<>]+ \(|Request failed with status code|timeout of \d+ms exceeded|AbortError|^\w+Error:/i;

const CHUNK_LOAD_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|ChunkLoadError/i;

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null;
const str = (value: unknown): string | undefined =>
    (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);

function isBrowserOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function translateKnown(message: string): string {
    for (const [pattern, replacement] of ENGLISH_TRANSLATIONS) {
        if (pattern.test(message)) return replacement;
    }
    return message;
}

function isUsefulServerMessage(message: string | undefined): message is string {
    if (!message) return false;
    if (GENERIC_SERVER_TEXTS.has(message.toLowerCase().replace(/[.!]+$/, ''))) return false;
    if (message.length > 400) return false;
    if (/^\s*</.test(message)) return false; // HTML error page
    return !TECHNICAL_MESSAGE_PATTERN.test(message);
}

function formatDetail(entry: unknown): string | undefined {
    if (typeof entry === 'string') return str(entry);
    if (!isBag(entry)) return undefined;
    const message = str(entry.message) ?? str(entry.msg) ?? str(entry.error);
    if (!message) return undefined;
    const rawField = str(entry.field) ?? str(entry.path) ?? (Array.isArray(entry.path) ? entry.path.join('.') : undefined) ?? str(entry.param);
    // Drop transport prefixes such as "body." from validator field names.
    const field = rawField?.replace(/^(body|query|params)\./, '');
    if (!field || message.toLowerCase().includes(field.toLowerCase())) return message;
    return `${field}: ${message}`;
}

function extractDetails(data: Bag): string[] {
    const candidates = [data.details, data.errors, data.issues, data.fieldErrors];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.map(formatDetail).filter((v): v is string => Boolean(v)).slice(0, 5);
        }
        if (isBag(candidate)) {
            // { campo: 'mensaje' } or { campo: ['mensaje'] }
            return Object.entries(candidate)
                .map(([field, value]) => {
                    const message = Array.isArray(value) ? str(value[0]) : str(value);
                    return message ? (message.toLowerCase().includes(field.toLowerCase()) ? message : `${field}: ${message}`) : undefined;
                })
                .filter((v): v is string => Boolean(v))
                .slice(0, 5);
        }
    }
    return [];
}

function kindForStatus(status: number): ApiErrorKind {
    if (status === 400 || status === 422) return 'validation';
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status === 404 || status === 410) return 'notFound';
    if (status === 408) return 'timeout';
    if (status === 409) return 'conflict';
    if (status === 413) return 'payloadTooLarge';
    if (status === 428) return 'precondition';
    if (status === 429) return 'rateLimit';
    if (status === 502 || status === 503 || status === 504) return 'unavailable';
    if (status >= 500) return 'server';
    return 'unknown';
}

function retryAfterSuffix(headers: unknown): string {
    if (!isBag(headers)) return '';
    const getter = (headers as { get?: (name: string) => unknown }).get;
    const raw = typeof getter === 'function' ? getter.call(headers, 'retry-after') : headers['retry-after'];
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 && seconds < 3600
        ? ` Podrás reintentar en ${Math.ceil(seconds)} s.`
        : '';
}

/** Join "No se pudo guardar" + "motivo" without doubled punctuation. */
export function withContext(context: string | undefined, message: string): string {
    const ctx = context?.trim().replace(/[.:;\s]+$/, '');
    if (!ctx) return message;
    if (message.toLowerCase().startsWith(ctx.toLowerCase())) return message;
    return `${ctx}: ${message}`;
}

export function isCanceledError(error: unknown): boolean {
    if (!isBag(error)) return false;
    return error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError' || error.__CANCEL__ === true;
}

/**
 * Describe any thrown value. `context` is an optional lead such as
 * "No se pudo guardar el producto"; it is prefixed to the reason.
 */
export function describeApiError(error: unknown, context?: string): DescribedError {
    const build = (base: Omit<DescribedError, 'message'> & { reason: string }): DescribedError => {
        const detailText = base.details.length > 0 ? ` (${base.details.join('; ')})` : '';
        return {
            kind: base.kind,
            status: base.status,
            code: base.code,
            details: base.details,
            retryable: base.retryable,
            message: withContext(context, `${base.reason}${detailText}`),
        };
    };

    if (error === null || error === undefined) {
        return build({ kind: 'unknown', details: [], retryable: true, reason: GENERIC_ERROR_MESSAGE });
    }

    if (typeof error === 'string') {
        const text = translateKnown(error.trim());
        return build({ kind: 'client', details: [], retryable: true, reason: isUsefulServerMessage(text) ? text : GENERIC_ERROR_MESSAGE });
    }

    if (!isBag(error)) {
        return build({ kind: 'unknown', details: [], retryable: true, reason: GENERIC_ERROR_MESSAGE });
    }

    if (isCanceledError(error)) {
        return build({ kind: 'canceled', details: [], retryable: true, reason: 'La operación fue cancelada.' });
    }

    const response = isBag(error.response) ? error.response : undefined;
    const isAxios = error.isAxiosError === true || response !== undefined || isBag(error.config);

    if (isAxios) {
        if (!response) {
            const code = str(error.code);
            if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(str(error.message) ?? '')) {
                return build({ kind: 'timeout', code, details: [], retryable: true, reason: TIMEOUT_MESSAGE });
            }
            if (isBrowserOffline()) {
                return build({ kind: 'offline', code, details: [], retryable: true, reason: OFFLINE_MESSAGE });
            }
            return build({ kind: 'network', code, details: [], retryable: true, reason: NETWORK_MESSAGE });
        }

        const status = typeof response.status === 'number' ? response.status : 0;
        const data = response.data;
        let serverMessage: string | undefined;
        let code: string | undefined;
        let details: string[] = [];
        if (isBag(data) && !(typeof Blob !== 'undefined' && data instanceof Blob) && !(data instanceof ArrayBuffer)) {
            serverMessage = str(data.message) ?? str(data.error) ?? (isBag(data.error) ? str(data.error.message) : undefined);
            code = str(data.code) ?? (isBag(data.error) ? str(data.error.code) : undefined);
            details = extractDetails(data);
        } else if (typeof data === 'string') {
            serverMessage = str(data);
        }
        if (serverMessage) serverMessage = translateKnown(serverMessage);

        const kind = status ? kindForStatus(status) : 'unknown';
        const fallback = STATUS_MESSAGES[status]
            ?? (status >= 500 ? STATUS_MESSAGES[500] : status >= 400 ? STATUS_MESSAGES[400] : GENERIC_ERROR_MESSAGE);
        let reason = isUsefulServerMessage(serverMessage) ? serverMessage : fallback;
        if (kind === 'rateLimit') reason += retryAfterSuffix(response.headers);
        // When only details are informative, lead with the status explanation.
        const retryable = kind === 'network' || kind === 'timeout' || kind === 'rateLimit' || kind === 'unavailable' || kind === 'server' || kind === 'conflict';
        return build({ kind, status: status || undefined, code, details, retryable, reason });
    }

    // Marker produced by the offline request interceptor.
    if (error.isOfflineQueue === true) {
        return build({ kind: 'offline', details: [], retryable: true, reason: 'Sin conexión: la operación quedó pendiente de sincronizar.' });
    }

    const message = str(error.message);
    const name = str(error.name) ?? '';
    if (message && CHUNK_LOAD_PATTERN.test(message)) {
        return build({ kind: 'chunkLoad', details: [], retryable: true, reason: CHUNK_LOAD_MESSAGE });
    }
    if (message && (name === 'TypeError' && /Failed to fetch|NetworkError|Load failed/i.test(message))) {
        return build({ kind: isBrowserOffline() ? 'offline' : 'network', details: [], retryable: true, reason: isBrowserOffline() ? OFFLINE_MESSAGE : NETWORK_MESSAGE });
    }
    // Plain `new Error('Seleccione una sucursal')` thrown by app code is meant for people;
    // TypeError/ReferenceError/etc. are bugs and get the generic text.
    const isPlainError = name === '' || name === 'Error';
    if (message && isPlainError && isUsefulServerMessage(message)) {
        return build({ kind: 'client', details: [], retryable: false, reason: translateKnown(message) });
    }
    return build({ kind: 'client', details: [], retryable: true, reason: GENERIC_ERROR_MESSAGE });
}

/** Short form for `setError(getApiErrorMessage(err, 'No se pudo cargar…'))`. */
export function getApiErrorMessage(error: unknown, context?: string): string {
    return describeApiError(error, context).message;
}
