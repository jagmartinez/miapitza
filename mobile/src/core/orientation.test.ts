import { applyOrientation, orientationFor } from './orientation';

describe('orientation', () => {
    it('waiter and kitchen are landscape, account is portrait, setup is free', () => {
        expect(orientationFor('waiter')).toBe('landscape');
        expect(orientationFor('kitchen')).toBe('landscape');
        expect(orientationFor('account')).toBe('portrait');
        expect(orientationFor('setup')).toBeNull();
    });

    it('does not throw outside a native platform', async () => {
        await expect(applyOrientation('waiter')).resolves.toBeUndefined();
    });
});
