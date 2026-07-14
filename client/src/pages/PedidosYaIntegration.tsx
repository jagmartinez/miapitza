import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, pedidosYaAPI, menuAPI } from '../services/api';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { useCurrency } from '../hooks/useCurrency';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Input from '../components/Input';
import Select from '../components/Select';
import type { SingleValue } from 'react-select';
import {
    Settings, Zap, Link2, RefreshCw, CheckCircle, XCircle,
    Package, AlertTriangle, Clock, ArrowRightLeft, Search, Plus, Trash2
} from 'lucide-react';
import './PedidosYaIntegration.css';

interface PYConfig {
    id?: number;
    clientId?: string;
    clientSecret?: string;
    clientSecretSet?: boolean;
    restaurantId?: string;
    webhookSecret?: string;
    webhookSecretSet?: boolean;
    environment: string;
    autoAcceptOrders: boolean;
    autoSyncStatus: boolean;
    defaultWarehouseId?: number;
    branchId?: number;
    active: boolean;
    lastSyncAt?: string;
}

interface ProductMapping {
    id: number;
    externalId: string;
    externalName: string;
    menuItemId: number | null;
    isActive: boolean;
    menuItem?: { id: number; name: string; price: number; active: boolean } | null;
}

interface WebhookLog {
    id: number;
    eventType: string;
    externalId: string | null;
    status: string;
    errorMessage: string | null;
    createdAt: string;
}

interface OrderSync {
    id: number;
    externalId: string;
    externalStatus: string | null;
    internalStatus: string | null;
    syncDirection: string;
    lastSyncAt: string;
    order: { id: number; status: string; total: number; customerName: string | null; createdAt: string };
}

interface MenuItemOption { id: number; name: string; price: number }

type ActiveTab = 'config' | 'mappings' | 'orders' | 'logs';

export default function PedidosYaIntegration() {
    const { formatMoney } = useCurrency();
    const { user } = useAuth();
    const isSuperAdmin = hasAnyRole(user, ['SUPERADMIN']);
    const { confirm } = useConfirmDialog();
    const { success, error: showError } = useAppToast();
    const [activeTab, setActiveTab] = useState<ActiveTab>('config');
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<PYConfig>({
        environment: 'sandbox', autoAcceptOrders: false, autoSyncStatus: true, active: false,
    });
    const [mappings, setMappings] = useState<ProductMapping[]>([]);
    const [orderSyncs, setOrderSyncs] = useState<OrderSync[]>([]);
    const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);
    const [connectionStatus, setConnectionStatus] = useState<{ tested: boolean; success?: boolean; message?: string }>({ tested: false });
    const [saving, setSaving] = useState(false);

    // Mapping sidebar
    const [mappingSidebarOpen, setMappingSidebarOpen] = useState(false);
    const [mappingForm, setMappingForm] = useState({ externalId: '', externalName: '', menuItemId: '' });
    const [mappingSearch, setMappingSearch] = useState('');

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [configRes, menuRes] = await Promise.all([
                pedidosYaAPI.getConfig(),
                menuAPI.getAll(),
            ]);
            if (configRes.data.data) {
                setConfig({ ...configRes.data.data, clientSecret: '', webhookSecret: '' });
            }
            setMenuItems((menuRes.data.data || []).map((mi: { id: number; name: string; price: number }) => ({
                id: mi.id, name: mi.name, price: mi.price,
            })));
        } catch {
            showError('No se pudo cargar la configuración de PedidosYa.');
        }
        setLoading(false);
    }, [showError]);

    const loadMappings = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getMappings();
            setMappings(res.data.data || []);
        } catch { showError('No se pudieron cargar los mapeos.'); }
    }, [showError]);

    const loadOrderSyncs = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getOrderSyncs();
            setOrderSyncs(res.data.data || []);
        } catch { showError('No se pudieron cargar las órdenes sincronizadas.'); }
    }, [showError]);

    const loadWebhookLogs = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getWebhookLogs();
            setWebhookLogs(res.data.data || []);
        } catch { showError('No se pudieron cargar los logs del webhook.'); }
    }, [showError]);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    useEffect(() => {
        if (!isSuperAdmin) return;
        if (activeTab === 'mappings') void loadMappings();
        if (activeTab === 'orders') void loadOrderSyncs();
        if (activeTab === 'logs') void loadWebhookLogs();
    }, [activeTab, isSuperAdmin, loadMappings, loadOrderSyncs, loadWebhookLogs]);

    const handleSaveConfig = async () => {
        setSaving(true);
        try {
            const payload = { ...config } as Record<string, unknown>;
            delete payload.clientSecretSet;
            delete payload.webhookSecretSet;
            if (!config.clientSecret?.trim()) delete payload.clientSecret;
            if (!config.webhookSecret?.trim()) delete payload.webhookSecret;
            await pedidosYaAPI.upsertConfig(payload);
            success('Configuración guardada');
        } catch {
            showError('Error al guardar');
        }
        setSaving(false);
    };

    const handleTestConnection = async () => {
        setConnectionStatus({ tested: false });
        try {
            const res = await pedidosYaAPI.testConnection();
            setConnectionStatus({ tested: true, ...res.data.data });
        } catch {
            setConnectionStatus({ tested: true, success: false, message: 'Error de conexión' });
        }
    };

    const handleSyncMenu = async () => {
        try {
            const res = await pedidosYaAPI.syncMenu();
            success(`Menú sincronizado: ${res.data.data.synced} items`);
            loadAll();
        } catch {
            showError('Error al sincronizar menú');
        }
    };

    const handleSaveMapping = async () => {
        try {
            await pedidosYaAPI.upsertMapping({
                externalId: mappingForm.externalId,
                externalName: mappingForm.externalName,
                menuItemId: mappingForm.menuItemId ? Number(mappingForm.menuItemId) : null,
            });
            setMappingSidebarOpen(false);
            setMappingForm({ externalId: '', externalName: '', menuItemId: '' });
            loadMappings();
        } catch {
            showError('Error al guardar mapeo');
        }
    };

    const handleDeleteMapping = async (id: number) => {
        if (!(await confirm('¿Eliminar este mapeo de producto?', { title: 'Confirmar acción' }))) return;
        try {
            await pedidosYaAPI.deleteMapping(id);
            loadMappings();
        } catch {
            showError('Error al eliminar');
        }
    };

    if (loading) return <div className="categories-loading">Cargando integración PedidosYa...</div>;

    const webhookUrl = `${API_BASE_URL}/pedidosya/webhook/${user?.companyId || '{companyId}'}`;

    return (
        <div className="pedidosya-page">
            <div className="pedidosya-header">
                <div>
                    <h1><Zap size={32} /> PedidosYa</h1>
                    <p className="pedidosya-subtitle">
                        {config.active
                            ? <span className="status-active"><CheckCircle size={14} /> Integración activa</span>
                            : <span className="status-inactive"><XCircle size={14} /> Integración inactiva</span>
                        }
                        {config.lastSyncAt && <span className="last-sync"> · Última sync: {new Date(config.lastSyncAt).toLocaleString('es-NI')}</span>}
                    </p>
                </div>
            </div>

            <div className="pedidosya-tabs">
                {([
                    { id: 'config' as ActiveTab, label: 'Configuración', icon: <Settings size={18} /> },
                    { id: 'mappings' as ActiveTab, label: 'Mapeo de Productos', icon: <Package size={18} /> },
                    { id: 'orders' as ActiveTab, label: 'Órdenes Sincronizadas', icon: <ArrowRightLeft size={18} /> },
                    { id: 'logs' as ActiveTab, label: 'Webhook Logs', icon: <Clock size={18} /> },
                ].filter((tab) => tab.id === 'config' || isSuperAdmin)).map(tab => (
                    <button
                        key={tab.id}
                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            <div className="pedidosya-content">
                {/* ── CONFIG TAB ── */}
                {activeTab === 'config' && (
                    <div className="config-section">
                        <div className="config-card">
                            <div className="config-card-header">
                                <Link2 size={20} />
                                <h3>Credenciales OAuth2</h3>
                            </div>
                            <div className="form-row">
                                <Input
                                    label="Client ID"
                                    value={config.clientId || ''}
                                    onChange={e => setConfig({ ...config, clientId: e.target.value })}
                                    placeholder="Tu Client ID de PedidosYa"
                                />
                                <Input
                                    label="Client Secret"
                                    type="password"
                                    value={config.clientSecret || ''}
                                    onChange={e => setConfig({ ...config, clientSecret: e.target.value })}
                                    placeholder={config.clientSecretSet ? 'Configurado; escribe para reemplazar' : '••••••••'}
                                />
                            </div>
                            <div className="form-row">
                                <Input
                                    label="Restaurant ID"
                                    value={config.restaurantId || ''}
                                    onChange={e => setConfig({ ...config, restaurantId: e.target.value })}
                                    placeholder="ID del restaurante en PedidosYa"
                                />
                                <Select
                                    variant="modal"
                                    label="Ambiente"
                                    value={{
                                        value: config.environment,
                                        label: config.environment === 'production' ? 'Producción' : 'Sandbox (Pruebas)'
                                    }}
                                    onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                        option && setConfig({ ...config, environment: option.value })}
                                    options={[
                                        { value: 'sandbox', label: 'Sandbox (Pruebas)' },
                                        { value: 'production', label: 'Producción' }
                                    ]}
                                    isSearchable={false}
                                />
                            </div>
                        </div>

                        <div className="config-card">
                            <div className="config-card-header">
                                <Settings size={20} />
                                <h3>Comportamiento</h3>
                            </div>
                            <div className="toggle-row">
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={config.active}
                                        onChange={e => setConfig({ ...config, active: e.target.checked })}
                                    />
                                    <span>Integración Activa</span>
                                </label>
                                <p className="toggle-description">Habilita la recepción de pedidos desde PedidosYa</p>
                            </div>
                            <div className="toggle-row">
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={config.autoAcceptOrders}
                                        onChange={e => setConfig({ ...config, autoAcceptOrders: e.target.checked })}
                                    />
                                    <span>Aceptar Pedidos Automáticamente</span>
                                </label>
                                <p className="toggle-description">Si está desactivado, los pedidos requieren aceptación manual</p>
                            </div>
                            <div className="toggle-row">
                                <label className="toggle-label">
                                    <input
                                        type="checkbox"
                                        checked={config.autoSyncStatus}
                                        onChange={e => setConfig({ ...config, autoSyncStatus: e.target.checked })}
                                    />
                                    <span>Sincronizar Estado Automáticamente</span>
                                </label>
                                <p className="toggle-description">Envía actualizaciones de estado a PedidosYa cuando cambia la orden internamente</p>
                            </div>
                        </div>

                        <div className="config-card">
                            <div className="config-card-header">
                                <AlertTriangle size={20} />
                                <h3>Webhook</h3>
                            </div>
                            <Input
                                label="Webhook Secret"
                                value={config.webhookSecret || ''}
                                onChange={e => setConfig({ ...config, webhookSecret: e.target.value })}
                                placeholder={config.webhookSecretSet ? 'Configurado; escribe para reemplazar' : 'Secret para validar firmas HMAC'}
                            />
                            <div className="webhook-url-display">
                                <label className="input-label">URL del Webhook (configura en PedidosYa)</label>
                                <code>{webhookUrl}</code>
                            </div>
                        </div>

                        <div className="config-actions">
                            <Button variant="primary" onClick={handleSaveConfig} disabled={saving}>
                                {saving ? 'Guardando...' : 'Guardar Configuración'}
                            </Button>
                            {isSuperAdmin && <Button variant="secondary" onClick={handleTestConnection}>
                                <Zap size={16} /> Probar Conexión
                            </Button>}
                            {isSuperAdmin && <Button variant="secondary" onClick={handleSyncMenu}>
                                <RefreshCw size={16} /> Sincronizar Menú
                            </Button>}
                        </div>

                        {connectionStatus.tested && (
                            <div className={`connection-result ${connectionStatus.success ? 'success' : 'error'}`}>
                                {connectionStatus.success ? <CheckCircle size={18} /> : <XCircle size={18} />}
                                <span>{connectionStatus.message}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* ── MAPPINGS TAB ── */}
                {activeTab === 'mappings' && (
                    <div className="mappings-section">
                        <div className="mappings-header">
                            <div className="search-container">
                                <Search size={18} className="search-icon" />
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Buscar mapeo..."
                                    value={mappingSearch}
                                    onChange={e => setMappingSearch(e.target.value)}
                                />
                            </div>
                            <Button variant="primary" onClick={() => setMappingSidebarOpen(true)}>
                                <Plus size={18} /> Nuevo Mapeo
                            </Button>
                        </div>

                        <div className="mappings-table-container">
                            <table className="mappings-table">
                                <thead>
                                    <tr>
                                        <th>ID Externo</th>
                                        <th>Nombre PedidosYa</th>
                                        <th>Producto Interno</th>
                                        <th>Estado</th>
                                        <th>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mappings
                                        .filter(m => !mappingSearch ||
                                            m.externalName.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                                            m.menuItem?.name.toLowerCase().includes(mappingSearch.toLowerCase())
                                        )
                                        .map(mapping => (
                                            <tr key={mapping.id}>
                                                <td><code>{mapping.externalId}</code></td>
                                                <td>{mapping.externalName}</td>
                                                <td>
                                                    {mapping.menuItem
                                                        ? <span className="mapped">{mapping.menuItem.name}</span>
                                                        : <span className="unmapped">Sin mapear</span>
                                                    }
                                                </td>
                                                <td>
                                                    <span className={`badge ${mapping.isActive ? 'badge-active' : 'badge-inactive'}`}>
                                                        {mapping.isActive ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button className="action-btn-new delete" onClick={() => handleDeleteMapping(mapping.id)}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                            {mappings.length === 0 && (
                                <div className="empty-state">
                                    <Package size={48} />
                                    <p>No hay mapeos configurados. Los mapeos se crean automáticamente al recibir pedidos o puedes crearlos manualmente.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── ORDERS TAB ── */}
                {activeTab === 'orders' && (
                    <div className="orders-section">
                        <div className="section-header-row">
                            <h3>Últimas Órdenes Sincronizadas</h3>
                            <Button variant="ghost" onClick={loadOrderSyncs}><RefreshCw size={16} /> Actualizar</Button>
                        </div>
                        <div className="mappings-table-container">
                            <table className="mappings-table">
                                <thead>
                                    <tr>
                                        <th>ID Externo</th>
                                        <th>Orden Interna</th>
                                        <th>Estado Externo</th>
                                        <th>Estado Interno</th>
                                        <th>Dirección</th>
                                        <th>Total</th>
                                        <th>Última Sync</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orderSyncs.map(sync => (
                                        <tr key={sync.id}>
                                            <td><code>{sync.externalId}</code></td>
                                            <td>#{sync.order.id}</td>
                                            <td><span className="badge">{sync.externalStatus || '-'}</span></td>
                                            <td><span className="badge">{sync.internalStatus || '-'}</span></td>
                                            <td>{sync.syncDirection === 'INBOUND' ? '← Entrante' : '→ Saliente'}</td>
                                            <td>{formatMoney(Number(sync.order.total))}</td>
                                            <td>{new Date(sync.lastSyncAt).toLocaleString('es-NI')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {orderSyncs.length === 0 && (
                                <div className="empty-state">
                                    <ArrowRightLeft size={48} />
                                    <p>No hay órdenes sincronizadas todavía.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── LOGS TAB ── */}
                {activeTab === 'logs' && (
                    <div className="logs-section">
                        <div className="section-header-row">
                            <h3>Webhook Logs</h3>
                            <Button variant="ghost" onClick={loadWebhookLogs}><RefreshCw size={16} /> Actualizar</Button>
                        </div>
                        <div className="mappings-table-container">
                            <table className="mappings-table">
                                <thead>
                                    <tr>
                                        <th>Evento</th>
                                        <th>ID Externo</th>
                                        <th>Estado</th>
                                        <th>Error</th>
                                        <th>Fecha</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {webhookLogs.map(log => (
                                        <tr key={log.id}>
                                            <td><code>{log.eventType}</code></td>
                                            <td>{log.externalId || '-'}</td>
                                            <td>
                                                <span className={`badge badge-${log.status.toLowerCase()}`}>
                                                    {log.status}
                                                </span>
                                            </td>
                                            <td className="error-cell">{log.errorMessage || '-'}</td>
                                            <td>{new Date(log.createdAt).toLocaleString('es-NI')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {webhookLogs.length === 0 && (
                                <div className="empty-state">
                                    <Clock size={48} />
                                    <p>No hay logs de webhook. Los eventos aparecerán cuando PedidosYa envíe notificaciones.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── MAPPING SIDEBAR ── */}
            <Sidebar
                isOpen={mappingSidebarOpen}
                onClose={() => setMappingSidebarOpen(false)}
                title="Nuevo Mapeo de Producto"
            >
                <div className="premium-modal-content">
                    <form onSubmit={e => { e.preventDefault(); handleSaveMapping(); }} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section">
                                <div className="modal-section-header">
                                    <Package size={18} />
                                    <h3>Producto Externo</h3>
                                </div>
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="pedidosya-external-id">ID en PedidosYa</label>
                                    <input
                                        id="pedidosya-external-id"
                                        type="text"
                                        className="modal-standard-input"
                                        value={mappingForm.externalId}
                                        onChange={e => setMappingForm({ ...mappingForm, externalId: e.target.value })}
                                        placeholder="Ej: PY-12345"
                                        required
                                    />
                                </div>
                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="pedidosya-external-name">Nombre en PedidosYa</label>
                                    <input
                                        id="pedidosya-external-name"
                                        type="text"
                                        className="modal-standard-input"
                                        value={mappingForm.externalName}
                                        onChange={e => setMappingForm({ ...mappingForm, externalName: e.target.value })}
                                        placeholder="Nombre del producto en la plataforma"
                                        required
                                    />
                                </div>
                                <Select
                                    variant="modal"
                                    inputId="pedidosya-menu-item"
                                    label="Producto Interno (Menú)"
                                    value={
                                        mappingForm.menuItemId
                                            ? (() => {
                                                const mi = menuItems.find((m) => m.id.toString() === mappingForm.menuItemId);
                                                return mi
                                                    ? { value: mappingForm.menuItemId, label: `${mi.name} (${formatMoney(Number(mi.price))})` }
                                                    : null;
                                            })()
                                            : null
                                    }
                                    onChange={(option: SingleValue<{ value: string; label: string }>) =>
                                        setMappingForm({ ...mappingForm, menuItemId: option?.value || '' })}
                                    options={menuItems.map((mi) => ({
                                        value: mi.id.toString(),
                                        label: `${mi.name} (${formatMoney(Number(mi.price))})`
                                    }))}
                                    placeholder="-- Sin mapear --"
                                    isClearable
                                    isSearchable
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="ghost" type="button" onClick={() => setMappingSidebarOpen(false)}>Cancelar</Button>
                            <Button variant="primary" type="submit">Guardar Mapeo</Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
