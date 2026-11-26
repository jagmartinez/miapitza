import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const posSource = readFileSync(new URL('../pages/POS.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

describe('POS offline causal chain', () => {
    it('groups queued item additions and makes kitchen delivery depend on the whole group', () => {
        expect(posSource).toContain('entityTempId: operationGroupKey');
        expect(posSource).toContain('dependencyKey: offlineQueued ? operationGroupKey : null');
        expect(posSource).toContain('dependencyKey,');
    });

    it('forces a dependent kitchen operation into the queue if connectivity returns mid-flow', () => {
        expect(posSource).toContain('forceQueue: Boolean(dependencyKey)');
        expect(apiSource).toContain('offlineManager.getStatus() && !requestConfig.offlineMeta?.forceQueue');
        expect(apiSource).toContain('void offlineManager.processSyncQueue()');
    });
});
