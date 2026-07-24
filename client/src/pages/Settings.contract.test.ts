import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsSource = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');

describe('settings load safety contract', () => {
    it('blocks persistence until server settings have loaded successfully', () => {
        expect(settingsSource).toContain('const [settingsLoaded, setSettingsLoaded] = useState(false)');
        expect(settingsSource).toContain('if (!settingsLoaded || settingsLoadError)');
        expect(settingsSource).toContain('disabled={saving || Boolean(settingsLoadError)}');
        expect(settingsSource).toContain('<LoadErrorState');
    });

    it('uses a native keyboard-operable control for the tip switch', () => {
        expect(settingsSource).toMatch(/<button\s+type="button"\s+role="switch"/);
    });
});
