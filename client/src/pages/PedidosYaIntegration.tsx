import { useState, useEffect, useCallback } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { API_BASE_URL, pedidosYaAPI, menuAPI } from '../services/api';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { useCurrency } from '../hooks/useCurrency';
import { useAuth } from '../hooks/useAuth';
import { hasAnyRole } from '../utils/authz';
import {
    AppSelect, Badge, Button, DataTable, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, Switch, TableToolbar, Tabs, toneFor,
} from '@/ui';
import { Zap, RefreshCw, Search, Plus, Trash2 } from 'lucide-react';
import styles from './catalog.module.css';

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
        } catch (err) {
            showError(getApiErrorMessage(err, 'No se pudo cargar la configuración de PedidosYa.'));
        }
        setLoading(false);
    }, [showError]);

    const loadMappings = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getMappings();
            setMappings(res.data.data || []);
        } catch (err) { showError(getApiErrorMessage(err, 'No se pudieron cargar los mapeos.')); }
    }, [showError]);

    const loadOrderSyncs = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getOrderSyncs();
            setOrderSyncs(res.data.data || []);
        } catch (err) { showError(getApiErrorMessage(err, 'No se pudieron cargar las órdenes sincronizadas.')); }
    }, [showError]);

    const loadWebhookLogs = useCallback(async () => {
        try {
            const res = await pedidosYaAPI.getWebhookLogs();
            setWebhookLogs(res.data.data || []);
        } catch (err) { showError(getApiErrorMessage(err, 'No se pudieron cargar los logs del webhook.')); }
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
        } catch (err) {
            showError(getApiErrorMessage(err, 'Error al guardar'));
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
        } catch (err) {
            showError(getApiErrorMessage(err, 'Error al sincronizar menú'));
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
        } catch (err) {
            showError(getApiErrorMessage(err, 'Error al guardar mapeo'));
        }
    };

    const handleDeleteMapping = async (id: number) => {
        if (!(await confirm('¿Eliminar este mapeo de producto?', { title: 'Confirmar acción' }))) return;
        try {
            await pedidosYaAPI.deleteMapping(id);
            loadMappings();
        } catch (err) {
            showError(getApiErrorMessage(err, 'Error al eliminar'));
        }
    };

    const webhookUrl = `${API_BASE_URL}/pedidosya/webhook/${user?.companyId || '{companyId}'}`;

    const pageTabs = ([
        { id: 'config' as ActiveTab, label: 'Configuración' },
        { id: 'mappings' as ActiveTab, label: 'Mapeo de productos' },
        { id: 'orders' as ActiveTab, label: 'Órdenes sincronizadas' },
        { id: 'logs' as ActiveTab, label: 'Webhook logs' },
    ]).filter((tab) => tab.id === 'config' || isSuperAdmin);

    return (
        <PageContent>
            <PageHeader
                title="PedidosYa"
                description={
                    <span className={styles.inline}>
                        <Badge tone={config.active ? 'success' : 'neutral'} dot>
                            {config.active ? 'Integración activa' : 'Integración inactiva'}
                        </Badge>
                        {config.lastSyncAt && <span>Última sync: {new Date(config.lastSyncAt).toLocaleString('es-NI')}</span>}
                    </span>
                }
            />

            <Tabs ariaLabel="Secciones de PedidosYa" tabs={pageTabs} active={activeTab} onChange={(id) => setActiveTab(id as ActiveTab)} />

            {loading ? (
                <p className={styles.muted} role="status">Cargando integración PedidosYa…</p>
            ) : (
                <>
                    {/* ── CONFIG TAB ── */}
                    {activeTab === 'config' && (
                        <div className={styles.stack}>
                            <FormSection step={1} title="Credenciales OAuth2" description="Datos que entrega PedidosYa para la API.">
                                <FormGrid>
                                    <Field label="Client ID" htmlFor="pedidosya-client-id">
                                        <Input
                                            id="pedidosya-client-id"
                                            value={config.clientId || ''}
                                            onChange={e => setConfig({ ...config, clientId: e.target.value })}
                                            placeholder="Tu Client ID de PedidosYa"
                                        />
                                    </Field>
                                    <Field label="Client Secret" htmlFor="pedidosya-client-secret">
                                        <Input
                                            id="pedidosya-client-secret"
                                            type="password"
                                            autoComplete="new-password"
                                            value={config.clientSecret || ''}
                                            onChange={e => setConfig({ ...config, clientSecret: e.target.value })}
                                            placeholder={config.clientSecretSet ? 'Configurado; escribe para reemplazar' : '••••••••'}
                                        />
                                    </Field>
                                    <Field label="Restaurant ID" htmlFor="pedidosya-restaurant-id">
                                        <Input
                                            id="pedidosya-restaurant-id"
                                            value={config.restaurantId || ''}
                                            onChange={e => setConfig({ ...config, restaurantId: e.target.value })}
                                            placeholder="ID del restaurante en PedidosYa"
                                        />
                                    </Field>
                                    <Field label="Ambiente" htmlFor="pedidosya-environment">
                                        <AppSelect
                                            inputId="pedidosya-environment"
                                            value={config.environment}
                                            isClearable={false}
                                            isSearchable={false}
                                            onChange={(option) =>
                                                option && setConfig({ ...config, environment: option })}
                                            options={[
                                                { value: 'sandbox', label: 'Sandbox (Pruebas)' },
                                                { value: 'production', label: 'Producción' }
                                            ]}
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <FormSection step={2} title="Comportamiento">
                                <div className={styles.cellStack}>
                                    <Switch checked={config.active} onChange={(active) => setConfig({ ...config, active })} label="Integración activa" />
                                    <p className={styles.muted}>Habilita la recepción de pedidos desde PedidosYa.</p>
                                </div>
                                <div className={styles.cellStack}>
                                    <Switch checked={config.autoAcceptOrders} onChange={(autoAcceptOrders) => setConfig({ ...config, autoAcceptOrders })} label="Aceptar pedidos automáticamente" />
                                    <p className={styles.muted}>Si está desactivado, los pedidos requieren aceptación manual.</p>
                                </div>
                                <div className={styles.cellStack}>
                                    <Switch checked={config.autoSyncStatus} onChange={(autoSyncStatus) => setConfig({ ...config, autoSyncStatus })} label="Sincronizar estado automáticamente" />
                                    <p className={styles.muted}>Envía actualizaciones de estado a PedidosYa cuando cambia la orden internamente.</p>
                                </div>
                            </FormSection>

                            <FormSection step={3} title="Webhook" description="Configura esta URL y el secret en el portal de PedidosYa.">
                                <FormGrid>
                                    <Field label="Webhook Secret" htmlFor="pedidosya-webhook-secret">
                                        <Input
                                            id="pedidosya-webhook-secret"
                                            value={config.webhookSecret || ''}
                                            onChange={e => setConfig({ ...config, webhookSecret: e.target.value })}
                                            placeholder={config.webhookSecretSet ? 'Configurado; escribe para reemplazar' : 'Secret para validar firmas HMAC'}
                                        />
                                    </Field>
                                    <Field label="URL del webhook" htmlFor="pedidosya-webhook-url">
                                        <Input id="pedidosya-webhook-url" value={webhookUrl} readOnly />
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <div className={styles.inline}>
                                <Button variant="primary" onClick={handleSaveConfig} loading={saving}>
                                    Guardar configuración
                                </Button>
                                {isSuperAdmin && <Button icon={Zap} onClick={handleTestConnection}>Probar conexión</Button>}
                                {isSuperAdmin && <Button icon={RefreshCw} onClick={handleSyncMenu}>Sincronizar menú</Button>}
                            </div>

                            {connectionStatus.tested && (
                                <div role="status">
                                    <Badge tone={connectionStatus.success ? 'success' : 'danger'}>{connectionStatus.message}</Badge>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── MAPPINGS TAB ── */}
                    {activeTab === 'mappings' && (
                        <DataTable<ProductMapping>
                            ariaLabel="Mapeo de productos PedidosYa"
                            rows={mappings.filter((m) => !mappingSearch ||
                                m.externalName.toLowerCase().includes(mappingSearch.toLowerCase()) ||
                                m.menuItem?.name.toLowerCase().includes(mappingSearch.toLowerCase()))}
                            rowKey={(m) => m.id}
                            minWidth="720px"
                            resetKey={mappingSearch}
                            empty={mappings.length === 0 ? 'No hay mapeos configurados. Los mapeos se crean automáticamente al recibir pedidos o puedes crearlos manualmente.' : 'Ningún mapeo coincide con la búsqueda.'}
                            toolbar={(
                                <TableToolbar actions={<Button variant="primary" icon={Plus} onClick={() => setMappingSidebarOpen(true)}>Nuevo mapeo</Button>}>
                                    <Input
                                        type="search"
                                        aria-label="Buscar mapeo"
                                        placeholder="Buscar mapeo"
                                        prefix={<Search size={14} aria-hidden="true" />}
                                        value={mappingSearch}
                                        onChange={e => setMappingSearch(e.target.value)}
                                    />
                                </TableToolbar>
                            )}
                            columns={[
                                { key: 'externalId', header: 'ID externo', render: (m) => <code>{m.externalId}</code> },
                                { key: 'externalName', header: 'Nombre PedidosYa' },
                                { key: 'menuItem', header: 'Producto interno', render: (m) => m.menuItem
                                    ? m.menuItem.name
                                    : <Badge tone="warning">Sin mapear</Badge> },
                                { key: 'isActive', header: 'Estado', render: (m) => (
                                    <Badge tone={m.isActive ? 'success' : 'neutral'} dot>{m.isActive ? 'Activo' : 'Inactivo'}</Badge>
                                ) },
                                { key: 'actions', header: 'Acciones', type: 'actions', width: '100px', render: (m) => (
                                    <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label="Eliminar mapeo" onClick={() => handleDeleteMapping(m.id)} />
                                ) },
                            ]}
                        />
                    )}

                    {/* ── ORDERS TAB ── */}
                    {activeTab === 'orders' && (
                        <DataTable<OrderSync>
                            ariaLabel="Órdenes sincronizadas con PedidosYa"
                            rows={orderSyncs}
                            rowKey={(s) => s.id}
                            minWidth="860px"
                            empty="No hay órdenes sincronizadas todavía."
                            toolbar={<TableToolbar actions={<Button variant="ghost" icon={RefreshCw} onClick={loadOrderSyncs}>Actualizar</Button>} />}
                            columns={[
                                { key: 'externalId', header: 'ID externo', render: (s) => <code>{s.externalId}</code> },
                                { key: 'order', header: 'Orden interna', render: (s) => `#${s.order.id}` },
                                { key: 'externalStatus', header: 'Estado externo', render: (s) => <Badge>{s.externalStatus || '—'}</Badge> },
                                { key: 'internalStatus', header: 'Estado interno', render: (s) => <Badge>{s.internalStatus || '—'}</Badge> },
                                { key: 'syncDirection', header: 'Dirección', render: (s) => s.syncDirection === 'INBOUND' ? '← Entrante' : '→ Saliente' },
                                { key: 'total', header: 'Total', type: 'money', accessor: (s) => Number(s.order.total) },
                                { key: 'lastSyncAt', header: 'Última sync', render: (s) => new Date(s.lastSyncAt).toLocaleString('es-NI') },
                            ]}
                        />
                    )}

                    {/* ── LOGS TAB ── */}
                    {activeTab === 'logs' && (
                        <DataTable<WebhookLog>
                            ariaLabel="Logs de webhook de PedidosYa"
                            rows={webhookLogs}
                            rowKey={(l) => l.id}
                            minWidth="760px"
                            empty="No hay logs de webhook. Los eventos aparecerán cuando PedidosYa envíe notificaciones."
                            toolbar={<TableToolbar actions={<Button variant="ghost" icon={RefreshCw} onClick={loadWebhookLogs}>Actualizar</Button>} />}
                            columns={[
                                { key: 'eventType', header: 'Evento', render: (l) => <code>{l.eventType}</code> },
                                { key: 'externalId', header: 'ID externo', render: (l) => l.externalId || '—' },
                                { key: 'status', header: 'Estado', render: (l) => <Badge tone={toneFor(l.status)}>{l.status}</Badge> },
                                { key: 'errorMessage', header: 'Error', render: (l) => l.errorMessage || '—' },
                                { key: 'createdAt', header: 'Fecha', render: (l) => new Date(l.createdAt).toLocaleString('es-NI') },
                            ]}
                        />
                    )}
                </>
            )}

            {/* ── MAPPING MODAL ── */}
            <FullScreenModal
                isOpen={mappingSidebarOpen}
                onClose={() => setMappingSidebarOpen(false)}
                title="Nuevo mapeo de producto"
                breadcrumb={['Integraciones', 'PedidosYa']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="pedidosya-mapping-form">Guardar mapeo</Button>
                    </>
                )}
            >
                <form id="pedidosya-mapping-form" onSubmit={e => { e.preventDefault(); handleSaveMapping(); }} className={styles.stack}>
                    <FormSection step={1} title="Producto externo" description="Cómo aparece el producto en PedidosYa y a qué plato del menú corresponde.">
                        <FormGrid>
                            <Field label="ID en PedidosYa" htmlFor="pedidosya-external-id" required>
                                <Input
                                    id="pedidosya-external-id"
                                    value={mappingForm.externalId}
                                    onChange={e => setMappingForm({ ...mappingForm, externalId: e.target.value })}
                                    placeholder="Ej: PY-12345"
                                    required
                                />
                            </Field>
                            <Field label="Nombre en PedidosYa" htmlFor="pedidosya-external-name" required>
                                <Input
                                    id="pedidosya-external-name"
                                    value={mappingForm.externalName}
                                    onChange={e => setMappingForm({ ...mappingForm, externalName: e.target.value })}
                                    placeholder="Nombre del producto en la plataforma"
                                    required
                                />
                            </Field>
                            <Field label="Producto interno (menú)" htmlFor="pedidosya-menu-item">
                                <AppSelect
                                    inputId="pedidosya-menu-item"
                                    value={mappingForm.menuItemId || null}
                                    onChange={(option) =>
                                        setMappingForm({ ...mappingForm, menuItemId: option || '' })}
                                    options={menuItems.map((mi) => ({
                                        value: mi.id.toString(),
                                        label: `${mi.name} (${formatMoney(Number(mi.price))})`
                                    }))}
                                    placeholder="-- Sin mapear --"
                                    isClearable
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
