import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cashShiftCss = readFileSync(new URL('./CashShift.css', import.meta.url), 'utf8');
const cashShiftSource = readFileSync(new URL('./CashShift.tsx', import.meta.url), 'utf8');

describe('CashShift responsive arqueo contract', () => {
    it('keeps denomination rows fluid instead of requiring desktop-only fixed columns', () => {
        const denominationRule = cashShiftCss.match(/\.denomination-item\s*\{[\s\S]*?\}/)?.[0] ?? '';
        const inputRule = cashShiftCss.match(/\.den-input-compact\s*\{[\s\S]*?\}/)?.[0] ?? '';

        expect(denominationRule).toContain('minmax(58px, 0.8fr)');
        expect(denominationRule).toContain('minmax(105px, 1.35fr)');
        expect(denominationRule).not.toContain('65px 16px 80px 1fr');
        expect(inputRule).toContain('min-width: 0');
        expect(inputRule).toContain('box-sizing: border-box');
    });

    it('moves the subtotal to its own aligned row on narrow devices and reserves safe areas', () => {
        expect(cashShiftCss).toContain('@media (max-width: 560px)');
        expect(cashShiftCss).toContain('"value times input"');
        expect(cashShiftCss).toContain('"subtotal subtotal subtotal"');
        expect(cashShiftCss).toContain('env(safe-area-inset-bottom, 0px)');
        expect(cashShiftCss).toContain('env(safe-area-inset-left, 0px)');
        expect(cashShiftCss).toContain('env(safe-area-inset-right, 0px)');
    });

    it('constrains only the arqueo sidebar across tablet widths', () => {
        expect(cashShiftCss).toContain('@media (min-width: 769px) and (max-width: 1024px)');
        expect(cashShiftCss).toContain('.sidebar-panel:has(.arqueo-sidebar)');
        expect(cashShiftCss).toContain('width: min(720px, 100vw)');
    });

    it('keeps denomination inputs identifiable and mobile-keyboard friendly', () => {
        expect(cashShiftSource).toContain('inputMode="numeric"');
        expect(cashShiftSource).toContain('aria-label={`Cantidad de billetes de ${symbol} ${den}`}');
        expect(cashShiftSource).toContain('aria-label={`Cantidad de monedas de ${symbol} ${den}`}');
        expect(cashShiftSource).toContain('aria-label={`Cantidad de billetes USD de ${den}`}');
    });
});
