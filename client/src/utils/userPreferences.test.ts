// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/db', () => ({ db: {} }));
vi.mock('../services/offlineManager', () => ({ offlineManager: { enqueueRequest: vi.fn(), isOnline: vi.fn(() => true) } }));

import api from '../services/api';
import { formatNumber, getRowsPerPage, resetUiPrefs } from '../ui';
import { loadUserPreferences, saveUserPreferences } from './userPreferences';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); resetUiPrefs(); });

describe('user preferences client', () => {
    it('loads the server value and DataTable default becomes the user rows per page', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { rowsPerPage: 50, density: 'compact' } } });
        await loadUserPreferences(7);
        expect(getRowsPerPage()).toBe(50);
        expect(document.documentElement.dataset.density).toBe('compact');
    });

    it('keeps the local copy when the server is unreachable', async () => {
        localStorage.setItem('uiPrefs:7', JSON.stringify({ rowsPerPage: 100 }));
        vi.spyOn(api, 'get').mockRejectedValue(new Error('offline'));
        expect(await loadUserPreferences(7)).toBeNull();
        expect(getRowsPerPage()).toBe(100);
    });

    it('saving rows per page 50 persists on the server and applies right away', async () => {
        const put = vi.spyOn(api, 'put').mockResolvedValue({ data: { data: { rowsPerPage: 50 } } });
        await saveUserPreferences(7, { rowsPerPage: 50 });
        expect(put).toHaveBeenCalledWith('/users/me/preferences', { rowsPerPage: 50 });
        expect(getRowsPerPage()).toBe(50);
        expect(JSON.parse(localStorage.getItem('uiPrefs:7') ?? '{}').rowsPerPage).toBe(50);
    });

    it('number format preference changes the default locale of formatNumber and resets on logout', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ data: { data: { numberFormat: 'en-US' } } });
        await loadUserPreferences(7);
        expect(formatNumber(1234.5)).toBe('1,234.50');
        resetUiPrefs();
        expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat('es-NI', { minimumFractionDigits: 2 }).format(1234.5));
    });
});
