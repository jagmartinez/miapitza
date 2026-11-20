import { resolveMode } from './mode';

describe('resolveMode', () => {
    it('null device → setup', () => expect(resolveMode(null)).toBe('setup'));
    it('SERVICE_TABLET → waiter', () => expect(resolveMode('SERVICE_TABLET')).toBe('waiter'));
    it('KITCHEN_TABLET → kitchen', () => expect(resolveMode('KITCHEN_TABLET')).toBe('kitchen'));
    it('PERSONAL → account', () => expect(resolveMode('PERSONAL')).toBe('account'));
});
