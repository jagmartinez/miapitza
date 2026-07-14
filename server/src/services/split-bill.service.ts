import prisma from '../utils/prisma';

export interface SplitBillQuantityAssignment {
    orderItemId: number;
    quantity: number;
}

export interface SplitBillItemAssignment {
    personName: string;
    /** Legacy contract: every referenced line is assigned in full. */
    itemIds?: number[];
    /** Quantity-aware contract: a line can be shared by multiple payers. */
    items?: SplitBillQuantityAssignment[];
}

export class SplitBillValidationError extends Error {
    readonly statusCode = 400;
}

/**
 * Split Bill Service
 * Handles dividing orders among multiple payers
 */
export class SplitBillService {
    private static normalizeAndValidatePayers<T extends { personName: string }>(splits: T[]): T[] {
        const seen = new Set<string>();
        return splits.map((split) => {
            const personName = typeof split.personName === 'string' ? split.personName.trim() : '';
            if (!personName) {
                throw new SplitBillValidationError('Cada persona debe tener un nombre');
            }
            const identity = personName.toLocaleLowerCase('es-NI');
            if (seen.has(identity)) {
                throw new SplitBillValidationError('Los nombres de las personas deben ser únicos');
            }
            seen.add(identity);
            return { ...split, personName };
        });
    }

    private static getRemainingBalance(order: {
        total: unknown;
        status?: string;
        payments?: Array<{ amount: unknown }>;
    }) {
        if (order.status === 'CANCELLED') {
            throw new Error('No se puede dividir una orden cancelada');
        }
        const totalCents = Math.round(Number(order.total) * 100);
        const paidCents = (order.payments || []).reduce(
            (sum, payment) => sum + Math.round(Number(payment.amount) * 100),
            0
        );
        const remainingCents = totalCents - paidCents;
        if (remainingCents <= 0) {
            throw new Error('La orden no tiene saldo pendiente');
        }
        return {
            orderTotal: totalCents / 100,
            totalPaid: paidCents / 100,
            remainingBalance: remainingCents / 100,
        };
    }

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
                },
                payments: { where: { status: 'ACTIVE' }, select: { amount: true, payerName: true } }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }

        const balance = this.getRemainingBalance(order);
        const orderTotal = balance.remainingBalance;
        const remainingCents = Math.round(orderTotal * 100);
        if (numberOfPeople > remainingCents) {
            throw new Error('No puede haber más personas que centavos pendientes; cada pago debe ser mayor a cero');
        }

        const baseCents = Math.floor(remainingCents / numberOfPeople);
        const extraCents = remainingCents % numberOfPeople;
        const amounts = Array.from(
            { length: numberOfPeople },
            (_, index) => (baseCents + (index < extraCents ? 1 : 0)) / 100
        );
        const amountPerPerson = baseCents / 100;

        return {
            orderId: order.id,
            originalTotal: balance.orderTotal,
            totalPaid: balance.totalPaid,
            remainingBalance: balance.remainingBalance,
            discount: Number(order.discount || 0),
            tipAmount: Number(order.tipAmount || 0),
            finalTotal: orderTotal,
            numberOfPeople,
            amountPerPerson,
            splits: Array.from({ length: numberOfPeople }, (_, i) => ({
                person: i + 1,
                amount: amounts[i],
                paid: false
            }))
        };
    }

    /**
     * Split order by items (each person selects their items)
     */
    static async splitByItems(
        orderId: number,
        companyId: number,
        itemAssignments: SplitBillItemAssignment[]
    ) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: {
                items: {
                    include: { menuItem: true, modifiers: true }
                },
                payments: { where: { status: 'ACTIVE' }, select: { amount: true, payerName: true } }
            }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }
        const balance = this.getRemainingBalance(order);

        if (!Array.isArray(itemAssignments) || itemAssignments.length === 0) {
            throw new SplitBillValidationError('Debe asignar todos los articulos de la orden');
        }
        if (itemAssignments.some((assignment) => !assignment || typeof assignment !== 'object')) {
            throw new SplitBillValidationError('Cada asignacion debe identificar una persona y sus articulos');
        }
        const namedAssignments = this.normalizeAndValidatePayers(itemAssignments);
        const orderItemById = new Map(order.items.map((item) => [item.id, item]));
        const normalizedAssignments = namedAssignments.map((assignment) => {
            const hasLegacyItems = assignment.itemIds !== undefined;
            const hasQuantityItems = assignment.items !== undefined;
            if (hasLegacyItems === hasQuantityItems) {
                throw new SplitBillValidationError('Cada persona debe enviar itemIds o items, pero no ambos');
            }

            const requestedItems = new Map<number, number>();
            if (hasLegacyItems) {
                if (!Array.isArray(assignment.itemIds) || assignment.itemIds.length === 0) {
                    throw new SplitBillValidationError('Cada persona debe tener al menos un articulo asignado');
                }
                for (const orderItemId of assignment.itemIds) {
                    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
                        throw new SplitBillValidationError('Los identificadores de articulos deben ser enteros positivos');
                    }
                    const orderItem = orderItemById.get(orderItemId);
                    if (!orderItem) {
                        throw new SplitBillValidationError('La division contiene articulos que no pertenecen a la orden');
                    }
                    requestedItems.set(
                        orderItemId,
                        (requestedItems.get(orderItemId) || 0) + orderItem.quantity
                    );
                }
            } else {
                if (!Array.isArray(assignment.items) || assignment.items.length === 0) {
                    throw new SplitBillValidationError('Cada persona debe tener al menos un articulo asignado');
                }
                for (const requestedItem of assignment.items) {
                    if (!requestedItem || typeof requestedItem !== 'object') {
                        throw new SplitBillValidationError('Cada articulo asignado debe indicar orderItemId y quantity');
                    }
                    const { orderItemId, quantity } = requestedItem;
                    if (!Number.isInteger(orderItemId) || orderItemId <= 0) {
                        throw new SplitBillValidationError('Los identificadores de articulos deben ser enteros positivos');
                    }
                    if (!Number.isInteger(quantity) || quantity <= 0) {
                        throw new SplitBillValidationError('Las cantidades asignadas deben ser enteros positivos');
                    }
                    if (!orderItemById.has(orderItemId)) {
                        throw new SplitBillValidationError('La division contiene articulos que no pertenecen a la orden');
                    }
                    requestedItems.set(orderItemId, (requestedItems.get(orderItemId) || 0) + quantity);
                }
            }

            return {
                personName: assignment.personName,
                items: Array.from(requestedItems, ([orderItemId, quantity]) => ({ orderItemId, quantity }))
            };
        });

        const assignedQuantityByItem = new Map<number, number>();
        for (const assignment of normalizedAssignments) {
            for (const requestedItem of assignment.items) {
                const orderedQuantity = orderItemById.get(requestedItem.orderItemId)!.quantity;
                const assignedQuantity = (assignedQuantityByItem.get(requestedItem.orderItemId) || 0)
                    + requestedItem.quantity;
                if (assignedQuantity > orderedQuantity) {
                    throw new SplitBillValidationError(
                        'La cantidad asignada no puede exceder la ordenada ni un articulo completo asignarse a mas de una persona'
                    );
                }
                assignedQuantityByItem.set(requestedItem.orderItemId, assignedQuantity);
            }
        }
        if (order.items.some((item) => assignedQuantityByItem.get(item.id) !== item.quantity)) {
            throw new SplitBillValidationError(
                'Todos los articulos y sus cantidades deben asignarse exactamente una vez'
            );
        }

        // OrderItem.subtotal is authoritative and already includes modifiers.
        // Split each line independently before allocating order-level amounts.
        const personItems: Array<Array<{
            orderItemId: number;
            name: string;
            quantity: number;
            price: number;
            amount: number;
            subtotal: number;
        }>> = normalizedAssignments.map(() => []);
        const personSubtotalCents = normalizedAssignments.map(() => 0);
        const personQuantityWeights = normalizedAssignments.map(() => 0);

        for (const orderItem of order.items) {
            const allocations = normalizedAssignments.flatMap((assignment, assignmentIndex) => {
                const allocated = assignment.items.find((item) => item.orderItemId === orderItem.id);
                return allocated ? [{ assignmentIndex, quantity: allocated.quantity }] : [];
            });
            const subtotalShares = this.distributeCents(
                Math.round(Number(orderItem.subtotal) * 100),
                allocations.map((allocation) => allocation.quantity)
            );
            allocations.forEach((allocation, allocationIndex) => {
                const subtotalCents = subtotalShares[allocationIndex];
                personSubtotalCents[allocation.assignmentIndex] += subtotalCents;
                personQuantityWeights[allocation.assignmentIndex] += allocation.quantity;
                personItems[allocation.assignmentIndex].push({
                    orderItemId: orderItem.id,
                    name: orderItem.menuItem.name,
                    quantity: allocation.quantity,
                    price: Number(orderItem.price),
                    amount: subtotalCents / 100,
                    subtotal: subtotalCents / 100
                });
            });
        }

        const discountCents = Math.round(Number(order.discount || 0) * 100);
        const taxCents = Math.round(Number(order.tax || 0) * 100);
        const tipCents = Math.round(Number(order.tipAmount || 0) * 100);
        const monetaryWeights = personSubtotalCents.some((weight) => weight > 0)
            ? personSubtotalCents
            : personQuantityWeights;
        const discountShares = this.distributeCents(discountCents, monetaryWeights);
        const taxShares = this.distributeCents(taxCents, monetaryWeights);
        const tipShares = this.distributeCents(tipCents, monetaryWeights);
        const componentTotals = personSubtotalCents.map((subtotal, index) =>
            subtotal - discountShares[index] + taxShares[index] + tipShares[index]
        );

        // Normally zero; explicit for historical orders whose total differs from
        // their stored components, while preserving exact invoice reconciliation.
        const orderTotalCents = Math.round(balance.orderTotal * 100);
        const componentTotalCents = componentTotals.reduce((sum, total) => sum + total, 0);
        const adjustmentWeights = componentTotals.some((weight) => weight > 0)
            ? componentTotals.map((weight) => Math.max(0, weight))
            : monetaryWeights;
        const adjustmentShares = this.distributeCents(
            orderTotalCents - componentTotalCents,
            adjustmentWeights
        );
        const fullOrderSplits = normalizedAssignments.map((assignment, index) => {
            const originalShareTotalCents = componentTotals[index] + adjustmentShares[index];
            return {
                personName: assignment.personName,
                items: personItems[index],
                subtotal: personSubtotalCents[index] / 100,
                discount: discountShares[index] / 100,
                tax: taxShares[index] / 100,
                tip: tipShares[index] / 100,
                roundingAdjustment: adjustmentShares[index] / 100,
                total: originalShareTotalCents / 100,
                paid: false
            };
        });
        const paidByPayer = new Map<string, number>();
        for (const payment of order.payments || []) {
            const payerName = payment.payerName?.trim();
            if (!payerName) continue;
            const payerIdentity = payerName.toLocaleLowerCase('es-NI');
            paidByPayer.set(
                payerIdentity,
                (paidByPayer.get(payerIdentity) || 0) + Math.round(Number(payment.amount) * 100)
            );
        }
        const payerRemainingWeights = fullOrderSplits.map((split) => Math.max(
            0,
            Math.round(split.total * 100)
                - (paidByPayer.get(split.personName.trim().toLocaleLowerCase('es-NI')) || 0)
        ));
        const effectiveWeights = payerRemainingWeights.some((weight) => weight > 0)
            ? payerRemainingWeights
            : fullOrderSplits.map((split) => Math.round(split.total * 100));
        const remainingShares = this.distributeCents(
            Math.round(balance.remainingBalance * 100),
            effectiveWeights
        );
        const splits = fullOrderSplits.map((split, index) => ({
            ...split,
            originalShareTotal: split.total,
            total: remainingShares[index] / 100,
        }));

        const discount = discountCents / 100;
        const tax = taxCents / 100;
        const tip = tipCents / 100;

        return {
            orderId: order.id,
            originalTotal: balance.orderTotal,
            totalPaid: balance.totalPaid,
            remainingBalance: balance.remainingBalance,
            discount,
            tax,
            tip,
            splitTotal: remainingShares.reduce((sum, share) => sum + share, 0) / 100,
            splits
        };
    }

    /**
     * Distribute a monetary amount across the given weights, proportionally to each
     * weight, in whole cents. Any rounding remainder is allocated using the
     * largest-remainder method so the parts always sum exactly to `amount`.
     */
    private static distributeCents(totalCents: number, weights: number[]): number[] {
        if (totalCents < 0) {
            return this.distributeCents(-totalCents, weights).map((share) => -share);
        }
        const totalWeight = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
        if (weights.length === 0 || totalWeight <= 0 || totalCents === 0) {
            return weights.map(() => 0);
        }

        const rawCents = weights.map((weight) => (totalCents * Math.max(0, weight)) / totalWeight);
        const floorCents = rawCents.map((c) => Math.floor(c));
        const remainder = totalCents - floorCents.reduce((sum, c) => sum + c, 0);

        // Hand the leftover cents to the largest fractional parts first.
        const byFraction = rawCents
            .map((c, i) => ({ i, frac: c - Math.floor(c) }))
            .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

        const result = [...floorCents];
        for (let k = 0; k < remainder && k < byFraction.length; k++) {
            result[byFraction[k].i] += 1;
        }

        return result;
    }

    private static distributeProportionally(amount: number, weights: number[]): number[] {
        return this.distributeCents(Math.round(amount * 100), weights).map((cents) => cents / 100);
    }

    /**
     * Split order by custom amounts
     */
    static async splitByAmount(orderId: number, companyId: number, customSplits: {
        personName: string;
        amount: number;
    }[]) {
        const order = await prisma.order.findFirst({
            where: { id: orderId, companyId },
            include: { payments: { where: { status: 'ACTIVE' }, select: { amount: true } } }
        });

        if (!order) {
            throw new Error('Orden no encontrada');
        }
        const balance = this.getRemainingBalance(order);

        if (!Array.isArray(customSplits) || customSplits.length === 0) {
            throw new Error('Debe indicar al menos un monto');
        }
        const validatedSplits = this.normalizeAndValidatePayers(customSplits);
        if (validatedSplits.some((split) => !Number.isFinite(split.amount) || split.amount <= 0)) {
            throw new Error('Cada monto debe ser un numero finito mayor a cero');
        }
        const normalizedSplits = validatedSplits.map((split) => {
            const cents = Math.round(split.amount * 100);
            if (Math.abs(split.amount - cents / 100) > 1e-9) {
                throw new Error('Cada monto debe tener como máximo dos decimales');
            }
            return { ...split, amount: cents / 100 };
        });
        const totalWithTip = balance.remainingBalance;
        const splitTotalCents = normalizedSplits.reduce((sum, split) => sum + Math.round(split.amount * 100), 0);
        const expectedCents = Math.round(totalWithTip * 100);
        const splitTotal = splitTotalCents / 100;

        if (splitTotalCents !== expectedCents) {
            const difference = (expectedCents - splitTotalCents) / 100;
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
            originalTotal: balance.orderTotal,
            totalPaid: balance.totalPaid,
            remainingBalance: balance.remainingBalance,
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
