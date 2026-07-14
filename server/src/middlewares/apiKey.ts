import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { auth } from './auth';
import { SettingService } from '../services/setting.service';

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
            include: { company: { select: { active: true } } }
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

        if (record.company.active !== true) {
            return res
                .status(403)
                .json({ success: false, message: 'Empresa inactiva' });
        }

        if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
            return res
                .status(403)
                .json({ success: false, message: 'API key expirada' });
        }

        // Parse scopes — stored as JSON array
        const scopes: string[] = Array.isArray(record.scopes)
            ? record.scopes.map(String)
            : JSON.parse(String(record.scopes ?? '[]'));

        req.user = {
            userId: 0,
            role: 'API_CLIENT',
            roles: scopes,
            companyId: record.companyId,
            timezone: await SettingService.getTimezone(record.companyId)
        };

        // Fire-and-forget: update lastUsedAt
        prisma.apiKey
            .update({
                where: { id: record.id },
                data: { lastUsedAt: new Date() },
            })
            .catch((error) => console.error(`[ApiKey] Failed to update lastUsedAt for key ${record.id}:`, error));

        next();
    } catch (error) {
        console.error('[ApiKey] Authentication failed due to an operational error:', error);
        return next(error);
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
