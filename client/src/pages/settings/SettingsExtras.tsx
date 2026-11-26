import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Database, Truck, Upload } from 'lucide-react';
import { Button, NumberInput, Switch } from '@/ui';
import { backupAPI, salesChannelsAPI, uploadAPI } from '../../services/api';
import { useAppToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { hasAnyRole } from '../../utils/authz';
import { getApiErrorMessage } from '../../utils/apiError';
import { resolveAssetUrl } from '../../utils/assets';

interface SalesChannelConfig {
  id?: number;
  channel: string;
  priceMarkupPct: number;
  commissionPct: number;
  isActive: boolean;
}

/** Logo de la empresa: se sube al elegirlo y su URL queda como cambio pendiente de `logoUrl`. */
export function LogoField({ value, dirty, onChange }: { value: string; dirty: boolean; onChange: (url: string) => void }) {
  const toast = useAppToast();
  const [uploading, setUploading] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('logo', file);
      const res = await uploadAPI.uploadLogo(body);
      onChange(res.data.data.url);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al subir el logo'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="settings-extra settings-extra--row">
      <div className="settings-extra__text">
        <strong>Logo{dirty ? ' (sin guardar)' : ''}</strong>
        <span>Imagen impresa en el encabezado del ticket. PNG, JPG, GIF o WEBP.</span>
      </div>
      <div className="settings-extra__logo">
        {value ? <img src={resolveAssetUrl(value)} alt="Logo de la empresa" /> : <span className="settings-page__empty">Sin logo</span>}
        <label className="ui-button ui-button--secondary ui-button--md settings-extra__upload">
          <Upload size={16} aria-hidden="true" />
          {uploading ? 'Subiendo…' : value ? 'Cambiar logo' : 'Subir logo'}
          <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" onChange={(e) => void onFile(e)} disabled={uploading} hidden />
        </label>
      </div>
    </div>
  );
}

/** Comisión y recargo de precio por canal de venta (tabla sales channels). */
export function SalesChannelsPanel() {
  const toast = useAppToast();
  const [channels, setChannels] = useState<SalesChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingChannel, setSavingChannel] = useState<string | null>(null);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await salesChannelsAPI.getAll();
      setChannels(res.data.data || []);
    } catch (err) {
      toastRef.current.error(getApiErrorMessage(err, 'No se pudieron cargar los canales de venta'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ensureDefaults = async () => {
    try {
      await salesChannelsAPI.ensureDefaults();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al crear canales por defecto'));
    }
  };

  const update = (index: number, patch: Partial<SalesChannelConfig>) =>
    setChannels((prev) => prev.map((ch, i) => (i === index ? { ...ch, ...patch } : ch)));

  const save = async (channel: SalesChannelConfig) => {
    setSavingChannel(channel.channel);
    try {
      await salesChannelsAPI.upsert({
        channel: channel.channel,
        priceMarkupPct: channel.priceMarkupPct,
        commissionPct: channel.commissionPct,
        isActive: channel.isActive,
      });
      toast.success('Canal guardado');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al guardar configuración del canal'));
    } finally {
      setSavingChannel(null);
    }
  };

  return (
    <div className="settings-extra">
      <div className="settings-extra__text">
        <strong>Comisión y recargo por canal</strong>
        <span>Recargo de precio y comisión de cada canal (PedidosYa, delivery propio, etc.).</span>
      </div>
      {loading ? <p className="settings-page__empty">Cargando canales…</p> : channels.length === 0 ? (
        <div className="settings-extra__actions">
          <p className="settings-page__empty">No hay canales configurados. Crea los canales predeterminados para comenzar.</p>
          <Button variant="primary" icon={Truck} onClick={() => void ensureDefaults()}>Crear canales por defecto</Button>
        </div>
      ) : (
        <ul className="settings-extra__channels">
          {channels.map((ch, idx) => (
            <li key={ch.channel} className={ch.isActive ? '' : 'is-inactive'}>
              <div className="settings-extra__channel-head">
                <strong>{ch.channel.replace('_', ' ')}</strong>
                <Switch label="Activo" checked={ch.isActive} onChange={(v) => update(idx, { isActive: v })} />
              </div>
              <div className="settings-extra__channel-fields">
                <label>
                  <span>Recargo de precio</span>
                  <NumberInput aria-label={`Recargo de precio ${ch.channel}`} value={ch.priceMarkupPct} min={0} suffix="%" onChange={(v) => update(idx, { priceMarkupPct: Math.min(v ?? 0, 100) })} />
                </label>
                <label>
                  <span>Comisión del canal</span>
                  <NumberInput aria-label={`Comisión ${ch.channel}`} value={ch.commissionPct} min={0} suffix="%" onChange={(v) => update(idx, { commissionPct: Math.min(v ?? 0, 100) })} />
                </label>
              </div>
              <Button loading={savingChannel === ch.channel} onClick={() => void save(ch)}>Guardar canal</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Respaldo manual de la base de datos: solo SUPERADMIN. */
export function BackupPanel() {
  const { user } = useAuth();
  const toast = useAppToast();
  const [creating, setCreating] = useState(false);
  if (!hasAnyRole(user, ['SUPERADMIN'])) return null;

  const create = async () => {
    setCreating(true);
    try {
      const res = await backupAPI.create();
      toast.success(`Respaldo creado exitosamente: ${res.data.data.filename}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Error al crear el respaldo'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="settings-extra settings-extra--row">
      <div className="settings-extra__text">
        <strong>Respaldo de base de datos</strong>
        <span>Genera un respaldo de la base de datos para mantener tus datos seguros.</span>
      </div>
      <Button variant="primary" icon={Database} loading={creating} onClick={() => void create()}>Crear respaldo</Button>
    </div>
  );
}
