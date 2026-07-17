import { describe, expect, it } from 'vitest';

import cameraSource from './hr/CameraCapture.tsx?raw';
import geolocationSource from './hr/GeolocationCapture.tsx?raw';
import printerSource from './TicketPrintModal.tsx?raw';
import tableBillSource from './TableOrdersModal.tsx?raw';
import kitchenSource from '../pages/Kitchen.tsx?raw';
import cashShiftSource from '../pages/CashShift.tsx?raw';

describe('Browser hardware fail-closed contracts', () => {
  it('releases camera tracks and never fabricates a capture after denial/failure', () => {
    expect(cameraSource).toContain("getTracks().forEach((track) => track.stop())");
    expect(cameraSource).toContain('onCaptureRef.current(null)');
    expect(cameraSource).toContain("name === 'NotAllowedError'");
    expect(cameraSource).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('uses fresh bounded GPS evidence and clears it on every hardware error', () => {
    expect(geolocationSource).toContain('timeout: 15000');
    expect(geolocationSource).toContain('maximumAge: 0');
    expect(geolocationSource).toContain('onCapture(null)');
    expect(geolocationSource).not.toMatch(/watchPosition|localStorage|sessionStorage/);
  });

  it('blocks printing without a loaded ticket and handles popup/load failure paths', () => {
    expect(printerSource).toContain("if (!ticketData || loadError)");
    expect(printerSource).toContain("if (!printWindow)");
    expect(printerSource).toContain("addEventListener('load', printWhenReady");
    expect(printerSource).toContain('disabled={loading || !ticketData || !!loadError}');
  });

  it('never fails silently when a secondary print popup is blocked', () => {
    for (const source of [tableBillSource, kitchenSource, cashShiftSource]) {
      expect(source).toContain("if (!printWindow)");
      expect(source).toMatch(/showError\('No se pudo abrir/);
    }
  });
});
