import { createSessionStore, memoryStore } from './session';

describe('session store device pairing', () => {
    it('stores device type next to the token and clears both together', async () => {
        const sessions = createSessionStore(memoryStore());
        expect(await sessions.deviceType()).toBeNull();
        await sessions.saveDeviceToken('d-1');
        await sessions.saveDeviceType('KITCHEN_TABLET');
        expect(await sessions.deviceType()).toBe('KITCHEN_TABLET');
        await sessions.clearDevice();
        expect(await sessions.deviceToken()).toBeNull();
        expect(await sessions.deviceType()).toBeNull();
    });

    it('ignores an unknown stored device type', async () => {
        const store = memoryStore();
        await store.set('deviceType', 'TOASTER');
        expect(await createSessionStore(store).deviceType()).toBeNull();
    });
});
