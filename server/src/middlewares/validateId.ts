import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that validates :id (or custom param) is a valid positive integer.
 * Returns 400 if the parameter is NaN or <= 0.
 */
export const validateId = (paramName: string = 'id') => {
    return (req: Request, res: Response, next: NextFunction) => {
        const raw = req.params[paramName];
        if (raw === undefined) return next();

        const parsed = parseInt(raw, 10);
        if (isNaN(parsed) || parsed <= 0) {
            return res.status(400).json({
                success: false,
                message: `${paramName} inválido: debe ser un entero positivo`
            });
        }
        next();
    };
};
