import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');

describe('ticket layout on short screens', () => {
    const ticket = read('ticket.css');
    it('keeps a minimum list height', () => {
        expect(ticket).toMatch(/\n\.vlist\s*\{[^}]*min-height:\s*140px/);
    });
    it('lets the panel scroll', () => {
        expect(read('order.css')).toMatch(/\n\.ticket\s*\{[^}]*overflow-y:\s*auto/);
    });
    it('keeps the footer visible in the short-height media rule', () => {
        expect(ticket).toMatch(/@media \(max-height: 480px\)\s*\{[\s\S]*\.ticket-foot\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/);
    });
});
