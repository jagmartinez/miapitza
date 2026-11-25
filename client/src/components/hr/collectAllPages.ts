interface PageMetadata {
  page: number;
  totalPages: number;
}

interface PageResult<T> {
  items: T[];
  pagination?: PageMetadata;
}

/**
 * Loads every server page before applying client-side table pagination.
 * This keeps tab counts, searches and page totals authoritative even when an
 * endpoint caps individual requests at 100 records.
 */
export async function collectAllPages<T>(
  loadPage: (page: number) => Promise<PageResult<T>>
): Promise<T[]> {
  const first = await loadPage(1);
  const totalPages = Math.max(1, first.pagination?.totalPages ?? 1);
  if (totalPages === 1) return first.items;

  const items = [...first.items];
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await loadPage(page);
    items.push(...result.items);
  }
  return items;
}
