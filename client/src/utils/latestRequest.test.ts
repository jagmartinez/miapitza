import { describe, expect, it } from 'vitest';
import { createLatestRequestGuard } from './latestRequest';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

describe('createLatestRequestGuard', () => {
    it('rejects an older response that settles after the newest scope', async () => {
        const guard = createLatestRequestGuard();
        const first = deferred<string>();
        const second = deferred<string>();
        const applied: string[] = [];

        const run = async (request: Promise<string>) => {
            const requestId = guard.begin();
            const result = await request;
            if (guard.isCurrent(requestId)) applied.push(result);
        };

        const firstRun = run(first.promise);
        const secondRun = run(second.promise);
        second.resolve('company-2');
        await secondRun;
        first.resolve('company-1');
        await firstRun;

        expect(applied).toEqual(['company-2']);
    });
});
