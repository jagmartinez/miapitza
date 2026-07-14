import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldRule {
    type: 'string' | 'number' | 'boolean' | 'email' | 'date' | 'array' | 'object';
    required?: boolean;
    min?: number;   // min length for string/array, min value for number
    max?: number;   // max length for string/array, max value for number
    enum?: string[];
    pattern?: RegExp;
    integer?: boolean;
    items?: FieldRule;
    properties?: Record<string, FieldRule>;
}

export interface ValidationSchema {
    body?: Record<string, FieldRule>;
    query?: Record<string, FieldRule>;
    params?: Record<string, FieldRule>;
}

interface ValidationError {
    field: string;
    message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function coerce(value: unknown, type: FieldRule['type']): unknown {
    if (value === undefined || value === null || value === '') return undefined;

    switch (type) {
        case 'number': {
            const n = Number(value);
            return Number.isNaN(n) ? value : n;
        }
        case 'boolean': {
            if (value === 'true' || value === '1') return true;
            if (value === 'false' || value === '0') return false;
            return value;
        }
        default:
            return value;
    }
}

function validateField(
    rawValue: unknown,
    rule: FieldRule,
    fieldPath: string,
): ValidationError | null {
    const value = coerce(rawValue, rule.type);

    // ---- required check ----
    if (value === undefined || value === null || value === '') {
        return rule.required
            ? { field: fieldPath, message: 'Campo requerido' }
            : null; // optional & absent → OK, skip the rest
    }

    // ---- type check ----
    switch (rule.type) {
        case 'string':
            if (typeof value !== 'string') {
                return { field: fieldPath, message: 'Debe ser una cadena de texto' };
            }
            break;

        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return { field: fieldPath, message: 'Debe ser un número válido' };
            }
            if (rule.integer && !Number.isInteger(value)) {
                return { field: fieldPath, message: 'Debe ser un número entero' };
            }
            break;

        case 'boolean':
            if (typeof value !== 'boolean') {
                return { field: fieldPath, message: 'Debe ser un valor booleano' };
            }
            break;

        case 'email':
            if (typeof value !== 'string' || !EMAIL_RE.test(value)) {
                return { field: fieldPath, message: 'Formato de email inválido' };
            }
            break;

        case 'date':
            if (typeof value !== 'string' || !ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
                return { field: fieldPath, message: 'Formato de fecha inválido' };
            }
            break;

        case 'array':
            if (!Array.isArray(value)) {
                return { field: fieldPath, message: 'Debe ser un arreglo' };
            }
            break;

        case 'object':
            if (typeof value !== 'object' || Array.isArray(value)) {
                return { field: fieldPath, message: 'Debe ser un objeto' };
            }
            break;
    }

    // ---- nested array/object validation ----
    if (rule.type === 'array' && Array.isArray(value) && rule.items) {
        for (let index = 0; index < value.length; index++) {
            const error = validateField(value[index], rule.items, `${fieldPath}[${index}]`);
            if (error) return error;
        }
    }
    if (rule.type === 'object' && typeof value === 'object' && value !== null && rule.properties) {
        const objectValue = value as Record<string, unknown>;
        for (const [property, propertyRule] of Object.entries(rule.properties)) {
            const error = validateField(objectValue[property], propertyRule, `${fieldPath}.${property}`);
            if (error) return error;
        }
    }

    // ---- min / max ----
    if (rule.min !== undefined) {
        if ((rule.type === 'string' || rule.type === 'email') && typeof value === 'string' && value.length < rule.min) {
            return { field: fieldPath, message: `Longitud mínima: ${rule.min} caracteres` };
        }
        if (rule.type === 'number' && typeof value === 'number' && value < rule.min) {
            return { field: fieldPath, message: `Valor mínimo: ${rule.min}` };
        }
        if (rule.type === 'array' && Array.isArray(value) && value.length < rule.min) {
            return { field: fieldPath, message: `Mínimo ${rule.min} elementos` };
        }
    }

    if (rule.max !== undefined) {
        if ((rule.type === 'string' || rule.type === 'email') && typeof value === 'string' && value.length > rule.max) {
            return { field: fieldPath, message: `Longitud máxima: ${rule.max} caracteres` };
        }
        if (rule.type === 'number' && typeof value === 'number' && value > rule.max) {
            return { field: fieldPath, message: `Valor máximo: ${rule.max}` };
        }
        if (rule.type === 'array' && Array.isArray(value) && value.length > rule.max) {
            return { field: fieldPath, message: `Máximo ${rule.max} elementos` };
        }
    }

    // ---- enum ----
    if (rule.enum && !rule.enum.includes(String(value))) {
        return { field: fieldPath, message: `Valor debe ser uno de: ${rule.enum.join(', ')}` };
    }

    // ---- pattern ----
    if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
        return { field: fieldPath, message: 'Formato inválido' };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function validate(schema: ValidationSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: ValidationError[] = [];

        for (const source of ['body', 'query', 'params'] as const) {
            const rules = schema[source];
            if (!rules) continue;

            const data: Record<string, unknown> = req[source] ?? {};

            for (const [field, rule] of Object.entries(rules)) {
                const error = validateField(data[field], rule, `${source}.${field}`);
                if (error) errors.push(error);
            }
        }

        if (errors.length > 0) {
            res.status(400).json({
                success: false,
                message: 'Error de validación',
                errors,
            });
            return;
        }

        next();
    };
}

// ---------------------------------------------------------------------------
// Commonly used schemas
// ---------------------------------------------------------------------------

export const schemas = {
    idParam: {
        params: { id: { type: 'number', required: true, min: 1 } },
    },
    pagination: {
        query: {
            page: { type: 'number', min: 1 },
            limit: { type: 'number', min: 1, max: 100 },
        },
    },
    dateRange: {
        query: {
            dateFrom: { type: 'date' },
            dateTo: { type: 'date' },
        },
    },
} satisfies Record<string, ValidationSchema>;
