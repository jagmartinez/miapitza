import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { WRITABLE_SETTING_KEYS } from '../../services/setting.service';

/**
 * Every key some code path persists or reads through PUT /settings must stay
 * writable; otherwise saving Settings.tsx (which sends the whole form) fails.
 */
const KEYS_WRITTEN_BY_SETTINGS_PAGE = [
    'companyName', 'taxRate', 'tipRate', 'cash_reconciliation_tolerance', 'tipEnabled', 'currency_symbol',
    'nif', 'address', 'phone', 'email', 'logoUrl',
    'invoicePrefix', 'invoiceFooter', 'invoiceTerms',
    'fiscal_jurisdiction', 'credit_note_series', 'fiscal_tax_id_length', 'fiscal_tax_id_charset',
    'enablePromotions', 'reservation_table_window_minutes', 'password_expiry_days', 'session_timeout_minutes',
];

/** Keys read server/client side from `${companyId}_<key>` settings rows. */
const KEYS_CONSUMED_ELSEWHERE = [
    'tax_rate', 'restaurant_name', 'timezone', 'currency', 'currency_name', 'currency_locale',
    'kds_warning_minutes', 'kds_urgent_minutes', 'maxManualDiscountPercent', 'ruc',
];

describe('settings writable allowlist', () => {
    it.each([...KEYS_WRITTEN_BY_SETTINGS_PAGE, ...KEYS_CONSUMED_ELSEWHERE])('allows %s', (key) => {
        expect(WRITABLE_SETTING_KEYS.has(key)).toBe(true);
    });

    it('covers every field of the Settings page form', () => {
        const settingsPage = path.resolve(__dirname, '../../../../client/src/pages/Settings.tsx');
        if (!fs.existsSync(settingsPage)) return;
        const source = fs.readFileSync(settingsPage, 'utf8');
        const block = source.match(/useState\(\{([\s\S]*?)\}\);/);
        expect(block).not.toBeNull();
        const keys = Array.from(block![1].matchAll(/^\s*([A-Za-z_]+):/gm), (m) => m[1]);
        expect(keys.length).toBeGreaterThan(10);
        expect(keys.filter((key) => !WRITABLE_SETTING_KEYS.has(key))).toEqual([]);
    });
});
