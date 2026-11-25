import { useCallback, useMemo, useState } from 'react';
import type { ResolvedSetting, SettingDef } from '../../services/settingsScope';

export const NUMBER_ERROR = 'Ingresa un número válido, mayor o igual a 0';

/** Returns an error message, or null when the (text) value is valid for the definition. */
export function validateSettingValue(def: SettingDef, raw: string): string | null {
    const v = raw.trim();
    if (def.type === 'number' || def.type === 'integer') {
        const pattern = def.type === 'integer' ? /^\d+$/ : /^\d+(\.\d+)?$/;
        if (!pattern.test(v)) return NUMBER_ERROR;
        const n = Number(v);
        if (def.min !== undefined && n < def.min) return `El valor mínimo es ${def.min}`;
        if (def.max !== undefined && n > def.max) return `El valor máximo es ${def.max}`;
        return null;
    }
    if (def.type === 'boolean') return v === 'true' || v === 'false' ? null : 'Valor inválido';
    if (def.type === 'enum') return def.options?.some((o) => o.value === v) ? null : 'Selecciona una opción válida';
    if (def.min !== undefined && v.length < def.min) return `Mínimo ${def.min} caracteres`;
    if (def.max !== undefined && v.length > def.max) return `Máximo ${def.max} caracteres`;
    return null;
}

function sameValue(def: SettingDef, a: string, b: string): boolean {
    if (def.type === 'number' || def.type === 'integer') {
        const na = Number(a.trim());
        const nb = Number(b.trim());
        if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    }
    return a === b;
}

export function useSettingsDraft(defs: SettingDef[], resolved: Record<string, ResolvedSetting>) {
    const [edits, setEdits] = useState<Record<string, string>>({});

    const original = useCallback((key: string) => resolved[key]?.value ?? '', [resolved]);

    const set = useCallback((key: string, v: string) => {
        setEdits((prev) => ({ ...prev, [key]: v }));
    }, []);

    const reset = useCallback((key: string) => {
        const companyValue = resolved[key]?.companyValue ?? '';
        setEdits((prev) => ({ ...prev, [key]: companyValue }));
    }, [resolved]);

    const discard = useCallback(() => setEdits({}), []);

    const draft = useMemo(() => {
        const out: Record<string, string> = {};
        for (const def of defs) out[def.key] = edits[def.key] ?? original(def.key);
        return out;
    }, [defs, edits, original]);

    const dirtyKeys = useMemo(
        () => defs.filter((d) => !sameValue(d, draft[d.key], original(d.key))).map((d) => d.key),
        [defs, draft, original]
    );

    const errors = useMemo(() => {
        const out: Record<string, string> = {};
        for (const key of dirtyKeys) {
            const def = defs.find((d) => d.key === key);
            const msg = def ? validateSettingValue(def, draft[key]) : null;
            if (msg) out[key] = msg;
        }
        return out;
    }, [defs, dirtyKeys, draft]);

    const changes = useCallback(() => {
        const out: Record<string, string> = {};
        for (const key of dirtyKeys) out[key] = draft[key];
        return out;
    }, [dirtyKeys, draft]);

    return { draft, set, reset, dirtyKeys, errors, discard, changes };
}
