import { useCallback, useEffect, useState } from 'react';
import { loadUserPreferences, saveUserPreferences, type UserPreferences } from '../../utils/userPreferences';

export interface PreferencesState {
    prefs: UserPreferences | null;
    loading: boolean;
    failed: boolean;
    reload(): void;
    save(patch: Partial<UserPreferences>): Promise<void>;
}

/** Carga y guarda las preferencias del usuario en el servidor; ambas pestañas comparten esta fuente. */
export function useUserPreferencesState(userId: number | undefined): PreferencesState {
    const [prefs, setPrefs] = useState<UserPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const reload = useCallback(() => {
        if (!userId) return;
        setLoading(true);
        setFailed(false);
        void loadUserPreferences(userId).then((p) => {
            if (p) setPrefs(p);
            else setFailed(true);
            setLoading(false);
        });
    }, [userId]);

    useEffect(() => { reload(); }, [reload]);

    const save = useCallback(async (patch: Partial<UserPreferences>) => {
        if (!userId) throw new Error('Sesión no disponible');
        setPrefs(await saveUserPreferences(userId, patch));
    }, [userId]);

    return { prefs, loading, failed, reload, save };
}
