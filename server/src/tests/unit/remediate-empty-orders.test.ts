import {
    classifyOrder,
    validateApplyGuards,
    type OrderSnapshot,
    type RemediationOptions
} from '../../scripts/remediate-empty-orders';

function snapshot(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
    return {
        id: 10,
        companyId: 1,
        branchId: 2,
        status: 'PAID',
        salesChannel: 'RESTAURANT',
        total: 0,
        invoiceNumber: null,
        discountCode: null,
        itemCount: 0,
        payments: [],
        externalSyncCount: 0,
        cashMovementCount: 0,
        inventoryMovementCount: 0,
        ...overrides
    };
}

describe('remediate-empty-orders safety classifier', () => {
    test('only accepts an empty non-positive terminal order without dependencies', () => {
        const result = classifyOrder(snapshot({
            total: -2,
            payments: [
                { id: 1, amount: 0, status: 'ACTIVE', reference: null },
                { id: 2, amount: -2, status: 'ACTIVE', reference: null }
            ]
        }));

        expect(result.eligible).toBe(true);
        expect(result.blockers).toEqual([]);
    });

    test.each([
        ['positive total', { total: 0.01 }, 'total positivo'],
        ['positive payment', { payments: [{ id: 3, amount: 1, status: 'ACTIVE', reference: null }] }, 'pago(s) positivo(s)'],
        ['invoice', { invoiceNumber: 'F-1' }, 'factura'],
        ['external sync', { externalSyncCount: 1 }, 'sincronización(es) externa(s)'],
        ['external channel', { salesChannel: 'PEDIDOSYA' }, 'canal externo'],
        ['cash ledger', { cashMovementCount: 1 }, 'movimiento(s) de caja'],
        ['inventory ledger', { inventoryMovementCount: 1 }, 'movimiento(s) de inventario'],
        ['payment reference', { payments: [{ id: 4, amount: 0, status: 'ACTIVE', reference: 'provider-4' }] }, 'referencia externa'],
        ['promotion', { discountCode: 'PROMO' }, 'promoción'],
        ['non-empty order', { itemCount: 1 }, 'item(s)'],
        ['non-terminal order', { status: 'OPEN' }, 'no es PAID/DELIVERED']
    ])('blocks %s', (_label, overrides, blocker) => {
        const result = classifyOrder(snapshot(overrides as Partial<OrderSnapshot>));
        expect(result.eligible).toBe(false);
        expect(result.blockers.join(' | ')).toContain(blocker);
    });
});

describe('remediate-empty-orders apply guards', () => {
    const options: RemediationOptions = {
        companyId: 1,
        actorUserId: 7,
        out: 'backup.json',
        apply: true,
        confirmCompany: 'Empresa Exacta'
    };
    const previousFirst = process.env.ALLOW_EMPTY_ORDER_REMEDIATION;
    const previousSecond = process.env.ALLOW_LEDGER_REMEDIATION;

    afterEach(() => {
        if (previousFirst === undefined) delete process.env.ALLOW_EMPTY_ORDER_REMEDIATION;
        else process.env.ALLOW_EMPTY_ORDER_REMEDIATION = previousFirst;
        if (previousSecond === undefined) delete process.env.ALLOW_LEDGER_REMEDIATION;
        else process.env.ALLOW_LEDGER_REMEDIATION = previousSecond;
    });

    test('requires both independent environment guards', () => {
        delete process.env.ALLOW_EMPTY_ORDER_REMEDIATION;
        delete process.env.ALLOW_LEDGER_REMEDIATION;
        expect(() => validateApplyGuards(options, 'Empresa Exacta')).toThrow('ALLOW_EMPTY_ORDER_REMEDIATION');

        process.env.ALLOW_EMPTY_ORDER_REMEDIATION = '1';
        expect(() => validateApplyGuards(options, 'Empresa Exacta')).toThrow('ALLOW_LEDGER_REMEDIATION');
    });

    test('requires the exact company name', () => {
        process.env.ALLOW_EMPTY_ORDER_REMEDIATION = '1';
        process.env.ALLOW_LEDGER_REMEDIATION = '1';
        expect(() => validateApplyGuards({ ...options, confirmCompany: 'empresa exacta' }, 'Empresa Exacta'))
            .toThrow('coincidir exactamente');
    });

    test('returns the actor only after every guard passes', () => {
        process.env.ALLOW_EMPTY_ORDER_REMEDIATION = '1';
        process.env.ALLOW_LEDGER_REMEDIATION = '1';
        expect(validateApplyGuards(options, 'Empresa Exacta')).toBe(7);
    });

    test('requires an explicit actor for immutable reversal metadata', () => {
        process.env.ALLOW_EMPTY_ORDER_REMEDIATION = '1';
        process.env.ALLOW_LEDGER_REMEDIATION = '1';
        expect(() => validateApplyGuards({ ...options, actorUserId: undefined }, 'Empresa Exacta'))
            .toThrow('--actor-user-id');
    });
});
