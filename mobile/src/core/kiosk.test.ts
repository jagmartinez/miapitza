const native = vi.hoisted(() => ({ value: true }));
const kiosk = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
const keepAwake = vi.hoisted(() => ({ keepAwake: vi.fn(), allowSleep: vi.fn() }));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
    registerPlugin: () => kiosk,
}));
vi.mock('@capacitor-community/keep-awake', () => ({ KeepAwake: keepAwake }));

import { enterKiosk, exitKiosk } from './kiosk';

describe('kiosk', () => {
    beforeEach(() => {
        native.value = true;
        kiosk.start.mockReset().mockResolvedValue(undefined);
        kiosk.stop.mockReset().mockResolvedValue(undefined);
        keepAwake.keepAwake.mockReset().mockResolvedValue(undefined);
        keepAwake.allowSleep.mockReset().mockResolvedValue(undefined);
    });

    it('enterKiosk calls KeepAwake.keepAwake and Kiosk.start on native', async () => {
        await enterKiosk();
        expect(keepAwake.keepAwake).toHaveBeenCalledTimes(1);
        expect(kiosk.start).toHaveBeenCalledTimes(1);
    });

    it('no-op on web', async () => {
        native.value = false;
        await enterKiosk();
        await exitKiosk();
        expect(keepAwake.keepAwake).not.toHaveBeenCalled();
        expect(keepAwake.allowSleep).not.toHaveBeenCalled();
        expect(kiosk.start).not.toHaveBeenCalled();
        expect(kiosk.stop).not.toHaveBeenCalled();
    });

    it('plugin rejection is swallowed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        keepAwake.keepAwake.mockRejectedValue(new Error('boom'));
        kiosk.stop.mockRejectedValue(new Error('boom'));
        await expect(enterKiosk()).resolves.toBeUndefined();
        expect(kiosk.start).toHaveBeenCalledTimes(1);
        await expect(exitKiosk()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('exitKiosk calls allowSleep and stop', async () => {
        await exitKiosk();
        expect(keepAwake.allowSleep).toHaveBeenCalledTimes(1);
        expect(kiosk.stop).toHaveBeenCalledTimes(1);
    });
});
