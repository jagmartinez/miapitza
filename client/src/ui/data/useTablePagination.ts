import { useState } from 'react';

export function useTablePagination(
  total: number,
  opts: { defaultPageSize?: number; resetKey?: unknown } = {},
) {
  const [pageSize, setPageSizeState] = useState(opts.defaultPageSize ?? 25);
  const [page, setPageState] = useState(1);
  const [lastKey, setLastKey] = useState(opts.resetKey);

  // Un filtro nuevo siempre vuelve a la primera página.
  let current = page;
  if (!Object.is(lastKey, opts.resetKey)) {
    setLastKey(opts.resetKey);
    setPageState(1);
    current = 1;
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, current), pages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize;
  const end = Math.min(total, start + pageSize);

  return {
    page: safePage,
    pageSize,
    setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pages)),
    setPageSize: (s: number) => {
      setPageSizeState(s);
      setPageState(1);
    },
    range: [start, end] as [number, number],
  };
}
