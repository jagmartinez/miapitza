import crypto from 'crypto';
import prisma from '../utils/prisma';
import { SalesChannelService } from './sales-channel.service';
import { decrypt, isEncrypted, isLegacyEncryptionCandidate } from '../utils/encryption';

/**
 * Delivery Platform Integration Service
 * Handles incoming orders from delivery platforms (Uber Eats, Rappi, etc.)
 */

export interface DeliveryOrder {
    externalId: string;
    platform: 'UBER_EATS' | 'RAPPI' | 'PEDIDOSYA' | 'OTHER';
    customerName: string;
    customerPhone?: string;
    customerAddress: string;
    items: DeliveryOrderItem[];
    total: number;
    deliveryFee?: number;
    notes?: string;
    scheduledFor?: Date;
}

export interface DeliveryOrderItem {
    externalId: string;
    name: string;
    quantity: number;
    price: number;
    notes?: string;
    modifiers?: string[];
}

export interface DeliveryStatusUpdate {
    externalId: string;
    status: 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
}

export class DeliveryService {
    static async assertStatusUpdateTarget(
        companyId: number,
        orderId: number,
        platform: string,
        externalOrderId: string
    ): Promise<{ branchId: number }> {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            select: { branchId: true, orderType: true, customerName: true }
        });
        if (!order || order.orderType !== 'DELIVERY') throw new Error('Delivery order not found');

        const normalizedPlatform = String(platform || '').trim().toUpperCase();
        const normalizedExternalId = String(externalOrderId || '').trim();
        if (!normalizedPlatform || !normalizedExternalId) throw new Error('Delivery platform and external order ID are required');
        const metadata = order.customerName || '';
        if (!metadata.startsWith(`[${normalizedPlatform}] `) || !metadata.includes(`| ID:${normalizedExternalId} |`)) {
            throw new Error('External delivery identity does not match the local order');
        }
        return { branchId: order.branchId };
    }

    /**
     * Process incoming order from delivery platform
     */
    static async processIncomingOrder(
        companyId: number,
        branchId: number,
        deliveryOrder: DeliveryOrder
    ) {
        const externalId = String(deliveryOrder.externalId || '').trim();
        if (!externalId || externalId === 'unknown') throw new Error('External order ID is required');
        if (!Array.isArray(deliveryOrder.items) || deliveryOrder.items.length === 0) throw new Error('Delivery order must contain items');
        // Never trust a caller-supplied branch: ensure it belongs to the tenant.
        const branch = await prisma.branch.findFirst({
            where: { id: branchId, companyId },
            select: { id: true }
        });
        if (!branch) {
            throw new Error('Branch not found for company');
        }

        // Check for duplicate order by matching external ID embedded in customerName
        const externalIdTag = `ID:${externalId} |`;
        const platformTag = `[${deliveryOrder.platform}]`;
        const existing = await prisma.order.findFirst({
            where: {
                companyId,
                branchId,
                AND: [
                    { customerName: { contains: platformTag } },
                    { customerName: { contains: externalIdTag } }
                ]
            },
            include: {
                items: {
                    include: { menuItem: true }
                }
            }
        });

        if (existing) {
            console.log(`Order ${deliveryOrder.externalId} already processed as internal order #${existing.id}`);
            return existing;
        }

        // Get default user for delivery orders (system user or branch manager)
        const systemUser = await prisma.user.findFirst({
            where: { companyId, status: 'ACTIVE' },
            orderBy: { id: 'asc' }
        });

        if (!systemUser) {
            throw new Error('No active user found to assign delivery order');
        }

        // Create order in system - store delivery metadata in customerName
        const customerNameWithMeta = `[${deliveryOrder.platform}] ${deliveryOrder.customerName} | ID:${deliveryOrder.externalId} | ${deliveryOrder.customerPhone || 'N/A'} | ${deliveryOrder.customerAddress}`;

        // Match delivery items with internal menu items
        for (const item of deliveryOrder.items) {
            if (!item.name?.trim()) throw new Error('Delivery item name is required');
            if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
                throw new Error(`Invalid delivery quantity for "${item.name}"`);
            }
            if (!Number.isFinite(Number(item.price)) || Number(item.price) < 0) {
                throw new Error(`Invalid delivery price for "${item.name}"`);
            }
        }

        const matchedItems = await this.matchDeliveryItems(companyId, branchId, deliveryOrder.items);
        if (matchedItems.length !== deliveryOrder.items.length) {
            throw new Error('Delivery order contains unmapped menu items; no partial order was created');
        }
        const computedTotal = Math.round(matchedItems.reduce((sum, item) => sum + item.quantity * item.price, 0) * 100) / 100;
        if (!Number.isFinite(computedTotal) || computedTotal < 0) throw new Error('Delivery order total is invalid');

        // Determine sales channel and calculate commission/markup
        const channelMap: Record<string, 'RESTAURANT' | 'DELIVERY' | 'PEDIDOSYA'> = {
            'PEDIDOSYA': 'PEDIDOSYA',
            'UBER_EATS': 'DELIVERY',
            'RAPPI': 'DELIVERY',
            'OTHER': 'DELIVERY',
        };
        const salesChannel = channelMap[deliveryOrder.platform];
        if (!salesChannel) throw new Error(`Unsupported delivery platform: ${String(deliveryOrder.platform)}`);

        let channelCommission = 0;
        let channelMarkup = 0;
        if (salesChannel === 'PEDIDOSYA') {
            const config = await SalesChannelService.getByChannel(companyId, 'PEDIDOSYA');
            if (config) {
                channelCommission = Math.round(computedTotal * Number(config.commissionPct) / 100 * 100) / 100;
                channelMarkup = Number(config.priceMarkupPct);
            }
        }

        const order = await prisma.order.create({
            data: {
                companyId,
                branchId,
                userId: systemUser.id,
                customerName: customerNameWithMeta.substring(0, 255),
                orderType: 'DELIVERY',
                salesChannel,
                channelCommission,
                channelMarkup,
                status: 'OPEN',
                total: computedTotal,
                items: matchedItems.length > 0 ? {
                    create: matchedItems.map(item => ({
                        menuItemId: item.menuItemId,
                        quantity: item.quantity,
                        price: item.price,
                        subtotal: item.quantity * item.price,
                        notes: item.notes || null
                    }))
                } : undefined
            },
            include: {
                items: {
                    include: { menuItem: true }
                }
            }
        });

        console.log(`Created order ${order.id} from ${deliveryOrder.platform} order ${deliveryOrder.externalId} with ${matchedItems.length} matched items`);

        return order;
    }

    /**
     * Send status update to delivery platform
     */
    static async sendStatusUpdate(
        platform: string,
        externalOrderId: string,
        status: DeliveryStatusUpdate['status']
    ) {
        void platform;
        void externalOrderId;
        void status;
        throw new Error('Outbound delivery status integration is not configured; status was not sent');
    }

    /**
     * Resolve the webhook secret bound to a specific tenant + platform.
     *
     * For PedidosYa we use the per-company secret stored (encrypted) in
     * PedidosYaConfig, so a valid signature can only be produced by a party
     * that knows THAT company's secret — closing the tenant-spoofing hole.
     *
     * Uber Eats / Rappi remain disabled here until a per-company secret model
     * exists; shared environment secrets are not accepted for tenant requests.
     */
    private static async resolveWebhookSecret(platform: string, companyId: number): Promise<string | null> {
        if (platform === 'pedidosya') {
            const config = await prisma.pedidosYaConfig.findFirst({
                where: { companyId, active: true },
                select: { webhookSecret: true }
            });
            if (!config?.webhookSecret) return null;
            try {
                // Legacy ciphertext has no prefix. If it has the structural
                // shape of the old envelope, always authenticate it instead of
                // downgrading a wrong-key/corrupt value to plaintext.
                return (isEncrypted(config.webhookSecret) || isLegacyEncryptionCandidate(config.webhookSecret))
                    ? decrypt(config.webhookSecret)
                    : config.webhookSecret;
            } catch (error) {
                // An encrypted value that cannot be decrypted is corrupt. Never
                // reinterpret its ciphertext as a legacy plaintext HMAC secret.
                console.error('[DeliveryService] No se pudo descifrar el secreto webhook PedidosYa:', error);
                return null;
            }
        }

        // Uber Eats/Rappi do not yet have tenant-bound secret storage. A shared
        // environment secret would let its holder impersonate any companyId,
        // so those public webhook variants remain fail-closed until supported.
        return null;
    }

    /**
     * Validate webhook signature against the tenant's configured secret.
     * The companyId is required so the HMAC is verified against a secret that
     * provably belongs to that tenant, rather than a global shared secret.
     */
    static async validateWebhookSignature(
        platform: string,
        signature: string,
        payload: string,
        companyId: number
    ): Promise<boolean> {
        // Reject if no signature is provided
        if (!signature) {
            return false;
        }

        const secret = await this.resolveWebhookSecret(platform, companyId);
        if (!secret) {
            // No secret configured for this tenant/platform = reject
            return false;
        }

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSignature);

        // timingSafeEqual requires equal-length buffers — check length first
        if (sigBuffer.length !== expectedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    }

    /**
     * Match delivery platform items with internal menu items by name similarity.
     * Returns items that could be matched; unmatched items are logged for manual review.
     */
    private static async matchDeliveryItems(
        companyId: number,
        branchId: number,
        deliveryItems: DeliveryOrderItem[]
    ): Promise<Array<{ menuItemId: number; quantity: number; price: number; notes?: string }>> {
        if (!deliveryItems || deliveryItems.length === 0) return [];

        // Load only global items or items assigned to the destination branch.
        const menuItems = await prisma.menuItem.findMany({
            where: {
                companyId,
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
            select: { id: true, name: true, price: true }
        });

        const matched: Array<{ menuItemId: number; quantity: number; price: number; notes?: string }> = [];

        for (const dItem of deliveryItems) {
            const normalizedName = dItem.name.toLowerCase().trim();

            // Try exact match first, then substring match
            let match = menuItems.find(
                mi => mi.name.toLowerCase().trim() === normalizedName
            );

            if (!match) {
                match = menuItems.find(
                    mi => normalizedName.includes(mi.name.toLowerCase().trim()) ||
                          mi.name.toLowerCase().trim().includes(normalizedName)
                );
            }

            if (match) {
                const notes = [
                    dItem.notes,
                    dItem.modifiers?.length ? `Mods: ${dItem.modifiers.join(', ')}` : null
                ].filter(Boolean).join(' | ') || undefined;

                matched.push({
                    menuItemId: match.id,
                    quantity: dItem.quantity,
                    price: dItem.price,
                    notes
                });
            } else {
                console.warn(`[DeliveryService] Could not match item "${dItem.name}" to any menu item`);
            }
        }

        return matched;
    }

    /**
     * Get platform configuration
     */
    static async getConfiguration(_companyId: number) {
        // In production, this would come from database
        return {
            uberEats: {
                enabled: false,
                merchantId: null,
                apiKey: null
            },
            rappi: {
                enabled: false,
                storeId: null,
                apiKey: null
            },
            pedidosYa: {
                enabled: false,
                branchId: null,
                apiKey: null
            }
        };
    }

    /**
     * Map internal order status to platform-specific status
     */
    static mapStatusToPlatform(
        platform: string,
        internalStatus: string
    ): DeliveryStatusUpdate['status'] | null {
        const statusMap: Record<string, Partial<Record<string, DeliveryStatusUpdate['status']>>> = {
            UBER_EATS: {
                'OPEN': 'ACCEPTED',
                'SENT_TO_KITCHEN': 'PREPARING',
                'IN_PREPARATION': 'PREPARING',
                'READY': 'READY_FOR_PICKUP',
                'DELIVERED': 'PICKED_UP',
                'CANCELLED': 'CANCELLED'
            },
            RAPPI: {
                'OPEN': 'ACCEPTED',
                'SENT_TO_KITCHEN': 'PREPARING',
                'IN_PREPARATION': 'PREPARING',
                'READY': 'READY_FOR_PICKUP',
                'DELIVERED': 'DELIVERED',
                'CANCELLED': 'CANCELLED'
            }
        };

        const normalizedPlatform = String(platform || '').trim().toUpperCase().replace(/-/g, '_');
        const normalizedStatus = String(internalStatus || '').trim().toUpperCase();
        return statusMap[normalizedPlatform]?.[normalizedStatus] ?? null;
    }
}
