/**
 * Typed business errors of the customer survey. `code` is the stable machine
 * identifier clients branch on; the error handler echoes `code`/`statusCode`.
 */
export type SurveyErrorCode =
    | 'SURVEY_DEVICE_REQUIRED'
    | 'SURVEY_ORDER_NOT_FOUND'
    | 'SURVEY_ORDER_NOT_PAID'
    | 'SURVEY_INVALID';

const SURVEY_ERROR_STATUS: Record<SurveyErrorCode, number> = {
    SURVEY_DEVICE_REQUIRED: 403,
    SURVEY_ORDER_NOT_FOUND: 404,
    SURVEY_ORDER_NOT_PAID: 409,
    SURVEY_INVALID: 400,
};

const SURVEY_ERROR_MESSAGE: Record<SurveyErrorCode, string> = {
    SURVEY_DEVICE_REQUIRED: 'La encuesta solo puede registrarse desde una tablet de servicio autorizada',
    SURVEY_ORDER_NOT_FOUND: 'Cuenta no encontrada',
    SURVEY_ORDER_NOT_PAID: 'La cuenta aun no esta pagada',
    SURVEY_INVALID: 'Datos de encuesta invalidos',
};

export class SurveyError extends Error {
    readonly statusCode: number;

    constructor(readonly code: SurveyErrorCode, message?: string) {
        super(message ?? SURVEY_ERROR_MESSAGE[code]);
        this.name = 'SurveyError';
        this.statusCode = SURVEY_ERROR_STATUS[code];
    }
}
