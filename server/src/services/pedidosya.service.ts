import prisma from '../utils/prisma';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { OrderService } from './order.service';
import { encrypt, decrypt, isEncrypted, isLegacyEncryptionCandidate } from '../utils/encryption';
import { DynamicPricingService } from './dynamic-pricing.service';
import { externalHttpTimeoutMs, fetchWithTimeout } from '../utils/external-http';

const SECRET_FIELDS = ['clientSecret', 'webhookSecret', 'accessToken', 'refreshToken'] as const;
const pedidosYaTimeoutMs = () => externalHttpTimeoutMs(process.env.PEDIDOSYA_HTTP_TIMEOUT_MS);

export class PedidosYaService {
    static async resolveWebhookConfig(companyId: number, payload?: Record<string, unknown>) {
        const configs = await prisma.pedidosYaConfig.findMany({ where: { companyId, active: true } });
        const nestedRestaurant = payload?.restaurant && typeof payload.restaurant === 'object'
            ? payload.restaurant as Record<string, unknown>
            : undefined;
        const externalRestaurantId = [
            payload?.restaurantId, payload?.restaurant_id, payload?.storeId,
            payload?.store_id, nestedRestaurant?.id
        ].map((value) => value == null ? '' : String(value).trim()).find(Boolean);

        if (externalRestaurantId) {
            const matched = configs.filter((config) => config.restaurantId === externalRestaurantId);
            if (matched.length === 1) return matched[0];
            if (matched.length > 1) throw new Error('Configuración PedidosYa ambigua para el restaurante externo');
        }
        if (configs.length === 1) return configs[0];
        if (configs.length === 0) throw new Error('PedidosYa config not found');
        throw new Error('El webhook no identifica la sucursal/restaurante y existen varias configuraciones activas');
    }
    // ── Secret handling (encrypt at rest, never expose in client responses) ──
    /** Decrypts a stored secret, tolerating legacy plaintext values. */
    static decryptSecret(value: string | null | undefined): string | null {
        if (!value) return null;
        if (!isEncrypted(value) && !isLegacyEncryptionCandidate(value)) return value;
        try {
            return decrypt(value);
        } catch (error) {
            console.error('[PedidosYa] No se pudo descifrar una credencial almacenada:', error);
            return null;
        }
    }

    /** Encrypts a secret for storage; passes through empty values. */
    private static encryptSecret(value: string | null | undefined): string | null | undefined {
        if (value === null || value === undefined || value === '') return value;
        if (isEncrypted(value)) return value;
        // Incoming configuration is explicit plaintext. Encrypt even when it
        // happens to look like base64 so an operator can replace an ambiguous
        // legacy value with a valid base64-formatted provider secret.
        return encrypt(value);
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
            // Undefined means the company-wide configuration, never an
            // arbitrary branch row. Branch callers always pass their scope.
            where: { companyId, branchId: branchId ?? null },
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
        if (branchId !== null) {
            const branch = await prisma.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } });
            if (!branch) throw new Error('Sucursal no encontrada para esta empresa');
        }
        if (data.defaultWarehouseId !== undefined) {
            const warehouse = await prisma.warehouse.findFirst({
                where: { id: data.defaultWarehouseId, companyId, ...(branchId ? { branchId } : {}) },
                select: { id: true }
            });
            if (!warehouse) throw new Error('Almacén no encontrado para esta empresa/sucursal');
        }

        // Explicit allowlist prevents mass assignment of tenant ownership,
        // stored OAuth tokens, timestamps or record identity through req.body.
        const payload: Record<string, unknown> = {};
        const assignIfPresent = (field: keyof typeof data) => {
            if (Object.prototype.hasOwnProperty.call(data, field)) payload[field] = data[field];
        };
        for (const field of [
            'clientId', 'clientSecret', 'restaurantId', 'webhookSecret',
            'environment', 'autoAcceptOrders', 'autoSyncStatus',
            'defaultWarehouseId', 'active'
        ] as const) assignIfPresent(field);
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
            }).catch((error) => console.error('[PedidosYa] No se pudo persistir auditoría de configuración:', error));
        }

        return config;
    }

    // ── OAuth2 Token Management ──
    static async refreshAccessToken(companyId: number, branchId?: number | null) {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true, branchId: branchId ?? null },
        });

        if (!config || !config.clientId || !config.clientSecret) {
            throw new Error('PedidosYa no está configurado correctamente');
        }

        const baseUrl = config.environment === 'production'
            ? 'https://api.pedidosya.com'
            : 'https://api-sandbox.pedidosya.com';

        const clientSecret = this.decryptSecret(config.clientSecret);
        if (!clientSecret) throw new Error('No se pudo leer la credencial PedidosYa');

        const response = await fetchWithTimeout(`${baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: config.clientId,
                client_secret: clientSecret,
            }),
        }, pedidosYaTimeoutMs());

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

    static async getValidToken(companyId: number, branchId?: number | null): Promise<string> {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, active: true, branchId: branchId ?? null },
        });

        if (!config) throw new Error('PedidosYa no configurado');

        if (config.accessToken && config.tokenExpiresAt && config.tokenExpiresAt > new Date()) {
            const token = this.decryptSecret(config.accessToken);
            if (!token) throw new Error('No se pudo leer el token PedidosYa');
            return token;
        }

        return this.refreshAccessToken(companyId, branchId);
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
        const externalId = String(payload.id || '').trim();
        if (!externalId) throw new Error('PedidosYa external order ID is required');

        const existingSync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
        });
        if (existingSync) return;

        const config = await this.resolveWebhookConfig(companyId, payload);
        const branchId = config.branchId || (await prisma.branch.findFirst({ where: { companyId, status: 'ACTIVE' }, orderBy: { id: 'asc' } }))?.id;
        if (!branchId) throw new Error('No active branch configured');
        const activeBranch = await prisma.branch.findFirst({
            where: { id: branchId, companyId, status: 'ACTIVE' },
            select: { id: true }
        });
        if (!activeBranch) throw new Error('La sucursal configurada para PedidosYa no está activa');

        const items = (payload.items || payload.products || []) as Array<{
            id?: string; name: string; quantity: number; price?: number; notes?: string;
        }>;
        if (items.length === 0) throw new Error(`Orden PedidosYa ${externalId} sin productos`);
        for (const item of items) {
            if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
                throw new Error(`Cantidad inválida para ${item.name || item.id || 'producto'}`);
            }
            if (item.price !== undefined && (!Number.isFinite(Number(item.price)) || Number(item.price) < 0)) {
                throw new Error(`Precio inválido para ${item.name || item.id || 'producto'}`);
            }
        }

        const channelConfig = await prisma.salesChannelConfig.findUnique({
            where: { companyId_channel: { companyId, channel: 'PEDIDOSYA' } }
        });
        if (channelConfig && !channelConfig.active) throw new Error('El canal PedidosYa está desactivado');
        const markupPct = Number(channelConfig?.priceMarkupPct ?? 0);
        const { mapped: mappedItems, unmapped } = await this.mapOrderItems(companyId, branchId, items, markupPct);

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
            where: { companyId, username: 'system', status: 'ACTIVE' },
            select: { id: true },
        });
        if (!systemUser) throw new Error('Debe existir el usuario de servicio activo "system" para recibir pedidos PedidosYa');
        const userId = systemUser.id;

        const customerName = `[PEDIDOSYA] ${payload.customerName || 'Cliente'} | ID:${externalId}`;
        const total = mappedItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        const channelCommission = Math.round(total * Number(channelConfig?.commissionPct ?? 0)) / 100;
        const acceptedAt = config.autoAcceptOrders ? new Date() : null;

        let order;
        try {
            order = await prisma.$transaction(async (tx) => {
                const replay = await tx.pedidosYaOrderSync.findUnique({
                    where: { companyId_externalId: { companyId, externalId } },
                    select: { id: true },
                });
                if (replay) return null;

                const created = await tx.order.create({
                    data: {
                        companyId,
                        branchId,
                        userId,
                        customerName,
                        orderType: 'DELIVERY',
                        salesChannel: 'PEDIDOSYA',
                        status: config.autoAcceptOrders ? 'SENT_TO_KITCHEN' : 'OPEN',
                        total,
                        channelCommission,
                        channelMarkup: markupPct,
                        items: {
                            create: mappedItems.map(item => ({
                                menuItemId: item.menuItemId,
                                quantity: item.quantity,
                                price: item.price,
                                subtotal: item.price * item.quantity,
                                notes: item.notes || undefined,
                                status: 'PENDING',
                                sentAt: acceptedAt,
                            })),
                        },
                    },
                });

                await tx.pedidosYaOrderSync.create({
                    data: {
                        companyId,
                        orderId: created.id,
                        externalId,
                        externalStatus: payload.status as string || 'NEW',
                        internalStatus: config.autoAcceptOrders ? 'SENT_TO_KITCHEN' : 'OPEN',
                        syncDirection: 'INBOUND',
                        metadata: payload as Prisma.InputJsonValue,
                    },
                });

                return created;
            });
        } catch (error: unknown) {
            // A concurrent replay can win the unique (companyId, externalId)
            // constraint after our initial read. The transaction is rolled back,
            // including its Order, so acknowledging the already committed sync is
            // safe and cannot leave an orphan/duplicate local order.
            if ((error as { code?: string }).code === 'P2002') {
                const replay = await prisma.pedidosYaOrderSync.findUnique({
                    where: { companyId_externalId: { companyId, externalId } },
                    select: { id: true },
                });
                if (replay) return;
            }
            throw error;
        }

        if (!order) return;

        AuditLogService.log({
            companyId, userId, entityType: 'Order', entityId: order.id,
            action: 'CREATE', details: { source: 'PEDIDOSYA', externalId },
        }).catch((error) => console.error('[PedidosYa] No se pudo persistir auditoría de la orden:', error));
    }

    private static async handleOrderCancelled(companyId: number, payload: Record<string, unknown>) {
        const externalId = payload.id as string || payload.orderId as string;
        const sync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
        });
        if (!sync) return;
        const config = await this.resolveWebhookConfig(companyId, payload);

        // Route through OrderService.cancel so the cancellation validates the
        // state transition, reverses any consumed inventory (reverseForOrder) and
        // frees the table — instead of a raw status write that skips all of that.
        const systemUser = await prisma.user.findFirst({
            where: { companyId, username: 'system', status: 'ACTIVE' },
            select: { id: true },
        });
        if (!systemUser) throw new Error('Usuario de servicio "system" no disponible para cancelar la orden PedidosYa');

        try {
            await OrderService.cancel(
                sync.orderId,
                companyId,
                systemUser.id,
                'Cancelado por PedidosYa',
                // Channel cancellations are authoritative even for PAID orders.
                {
                    allowPaidReversal: true,
                    wasteWarehouseId: config.defaultWarehouseId ?? undefined,
                    // The signed provider cancellation is the external refund
                    // evidence for non-cash channel payments.
                    externalRefundReference: `PEDIDOSYA-CANCEL-${externalId}`
                }
            );
        } catch (err) {
            if ((err as Error).message === 'Order is already cancelled') {
                // Idempotent webhook replay: local and external state already agree.
            } else {
            // The order may already be in a terminal/incompatible state (e.g.
            // already cancelled). Don't break the webhook: log it and still
            // update the sync record so it reflects the external cancellation.
            console.error(`[PedidosYa] No se pudo cancelar la orden ${sync.orderId} vía OrderService:`, err);
                throw err;
            }
        }

        await prisma.pedidosYaOrderSync.update({
            where: { id: sync.id },
            data: { externalStatus: 'CANCELLED', internalStatus: 'CANCELLED', lastSyncAt: new Date() },
        });
    }

    private static async handleStatusChange(companyId: number, payload: Record<string, unknown>) {
        const externalId = payload.id as string || payload.orderId as string;
        const newStatus = String(payload.status || '').trim().toUpperCase();
        if (!externalId || !newStatus) throw new Error('PedidosYa order ID and status are required');

        const sync = await prisma.pedidosYaOrderSync.findFirst({
            where: { companyId, externalId },
            include: { order: { select: { id: true, branchId: true, status: true } } }
        });
        if (!sync) return;

        if (newStatus === 'DELIVERED' && sync.order.status !== 'DELIVERED') {
            const config = await prisma.pedidosYaConfig.findFirst({
                where: {
                    companyId,
                    active: true,
                    OR: [{ branchId: sync.order.branchId }, { branchId: null }]
                },
                orderBy: { branchId: 'desc' },
                select: { defaultWarehouseId: true }
            });
            if (!config?.defaultWarehouseId) {
                throw new Error('PedidosYa no tiene una bodega predeterminada configurada para completar la entrega');
            }
            const systemUser = await prisma.user.findFirst({
                where: { companyId, username: 'system', status: 'ACTIVE' },
                select: { id: true }
            });
            if (!systemUser) throw new Error('Usuario de servicio "system" no disponible para completar la entrega PedidosYa');

            // External delivery is authoritative, but it must use the exact same
            // atomic stock+status operation as local delivery. Disable the
            // outbound echo to avoid sending the webhook state back recursively.
            await OrderService.complete(
                sync.order.id,
                companyId,
                config.defaultWarehouseId,
                systemUser.id,
                { syncExternal: false }
            );
        }

        await prisma.pedidosYaOrderSync.update({
            where: { id: sync.id },
            data: {
                externalStatus: newStatus,
                ...(newStatus === 'DELIVERED' ? { internalStatus: 'DELIVERED' } : {}),
                lastSyncAt: new Date()
            },
        });
    }

    // ── Product Mapping ──
    private static async mapOrderItems(companyId: number, branchId: number, items: Array<{
        id?: string; name: string; quantity: number; price?: number; notes?: string;
    }>, markupPct: number) {
        const result: Array<{ menuItemId: number; quantity: number; price: number; notes?: string }> = [];
        // Track items we could not resolve to a MenuItem so the caller can reject
        // the sync instead of silently dropping them.
        const unmapped: string[] = [];

        for (const item of items) {
            let menuItemId: number | null = null;
            let price = item.price === undefined ? null : Number(item.price);

            if (item.id) {
                const mapping = await prisma.pedidosYaProductMapping.findFirst({
                    where: { companyId, externalId: item.id, isActive: true },
                    include: {
                        menuItem: {
                            select: {
                                id: true,
                                price: true,
                                branchId: true,
                                active: true,
                                type: true,
                                _count: { select: { recipes: true } }
                            }
                        }
                    },
                });
                const mappedItemReady = mapping?.menuItem?.type === 'DIRECT'
                    || (mapping?.menuItem?.type === 'PREPARED' && mapping.menuItem._count.recipes > 0);
                if (mapping?.menuItem?.active && mappedItemReady
                    && (mapping.menuItem.branchId === null || mapping.menuItem.branchId === branchId)) {
                    menuItemId = mapping.menuItem.id;
                    const basePrice = await DynamicPricingService.getPrice(menuItemId, branchId, companyId);
                    price = price ?? Math.round(basePrice * (1 + markupPct / 100) * 100) / 100;
                }
            }

            if (!menuItemId) {
                const candidates = await prisma.menuItem.findMany({
                    where: {
                        companyId,
                        name: { contains: item.name.trim() },
                        active: true,
                        AND: [
                            { OR: [{ branchId: null }, { branchId }] },
                            {
                                OR: [
                                    { type: 'DIRECT' },
                                    { type: 'PREPARED', recipes: { some: {} } }
                                ]
                            }
                        ]
                    },
                    select: { id: true, name: true, price: true },
                });
                const exact = candidates.filter((candidate) =>
                    candidate.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase()
                );
                const menuItem = exact.length === 1 ? exact[0] : null;
                if (menuItem) {
                    menuItemId = menuItem.id;
                    const basePrice = await DynamicPricingService.getPrice(menuItemId, branchId, companyId);
                    price = price ?? Math.round(basePrice * (1 + markupPct / 100) * 100) / 100;
                }
            }

            if (menuItemId && price !== null) {
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
            include: { order: { select: { branchId: true } } },
        });
        if (!sync) return;

        const config = await prisma.pedidosYaConfig.findFirst({
            where: {
                companyId,
                active: true,
                OR: [{ branchId: sync.order.branchId }, { branchId: null }],
            },
            orderBy: { branchId: 'desc' },
        });
        if (!config || !config.autoSyncStatus) return;

        const platformStatus = this.mapInternalToPlatformStatus(newStatus);
        if (!platformStatus) return;

        const previousMetadata = sync.metadata && typeof sync.metadata === 'object' && !Array.isArray(sync.metadata)
            ? sync.metadata as Record<string, unknown>
            : {};
        const attemptedAt = new Date();
        await prisma.pedidosYaOrderSync.update({
            where: { id: sync.id },
            data: {
                internalStatus: newStatus,
                syncDirection: 'OUTBOUND',
                metadata: {
                    ...previousMetadata,
                    outboundSync: { status: 'PENDING', targetStatus: platformStatus, attemptedAt: attemptedAt.toISOString() },
                } as Prisma.InputJsonValue,
            },
        });

        try {
            const token = await this.getValidToken(companyId, config.branchId);
            const baseUrl = config.environment === 'production'
                ? 'https://api.pedidosya.com'
                : 'https://api-sandbox.pedidosya.com';

            const response = await fetchWithTimeout(`${baseUrl}/v3/orders/${sync.externalId}/status`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: platformStatus }),
            }, pedidosYaTimeoutMs());
            if (!response.ok) throw new Error(`PedidosYa status sync failed: HTTP ${response.status}`);

            await prisma.pedidosYaOrderSync.update({
                where: { id: sync.id },
                data: {
                    externalStatus: platformStatus,
                    lastSyncAt: new Date(),
                    metadata: {
                        ...previousMetadata,
                        outboundSync: { status: 'SYNCED', targetStatus: platformStatus, attemptedAt: attemptedAt.toISOString() },
                    } as Prisma.InputJsonValue,
                },
            });
        } catch (error: unknown) {
            const message = (error as Error).message;
            await prisma.pedidosYaOrderSync.update({
                where: { id: sync.id },
                data: {
                    metadata: {
                        ...previousMetadata,
                        outboundSync: {
                            status: 'FAILED',
                            targetStatus: platformStatus,
                            attemptedAt: attemptedAt.toISOString(),
                            error: message,
                        },
                    } as Prisma.InputJsonValue,
                },
            });
            throw error;
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
        if (!data.externalId?.trim() || !data.externalName?.trim()) throw new Error('External ID and name are required');
        if (data.menuItemId !== undefined && data.menuItemId !== null) {
            const menuItem = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, companyId, active: true }, select: { id: true } });
            if (!menuItem) throw new Error('Menu item not found for company');
        }
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

        // The previous implementation only counted local items and stamped
        // lastSyncAt, but never called PedidosYa. Failing closed prevents a
        // misleading production success until the outbound menu contract exists.
        throw new Error('La sincronización outbound del menú con PedidosYa aún no está implementada');
    }

    // ── Test Connection ──
    static async testConnection(companyId: number) {
        const config = await prisma.pedidosYaConfig.findFirst({
            where: { companyId, branchId: null },
        });
        if (!config || !config.clientId) {
            return { success: false, message: 'Configuración incompleta - faltan credenciales' };
        }

        try {
            await this.refreshAccessToken(companyId, null);
            return { success: true, message: 'Conexión exitosa con PedidosYa' };
        } catch (error: unknown) {
            return { success: false, message: `Error: ${(error as Error).message}` };
        }
    }
}
