import type { Request, Response } from 'express';
import { PedidosYaService } from '../services/pedidosya.service';

export class PedidosYaController {
    static async getConfig(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const branchId = req.query.branchId ? Number(req.query.branchId) : undefined;
            const config = await PedidosYaService.getMaskedConfig(companyId, branchId);
            res.json({ success: true, data: config });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async upsertConfig(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const userId = req.user!.userId;
            const config = await PedidosYaService.upsertConfig(companyId, req.body, userId);
            res.json({ success: true, data: config });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async testConnection(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const result = await PedidosYaService.testConnection(companyId);
            res.json({ success: true, data: result });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getMappings(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const mappings = await PedidosYaService.getMappings(companyId);
            res.json({ success: true, data: mappings });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async upsertMapping(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const mapping = await PedidosYaService.upsertMapping(companyId, req.body);
            res.json({ success: true, data: mapping });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async deleteMapping(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            await PedidosYaService.deleteMapping(companyId, Number(req.params.id));
            res.json({ success: true, message: 'Mapping eliminado' });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getWebhookLogs(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const status = req.query.status as string | undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const logs = await PedidosYaService.getWebhookLogs(companyId, { status, limit });
            res.json({ success: true, data: logs });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async getOrderSyncs(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const syncs = await PedidosYaService.getOrderSyncs(companyId, { limit });
            res.json({ success: true, data: syncs });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    static async syncMenu(req: Request, res: Response) {
        try {
            const companyId = req.user!.companyId;
            const result = await PedidosYaService.syncMenu(companyId);
            res.json({ success: true, data: result });
        } catch (error: unknown) {
            res.status(500).json({ success: false, message: (error as Error).message });
        }
    }

    // ── Webhook Endpoint (public, signature-validated) ──
    static async webhook(req: Request, res: Response) {
        try {
            const signature = req.headers['x-pedidosya-signature'] as string | undefined;
            const companyId = Number(req.params.companyId);

            if (!companyId || isNaN(companyId)) {
                res.status(400).json({ error: 'Invalid company ID' });
                return;
            }

            const config = await PedidosYaService.getConfig(companyId);
            if (!config || !config.webhookSecret) {
                res.status(404).json({ error: 'Configuration not found' });
                return;
            }

            // Signature is mandatory: reject if the header is missing or invalid.
            const secret = PedidosYaService.decryptSecret(config.webhookSecret);
            const rawBody = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
            if (!signature || !secret || !PedidosYaService.validateWebhookSignature(rawBody, signature, secret)) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }

            const eventType = req.body.event || req.body.type || 'UNKNOWN';
            const result = await PedidosYaService.processWebhook(companyId, eventType, req.body);

            res.status(200).json({ received: true, ...result });
        } catch (error: unknown) {
            console.error('[PedidosYa Webhook] Error:', (error as Error).message);
            res.status(500).json({ error: 'Processing failed' });
        }
    }
}
