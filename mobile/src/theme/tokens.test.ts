import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('dark tokens', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    it('defines the dark palette', () => {
        expect(css).toContain('--bg: #0E0F10');
        expect(css).toContain('--ready: #D4A84B');
        expect(css).toContain('--alert: #C96B66');
    });
});
