import { Request, Response, NextFunction } from 'express';
import { normalizeError } from '../utils/error';

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
    'JWT_SECRET environment variable is not configured',
    'No se pudo conectar a la base de datos. Arranca MySQL o revisa DATABASE_URL.',
    'Cuenta bloqueada temporalmente',
    'Código inválido',
    'La nueva contraseña debe ser diferente a la actual',
    'Contraseña actual incorrecta',
]);

function isSafeMessage(msg: string): boolean {
    if (SAFE_ERROR_MESSAGES.has(msg)) return true;
    // Allow messages that start with known safe prefixes
    const safePrefixes = [
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
        // Legacy English prefixes for service-layer errors not yet translated
        'Amount exceeds',
        'Remaining:',
        'Cannot ',
        'Insufficient stock',
        'Invalid ID',
        'Account temporarily locked',
        'No active cash shift',
        'Product ',
        'Order status transition',
        'Order has existing payments',
        'Invalid order status',
        'Only orders with status',
    ];
    return safePrefixes.some(prefix => msg.startsWith(prefix));
}

export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction
) => {
    const { statusCode, message: errMessage, stack } = normalizeError(err);

    // Log full error server-side (sanitize sensitive data)
    console.error('Error:', {
        message: errMessage,
        statusCode,
        path: req.path,
        method: req.method,
        ...(process.env.NODE_ENV === 'development' && stack && { stack })
    });

    const rawMessage = errMessage || 'Error interno del servidor';

    // Only forward safe messages to client; generic message for everything else
    const message = statusCode < 500 && isSafeMessage(rawMessage)
        ? rawMessage
        : statusCode === 503 && isSafeMessage(rawMessage)
            ? rawMessage
            : statusCode >= 500
                ? 'Error interno del servidor'
                : rawMessage.length < 200 && isSafeMessage(rawMessage) ? rawMessage : 'Ocurrió un error';

    res.status(statusCode).json({
        success: false,
        message,
    });
};
