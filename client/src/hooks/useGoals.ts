import { useEffect, useState } from 'react';
import { fetchResolved, type ResolvedPayload } from '../services/settingsScope';

export interface Goals {
    foodCostPct: number;
    foodCostGapPts: number;
    grossMarginPct: number;
    avgTicket: number;
    laborCostMaxPct: number;
    operatingMarginPct: number;
    monthlySales: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<ResolvedPayload> }>();

export function clearGoalsCache(): void {
    cache.clear();
}

function load(branchId: number | null): Promise<ResolvedPayload> {
    const key = String(branchId);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const promise = fetchResolved(branchId);
    cache.set(key, { at: Date.now(), promise });
    promise.catch(() => cache.delete(key));
    return promise;
}

const num = (payload: ResolvedPayload, key: string): number => {
    const n = Number(payload.values[key]?.value);
    return Number.isFinite(n) ? n : 0;
};

export function toGoals(payload: ResolvedPayload): Goals {
    return {
        foodCostPct: num(payload, 'goal.foodCostPct'),
        foodCostGapPts: num(payload, 'goal.foodCostGapPts'),
        grossMarginPct: num(payload, 'goal.grossMarginPct'),
        avgTicket: num(payload, 'goal.avgTicket'),
        laborCostMaxPct: num(payload, 'goal.laborCostMaxPct'),
        operatingMarginPct: num(payload, 'goal.operatingMarginPct'),
        monthlySales: num(payload, 'goal.monthlySales'),
    };
}

const EMPTY: Goals = {
    foodCostPct: 0, foodCostGapPts: 0, grossMarginPct: 0, avgTicket: 0,
    laborCostMaxPct: 0, operatingMarginPct: 0, monthlySales: 0,
};

/** Business goals for a branch (or the company when null), cached for 60 s. */
export function useGoals(branchId: number | null): Goals {
    const [goals, setGoals] = useState<Goals>(EMPTY);

    useEffect(() => {
        let alive = true;
        load(branchId)
            .then((payload) => { if (alive) setGoals(toGoals(payload)); })
            .catch(() => undefined);
        return () => { alive = false; };
    }, [branchId]);

    return goals;
}
