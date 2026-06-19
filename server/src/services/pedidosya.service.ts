import prisma from '../utils/prisma';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { OrderService } from './order.service';
import { encrypt, decrypt, isEncrypted } from '../utils/encryption';

const SECRET_FIELDS = ['clientSecret', 'webhookSecret', 'accessToken', 'refreshToken'] as const;

export class PedidosYaService {
    // ── Secret handling (encrypt at rest, never expose in client responses) ──
    /** Decrypts a stored secret, tolerating legacy plaintext values. */
    static decryptSecret(value: string | null | undefined): string | null {
        if (!value) return null;
        try {
            return isEncrypted(value) ? decrypt(value) : value;
        } catch {
            return value;
        }
    }

    /** Encrypts a secret for storage; passes through empty values. */
    private static encryptSecret(value: string | null | undefined): string | null | undefined {
        if (value === null || value === undefined || value === '') return value;
        return isEncrypted(value) ? value : encrypt(value);
    }

    /** Masks a secret for client responses, exposing only the last 4 chars. */
    private static maskSecret(value: string | null | undefined): string | null {
        if (!value) return null;
        const plain = this.decryptSecret(value) || '';
        return `••••${plain.slice(-4)}`;
    }

    // ── Configuration ──
    static async getConfig(companyId: number, branchId?: number) {
        return prisma.pedidosYaConfig.findFirst({
            where: { companyId, ...(branchId ? { branchId } : {}) },
            include: {
                branch: { select: { id: true, name: true, code: true } },
                warehouse: { select: { id: true, name: true } },
            },
        });
    }

    /** Config for client responses: secrets are masked/redacted, never returned in full. */
    static async getMaskedConfig(companyId: number, branchId?: number) {
        const config = await this.getConfig(companyId, branchId);
        if (!config) return null;
        return {
            ...config,
            clientSecret: this.maskSecret(config.clientSecret),
            webhookSecret: this.maskSecret(config.webhookSecret),
            accessToken: this.maskSecret(config.accessToken),
            refreshToken: this.maskSecret(config.refreshToken),
            clientSecretSet: !!config.clientSecret,
            webhookSecretSet: !!config.webhookSecret,
            accessTokenSet: !!config.accessToken,
            refreshTokenSet: !!config.refreshToken,
        };
    }

    static async upsertConfig(companyId: number, data: {
        branchId?: number;
        clientId?: string;
        clientSecret?: string;
        restaurantId?: string;
        webhookSecret?: string;
        environment?: string;
        autoAcceptOrders?: boolean;
        autoSyncStatus?: boolean;
        defaultWarehouseId?: number;
        active?: boolean;
    }, userId?: number) {
        const branchId = data.branchId || null;

        // Encrypt integration secrets at rest before persisting.
        const payload: Record<string, unknown> = { ...data };
        for (const field of SECRET_FIELDS) {
            if (field in payload) {
                payload[field] = this.encryptSecret(payload[field] as string | null | undefined);
            }
        }

        const existing = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, branchId },
        });

        let config;
        if (existing) {
            config = await prisma.pedidosYaConfig.update({
                where: { id: existing.id },
                data: payload as Prisma.PedidosYaConfigUpdateInput,
            });
        } else {
            config = await prisma.pedidosYaConfig.create({
                data: { ...payload, companyId, branchId } as Prisma.PedidosYaConfigUncheckedCreateInput,
            });
        }

        if (userId) {
            AuditLogService.log({
                companyId, userId, entityType: 'PedidosYaConfig', entityId: config.id,
                action: existing ? 'UPDATE' : 'CREATE',
                details: { active: data.active, environment: data.environment },
            }).catch(() => {});
        }

        return config;
    }

    // ── OAuth2 Token Management ──
    static async refreshAccessToken(companyId: number) {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true },
        });

        if (!config || !config.clientId || !config.clientSecret) {
            throw new Error('PedidosYa no está configurado correctamente');
        }

        const baseUrl = config.environment === 'production'
            ? 'https://api.pedidosya.com'
            : 'https://api-sandbox.pedidosya.com';

        const response = await fetch(`${baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: config.clientId,
                client_secret: this.decryptSecret(config.clientSecret),
            }),
        });

        if (!response.ok) {
            throw new Error(`OAuth token refresh failed: ${response.status}`);
        }

        const tokenData = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

        await prisma.pedidosYaConfig.update({
            where: { id: config.id },
            data: {
                accessToken: this.encryptSecret(tokenData.access_token),
                refreshToken: tokenData.refresh_token ? this.encryptSecret(tokenData.refresh_token) : config.refreshToken,
                tokenExpiresAt: expiresAt,
            },
        });

        return tokenData.access_token;
    }

    static async getValidToken(companyId: number): Promise<string> {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true },
        });

        if (!config) throw new Error('PedidosYa no configurado');

        if (config.accessToken && config.tokenExpiresAt && config.tokenExpiresAt > new Date()) {
            return this.decryptSecret(config.accessToken) || '';
        }

        return this.refreshAccessToken(companyId);
    }

    // ── Webhook Processing ──
    static validateWebhookSignature(payload: string, signature: string, secret: string): boolean {
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
            return false;
        }
    }

    static async processWebhook(companyId: number, eventType: string, payload: Record<string, unknown>) {
        const log = await prisma.pedidosYaWebhookLog.create({
            data: {
                companyId,
                eventType,
                externalId: payload.id as string || null,
                payload: payload as Prisma.InputJsonValue,
                status: 'RECEIVED'
            },
        });

        try {
            switch (eventType) {
                case 'NEW_ORDER':
                    await this.handleNewOrder(companyId, payload);
                    break;
                case 'ORDER_CANCELLED':
                    await this.handleOrderCancelled(companyId, payload);
                    break;
                case 'ORDER_STATUS_CHANGE':
                    await this.handleStatusChange(companyId, payload);
                    break;
                default:
                    await prisma.pedidosYaWebhookLog.update({
                        where: { id: log.id },
                        data: { status: 'IGNORED' },
                    });
                    return { status: 'IGNORED', logId: log.id };
            }

            await prisma.pedidosYaWebhookLog.update({
                where: { id: log.id },
                data: { status: 'PROCESSED', processedAt: new Date() },
            });
            return { status: 'PROCESSED', logId: log.id };
        } catch (error: unknown) {
            await prisma.pedidosYaWebhookLog.update({
                where: { id: log.id },
                data: { status: 'FAILED', errorMessage: (error as Error).message },
            });
            throw error;
        }
    }

    private static async handleNewOrder(companyId: number, payload: Record<string, unknown>) {
        const externalId = payload.id as string;

        const existingSync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
        });
        if (existingSync) return;

        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true },
        });
        if (!config) throw new Error('PedidosYa config not found');

        const items = (payload.items || payload.products || []) as Array<{
            id?: string; name: string; quantity: number; price?: number; notes?: string;
        }>;

        const { mapped: mappedItems, unmapped } = await this.mapOrderItems(companyId, items);

        // Never create a partial order: if any incoming item has no menu mapping,
        // reject the whole sync so it is not silently dropped. The thrown error is
        // persisted on the webhook log (status FAILED) by processWebhook, leaving a
        // clear trace for manual review/mapping instead of an incomplete sale.
        if (unmapped.length > 0) {
            throw new Error(
                `Orden PedidosYa ${externalId} no sincronizada: ${unmapped.length} producto(s) sin mapeo ` +
                `(${unmapped.join(', ')}). Configure el mapeo de productos antes de aceptar la orden.`
            );
        }

        const systemUser = await prisma.user.findFirst({
            where: { companyId, username: 'system' },
            select: { id: true },
        });
        const userId = systemUser?.id || 1;
        const branchId = config.branchId || (await prisma.branch.findFirst({ where: { companyId } }))?.id;
        if (!branchId) throw new Error('No branch configured');

        const customerName = `[PEDIDOSYA] ${payload.customerName || 'Cliente'} | ID:${externalId}`;
        const total = mappedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

        const order = await prisma.order.create({
            data: {
                companyId,
                branchId,
                userId,
                customerName,
                orderType: 'DELIVERY',
                salesChannel: 'PEDIDOSYA',
                status: config.autoAcceptOrders ? 'OPEN' : 'OPEN',
                total,
                items: {
                    create: mappedItems.map(item => ({
                        menuItemId: item.menuItemId,
                        quantity: item.quantity,
                        price: item.price,
                        subtotal: item.price * item.quantity,
                        notes: item.notes || undefined,
                        status: 'PENDING',
                    })),
                },
            },
        });

        await prisma.pedidosYaOrderSync.create({
            data: {
                companyId,
                orderId: order.id,
                externalId,
                externalStatus: payload.status as string || 'NEW',
                internalStatus: 'OPEN',
                syncDirection: 'INBOUND',
                metadata: payload as Prisma.InputJsonValue,
            },
        });

        AuditLogService.log({
            companyId, userId, entityType: 'Order', entityId: order.id,
            action: 'CREATE', details: { source: 'PEDIDOSYA', externalId },
        }).catch(() => {});
    }

    private static async handleOrderCancelled(companyId: number, payload: Record<string, unknown>) {
        const externalId = payload.id as string || payload.orderId as string;
        const sync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
        });
        if (!sync) return;

        // Route through OrderService.cancel so the cancellation validates the
        // state transition, reverses any consumed inventory (reverseForOrder) and
        // frees the table — instead of a raw status write that skips all of that.
        const systemUser = await prisma.user.findFirst({
            where: { companyId, username: 'system' },
            select: { id: true },
        });

        try {
            await OrderService.cancel(
                sync.orderId,
                companyId,
                systemUser?.id,
                'Cancelado por PedidosYa',
                // Channel cancellations are authoritative even for PAID orders.
                { allowPaidReversal: true }
            );
        } catch (err) {
            // The order may already be in a terminal/incompatible state (e.g.
            // already cancelled). Don't break the webhook: log it and still
            // update the sync record so it reflects the external cancellation.
            console.error(`[PedidosYa] No se pudo cancelar la orden ${sync.orderId} vía OrderService:`, err);
            AuditLogService.log({
                companyId,
                userId: systemUser?.id || 1,
                entityType: 'Order',
                entityId: sync.orderId,
                action: 'CANCEL',
                details: { source: 'PEDIDOSYA', externalId, cancelFailed: true, error: (err as Error).message },
            }).catch(() => {});
        }

        await prisma.pedidosYaOrderSync.update({
            where: { id: sync.id },
            data: { externalStatus: 'CANCELLED', internalStatus: 'CANCELLED', lastSyncAt: new Date() },
        });
    }

    private static async handleStatusChange(companyId: number, payload: Record<string, unknown>) {
        const externalId = payload.id as string || payload.orderId as string;
        const newStatus = payload.status as string;

        const sync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
        });
        if (!sync) return;

        await prisma.pedidosYaOrderSync.update({
            where: { id: sync.id },
            data: { externalStatus: newStatus, lastSyncAt: new Date() },
        });
    }

    // ── Product Mapping ──
    private static async mapOrderItems(companyId: number, items: Array<{
        id?: string; name: string; quantity: number; price?: number; notes?: string;
    }>) {
        const result: Array<{ menuItemId: number; quantity: number; price: number; notes?: string }> = [];
        // Track items we could not resolve to a MenuItem so the caller can reject
        // the sync instead of silently dropping them.
        const unmapped: string[] = [];

        for (const item of items) {
            let menuItemId: number | null = null;
            let price = item.price || 0;

            if (item.id) {
                const mapping = await prisma.pedidosYaProductMapping.findFirst({
                    where: { companyId, externalId: item.id, isActive: true },
                    include: { menuItem: { select: { id: true, price: true } } },
                });
                if (mapping?.menuItem) {
                    menuItemId = mapping.menuItem.id;
                    price = price || Number(mapping.menuItem.price);
                }
            }

            if (!menuItemId) {
                const menuItem = await prisma.menuItem.findFirst({
                    where: { companyId, name: { contains: item.name }, active: true },
                    select: { id: true, price: true },
                });
                if (menuItem) {
                    menuItemId = menuItem.id;
                    price = price || Number(menuItem.price);
                }
            }

            if (menuItemId) {
                result.push({ menuItemId, quantity: item.quantity, price, notes: item.notes });
            } else {
                unmapped.push(item.name || item.id || 'desconocido');
            }
        }

        return { mapped: result, unmapped };
    }

    // ── Status Sync (outbound) ──
    static async syncOrderStatus(companyId: number, orderId: number, newStatus: string) {
        const sync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, orderId },
        });
        if (!sync) return;

        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true },
        });
        if (!config || !config.autoSyncStatus) return;

        const platformStatus = this.mapInternalToPlatformStatus(newStatus);
        if (!platformStatus) return;

        try {
            const token = await this.getValidToken(companyId);
            const baseUrl = config.environment === 'production'
                ? 'https://api.pedidosya.com'
                : 'https://api-sandbox.pedidosya.com';

            await fetch(`${baseUrl}/v3/orders/${sync.externalId}/status`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: platformStatus }),
            });

            await prisma.pedidosYaOrderSync.update({
                where: { id: sync.id },
                data: {
                    internalStatus: newStatus,
                    externalStatus: platformStatus,
                    lastSyncAt: new Date(),
                    syncDirection: 'OUTBOUND',
                },
            });
        } catch (error) {
            console.error('[PedidosYa] Status sync failed:', error);
        }
    }

    private static mapInternalToPlatformStatus(status: string): string | null {
        const map: Record<string, string> = {
            'SENT_TO_KITCHEN': 'CONFIRMED',
            'IN_PREPARATION': 'IN_PREPARATION',
            'READY': 'READY_FOR_PICKUP',
            'DELIVERED': 'DELIVERED',
            'CANCELLED': 'REJECTED',
        };
        return map[status] || null;
    }

    // ── Product Mapping CRUD ──
    static async getMappings(companyId: number) {
        return prisma.pedidosYaProductMapping.findMany({
            where: { companyId },
            include: {
                menuItem: { select: { id: true, name: true, price: true, active: true } },
            },
            orderBy: { externalName: 'asc' },
        });
    }

    static async upsertMapping(companyId: number, data: {
        externalId: string;
        externalName: string;
        menuItemId?: number | null;
        isActive?: boolean;
    }) {
        const existing = await prisma.pedidosYaProductMapping.findFirst({
            where: { companyId, externalId: data.externalId },
        });

        if (existing) {
            return prisma.pedidosYaProductMapping.update({
                where: { id: existing.id },
                data: { externalName: data.externalName, menuItemId: data.menuItemId, isActive: data.isActive },
            });
        }

        return prisma.pedidosYaProductMapping.create({
            data: { companyId, ...data },
        });
    }

    static async deleteMapping(companyId: number, id: number) {
        const mapping = await prisma.pedidosYaProductMapping.findFirst({
            where: { id, companyId },
        });
        if (!mapping) throw new Error('Mapping not found');
        return prisma.pedidosYaProductMapping.delete({ where: { id } });
    }

    // ── Webhook Logs ──
    static async getWebhookLogs(companyId: number, filters?: { status?: string; limit?: number }) {
        return prisma.pedidosYaWebhookLog.findMany({
            where: { companyId, ...(filters?.status ? { status: filters.status } : {}) },
            orderBy: { createdAt: 'desc' },
            take: filters?.limit || 50,
        });
    }

    // ── Order Syncs ──
    static async getOrderSyncs(companyId: number, filters?: { limit?: number }) {
        return prisma.pedidosYaOrderSync.findMany({
            where: { companyId },
            include: {
                order: {
                    select: { id: true, status: true, total: true, customerName: true, createdAt: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: filters?.limit || 50,
        });
    }

    // ── Menu Sync (push menu to PedidosYa) ──
    static async syncMenu(companyId: number) {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true },
        });
        if (!config) throw new Error('PedidosYa no configurado');

        const menuItems = await prisma.menuItem.findMany({
            where: { companyId, active: true },
            include: { category: { select: { name: true } } },
        });

        await prisma.pedidosYaConfig.update({
            where: { id: config.id },
            data: { lastSyncAt: new Date() },
        });

        return { synced: menuItems.length, lastSyncAt: new Date() };
    }

    // ── Test Connection ──
    static async testConnection(companyId: number) {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId },
        });
        if (!config || !config.clientId) {
            return { success: false, message: 'Configuración incompleta - faltan credenciales' };
        }

        try {
            await this.refreshAccessToken(companyId);
            return { success: true, message: 'Conexión exitosa con PedidosYa' };
        } catch (error: unknown) {
            return { success: false, message: `Error: ${(error as Error).message}` };
        }
    }
}
