import type { CapacitorConfig } from '@capacitor/cli';

/**
 * CAP_LAN_DEV=1 (debug builds against a dev server on the LAN over http) lets the
 * https WebView origin call the http API. Release builds must never set it.
 */
const lanDev = process.env.CAP_LAN_DEV === '1';

const config: CapacitorConfig = {
    appId: 'com.miapitza.ops',
    appName: 'Mia Pitza Ops',
    webDir: 'dist',
    android: { allowMixedContent: lanDev },
};

export default config;
