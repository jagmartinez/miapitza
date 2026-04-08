import prisma from '../utils/prisma';

/**
 * Split Bill Service
 * Handles dividing orders among multiple payers
 */
export class SplitBillService {
    /**
     * Split order evenly among N people
     */
    static async splitEvenly(orderId: number, companyId: number, numberOfPeople: number) {
        if (!numberOfPeople || numberOfPeople < 1) {
            throw new Error('Number of people must be at least 1');
        }

        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                items: {
                    include: { menuItem: true, modifiers: true }
                }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const orderTotal = Number(order.total);
        if (orderTotal <= 0) {
            throw new Error('Order total must be positive to split');
        }

        // Use Math.round instead of Math.ceil; last person pays the remainder
        const amountPerPerson = Math.round((orderTotal / numberOfPeople) * 100) / 100;
        const subtotalForNMinus1 = amountPerPerson * (numberOfPeople - 1);
        const lastPersonAmount = Math.round((orderTotal - subtotalForNMinus1) * 100) / 100;

        return {
            orderId: order.id,
            originalTotal: Number(order.total),
            discount: Number(order.discount || 0),
            tipAmount: Number(order.tipAmount || 0),
            finalTotal: orderTotal,
            numberOfPeople,
            amountPerPerson,
            splits: Array.from({ length: numberOfPeople }, (_, i) => ({
                person: i + 1,
                amount: i === numberOfPeople - 1 ? lastPersonAmount : amountPerPerson,
                paid: false
            }))
        };
    }

    /**
     * Split order by items (each person selects their items)
     */
    static async splitByItems(orderId: number, companyId: number, itemAssignments: {
        personName: string;
        itemIds: number[];
    }[]) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                items: {
                    include: { menuItem: true, modifiers: true }
                }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const splits = itemAssignments.map(assignment => {
            const personItems = order.items.filter((item) => assignment.itemIds.includes(item.id));

            // item.subtotal already includes modifier prices — do not double-count
            const itemsSubtotal = personItems.reduce((sum, item) => {
                return sum + Number(item.subtotal);
            }, 0);

            const orderTotal = Number(order.total);
            const proportion = orderTotal > 0 ? itemsSubtotal / orderTotal : 0;
            const proportionalTotal = Math.round((orderTotal * proportion) * 100) / 100;

            return {
                personName: assignment.personName,
                items: personItems.map((item) => ({
                    name: item.menuItem.name,
                    quantity: item.quantity,
                    price: Number(item.price),
                    subtotal: Number(item.subtotal)
                })),
                subtotal: itemsSubtotal,
                tip: 0,
                discount: 0,
                total: proportionalTotal,
                paid: false
            };
        });

        const expectedTotal = Number(order.total);
        const currentTotal = splits.reduce((sum, split) => sum + split.total, 0);
        const delta = Math.round((expectedTotal - currentTotal) * 100) / 100;
        if (splits.length > 0 && Math.abs(delta) > 0) {
            const lastIndex = splits.length - 1;
            splits[lastIndex].total = Math.round((splits[lastIndex].total + delta) * 100) / 100;
        }

        return {
            orderId: order.id,
            originalTotal: Number(order.total),
            splits
        };
    }

    /**
     * Split order by custom amounts
     */
    static async splitByAmount(orderId: number, companyId: number, customSplits: {
        personName: string;
        amount: number;
    }[]) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const totalWithTip = Number(order.total);
        const splitTotal = customSplits.reduce((sum, s) => sum + s.amount, 0);

        if (Math.abs(splitTotal - totalWithTip) > 0.01) {
            const difference = totalWithTip - splitTotal;
            return {
                valid: false,
                error: `La suma de los montos (${splitTotal.toFixed(2)}) no coincide con el total (${totalWithTip.toFixed(2)}). Diferencia: ${difference.toFixed(2)}`,
                orderId: order.id,
                orderTotal: totalWithTip,
                splitTotal
            };
        }

        return {
            valid: true,
            orderId: order.id,
            originalTotal: Number(order.total),
            finalTotal: totalWithTip,
            splits: customSplits.map(s => ({
                ...s,
                paid: false
            }))
        };
    }

    /**
     * Get suggested tip amounts
     */
    static getSuggestedTips(subtotal: number) {
        return {
            subtotal,
            suggestions: [
                { percentage: 10, amount: Math.round(subtotal * 0.10 * 100) / 100 },
                { percentage: 15, amount: Math.round(subtotal * 0.15 * 100) / 100 },
                { percentage: 18, amount: Math.round(subtotal * 0.18 * 100) / 100 },
                { percentage: 20, amount: Math.round(subtotal * 0.20 * 100) / 100 }
            ]
        };
    }
}
