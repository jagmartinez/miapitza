import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, ConfirmDialog, Drawer, Input, LoadErrorState, PageContent, PageHeader, ScopeSelector, SettingsRow, Skeleton, UnsavedChangesBar,
} from '@/ui';
import { Search } from 'lucide-react';
import {
  fetchHistory, fetchRegistry, fetchResolved, saveResolved,
  type ResolvedSetting, type SectionDef, type SettingDef, type SettingHistoryEntry,
} from '../../services/settingsScope';
import { branchesAPI } from '../../services/api';
import { payrollClient } from '../../components/hr/payrollClient';
import type { HrPayrollRuleVersion } from '../../types/hr-payroll';
import { useAppToast } from '../../context/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { useSettingsDraft } from './useSettingsDraft';
import { BackupPanel, LogoField, SalesChannelsPanel } from './SettingsExtras';
import './settings-page.css';

/** Sección solo de lectura: las tasas legales viven en la versión legal de nómina, no en el registro. */
const NOMINA_SECTION = 'nomina-legal';

const GROUP_LABELS: Record<string, string> = {
  organizacion: 'Organización',
  ventas: 'Ventas',
  operacion: 'Operación',
  metas: 'Metas y finanzas',
  rrhh: 'Recursos humanos',
  seguridad: 'Seguridad',
};

const ADMIN_LINKS = [
  { to: '/branches', label: 'Sucursales y bodegas' },
  { to: '/roles-permissions', label: 'Roles y permisos' },
  { to: '/rh/asistencia/configuracion', label: 'Dispositivos' },
  { to: '/integraciones/pedidosya', label: 'Integraciones' },
];

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtDate = (iso: string) => new Date(iso).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' });

export default function SettingsPage() {
  const toast = useAppToast();
  const [sections, setSections] = useState<SectionDef[]>([]);
  const [defs, setDefs] = useState<SettingDef[]>([]);
  const [branches, setBranches] = useState<{ id: number; name: string }[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [pendingBranch, setPendingBranch] = useState<{ id: number | null } | null>(null);
  const [resolved, setResolved] = useState<Record<string, ResolvedSetting>>({});
  const [version, setVersion] = useState('');
  const [activeSection, setActiveSection] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SettingHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [payrollRule, setPayrollRule] = useState<HrPayrollRuleVersion | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { draft, set, reset, dirtyKeys, errors, discard, changes } = useSettingsDraft(defs, resolved);

  const loadHistory = useCallback(async () => {
    try { setHistory(await fetchHistory(undefined, 50)); } catch { setHistory([]); }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [registry, branchRes] = await Promise.all([fetchRegistry(), branchesAPI.getAll({ status: 'ACTIVE' })]);
        if (!alive) return;
        setSections(registry.sections);
        setDefs(registry.definitions);
        setActiveSection(registry.sections[0]?.id ?? '');
        const list = (branchRes.data?.data ?? []) as { id: number; name: string }[];
        setBranches(list.map((b) => ({ id: b.id, name: b.name })));
      } catch (err) {
        if (alive) setLoadError(getApiErrorMessage(err, 'No fue posible cargar la configuración'));
      }
    })();
    void loadHistory();
    payrollClient.getRules({ limit: 100 })
      .then((r) => { if (alive) setPayrollRule(r.items.find((x) => x.status === 'ACTIVE') ?? null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [loadHistory, reloadKey]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchResolved(branchId)
      .then((r) => { if (alive) { setResolved(r.values); setVersion(r.version); setLoadError(null); } })
      .catch((err) => { if (alive) setLoadError(getApiErrorMessage(err, 'No fue posible recuperar la configuración vigente (el guardado queda bloqueado para proteger los valores existentes)')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [branchId, reloadKey]);

  const scope = useMemo(() => {
    if (branchId == null) return 'company' as const;
    return { branchName: branches.find((b) => b.id === branchId)?.name ?? 'sucursal' };
  }, [branchId, branches]);

  const dirtySections = useMemo(() => {
    const keys = new Set(dirtyKeys);
    return new Set(defs.filter((d) => keys.has(d.key)).map((d) => d.section));
  }, [defs, dirtyKeys]);

  const searching = query.trim().length > 0;
  const visibleSections = useMemo(() => {
    if (!searching) return sections.filter((s) => s.id === activeSection);
    const q = normalize(query.trim());
    return sections.filter((s) => defs.some((d) => d.section === s.id && normalize(`${d.label} ${d.description}`).includes(q)));
  }, [sections, defs, activeSection, query, searching]);

  const defsFor = (sectionId: string) => {
    const inSection = defs.filter((d) => d.section === sectionId);
    if (!searching) return inSection;
    const q = normalize(query.trim());
    return inSection.filter((d) => normalize(`${d.label} ${d.description}`).includes(q));
  };

  const groups = useMemo(() => {
    const out: { group: string; items: SectionDef[] }[] = [];
    for (const s of sections) {
      let g = out.find((x) => x.group === s.group);
      if (!g) { g = { group: s.group, items: [] }; out.push(g); }
      g.items.push(s);
    }
    return out;
  }, [sections]);

  const onScopeChange = (id: number | null) => {
    if (id === branchId) return;
    if (dirtyKeys.length > 0) setPendingBranch({ id });
    else setBranchId(id);
  };

  const onSave = async () => {
    if (loadError) {
      toast.error('Recarga la configuración vigente antes de guardar cambios.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveResolved(branchId, version, changes());
      setResolved(result.values);
      setVersion(result.version);
      discard();
      toast.success('Configuración guardada');
      void loadHistory();
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { message?: string; errors?: Record<string, string> } } };
      if (e.response?.status === 409) toast.error('Otro usuario guardó cambios; recarga para continuar');
      else if (e.response?.status === 400) toast.error(e.response.data?.message ?? 'Hay valores inválidos en la configuración');
      else toast.error(getApiErrorMessage(err, 'No fue posible guardar la configuración'));
    } finally {
      setSaving(false);
    }
  };

  const lastChange = history[0];
  const nameOf = (key: string) => defs.find((d) => d.key === key)?.label ?? key;

  return (
    <PageContent>
      <PageHeader
        title="Configuración"
        description="Parámetros de la empresa y de cada sucursal."
        actions={<ScopeSelector branches={branches} value={branchId} onChange={onScopeChange} />}
      />

      <div className="settings-page">
        <aside className="settings-page__nav" aria-label="Secciones de configuración">
          <div className="settings-page__search">
            <Search size={16} aria-hidden="true" />
            <Input
              aria-label="Buscar configuración"
              placeholder="Buscar parámetro"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {groups.map((g) => (
            <div key={g.group} className="settings-page__group">
              <p className="settings-page__group-title">{GROUP_LABELS[g.group] ?? g.group}</p>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-page__navitem ${!searching && s.id === activeSection ? 'is-active' : ''}`}
                  aria-current={!searching && s.id === activeSection ? 'page' : undefined}
                  onClick={() => { setQuery(''); setActiveSection(s.id); }}
                >
                  <span>{s.title}</span>
                  {dirtySections.has(s.id) ? <span className="settings-page__dot" role="img" aria-label="Con cambios sin guardar" /> : null}
                </button>
              ))}
            </div>
          ))}
          <div className="settings-page__group">
            <p className="settings-page__group-title">{GROUP_LABELS.rrhh}</p>
            <button
              type="button"
              className={`settings-page__navitem ${!searching && activeSection === NOMINA_SECTION ? 'is-active' : ''}`}
              aria-current={!searching && activeSection === NOMINA_SECTION ? 'page' : undefined}
              onClick={() => { setQuery(''); setActiveSection(NOMINA_SECTION); }}
            >
              <span>Nómina (solo lectura)</span>
            </button>
          </div>
          <div className="settings-page__group">
            <p className="settings-page__group-title">Administración</p>
            {ADMIN_LINKS.map((l) => (
              <Link key={l.to} className="settings-page__navitem settings-page__navlink" to={l.to}>{l.label}</Link>
            ))}
          </div>
        </aside>

        <div className="settings-page__main">
          {loadError ? <LoadErrorState message={loadError} onRetry={() => { setLoadError(null); setReloadKey((k) => k + 1); }} /> : null}
          {loading && defs.length === 0 ? <Skeleton /> : null}
          {searching && visibleSections.length === 0 ? <p className="settings-page__empty">Sin resultados para "{query}".</p> : null}

          {visibleSections.map((s) => (
            <section key={s.id} className="settings-page__section" aria-labelledby={`sec-${s.id}`}>
              <h2 id={`sec-${s.id}`} className="settings-page__section-title">{s.title}</h2>
              <p className="settings-page__section-desc">{s.description}</p>
              {s.note ? <p className="settings-page__note">{s.note}</p> : null}
              {defsFor(s.id).map((d) => {
                const r = resolved[d.key];
                if (d.key === 'logoUrl') {
                  return <LogoField key={d.key} value={draft[d.key] ?? ''} dirty={dirtyKeys.includes(d.key)} onChange={(v) => set(d.key, v)} />;
                }
                return (
                  <SettingsRow
                    key={d.key}
                    def={d}
                    value={draft[d.key] ?? ''}
                    source={r?.source ?? 'default'}
                    companyValue={r?.companyValue ?? ''}
                    scope={scope}
                    error={errors[d.key]}
                    dirty={dirtyKeys.includes(d.key)}
                    onChange={(v) => set(d.key, v)}
                    onReset={() => reset(d.key)}
                  />
                );
              })}
              {!searching && s.id === 'canales' && branchId == null ? <SalesChannelsPanel /> : null}
              {!searching && s.id === 'seguridad' ? <BackupPanel /> : null}
            </section>
          ))}

          {!searching && activeSection === NOMINA_SECTION ? (
            <section className="settings-page__section">
              <h2 className="settings-page__section-title">Nómina</h2>
              <p className="settings-page__note">
                {payrollRule
                  ? `Parámetros legales de nómina (INSS, INATEC, divisor de hora extra) desde la versión activa: ${payrollRule.name} v${payrollRule.version}.`
                  : 'No hay una versión legal de nómina activa.'}{' '}
                Son de solo lectura aquí. <Link to="/rh/nomina">Ver control legal de nómina</Link>
              </p>
              {payrollRule?.configurationSummary ? <p className="settings-page__section-desc">{payrollRule.configurationSummary}</p> : null}
            </section>
          ) : null}

          <footer className="settings-page__footer">
            <span>
              {lastChange
                ? `Última modificación: ${lastChange.userName} · ${fmtDate(lastChange.createdAt)}`
                : 'Sin modificaciones registradas'}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>Ver historial</Button>
          </footer>
        </div>
      </div>

      {dirtyKeys.length > 0 ? (
        <UnsavedChangesBar
          count={dirtyKeys.length}
          hasErrors={Object.keys(errors).length > 0}
          saving={saving}
          onDiscard={discard}
          onSave={() => void onSave()}
        />
      ) : null}

      <Drawer isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="Historial de cambios">
        {history.length === 0 ? <p className="settings-page__empty">Aún no hay cambios registrados.</p> : (
          <ul className="settings-page__history">
            {history.map((h, i) => (
              <li key={`${h.createdAt}-${h.name}-${i}`}>
                <strong>{nameOf(h.name)}</strong>
                <span>{h.oldValue ?? '—'} → {h.newValue ?? '—'}</span>
                <small>{h.userName} · {fmtDate(h.createdAt)}{h.branchId != null ? ` · ${branches.find((b) => b.id === h.branchId)?.name ?? 'Sucursal'}` : ''}</small>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={pendingBranch !== null}
        title="Descartar cambios"
        message="Tienes cambios sin guardar. Si cambias de alcance se perderán."
        confirmLabel="Descartar y cambiar"
        tone="danger"
        onCancel={() => setPendingBranch(null)}
        onConfirm={() => { discard(); setBranchId(pendingBranch?.id ?? null); setPendingBranch(null); }}
      />
    </PageContent>
  );
}
