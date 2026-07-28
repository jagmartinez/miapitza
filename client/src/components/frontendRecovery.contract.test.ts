import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authSource = readFileSync(new URL('../context/AuthContext.tsx', import.meta.url), 'utf8');
const networkSource = readFileSync(new URL('./NetworkStatus.tsx', import.meta.url), 'utf8');
const usersSource = readFileSync(new URL('../pages/Users.tsx', import.meta.url), 'utf8');
const reservationsSource = readFileSync(new URL('../pages/Reservations.tsx', import.meta.url), 'utf8');
const operationalPages = [
    '../pages/ProductionOrders.tsx',
    '../pages/ProductionRecipes.tsx',
    '../pages/Warehouses.tsx',
    '../pages/PurchaseOrders.tsx',
    '../pages/Users.tsx',
    '../pages/Reservations.tsx',
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

    it('blocks stale mutable user and reservation surfaces until the failed scope reloads', () => {
        expect(usersSource).toContain('lastRequestedCompanyId.current = companyId');
        expect(usersSource).toContain('loadData(lastRequestedCompanyId.current, true)');
        expect(usersSource).toContain('loadRequestGuard.current.begin()');
        expect(usersSource).toContain('loadRequestGuard.current.isCurrent(requestId)');
        expect(usersSource).toContain("{!loadError && viewMode === 'table'");
        expect(usersSource).toContain("{!loadError && viewMode === 'cards'");
        expect(reservationsSource).toContain("{!loadError && viewMode === 'calendar'");
        expect(reservationsSource).toContain("{!loadError && viewMode === 'table'");
    });
});
