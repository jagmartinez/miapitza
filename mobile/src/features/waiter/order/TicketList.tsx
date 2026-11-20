import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ListRow {
    key: string;
    /** Fixed pixel height: the window is computed from heights, rows are never measured. */
    height: number;
    node: ReactNode;
}

const FALLBACK_VIEWPORT = 480;
const OVERSCAN_PX = 120;

/**
 * Windowed list without a library: only rows intersecting the viewport (plus a small overscan) are mounted.
 * Rows are absolutely placed by cumulative height, so 40+ lines cost the same as 10.
 */
export function TicketList({ rows, scrollToKey, className, testId = 'ticket-list' }: { rows: ListRow[]; scrollToKey?: string | null; className?: string; testId?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);

    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = () => setViewport(el.clientHeight || FALLBACK_VIEWPORT);
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const offsets: number[] = [];
    let total = 0;
    for (const row of rows) {
        offsets.push(total);
        total += row.height;
    }

    // Bring a freshly added line into view.
    useEffect(() => {
        if (!scrollToKey || !ref.current) return;
        const i = rows.findIndex((r) => r.key === scrollToKey);
        if (i < 0) return;
        const el = ref.current;
        const top = offsets[i];
        const bottom = top + rows[i].height;
        const view = el.clientHeight || FALLBACK_VIEWPORT;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (bottom > el.scrollTop + view) el.scrollTop = bottom - view;
        setScrollTop(el.scrollTop);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scrollToKey]);

    const from = scrollTop - OVERSCAN_PX;
    const to = scrollTop + viewport + OVERSCAN_PX;
    const visible: number[] = [];
    rows.forEach((row, i) => {
        if (offsets[i] + row.height >= from && offsets[i] <= to) visible.push(i);
    });

    return (
        <div ref={ref} className={`vlist${className ? ` ${className}` : ''}`} data-testid={testId} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
            <div className="vlist-inner" style={{ height: total }}>
                {visible.map((i) => (
                    <div key={rows[i].key} className="vlist-row" style={{ top: offsets[i], height: rows[i].height }}>
                        {rows[i].node}
                    </div>
                ))}
            </div>
        </div>
    );
}
