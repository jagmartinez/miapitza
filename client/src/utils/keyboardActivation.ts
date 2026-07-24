import type { KeyboardEvent } from 'react';

export function activateOnKeyboard(event: KeyboardEvent<HTMLElement>, action: () => void) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
}
