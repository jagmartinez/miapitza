import type { DeviceType } from './session';

export type AppMode = 'setup' | 'waiter' | 'kitchen' | 'account';

export function resolveMode(deviceType: DeviceType | null): AppMode {
    switch (deviceType) {
        case 'SERVICE_TABLET':
            return 'waiter';
        case 'KITCHEN_TABLET':
            return 'kitchen';
        case 'PERSONAL':
            return 'account';
        default:
            return 'setup';
    }
}
