import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(new URL('./settings/SettingsPage.tsx', import.meta.url), 'utf8');
const settingsRowSource = readFileSync(new URL('../ui/settings/SettingsRow.tsx', import.meta.url), 'utf8');
const switchSource = readFileSync(new URL('../ui/forms/Switch.tsx', import.meta.url), 'utf8');

describe('settings load safety contract', () => {
    it('blocks persistence while the current server settings could not be loaded', () => {
        expect(settingsSource).toContain('if (loadError) {');
        expect(settingsSource).toContain('Recarga la configuración vigente antes de guardar cambios.');
        expect(settingsSource).toContain('getApiErrorMessage(');
    });

    it('uses a native keyboard-operable control for boolean settings such as the tip switch', () => {
        expect(settingsRowSource).toContain('<Switch');
        expect(switchSource).toMatch(/<button\s+type="button"[\s\S]*?role="switch"/);
    });
});
