import prisma from '../utils/prisma';

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
    /**
     * Process incoming order from delivery platform
     */
    static async processIncomingOrder(
        companyId: number,
        branchId: number,
        deliveryOrder: DeliveryOrder
    ) {
        // Check for duplicate order by matching external ID embedded in customerName
        const externalIdTag = `ID:${deliveryOrder.externalId}`;
        const existing = await prisma.order.findFirst({
            where: {
                companyId,
                branchId,
                customerName: { contains: externalIdTag },
                // Only consider orders from the last 48 hours to avoid false matches with old data
                createdAt: {
                    gte: new Date(Date.now() - 48 * 60 * 60 * 1000)
                }
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
        const matchedItems = await this.matchDeliveryItems(companyId, deliveryOrder.items);

        const order = await prisma.order.create({
            data: {
                companyId,
                branchId,
                userId: systemUser.id,
                customerName: customerNameWithMeta.substring(0, 255),
                orderType: 'DELIVERY',
                status: 'OPEN',
                total: deliveryOrder.total,
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

        // Send confirmation back to platform
        await this.sendStatusUpdate(
            deliveryOrder.platform,
            deliveryOrder.externalId,
            'ACCEPTED'
        );

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
        // Mock implementation - in production, this would call the platform's API
        console.log(`[${platform}] Sending status update for order ${externalOrderId}: ${status}`);

        // Simulate API call
        const mockResponse = {
            success: true,
            platform,
            externalOrderId,
            status,
            timestamp: new Date().toISOString()
        };

        return mockResponse;
    }

    /**
     * Validate webhook signature (platform-specific)
     */
    static validateWebhookSignature(
        platform: string,
        signature: string,
        payload: string
    ): boolean {
        // Each platform uses its own signature method (HMAC-SHA256 for Uber Eats, etc.)
        // Reject if no signature is provided
        if (!signature) {
            return false;
        }

        // TODO: Implement per-platform HMAC verification with stored secrets
        // For now, require at minimum that a signature header is present
        // In production: compare HMAC of payload with signature using platform secret from DB
        const platformSecrets: Record<string, string | undefined> = {
            'uber-eats': process.env.UBER_EATS_WEBHOOK_SECRET,
            'rappi': process.env.RAPPI_WEBHOOK_SECRET,
            'pedidosya': process.env.PEDIDOSYA_WEBHOOK_SECRET,
        };

        const secret = platformSecrets[platform];
        if (!secret) {
            // No secret configured = platform not enabled, reject
            return false;
        }

        // Basic HMAC-SHA256 verification
        const crypto = require('crypto');
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
        deliveryItems: DeliveryOrderItem[]
    ): Promise<Array<{ menuItemId: number; quantity: number; price: number; notes?: string }>> {
        if (!deliveryItems || deliveryItems.length === 0) return [];

        // Load all active menu items for this company
        const menuItems = await prisma.menuItem.findMany({
            where: { companyId, active: true },
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
    ): string {
        const statusMap: Record<string, Record<string, string>> = {
            UBER_EATS: {
                'OPEN': 'ACCEPTED',
                'SENT_TO_KITCHEN': 'PREPARING',
                'READY': 'READY_FOR_PICKUP',
                'DELIVERED': 'PICKED_UP',
                'CANCELLED': 'CANCELLED'
            },
            RAPPI: {
                'OPEN': 'ACCEPTED',
                'SENT_TO_KITCHEN': 'IN_PROGRESS',
                'READY': 'READY',
                'DELIVERED': 'DELIVERED',
                'CANCELLED': 'REJECTED'
            }
        };

        return statusMap[platform]?.[internalStatus] || internalStatus;
    }
}
