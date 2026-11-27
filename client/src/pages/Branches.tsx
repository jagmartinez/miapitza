import { useState, useEffect, useCallback, useRef } from 'react';
import { branchesAPI, hrAPI, type BranchGeofencePayload } from '../services/api';
import BranchWarehouseRoutes, { type WarehouseRoutesController } from '../components/BranchWarehouseRoutes';
import { Plus, Phone, Pencil, Power, Store, LocateFixed, Search } from 'lucide-react';
import type { Branch } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { MIN_LOCATION_ACCURACY_M } from '../components/hr/attendanceSettingsRules';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    LoadErrorState, PageContent, PageHeader, Switch, TableToolbar, Tabs, Textarea, type Column,
} from '@/ui';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'Todas' },
    { value: 'ACTIVE', label: 'Activas' },
    { value: 'INACTIVE', label: 'Inactivas' },
];

interface BranchFormData {
    name: string;
    code: string;
    address: string;
    phone: string;
    status: 'ACTIVE' | 'INACTIVE';
    latitude: string;
    longitude: string;
    geofenceRadiusM: string;
    maxLocationAccuracyM: string;
    timezone: string;
    attendanceEnabled: boolean;
    geofenceVersion?: number;
    /** Default sale warehouse (auto-delivery / POS availability); null = automatic. */
    defaultSaleWarehouseId: number | null;
}

const resolvedBrowserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const emptyBranchForm = (timezone = resolvedBrowserTimezone()): BranchFormData => ({
    name: '',
    code: '',
    address: '',
    phone: '',
    status: 'ACTIVE',
    latitude: '',
    longitude: '',
    geofenceRadiusM: '100',
    maxLocationAccuracyM: '30',
    timezone,
    attendanceEnabled: false,
    defaultSaleWarehouseId: null,
});

export default function Branches() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const isSuperAdmin = hasAnyRole(user, ['SUPERADMIN']);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [search, setSearch] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [formData, setFormData] = useState<BranchFormData>(() => emptyBranchForm(user?.timezone));
    const [activeTab, setActiveTab] = useState<'general' | 'ubicacion'>('general');
    const [saving, setSaving] = useState(false);
    const [locating, setLocating] = useState(false);
    const [locationAccuracyM, setLocationAccuracyM] = useState<number | null>(null);
    const [geofenceLoading, setGeofenceLoading] = useState(false);

    const loadData = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [branchesRes] = await Promise.all([
                branchesAPI.getAll()
            ]);
            setBranches(branchesRes.data.data);

        } catch (error) {
            console.error('Error loading data:', error);
            setLoadError(getApiErrorMessage(error, 'No fue posible cargar las sucursales'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const routesControllerRef = useRef<WarehouseRoutesController | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingBranch && !isSuperAdmin) {
            showWarning('Solo un superadministrador puede crear sucursales.');
            return;
        }
        if (!formData.name.trim() || !formData.code.trim()) {
            showError('Nombre y código de sucursal son obligatorios.');
            setActiveTab('general');
            return;
        }
        const latitude = formData.latitude.trim() === '' ? null : Number(formData.latitude);
        const longitude = formData.longitude.trim() === '' ? null : Number(formData.longitude);
        const geofenceRadiusM = formData.geofenceRadiusM.trim() === '' ? null : Number(formData.geofenceRadiusM);
        const maxLocationAccuracyM = formData.maxLocationAccuracyM.trim() === '' ? null : Number(formData.maxLocationAccuracyM);

        if ((latitude === null) !== (longitude === null)) {
            showError('Latitud y longitud deben registrarse juntas.');
            setActiveTab('ubicacion');
            return;
        }
        if (!editingBranch && (latitude === null || longitude === null)) {
            showError('La ubicación geodésica es obligatoria para crear una sucursal.');
            setActiveTab('ubicacion');
            return;
        }
        if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
            showError('La latitud debe estar entre -90 y 90.');
            setActiveTab('ubicacion');
            return;
        }
        if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
            showError('La longitud debe estar entre -180 y 180.');
            setActiveTab('ubicacion');
            return;
        }
        if (latitude !== null && (geofenceRadiusM === null || !Number.isInteger(geofenceRadiusM) || geofenceRadiusM < 10 || geofenceRadiusM > 10000)) {
            showError('Define un radio de geocerca entero entre 10 y 10000 metros.');
            setActiveTab('ubicacion');
            return;
        }
        if (latitude !== null && (maxLocationAccuracyM === null || !Number.isInteger(maxLocationAccuracyM) || maxLocationAccuracyM < MIN_LOCATION_ACCURACY_M || maxLocationAccuracyM > 5000)) {
            showError(`Define una precisión GPS máxima entera entre ${MIN_LOCATION_ACCURACY_M} y 5000 metros. Los teléfonos rara vez garantizan menos de ${MIN_LOCATION_ACCURACY_M} m.`);
            setActiveTab('ubicacion');
            return;
        }
        if (formData.attendanceEnabled && latitude === null) {
            showError('No se puede habilitar el marcaje sin coordenadas y geocerca.');
            setActiveTab('ubicacion');
            return;
        }
        try {
            new Intl.DateTimeFormat('es-NI', { timeZone: formData.timezone }).format();
        } catch {
            showError('Ingresa una zona horaria IANA válida, por ejemplo America/Managua.');
            setActiveTab('ubicacion');
            return;
        }

        const branchPayload = {
            name: formData.name,
            code: formData.code,
            address: formData.address,
            phone: formData.phone,
            status: formData.status,
        };
        const geofencePayload: BranchGeofencePayload = {
            latitude,
            longitude,
            geofenceRadiusM,
            maxLocationAccuracyM,
            timezone: formData.timezone || null,
            attendanceEnabled: formData.attendanceEnabled,
            ...(formData.geofenceVersion !== undefined ? { expectedVersion: formData.geofenceVersion } : {}),
        };

        const defaultSaleWarehouseChanged = !!editingBranch
            && (editingBranch.defaultSaleWarehouseId ?? null) !== formData.defaultSaleWarehouseId;

        setSaving(true);
        try {
            let savedBranch = editingBranch;
            if (editingBranch) {
                if (isSuperAdmin) {
                    await hrAPI.updateBranchGeofence(editingBranch.id, {
                        ...geofencePayload,
                        name: branchPayload.name,
                        code: branchPayload.code,
                        address: branchPayload.address,
                        phone: branchPayload.phone,
                        status: branchPayload.status,
                    });
                    savedBranch = editingBranch;
                    if (defaultSaleWarehouseChanged) {
                        await branchesAPI.update(editingBranch.id, { defaultSaleWarehouseId: formData.defaultSaleWarehouseId });
                    }
                } else {
                    const response = await branchesAPI.update(editingBranch.id, {
                        ...branchPayload,
                        ...(defaultSaleWarehouseChanged ? { defaultSaleWarehouseId: formData.defaultSaleWarehouseId } : {}),
                    });
                    savedBranch = response.data.data as Branch;
                }
            } else {
                // El alta histórica de sucursales acepta la geocerca en el mismo
                // comando para que nunca exista una sucursal nueva incompleta.
                const response = await branchesAPI.create({ ...branchPayload, ...geofencePayload });
                savedBranch = response.data.data as Branch;
            }

            if (!savedBranch?.id) throw new Error('La API no devolvió la sucursal guardada');

            const routes = routesControllerRef.current;
            if (routes?.dirty && !(await routes.save())) {
                await loadData();
                setActiveTab('general');
                showError('La sucursal se guardó, pero las rutas de bodega no. Corrígelas y vuelve a guardar.');
                return;
            }

            await loadData();
            closeModal();
        } catch (error) {
            console.error('Error saving branch:', error);
            const message = error && typeof error === 'object' && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(message || 'Error al guardar la sucursal');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!isSuperAdmin) {
            showWarning('Solo un superadministrador puede desactivar sucursales.');
            return;
        }
        if (!(await confirm('¿Estás seguro de desactivar esta sucursal?', { title: 'Confirmar acción' }))) return;
        try {
            await branchesAPI.delete(id);
            await loadData();
        } catch (error) {
            console.error('Error deleting branch:', error);
            showError(getApiErrorMessage(error, 'Error al desactivar la sucursal'));
        }
    };

    const openModal = async (branch?: Branch) => {
        if (!branch && !isSuperAdmin) {
            showWarning('Solo un superadministrador puede crear sucursales.');
            return;
        }
        if (branch) {
            setEditingBranch(branch);
            setFormData({
                name: branch.name,
                code: branch.code as string,
                address: branch.address || '',
                phone: branch.phone || '',
                status: branch.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                latitude: branch.latitude == null ? '' : String(branch.latitude),
                longitude: branch.longitude == null ? '' : String(branch.longitude),
                geofenceRadiusM: branch.geofenceRadiusM == null ? '' : String(branch.geofenceRadiusM),
                maxLocationAccuracyM: branch.maxLocationAccuracyM == null ? '' : String(branch.maxLocationAccuracyM),
                timezone: branch.timezone || user?.timezone || resolvedBrowserTimezone(),
                attendanceEnabled: branch.attendanceEnabled ?? false,
                geofenceVersion: branch.geofenceVersion,
                defaultSaleWarehouseId: branch.defaultSaleWarehouseId ?? null,
            });
        } else {
            setEditingBranch(null);
            setFormData(emptyBranchForm(user?.timezone));
        }
        setLocationAccuracyM(null);
        setIsModalOpen(true);
        if (branch && isSuperAdmin) {
            setGeofenceLoading(true);
            try {
                const response = await hrAPI.getBranchGeofence(branch.id);
                const geofence = response.data?.data;
                if (geofence) {
                    setFormData(current => ({
                        ...current,
                        latitude: geofence.latitude == null ? '' : String(geofence.latitude),
                        longitude: geofence.longitude == null ? '' : String(geofence.longitude),
                        geofenceRadiusM: geofence.geofenceRadiusM == null ? '' : String(geofence.geofenceRadiusM),
                        maxLocationAccuracyM: geofence.maxLocationAccuracyM == null ? '' : String(geofence.maxLocationAccuracyM),
                        timezone: geofence.timezone || user?.timezone || resolvedBrowserTimezone(),
                        attendanceEnabled: geofence.attendanceEnabled ?? false,
                        geofenceVersion: typeof geofence.version === 'number' ? geofence.version : undefined,
                    }));
                }
            } catch (error) {
                console.error('Error loading branch geofence:', error);
                notifyError(error, 'No se pudo actualizar la geocerca desde el servidor (se muestran los datos disponibles de la sucursal)', { type: 'warning' });
            } finally {
                setGeofenceLoading(false);
            }
        }
    };

    const useCurrentLocation = () => {
        if (!navigator.geolocation) {
            showError('Este navegador no permite obtener la ubicación.');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                setFormData(current => ({
                    ...current,
                    latitude: coords.latitude.toFixed(7),
                    longitude: coords.longitude.toFixed(7),
                }));
                setLocationAccuracyM(Math.round(coords.accuracy));
                setLocating(false);
            },
            (error) => {
                const message = error.code === error.PERMISSION_DENIED
                    ? 'Permiso de ubicación denegado. Habilítalo o ingresa las coordenadas manualmente.'
                    : 'No fue posible obtener una ubicación precisa. Intenta nuevamente.';
                showError(message);
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    };

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setEditingBranch(null);
        setLocating(false);
        setLocationAccuracyM(null);
        setGeofenceLoading(false);
    }, []);

    const handleSidebarClose = useCallback(() => {
        closeModal();
        setActiveTab('general');
    }, [closeModal]);

    const q = search.trim().toLowerCase();
    const filteredBranches = branches.filter((b) => {
        if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
        return !q || b.name.toLowerCase().includes(q) || (b.code ?? '').toLowerCase().includes(q)
            || (b.address ?? '').toLowerCase().includes(q);
    });

    const columns: Column<Branch>[] = [
        {
            key: 'name',
            header: 'Sucursal',
            render: (b) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{b.name}</span>
                    {b.code && <span className={styles.muted}>{b.code}</span>}
                </div>
            )
        },
        ...(isSuperAdmin ? [{
            key: 'company',
            header: 'Empresa',
            accessor: (b: Branch) => b.company?.name || '—'
        }] : []),
        { key: 'phone', header: 'Teléfono', accessor: (b) => b.phone || '—' },
        { key: 'address', header: 'Dirección', accessor: (b) => b.address || '—', hideBelow: 'lg' },
        { key: 'users', header: 'Usuarios', type: 'number', decimals: 0, accessor: (b) => b._count?.users || 0 },
        { key: 'tables', header: 'Mesas', type: 'number', decimals: 0, accessor: (b) => b._count?.tables || 0 },
        {
            key: 'status',
            header: 'Estado',
            type: 'status',
            render: (b) => (
                <div className={styles.inline}>
                    <Badge tone={b.status === 'ACTIVE' ? 'success' : 'neutral'} dot>{b.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}</Badge>
                    {(b._count?.warehouses ?? 0) === 0 && (
                        <span title="Sin almacén: no se podrá cobrar en esta sucursal hasta configurar uno">
                            <Badge tone="warning">Sin almacén</Badge>
                        </span>
                    )}
                </div>
            )
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (b) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} label={`Editar ${b.name}`} tooltip="Editar" onClick={() => openModal(b)} />
                    {isSuperAdmin && b.status === 'ACTIVE' && (
                        <IconButton size="sm" icon={Power} tone="danger" tooltip="Desactivar" label={`Desactivar ${b.name}`} onClick={() => handleDelete(b.id)} />
                    )}
                </div>
            )
        }
    ] as Column<Branch>[];

    const accuracyOk = locationAccuracyM !== null && locationAccuracyM <= Number(formData.maxLocationAccuracyM || 0);

    return (
        <PageContent>
            <PageHeader
                title="Sucursales"
                description="Ubicaciones, bodegas de venta y geocerca de asistencia"
                actions={isSuperAdmin ? (
                    <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                        Nueva sucursal
                    </Button>
                ) : undefined}
            />

            {loadError ? (
                <LoadErrorState message={loadError} onRetry={() => { void loadData(); }} />
            ) : (
                <>
                <Tabs
                    ariaLabel="Filtrar sucursales por estado"
                    active={statusFilter}
                    onChange={(id) => setStatusFilter(id as StatusFilter)}
                    tabs={STATUS_OPTIONS.map((o) => ({
                        id: o.value,
                        label: o.label,
                        badge: o.value === 'ALL' ? branches.length : branches.filter((b) => b.status === o.value).length,
                    }))}
                />
                <DataTable<Branch>
                    ariaLabel="Listado de sucursales"
                    rows={filteredBranches}
                    rowKey={(b) => b.id}
                    columns={columns}
                    loading={loading}
                    resetKey={`${statusFilter}|${q}`}
                    onRowClick={(b) => { void openModal(b); }}
                    empty={branches.length === 0 ? (
                        <EmptyState
                            icon={Store}
                            title="No hay sucursales registradas"
                            action={isSuperAdmin ? <Button variant="primary" onClick={() => openModal()}>Crear primera sucursal</Button> : undefined}
                        />
                    ) : 'No hay sucursales con este filtro.'}
                    toolbar={(
                        <TableToolbar>
                            <Input
                                type="search"
                                aria-label="Buscar sucursal"
                                placeholder="Buscar por nombre, código o dirección"
                                prefix={<Search size={14} aria-hidden="true" />}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </TableToolbar>
                    )}
                />
                </>
            )}

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={handleSidebarClose}
                title={editingBranch ? 'Editar sucursal' : 'Nueva sucursal'}
                breadcrumb={['Configuración', 'Sucursales']}
                tabs={[
                    { id: 'general', label: 'General' },
                    { id: 'ubicacion', label: 'Ubicación y geocerca' },
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as 'general' | 'ubicacion')}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="branch-form" loading={saving}>
                            {editingBranch ? 'Guardar cambios' : 'Crear sucursal'}
                        </Button>
                    </>
                )}
            >
                <form id="branch-form" onSubmit={handleSubmit} className={styles.stack}>
                    {activeTab === 'general' && (
                        <>
                            <FormSection step={1} title="Información general">
                                <FormGrid>
                                    <Field label="Nombre de la sucursal" htmlFor="branch-name" required>
                                        <Input
                                            id="branch-name"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ej: Sucursal Central"
                                            required
                                        />
                                    </Field>
                                    <Field label="Código" htmlFor="branch-code" required>
                                        <Input
                                            id="branch-code"
                                            value={formData.code}
                                            onChange={e => setFormData({ ...formData, code: e.target.value })}
                                            placeholder="SUC-001"
                                            required
                                        />
                                    </Field>
                                    <Field label="Teléfono" htmlFor="branch-phone">
                                        <Input
                                            id="branch-phone"
                                            type="tel"
                                            prefix={<Phone size={14} aria-hidden="true" />}
                                            value={formData.phone}
                                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                            placeholder="2255-0000"
                                        />
                                    </Field>
                                    {editingBranch && (
                                        <Field label="Estado de la sucursal" htmlFor="branch-status">
                                            <AppSelect<'ACTIVE' | 'INACTIVE'>
                                                isClearable={false}
                                                isSearchable={false}
                                                inputId="branch-status"
                                                options={[
                                                    { value: 'ACTIVE', label: 'Activa' },
                                                    { value: 'INACTIVE', label: 'Inactiva' }
                                                ]}
                                                value={formData.status}
                                                onChange={(v) => setFormData({
                                                    ...formData,
                                                    status: v === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                                                    ...(v === 'INACTIVE' ? { attendanceEnabled: false } : {}),
                                                })}
                                            />
                                        </Field>
                                    )}
                                </FormGrid>
                            </FormSection>

                            {editingBranch && (() => {
                                const saleWarehouses = (editingBranch.warehouses ?? [])
                                    .filter((warehouse) => !warehouse.type || warehouse.type === 'BRANCH');
                                const automatic = { value: 0, label: 'Automática (única bodega de sucursal)' };
                                const options = [
                                    automatic,
                                    ...saleWarehouses.map((warehouse) => ({
                                        value: warehouse.id,
                                        label: warehouse.code ? `${warehouse.name} (${warehouse.code})` : warehouse.name,
                                    })),
                                ];
                                return (
                                    <FormSection step={2} title="Bodegas" description="Bodega de venta y rutas de abastecimiento.">
                                        <FormGrid>
                                            <Field
                                                label="Bodega de venta predeterminada"
                                                htmlFor="branch-default-sale-warehouse"
                                                hint="Se usa para la entrega automática y la disponibilidad del POS. Con varias bodegas y sin predeterminada, la entrega requiere elegir bodega."
                                            >
                                                <AppSelect
                                                    isClearable={false}
                                                    inputId="branch-default-sale-warehouse"
                                                    options={options}
                                                    value={formData.defaultSaleWarehouseId ?? 0}
                                                    onChange={(v) => setFormData({
                                                        ...formData,
                                                        defaultSaleWarehouseId: v !== null && Number(v) > 0 ? Number(v) : null,
                                                    })}
                                                />
                                            </Field>
                                        </FormGrid>
                                        <BranchWarehouseRoutes
                                            branchId={editingBranch.id}
                                            warehouses={editingBranch.warehouses ?? []}
                                            canEdit={hasAnyRole(user, ['SUPERADMIN', 'ADMIN'])}
                                            controllerRef={routesControllerRef}
                                        />
                                    </FormSection>
                                );
                            })()}
                        </>
                    )}

                    {activeTab === 'ubicacion' && (
                        <>
                            <FormSection step={1} title="Dirección">
                                <Field label="Dirección completa" htmlFor="branch-address">
                                    <Textarea
                                        id="branch-address"
                                        rows={3}
                                        value={formData.address}
                                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                                        placeholder="Ciudad, Barrio, Calle..."
                                    />
                                </Field>
                            </FormSection>

                            <FormSection
                                step={2}
                                title="Geocerca para marcaje"
                                description="Se validará la ubicación solo al realizar el marcaje. No se realiza seguimiento continuo ni se muestra un mapa."
                            >
                                {geofenceLoading && <p className={styles.muted} role="status">Cargando configuración de geocerca…</p>}
                                <div>
                                    <Button icon={LocateFixed} onClick={useCurrentLocation} disabled={!isSuperAdmin || locating || geofenceLoading}>
                                        {locating ? 'Obteniendo ubicación…' : 'Usar mi ubicación'}
                                    </Button>
                                </div>
                                <FormGrid>
                                    <Field label="Latitud" htmlFor="branch-latitude" required={!editingBranch || formData.attendanceEnabled}>
                                        <Input
                                            id="branch-latitude"
                                            type="number"
                                            step="0.0000001"
                                            min="-90"
                                            max="90"
                                            value={formData.latitude}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, latitude: e.target.value })}
                                            placeholder="12.1363890"
                                            required={!editingBranch || formData.attendanceEnabled}
                                        />
                                    </Field>
                                    <Field label="Longitud" htmlFor="branch-longitude" required={!editingBranch || formData.attendanceEnabled}>
                                        <Input
                                            id="branch-longitude"
                                            type="number"
                                            step="0.0000001"
                                            min="-180"
                                            max="180"
                                            value={formData.longitude}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, longitude: e.target.value })}
                                            placeholder="-86.2513890"
                                            required={!editingBranch || formData.attendanceEnabled}
                                        />
                                    </Field>
                                </FormGrid>
                                {locationAccuracyM !== null && (
                                    <div role="status" className={styles.inline}>
                                        <Badge tone={accuracyOk ? 'success' : 'warning'}>
                                            Precisión reportada: ±{locationAccuracyM} m · {accuracyOk ? 'aceptable para el límite configurado' : 'supera el máximo permitido'}
                                        </Badge>
                                    </div>
                                )}
                                <FormGrid>
                                    <Field label="Radio de geocerca (m)" htmlFor="branch-geofence-radius" required={formData.latitude !== '' || formData.attendanceEnabled}>
                                        <Input
                                            id="branch-geofence-radius"
                                            type="number"
                                            min="10"
                                            max="10000"
                                            step="1"
                                            className="ui-input--number"
                                            value={formData.geofenceRadiusM}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, geofenceRadiusM: e.target.value })}
                                            required={formData.latitude !== '' || formData.attendanceEnabled}
                                        />
                                    </Field>
                                    <Field label="Margen máximo de error GPS (m)" htmlFor="branch-max-accuracy" required={formData.latitude !== '' || formData.attendanceEnabled}>
                                        <Input
                                            id="branch-max-accuracy"
                                            type="number"
                                            min={MIN_LOCATION_ACCURACY_M}
                                            max="5000"
                                            step="1"
                                            className="ui-input--number"
                                            value={formData.maxLocationAccuracyM}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, maxLocationAccuracyM: e.target.value })}
                                            required={formData.latitude !== '' || formData.attendanceEnabled}
                                        />
                                    </Field>
                                    <Field label="Zona horaria IANA" htmlFor="branch-timezone" required>
                                        <Input
                                            id="branch-timezone"
                                            value={formData.timezone}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                                            placeholder="America/Managua"
                                            required
                                        />
                                    </Field>
                                </FormGrid>
                                {formData.attendanceEnabled && Number(formData.maxLocationAccuracyM) < 20 && (
                                    <p className={styles.alert} role="status">
                                        <strong>Configuración GPS estricta.</strong> Los teléfonos normalmente no garantizan menos de 10–15 m. Usa 20–30 m como punto de partida y valida en el local.
                                    </p>
                                )}
                                {formData.attendanceEnabled && Number(formData.geofenceRadiusM) < 50 && (
                                    <p className={styles.alert} role="status">
                                        <strong>Geocerca muy pequeña.</strong> Un radio menor de 50 m puede rechazar personal dentro del local por deriva GPS. El valor inicial recomendado es 100 m.
                                    </p>
                                )}
                                <div className={styles.cellStack}>
                                    <Switch
                                        id="branch-attendance-enabled"
                                        checked={formData.attendanceEnabled}
                                        disabled={!isSuperAdmin}
                                        onChange={(attendanceEnabled) => setFormData({ ...formData, attendanceEnabled })}
                                        label="Habilitar validación de asistencia"
                                    />
                                    <p className={styles.muted}>
                                        Los marcajes de esta sucursal exigirán una ubicación dentro de la geocerca y con la precisión configurada.
                                    </p>
                                </div>
                            </FormSection>
                        </>
                    )}
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
