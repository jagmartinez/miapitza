import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { branchesAPI, hrAPI, type BranchGeofencePayload } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { Plus, MapPin, Phone, Edit2, Trash2, Building2, Store, AlertTriangle, LocateFixed } from 'lucide-react';
import type { Branch } from '../types';
import type { SingleValue } from 'react-select';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import './Branches.css';

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
    geofenceRadiusM: '',
    maxLocationAccuracyM: '',
    timezone,
    attendanceEnabled: false,
});

export default function Branches() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const isSuperAdmin = hasAnyRole(user, ['SUPERADMIN']);

    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const { viewMode, setViewMode } = useViewMode('branches');
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
            setLoadError('No fue posible cargar las sucursales.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

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
        if (latitude !== null && (maxLocationAccuracyM === null || !Number.isInteger(maxLocationAccuracyM) || maxLocationAccuracyM < 1 || maxLocationAccuracyM > 5000)) {
            showError('Define una precisión GPS máxima entera entre 1 y 5000 metros.');
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
                } else {
                    const response = await branchesAPI.update(editingBranch.id, branchPayload);
                    savedBranch = response.data.data as Branch;
                }
            } else {
                // El alta histórica de sucursales acepta la geocerca en el mismo
                // comando para que nunca exista una sucursal nueva incompleta.
                const response = await branchesAPI.create({ ...branchPayload, ...geofencePayload });
                savedBranch = response.data.data as Branch;
            }

            if (!savedBranch?.id) throw new Error('La API no devolvió la sucursal guardada');

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
            showError('Error al desactivar la sucursal');
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
                showWarning('No se pudo actualizar la geocerca desde el servidor; se muestran los datos disponibles de la sucursal.');
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

    const filteredBranches = statusFilter
        ? branches.filter(b => b.status === statusFilter)
        : branches;


    if (loading) return <div>Cargando...</div>;
    if (loadError) {
        return (
            <div className="state-placeholder" role="alert">
                <AlertTriangle size={42} aria-hidden="true" />
                <p>{loadError}</p>
                <Button variant="ghost" onClick={() => void loadData()}>Reintentar</Button>
            </div>
        );
    }

    return (
        <div className="branches-page">
            {/* Modern Header */}
            <div className="branches-header-new">
                <div className="header-title-section">
                    <h1><Store size={32} /> Gestión de Sucursales</h1>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                    {isSuperAdmin && (
                        <Button variant="primary" onClick={() => openModal()}>
                            <Plus size={20} />
                            Nueva Sucursal
                        </Button>
                    )}
                </div>
            </div>

            {/* Filters Row */}
            <div className="branches-filters-row">
                <div className="branch-status-filters">
                    <button
                        className={`branch-status-btn ${statusFilter === null ? 'active' : ''}`}
                        onClick={() => setStatusFilter(null)}
                    >
                        Todas
                    </button>
                    <button
                        className={`branch-status-btn active-filter ${statusFilter === 'ACTIVE' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('ACTIVE')}
                    >
                        Activas
                    </button>
                    <button
                        className={`branch-status-btn inactive-filter ${statusFilter === 'INACTIVE' ? 'active' : ''}`}
                        onClick={() => setStatusFilter('INACTIVE')}
                    >
                        Inactivas
                    </button>
                </div>

            </div>

            {/* Table view */}
            {viewMode === 'table' && filteredBranches.length > 0 && (
                <CatalogTable<Branch>
                    rows={filteredBranches}
                    rowKey={(b) => b.id}
                    resetKey={statusFilter}
                    columns={[
                        {
                            key: 'name',
                            header: 'Sucursal',
                            render: (b) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{b.name}</span>
                                    {b.code && <span className="cell-sub">{b.code}</span>}
                                    {(b._count?.warehouses ?? 0) === 0 && (
                                        <span
                                            className="cell-sub"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning, #f59e0b)', fontWeight: 600 }}
                                            title="Sin almacén: no se podrá cobrar en esta sucursal hasta configurar uno"
                                        >
                                            <AlertTriangle size={12} /> Sin almacén
                                        </span>
                                    )}
                                </div>
                            )
                        },
                        ...(isSuperAdmin ? [{
                            key: 'company',
                            header: 'Empresa',
                            render: (b: Branch) => b.company?.name || '-'
                        }] : []),
                        { key: 'phone', header: 'Teléfono', render: (b) => b.phone || '-' },
                        { key: 'address', header: 'Dirección', render: (b) => b.address || '-' },
                        { key: 'users', header: 'Usuarios', align: 'center', render: (b) => b._count?.users || 0 },
                        { key: 'tables', header: 'Mesas', align: 'center', render: (b) => b._count?.tables || 0 },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (b) => <span className={`catalog-pill ${b.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>{b.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}</span>
                        },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (b) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => openModal(b)} title="Editar">
                                        <Edit2 size={16} />
                                    </button>
                                    {isSuperAdmin && b.status === 'ACTIVE' && (
                                        <button className="catalog-action-btn danger" onClick={() => handleDelete(b.id)} title="Desactivar">
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            )
                        }
                    ] as CatalogColumn<Branch>[]}
                />
            )}

            {/* Enhanced Branch Grid */}
            {viewMode === 'cards' && (
            <div className="branches-grid-new">
                {filteredBranches.map((branch) => (
                    <div key={branch.id} className={`branch-card-new ${branch.status.toLowerCase()}`}>
                        {/* Status Badge */}
                        <div className={`status-badge-new ${branch.status.toLowerCase()}`}>
                            {branch.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}
                        </div>

                        {/* Card Body */}
                        <div className="branch-card-body-new">
                            <div className="branch-name-new">{branch.name}</div>

                            <div className="branch-identifiers-new">
                                <span className="branch-code-new">{branch.code}</span>
                                {isSuperAdmin && branch.company && (
                                    <span className="branch-company-tag-new">
                                        <Building2 size={12} />
                                        {branch.company.name}
                                    </span>
                                )}
                                {(branch._count?.warehouses ?? 0) === 0 && (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            padding: '2px 8px',
                                            borderRadius: '999px',
                                            fontSize: '0.72rem',
                                            fontWeight: 700,
                                            color: 'var(--color-warning, #f59e0b)',
                                            background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent)',
                                            border: '1px solid var(--color-warning, #f59e0b)'
                                        }}
                                        title="Sin almacén: no se podrá cobrar en esta sucursal hasta configurar uno"
                                    >
                                        <AlertTriangle size={12} /> Sin almacén
                                    </span>
                                )}
                            </div>

                            <div className="branch-details-new">
                                <div className="detail-item">
                                    <MapPin size={16} />
                                    <span>{branch.address || 'Sin dirección'}</span>
                                </div>
                                <div className="detail-item">
                                    <Phone size={16} />
                                    <span>{branch.phone || 'Sin teléfono'}</span>
                                </div>
                            </div>

                            <div className="branch-stats-new">
                                <div className="stat-item-new">
                                    <span className="stat-value-new">{branch._count?.users || 0}</span>
                                    <span className="stat-label-new">Usuarios</span>
                                </div>
                                <div className="stat-item-new">
                                    <span className="stat-value-new">{branch._count?.tables || 0}</span>
                                    <span className="stat-label-new">Mesas</span>
                                </div>
                                <div className="stat-item-new">
                                    <span className="stat-value-new">{branch._count?.warehouses || 0}</span>
                                    <span className="stat-label-new">Almacenes</span>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="branch-card-actions-new">
                            <button
                                className="action-btn-new edit"
                                onClick={() => openModal(branch)}
                                title="Editar"
                            >
                                <Edit2 size={20} />
                                <span>Editar</span>
                            </button>
                            {isSuperAdmin && branch.status === 'ACTIVE' && (
                                <button
                                    className="action-btn-new delete"
                                    onClick={() => handleDelete(branch.id)}
                                    title="Desactivar"
                                >
                                    <Trash2 size={20} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            )}

            {filteredBranches.length === 0 && (
                <div className="no-branches-message">
                    <Store size={48} />
                    <p>No hay sucursales {statusFilter ? 'con este estado' : 'registradas'}</p>
                    {(statusFilter || isSuperAdmin) && (
                        <Button
                            onClick={() => {
                                if (statusFilter) setStatusFilter(null);
                                else openModal();
                            }}
                        >
                            {statusFilter ? 'Ver todas' : 'Crear primera sucursal'}
                        </Button>
                    )}
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={handleSidebarClose}
                title={editingBranch ? 'Editar Sucursal' : 'Nueva Sucursal'}
            >
                <div className="premium-modal-content branches-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs">
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Store size={18} />
                            <span>General</span>
                        </button>
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'ubicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ubicacion')}
                        >
                            <MapPin size={18} />
                            <span>Ubicación</span>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {/* 1. GENERAL TAB */}
                            {activeTab === 'general' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Store size={18} />
                                        <h3>Información General</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="branch-name">Nombre de la Sucursal</label>
                                        <input
                                            id="branch-name"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ej: Sucursal Central"
                                            required
                                        />
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-code">Código</label>
                                            <input
                                                id="branch-code"
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.code}
                                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                                placeholder="SUC-001"
                                                required
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-phone">Teléfono</label>
                                            <div style={{ position: 'relative' }}>
                                                <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                                                <input
                                                    id="branch-phone"
                                                    type="text"
                                                    className="modal-standard-input"
                                                    style={{ paddingLeft: '36px' }}
                                                    value={formData.phone}
                                                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                                    placeholder="2255-0000"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {editingBranch && (
                                        <Select
                                            variant="modal"
                                            label="Estado de Sucursal"
                                            options={[
                                                { value: 'ACTIVE', label: 'Activa' },
                                                { value: 'INACTIVE', label: 'Inactiva' }
                                            ]}
                                            value={formData.status === 'ACTIVE' ? { value: 'ACTIVE', label: 'Activa' } : { value: 'INACTIVE', label: 'Inactiva' }}
                                            onChange={(option: SingleValue<{ value: string; label: string }>) => setFormData({
                                                ...formData,
                                                status: option?.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
                                                ...(option?.value === 'INACTIVE' ? { attendanceEnabled: false } : {}),
                                            })}
                                            isSearchable={false}
                                        />
                                    )}
                                </div>
                            )}

                            {/* 2. UBICACION TAB */}
                            {activeTab === 'ubicacion' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <MapPin size={18} />
                                        <h3>Dirección y geocerca</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="branch-address">Dirección Completa</label>
                                        <textarea
                                            id="branch-address"
                                            className="modal-standard-input"
                                            style={{ minHeight: '100px', paddingTop: '12px', resize: 'vertical' }}
                                            value={formData.address}
                                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                                            placeholder="Ciudad, Barrio, Calle..."
                                        />
                                    </div>

                                    <div className="modal-section-header" style={{ marginTop: '8px' }}>
                                        <LocateFixed size={18} />
                                        <h3>Geocerca para marcaje</h3>
                                    </div>

                                    <p style={{ margin: 0, color: 'var(--color-neutral-500)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                                        Se validará la ubicación solo al realizar el marcaje. No se realiza seguimiento continuo ni se muestra un mapa.
                                    </p>

                                    {geofenceLoading && (
                                        <div role="status" style={{ color: 'var(--color-neutral-500)', fontSize: '0.85rem' }}>
                                            Cargando configuración de geocerca…
                                        </div>
                                    )}

                                    <div>
                                        <Button type="button" variant="secondary" onClick={useCurrentLocation} disabled={!isSuperAdmin || locating || geofenceLoading}>
                                            <LocateFixed size={17} />
                                            {locating ? 'Obteniendo ubicación…' : 'Usar mi ubicación'}
                                        </Button>
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-latitude">Latitud</label>
                                            <input
                                                id="branch-latitude"
                                                type="number"
                                                step="0.0000001"
                                                min="-90"
                                                max="90"
                                                className="modal-standard-input"
                                                value={formData.latitude}
                                                disabled={!isSuperAdmin}
                                                onChange={e => setFormData({ ...formData, latitude: e.target.value })}
                                                placeholder="12.1363890"
                                                required={!editingBranch || formData.attendanceEnabled}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-longitude">Longitud</label>
                                            <input
                                                id="branch-longitude"
                                                type="number"
                                                step="0.0000001"
                                                min="-180"
                                                max="180"
                                                className="modal-standard-input"
                                                value={formData.longitude}
                                                disabled={!isSuperAdmin}
                                                onChange={e => setFormData({ ...formData, longitude: e.target.value })}
                                                placeholder="-86.2513890"
                                                required={!editingBranch || formData.attendanceEnabled}
                                            />
                                        </div>
                                    </div>

                                    {locationAccuracyM !== null && (
                                        <div
                                            role="status"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid var(--color-border)',
                                                background: 'var(--color-background)',
                                                color: locationAccuracyM <= Number(formData.maxLocationAccuracyM || 0)
                                                    ? 'var(--color-success)'
                                                    : 'var(--color-warning)',
                                                fontSize: '0.85rem',
                                            }}
                                        >
                                            {locationAccuracyM <= Number(formData.maxLocationAccuracyM || 0)
                                                ? <LocateFixed size={16} />
                                                : <AlertTriangle size={16} />}
                                            Precisión reportada: ±{locationAccuracyM} m ·{' '}
                                            {locationAccuracyM <= Number(formData.maxLocationAccuracyM || 0)
                                                ? 'aceptable para el límite configurado'
                                                : 'supera el máximo permitido'}
                                        </div>
                                    )}

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-geofence-radius">Radio de geocerca (m)</label>
                                            <input
                                                id="branch-geofence-radius"
                                                type="number"
                                                min="10"
                                                max="10000"
                                                step="1"
                                                className="modal-standard-input"
                                                value={formData.geofenceRadiusM}
                                                disabled={!isSuperAdmin}
                                                onChange={e => setFormData({ ...formData, geofenceRadiusM: e.target.value })}
                                                required={formData.latitude !== '' || formData.attendanceEnabled}
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="branch-max-accuracy">Precisión GPS máxima (m)</label>
                                            <input
                                                id="branch-max-accuracy"
                                                type="number"
                                                min="1"
                                                max="5000"
                                                step="1"
                                                className="modal-standard-input"
                                                value={formData.maxLocationAccuracyM}
                                                disabled={!isSuperAdmin}
                                                onChange={e => setFormData({ ...formData, maxLocationAccuracyM: e.target.value })}
                                                required={formData.latitude !== '' || formData.attendanceEnabled}
                                            />
                                        </div>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label" htmlFor="branch-timezone">Zona horaria IANA</label>
                                        <input
                                            id="branch-timezone"
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.timezone}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                                            placeholder="America/Managua"
                                            required
                                        />
                                    </div>

                                    <label
                                        htmlFor="branch-attendance-enabled"
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '10px',
                                            padding: '12px',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: '10px',
                                            background: 'var(--color-background)',
                                            color: 'var(--color-text)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <input
                                            id="branch-attendance-enabled"
                                            type="checkbox"
                                            checked={formData.attendanceEnabled}
                                            disabled={!isSuperAdmin}
                                            onChange={e => setFormData({ ...formData, attendanceEnabled: e.target.checked })}
                                            style={{ marginTop: '3px', accentColor: 'var(--color-primary)' }}
                                        />
                                        <span>
                                            <strong style={{ display: 'block' }}>Habilitar validación de asistencia</strong>
                                            <small style={{ color: 'var(--color-neutral-500)', lineHeight: 1.45 }}>
                                                Los marcajes de esta sucursal exigirán una ubicación dentro de la geocerca y con la precisión configurada.
                                            </small>
                                        </span>
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button variant="ghost" type="button" onClick={closeModal}>
                                Cancelar
                            </Button>
                            <Button variant="primary" type="submit" disabled={saving}>
                                {saving ? 'Guardando...' : editingBranch ? 'Guardar Cambios' : 'Crear Sucursal'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
