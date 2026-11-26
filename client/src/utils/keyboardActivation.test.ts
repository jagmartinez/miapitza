import { describe, expect, it, vi } from 'vitest';
import { activateOnKeyboard } from './keyboardActivation';

function event(key: string, sameTarget = true) {
    const target = {};
    return {
        key,
        target,
        currentTarget: sameTarget ? target : {},
        preventDefault: vi.fn(),
    };
}

describe('keyboard activation', () => {
    it.each(['Enter', ' '])('activates cards with %s', (key) => {
        const action = vi.fn();
        const keyboardEvent = event(key);
        activateOnKeyboard(keyboardEvent as never, action);
        expect(keyboardEvent.preventDefault).toHaveBeenCalledOnce();
        expect(action).toHaveBeenCalledOnce();
    });

    it('ignores unrelated keys and events bubbling from nested controls', () => {
        const action = vi.fn();
        activateOnKeyboard(event('Escape') as never, action);
        activateOnKeyboard(event('Enter', false) as never, action);
        expect(action).not.toHaveBeenCalled();
    });
});
