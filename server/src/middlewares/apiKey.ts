import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { auth } from './auth';

/**
 * Standalone API key authentication middleware.
 * Extracts the key from the `x-api-key` header, validates it against
 * the database, and populates `req.user` with the key's identity.
 */
export const apiKeyAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const apiKey = req.headers['x-api-key'] as string | undefined;

        if (!apiKey) {
            return res
                .status(401)
                .json({ success: false, message: 'API key no proporcionada' });
        }

        const keyHash = crypto
            .createHash('sha256')
            .update(apiKey)
            .digest('hex');

        const record = await prisma.apiKey.findUnique({
            where: { keyHash },
        });

        if (!record) {
            return res
                .status(401)
                .json({ success: false, message: 'API key inválida' });
        }

        if (!record.active) {
            return res
                .status(403)
                .json({ success: false, message: 'API key desactivada' });
        }

        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return res
                .status(403)
                .json({ success: false, message: 'API key expirada' });
        }

        // Parse scopes — stored as JSON array
        const scopes: string[] = Array.isArray(record.scopes)
            ? record.scopes
            : JSON.parse(record.scopes ?? '[]');

        req.user = {
            userId: 0,
            role: 'API_CLIENT',
            roles: scopes,
            companyId: record.companyId,
        };

        // Fire-and-forget: update lastUsedAt
        prisma.apiKey
            .update({
                where: { id: record.id },
                data: { lastUsedAt: new Date() },
            })
            .catch(() => {
                // Silently ignore tracking errors to avoid blocking the request
            });

        next();
    } catch {
        return res
            .status(500)
            .json({ success: false, message: 'Error al validar API key' });
    }
};

/**
 * Combined middleware: tries API key authentication first;
 * if no `x-api-key` header is present, falls back to JWT auth.
 */
export const apiKeyOrJwt = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const apiKey = req.headers['x-api-key'] as string | undefined;

    if (apiKey) {
        return apiKeyAuth(req, res, next);
    }

    // No API key header — delegate to standard JWT auth
    return auth(req, res, next);
};
