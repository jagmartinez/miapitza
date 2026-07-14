import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('users status management contract', () => {
    it('uses reversible status updates instead of deleting users', () => {
        const source = readFileSync(fileURLToPath(new URL('./Users.tsx', import.meta.url)), 'utf8');
        expect(source).toContain("usersAPI.update(targetUser.id, { status: activating ? 'ACTIVE' : 'INACTIVE' })");
        expect(source).toContain('Su historial se conservará');
        expect(source).not.toContain('usersAPI.delete(');
    });
});
