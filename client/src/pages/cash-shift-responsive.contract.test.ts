import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cashShiftCss = readFileSync(new URL('./CashShift.module.css', import.meta.url), 'utf8');
const cashShiftSource = readFileSync(new URL('./CashShift.tsx', import.meta.url), 'utf8');
// El arqueo vive en el FullScreenModal del design system: las zonas seguras se reservan ahí.
const overlaysCss = readFileSync(new URL('../ui/overlays/overlays.css', import.meta.url), 'utf8');

describe('CashShift responsive arqueo contract', () => {
    it('keeps denomination rows fluid instead of requiring desktop-only fixed columns', () => {
        const denominationRule = cashShiftCss.match(/\.denomRow\s*\{[\s\S]*?\}/)?.[0] ?? '';

        expect(denominationRule).toContain('minmax(');
        expect(denominationRule).toContain('min-width: 0');
        expect(denominationRule).not.toContain('65px 16px 80px 1fr');
    });

    it('moves the subtotal to its own aligned row on narrow devices and reserves safe areas', () => {
        expect(cashShiftCss).toContain('@media (max-width: 560px)');
        expect(cashShiftCss).toContain('"subtotal subtotal"');
        expect(overlaysCss).toContain('env(safe-area-inset-bottom, 0px)');
        expect(overlaysCss).toContain('env(safe-area-inset-left, 0px)');
        expect(overlaysCss).toContain('env(safe-area-inset-right, 0px)');
    });

    it('stacks the arqueo summary below the count across tablet widths (769-1024 px)', () => {
        // El resumen del arqueo solo va a columna lateral desde 1024 px; en tableta queda debajo del conteo.
        expect(overlaysCss).toMatch(/@media \(min-width: 1024px\)\s*\{\s*\.ui-fsm__body\.has-aside/);
        expect(cashShiftCss).toContain('@media (max-width: 1023px)');
    });

    it('keeps denomination inputs identifiable and mobile-keyboard friendly', () => {
        expect(cashShiftSource).toContain('inputMode="numeric"');
        expect(cashShiftSource).toContain('Cantidad de billetes de ${symbol} ${den}');
        expect(cashShiftSource).toContain('Cantidad de monedas de ${symbol} ${den}');
        expect(cashShiftSource).toContain('Cantidad de billetes USD de ${den}');
    });
});
