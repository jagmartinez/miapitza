import { useState, useEffect, useCallback } from 'react';
import { unitsAPI } from '../services/api';
import type { ProductAllowedUnit } from '../types';

export function useProductUnits(productId: number | null) {
    const [units, setUnits] = useState<ProductAllowedUnit[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        if (!productId) {
            setUnits([]);
            return;
        }
        setLoading(true);
        try {
            const res = await unitsAPI.getProductUnits(productId);
            setUnits(res.data.data || []);
        } catch {
            setUnits([]);
        } finally {
            setLoading(false);
        }
    }, [productId]);

    useEffect(() => { load(); }, [load]);

    const defaultUnit = units.find(u => u.isDefault) || units.find(u => u.isBase) || units[0];

    return { units, loading, defaultUnit, reload: load };
}
