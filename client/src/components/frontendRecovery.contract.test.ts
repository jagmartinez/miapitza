import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
const networkSource = readFileSync(new URL('./NetworkStatus.tsx', import.meta.url), 'utf8');
const operationalPages = [
    '../pages/ProductionOrders.tsx',
    '../pages/ProductionRecipes.tsx',
    '../pages/Warehouses.tsx',
    '../pages/PurchaseOrders.tsx',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

describe('frontend recovery and session safety', () => {
    it('clears the local session before awaiting remote logout', () => {
        const logoutBody = authSource.slice(
            authSource.indexOf('const logout = useCallback'),
            authSource.indexOf('const resetTimer'),
        );
        expect(logoutBody.indexOf("localStorage.removeItem('token')"))
            .toBeLessThan(logoutBody.indexOf('await remoteLogout'));
        expect(logoutBody.indexOf('setUser(null)'))
            .toBeLessThan(logoutBody.indexOf('await remoteLogout'));
    });

    it('uses owner-scoped queue counts and resumes pending online work on mount', () => {
        expect(networkSource).toContain('offlineManager.getPendingCount()');
        expect(networkSource).not.toContain('db.syncQueue.count()');
        expect(networkSource).toContain('offlineManager.processSyncQueue()');
    });

    it('shows retryable errors instead of replacing operational failures with empty lists', () => {
        for (const source of operationalPages) {
            expect(source).toContain('<LoadErrorState');
            expect(source).toContain('setLoadError(');
        }
    });
});
