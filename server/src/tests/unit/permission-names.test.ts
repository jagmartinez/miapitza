import { collectPermissionNames } from '../../utils/permission-names';

describe('collectPermissionNames', () => {
    it('combines primary and secondary role grants without duplicates in stable order', () => {
        expect(collectPermissionNames([
            { permissions: [{ name: 'payments.reverse' }, { name: 'orders.view' }] },
            { permissions: [{ name: 'orders.view' }, { name: 'payments.process' }] },
        ])).toEqual(['orders.view', 'payments.process', 'payments.reverse']);
    });

    it('supports legacy/mocked roles without a permissions relation', () => {
        expect(collectPermissionNames([{}, { permissions: null }])).toEqual([]);
    });
});
