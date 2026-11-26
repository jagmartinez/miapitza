import { useState } from 'react';
import { Bell, Save, SlidersHorizontal } from 'lucide-react';
import {
    AppSelect, Button, Checkbox, Field, FormGrid, LoadErrorState, SegmentedControl, Skeleton,
} from '@/ui';
import type { NotificationMatrix, UserPreferences } from '../../utils/userPreferences';
import type { PreferencesState } from './usePreferencesState';
import type { Language } from '../../utils/translations';
import { axiosErr, HOME_PAGE_OPTIONS, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from './profileHelpers';

function SaveFeedback({ message }: { message: { type: 'success' | 'error'; text: string } | null }) {
    return message ? (
        <div className={`profile-msg ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'} aria-live="polite">{message.text}</div>
    ) : null;
}

function PrefsGate({ state, children }: { state: PreferencesState; children: (prefs: UserPreferences) => React.ReactNode }) {
    if (state.loading && !state.prefs) return <Skeleton height={120} />;
    if (state.failed || !state.prefs) {
        return <LoadErrorState message="No pudimos cargar tus preferencias. No se muestran valores por defecto para no sobrescribirlas." onRetry={state.reload} />;
    }
    return <>{children(state.prefs)}</>;
}

// ── Preferencias ──
function PreferencesForm({ prefs, state, language, setLanguage, theme, toggleTheme, branches }: {
    prefs: UserPreferences;
    state: PreferencesState;
    language: Language;
    setLanguage(l: Language): void;
    theme: 'light' | 'dark';
    toggleTheme(): void;
    branches: { id: number; name: string }[];
}) {
    const [density, setDensity] = useState(prefs.density);
    const [rows, setRows] = useState(String(prefs.rowsPerPage));
    const [home, setHome] = useState<string>(prefs.homePage ?? '/dashboard');
    const [branchId, setBranchId] = useState<number | null>(prefs.defaultBranchId);
    const [numberFormat, setNumberFormat] = useState(prefs.numberFormat);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const dirty =
        density !== prefs.density || Number(rows) !== prefs.rowsPerPage || home !== (prefs.homePage ?? '/dashboard') ||
        branchId !== prefs.defaultBranchId || numberFormat !== prefs.numberFormat;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            await state.save({
                density,
                rowsPerPage: Number(rows) as UserPreferences['rowsPerPage'],
                homePage: home === '/dashboard' ? null : home,
                defaultBranchId: branchId,
                numberFormat,
            });
            setMessage({ type: 'success', text: 'Preferencias guardadas' });
        } catch (err: unknown) {
            setMessage({ type: 'error', text: axiosErr(err, 'No se pudieron guardar las preferencias') });
        } finally { setSaving(false); }
    };

    return (
        <form className="profile-form profile-form--wide" onSubmit={submit} aria-label="Preferencias">
            <FormGrid>
                <Field label="Idioma" htmlFor="pref-language" hint="Idioma de la interfaz; se aplica al instante.">
                    <AppSelect<Language>
                        inputId="pref-language"
                        isClearable={false}
                        options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]}
                        value={language}
                        onChange={(l) => { if (l) setLanguage(l); }}
                    />
                </Field>
                <Field label="Tema" htmlFor="pref-theme" hint="Se aplica al instante en este dispositivo.">
                    <SegmentedControl<'light' | 'dark'>
                        ariaLabel="Tema"
                        options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]}
                        value={theme}
                        onChange={(v) => { if (v !== theme) toggleTheme(); }}
                    />
                </Field>
                <Field label="Densidad de las tablas" htmlFor="pref-density">
                    <SegmentedControl<'comfortable' | 'compact'>
                        ariaLabel="Densidad de las tablas"
                        options={[{ value: 'comfortable', label: 'Cómoda' }, { value: 'compact', label: 'Compacta' }]}
                        value={density}
                        onChange={setDensity}
                    />
                </Field>
                <Field label="Filas por página" htmlFor="pref-rows" hint="Tamaño inicial de todas las tablas.">
                    <SegmentedControl<string>
                        ariaLabel="Filas por página (preferencia)"
                        options={['10', '25', '50', '100'].map((n) => ({ value: n, label: n }))}
                        value={rows}
                        onChange={setRows}
                    />
                </Field>
                <Field label="Página de inicio" htmlFor="pref-home" hint="Dónde cae la raíz del sitio al entrar.">
                    <AppSelect<string>
                        inputId="pref-home"
                        isClearable={false}
                        options={HOME_PAGE_OPTIONS}
                        value={home}
                        onChange={(v) => setHome(v ?? '/dashboard')}
                    />
                </Field>
                <Field label="Sucursal predeterminada" htmlFor="pref-branch" hint="Filtro inicial de Reportería.">
                    <AppSelect<number | ''>
                        inputId="pref-branch"
                        isClearable={false}
                        options={[{ value: '', label: 'Sin predeterminada' }, ...branches.map((b) => ({ value: b.id as number | '', label: b.name }))]}
                        value={branchId ?? ''}
                        onChange={(v) => setBranchId(v === '' || v == null ? null : v)}
                    />
                </Field>
                <Field label="Formato de números" htmlFor="pref-number">
                    <SegmentedControl<'es-NI' | 'en-US'>
                        ariaLabel="Formato de números"
                        options={[{ value: 'es-NI', label: '1.234,50' }, { value: 'en-US', label: '1,234.50' }]}
                        value={numberFormat}
                        onChange={setNumberFormat}
                    />
                </Field>
            </FormGrid>
            <div className="profile-form__footer">
                <Button type="submit" variant="primary" icon={Save} disabled={!dirty} loading={saving}>
                    {saving ? 'Guardando...' : 'Guardar preferencias'}
                </Button>
            </div>
            <SaveFeedback message={message} />
        </form>
    );
}

export function PreferencesTab(props: {
    state: PreferencesState;
    language: Language;
    setLanguage(l: Language): void;
    theme: 'light' | 'dark';
    toggleTheme(): void;
    branches: { id: number; name: string }[];
}) {
    const { state, ...rest } = props;
    return (
        <section className="profile-section" aria-labelledby="profile-sec-prefs">
            <h2 id="profile-sec-prefs" className="profile-section__title">
                <SlidersHorizontal size={18} aria-hidden="true" /> Preferencias
            </h2>
            <PrefsGate state={state}>
                {(prefs) => <PreferencesForm key={JSON.stringify(prefs)} prefs={prefs} state={state} {...rest} />}
            </PrefsGate>
        </section>
    );
}

// ── Notificaciones ──
function NotificationsForm({ prefs, state }: { prefs: UserPreferences; state: PreferencesState }) {
    const [matrix, setMatrix] = useState<NotificationMatrix>(prefs.notifications ?? {});
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Sin elección guardada la app avisa en pantalla y el correo queda apagado.
    const isOn = (event: string, channel: string) => matrix[event]?.[channel] ?? channel === 'app';
    const toggle = (event: string, channel: string, on: boolean) => {
        setMessage(null);
        setMatrix((m) => ({ ...m, [event]: { ...m[event], [channel]: on } }));
    };
    const dirty = NOTIFICATION_EVENTS.some((ev) =>
        NOTIFICATION_CHANNELS.some((ch) => isOn(ev.id, ch.id) !== (prefs.notifications?.[ev.id]?.[ch.id] ?? ch.id === 'app')));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);
        try {
            const full: NotificationMatrix = {};
            for (const ev of NOTIFICATION_EVENTS) {
                full[ev.id] = {};
                for (const ch of NOTIFICATION_CHANNELS) full[ev.id][ch.id] = isOn(ev.id, ch.id);
            }
            await state.save({ notifications: full });
            setMessage({ type: 'success', text: 'Notificaciones guardadas' });
        } catch (err: unknown) {
            setMessage({ type: 'error', text: axiosErr(err, 'No se pudieron guardar las notificaciones') });
        } finally { setSaving(false); }
    };

    return (
        <form className="profile-form profile-form--wide" onSubmit={submit} aria-label="Notificaciones">
            <div className="profile-matrix" role="group" aria-label="Eventos por canal">
                <div className="profile-matrix__head" aria-hidden="true">
                    <span>Evento</span>
                    {NOTIFICATION_CHANNELS.map((ch) => <span key={ch.id}>{ch.label}</span>)}
                </div>
                {NOTIFICATION_EVENTS.map((ev) => (
                    <div key={ev.id} className="profile-matrix__row">
                        <span className="profile-matrix__event">
                            <strong>{ev.label}</strong>
                            <small>{ev.hint}</small>
                        </span>
                        {NOTIFICATION_CHANNELS.map((ch) => (
                            <span key={ch.id} className="profile-matrix__cell">
                                <Checkbox
                                    label={<span className="sr-only">{`${ev.label} ${ch.label}`}</span>}
                                    checked={isOn(ev.id, ch.id)}
                                    onChange={(e) => toggle(ev.id, ch.id, e.target.checked)}
                                />
                            </span>
                        ))}
                    </div>
                ))}
            </div>
            <p className="profile-note">Tus elecciones se guardan en tu cuenta.</p>
            <div className="profile-form__footer">
                <Button type="submit" variant="primary" icon={Save} disabled={!dirty} loading={saving}>
                    {saving ? 'Guardando...' : 'Guardar notificaciones'}
                </Button>
            </div>
            <SaveFeedback message={message} />
        </form>
    );
}

export function NotificationsTab({ state }: { state: PreferencesState }) {
    return (
        <section className="profile-section" aria-labelledby="profile-sec-notif">
            <h2 id="profile-sec-notif" className="profile-section__title"><Bell size={18} aria-hidden="true" /> Notificaciones</h2>
            <PrefsGate state={state}>
                {(prefs) => <NotificationsForm key={JSON.stringify(prefs.notifications)} prefs={prefs} state={state} />}
            </PrefsGate>
        </section>
    );
}
