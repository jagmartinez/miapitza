import type { NextFunction, Request, Response } from 'express';

/** Reject undeclared body properties before they can reach a privileged HR service. */
export function allowHrBodyFields(allowed: readonly string[]) {
    const allowlist = new Set(allowed);
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            res.status(400).json({ success: false, message: 'El cuerpo debe ser un objeto JSON' });
            return;
        }
        const unknown = Object.keys(req.body).filter((field) => !allowlist.has(field));
        if (unknown.length > 0) {
            res.status(400).json({
                success: false,
                message: 'El cuerpo contiene campos no permitidos',
                errors: unknown.map((field) => ({ field: `body.${field}`, message: 'Campo no permitido' })),
            });
            return;
        }
        next();
    };
}
