import { describe, expect, it, vi } from 'vitest';
import { collectAllPages } from './collectAllPages';

describe('collectAllPages', () => {
  it('collects every page reported by server metadata in order', async () => {
    const loadPage = vi.fn(async (page: number) => ({
      items: [`registro-${page}`],
      pagination: { page, totalPages: 3 },
    }));

    await expect(collectAllPages(loadPage)).resolves.toEqual([
      'registro-1',
      'registro-2',
      'registro-3',
    ]);
    expect(loadPage).toHaveBeenCalledTimes(3);
  });

  it('keeps array-only compatible responses as a single complete page', async () => {
    const loadPage = vi.fn(async () => ({ items: [1, 2, 3] }));
    await expect(collectAllPages(loadPage)).resolves.toEqual([1, 2, 3]);
    expect(loadPage).toHaveBeenCalledOnce();
  });
});
