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
        if (!Number.isInteger(numberOfPeople) || numberOfPeople < 1) {
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

        if (!Array.isArray(itemAssignments) || itemAssignments.length === 0) {
            throw new Error('Debe asignar todos los articulos de la orden');
        }
        const orderItemIds = new Set(order.items.map((item) => item.id));
        const assignedIds = itemAssignments.flatMap((assignment) => assignment.itemIds);
        if (assignedIds.some((id) => !Number.isInteger(id) || !orderItemIds.has(id))) {
            throw new Error('La division contiene articulos que no pertenecen a la orden');
        }
        if (new Set(assignedIds).size !== assignedIds.length) {
            throw new Error('Un articulo no puede asignarse a mas de una persona');
        }
        if (assignedIds.length !== order.items.length) {
            throw new Error('Todos los articulos deben asignarse exactamente una vez');
        }

        // Each person's share is driven by their item subtotal. We then split the
        // order-level discount, tax and tip proportionally by that same share so the
        // pieces always sum back to the order's amounts (no dumping on the last payer).
        const perPerson = itemAssignments.map((assignment) => {
            const personItems = order.items.filter((item) => assignment.itemIds.includes(item.id));
            // item.subtotal already includes modifier prices — do not double-count
            const itemsSubtotal = personItems.reduce((sum, item) => sum + Number(item.subtotal), 0);
            return { assignment, personItems, itemsSubtotal };
        });

        const weights = perPerson.map((p) => p.itemsSubtotal);
        const discount = Number(order.discount || 0);
        const tax = Number(order.tax || 0);
        const tip = Number(order.tipAmount || 0);

        const discountShares = this.distributeProportionally(discount, weights);
        const taxShares = this.distributeProportionally(tax, weights);
        const tipShares = this.distributeProportionally(tip, weights);

        const splits = perPerson.map((p, idx) => {
            const subtotal = Math.round(p.itemsSubtotal * 100) / 100;
            const personDiscount = discountShares[idx];
            const personTax = taxShares[idx];
            const personTip = tipShares[idx];
            const total = Math.round((subtotal - personDiscount + personTax + personTip) * 100) / 100;

            return {
                personName: p.assignment.personName,
                items: p.personItems.map((item) => ({
                    name: item.menuItem.name,
                    quantity: item.quantity,
                    price: Number(item.price),
                    subtotal: Number(item.subtotal)
                })),
                subtotal,
                discount: personDiscount,
                tax: personTax,
                tip: personTip,
                total,
                paid: false
            };
        });

        return {
            orderId: order.id,
            originalTotal: Number(order.total),
            discount,
            tax,
            tip,
            splitTotal: Math.round(splits.reduce((sum, s) => sum + s.total, 0) * 100) / 100,
            splits
        };
    }

    /**
     * Distribute a monetary amount across the given weights, proportionally to each
     * weight, in whole cents. Any rounding remainder is allocated using the
     * largest-remainder method so the parts always sum exactly to `amount`.
     */
    private static distributeProportionally(amount: number, weights: number[]): number[] {
        const totalWeight = weights.reduce((sum, w) => sum + w, 0);
        const totalCents = Math.round(amount * 100);

        if (weights.length === 0 || totalWeight <= 0 || totalCents === 0) {
            return weights.map(() => 0);
        }

        const rawCents = weights.map((w) => (totalCents * w) / totalWeight);
        const floorCents = rawCents.map((c) => Math.floor(c));
        const remainder = totalCents - floorCents.reduce((sum, c) => sum + c, 0);

        // Hand the leftover cents to the largest fractional parts first.
        const byFraction = rawCents
            .map((c, i) => ({ i, frac: c - Math.floor(c) }))
            .sort((a, b) => b.frac - a.frac);

        const result = [...floorCents];
        for (let k = 0; k < remainder && k < byFraction.length; k++) {
            result[byFraction[k].i] += 1;
        }

        return result.map((c) => c / 100);
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

        if (!Array.isArray(customSplits) || customSplits.length === 0) {
            throw new Error('Debe indicar al menos un monto');
        }
        if (customSplits.some((split) => !Number.isFinite(split.amount) || split.amount <= 0)) {
            throw new Error('Cada monto debe ser un numero finito mayor a cero');
        }
        const normalizedSplits = customSplits.map((split) => ({
            ...split,
            amount: Math.round(split.amount * 100) / 100
        }));
        const totalWithTip = Number(order.total);
        const splitTotal = Math.round(normalizedSplits.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;

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
            splits: normalizedSplits.map(s => ({
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
