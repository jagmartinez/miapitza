import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BiCompare, BiParams, BiPeriod } from '../../services/bi';

const PERIODS: BiPeriod[] = ['today', '7d', '30d', '12m', 'custom'];
const COMPARES: BiCompare[] = ['previous', 'year'];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface BiFilters extends BiParams {
    /** Los filtros ya son válidos para pedir datos (un rango personalizado necesita `from`). */
    ready: boolean;
    set(partial: Partial<BiParams>): void;
}

function parseBranches(raw: string | null): number[] {
    if (!raw) return [];
    const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * Filtros globales sincronizados con la URL (`?period=30d&compare=previous&branches=1,2`)
 * para que una vista se pueda compartir. Valores inválidos vuelven al default.
 */
export function useBiFilters(): BiFilters {
    const [search, setSearch] = useSearchParams();
    const rawPeriod = search.get('period');
    const rawCompare = search.get('compare');
    const rawBranches = search.get('branches');
    const rawFrom = search.get('from');
    const rawTo = search.get('to');

    const period: BiPeriod = PERIODS.includes(rawPeriod as BiPeriod) ? (rawPeriod as BiPeriod) : '30d';
    const compare: BiCompare = COMPARES.includes(rawCompare as BiCompare) ? (rawCompare as BiCompare) : 'previous';
    const from = rawFrom && DATE_ONLY.test(rawFrom) ? rawFrom : undefined;
    const to = rawTo && DATE_ONLY.test(rawTo) ? rawTo : undefined;

    const branchIds = useMemo(() => parseBranches(rawBranches), [rawBranches]);

    const set = useCallback((partial: Partial<BiParams>) => {
        setSearch((prev) => {
            const next = new URLSearchParams(prev);
            if (partial.period !== undefined) {
                next.set('period', partial.period);
                if (partial.period !== 'custom') { next.delete('from'); next.delete('to'); }
            }
            if (partial.compare !== undefined) next.set('compare', partial.compare);
            if (partial.branchIds !== undefined) {
                if (partial.branchIds.length > 0) next.set('branches', partial.branchIds.join(','));
                else next.delete('branches');
            }
            if (partial.from !== undefined) { if (partial.from) next.set('from', partial.from); else next.delete('from'); }
            if (partial.to !== undefined) { if (partial.to) next.set('to', partial.to); else next.delete('to'); }
            return next;
        }, { replace: true });
    }, [setSearch]);

    return {
        period,
        compare,
        branchIds,
        ...(period === 'custom' ? { from, to: to ?? from } : {}),
        ready: period !== 'custom' || Boolean(from),
        set,
    };
}

export interface SavedView { id: string; name: string; query: string }
const STORAGE_KEY = 'bi.views';

export function loadSavedViews(): SavedView[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((v): v is SavedView => !!v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.query === 'string')
            : [];
    } catch {
        return [];
    }
}

/** Guarda (o reemplaza por nombre) la vista actual; devuelve la lista resultante. */
export function saveView(name: string, query: string): SavedView[] {
    const current = loadSavedViews().filter((v) => v.name !== name && v.query !== query);
    const next = [...current, { id: `${Date.now()}`, name, query }].slice(-12);
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* sin almacenamiento disponible: la vista sigue siendo compartible por URL */
    }
    return next;
}
