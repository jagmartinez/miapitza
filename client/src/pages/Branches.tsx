import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { branchesAPI, companiesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { Plus, MapPin, Phone, Edit2, Trash2, Building2, Store } from 'lucide-react';
import type { Branch, Company } from '../types';
import type { SingleValue } from 'react-select';
import { useAuth } from '../hooks/useAuth';
import './Branches.css';

export default function Branches() {
    const { user } = useAuth();
    const isSuperAdmin = user?.role?.name === 'SUPERADMIN';

    const [branches, setBranches] = useState<Branch[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        code: '',
        address: '',
        phone: '',
        status: 'ACTIVE',
        companyId: ''
    });
    const [activeTab, setActiveTab] = useState<'general' | 'ubicacion'>('general');

    const loadData = useCallback(async () => {
        try {
            const [branchesRes] = await Promise.all([
                branchesAPI.getAll()
            ]);
            setBranches(branchesRes.data.data);

            if (isSuperAdmin) {
                const companiesRes = await companiesAPI.getAll();
                setCompanies(companiesRes.data.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            setLoading(false);
        }
    }, [isSuperAdmin]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                companyId: isSuperAdmin && formData.companyId ? parseInt(formData.companyId) : undefined
            };

            if (editingBranch) {
                await branchesAPI.update(editingBranch.id, payload);
            } else {
                await branchesAPI.create(payload);
            }
            await loadData();
            closeModal();
        } catch (error) {
            console.error('Error saving branch:', error);
            alert('Error al guardar la sucursal');
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('¿Estás seguro de desactivar esta sucursal?')) return;
        try {
            await branchesAPI.delete(id);
            await loadData();
        } catch (error) {
            console.error('Error deleting branch:', error);
            alert('Error al desactivar la sucursal');
        }
    };

    const openModal = (branch?: Branch) => {
        if (branch) {
            setEditingBranch(branch);
            setFormData({
                name: branch.name,
                code: branch.code as string,
                address: branch.address || '',
                phone: branch.phone || '',
                status: branch.status,
                companyId: branch.companyId?.toString() || ''
            });
        } else {
            setEditingBranch(null);
            setFormData({
                name: '',
                code: '',
                address: '',
                phone: '',
                status: 'ACTIVE',
                companyId: ''
            });
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingBranch(null);
    };

    const filteredBranches = statusFilter
        ? branches.filter(b => b.status === statusFilter)
        : branches;


    if (loading) return <div>Cargando...</div>;

    return (
        <div className="branches-page">
            {/* Modern Header */}
            <div className="branches-header-new">
                <div className="header-title-section">
                    <h1><Store size={32} /> Gestión de Sucursales</h1>
                </div>
                <Button variant="primary" onClick={() => openModal()}>
                    <Plus size={20} />
                    Nueva Sucursal
                </Button>
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

            {/* Enhanced Branch Grid */}
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
                            {branch.status === 'ACTIVE' && (
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

            {filteredBranches.length === 0 && (
                <div className="no-branches-message">
                    <Store size={48} />
                    <p>No hay sucursales {statusFilter ? 'con este estado' : 'registradas'}</p>
                    <Button onClick={() => statusFilter ? setStatusFilter(null) : openModal()}>
                        {statusFilter ? 'Ver todas' : 'Crear primera sucursal'}
                    </Button>
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={() => { closeModal(); setActiveTab('general'); }}
                title={editingBranch ? 'Editar Sucursal' : 'Nueva Sucursal'}
            >
                <div className="premium-modal-content branches-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs">
                        <div
                            className={`modal-tab ${activeTab === 'general' ? 'active' : ''}`}
                            onClick={() => setActiveTab('general')}
                        >
                            <Store size={18} />
                            <span>General</span>
                        </div>
                        <div
                            className={`modal-tab ${activeTab === 'ubicacion' ? 'active' : ''}`}
                            onClick={() => setActiveTab('ubicacion')}
                        >
                            <MapPin size={18} />
                            <span>Ubicación</span>
                        </div>
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
                                        <label className="modal-input-label">Nombre de la Sucursal</label>
                                        <input
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ej: Sucursal Central"
                                            required
                                            autoFocus
                                        />
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Código</label>
                                            <input
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.code}
                                                onChange={e => setFormData({ ...formData, code: e.target.value })}
                                                placeholder="SUC-001"
                                                required
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Teléfono</label>
                                            <div style={{ position: 'relative' }}>
                                                <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                                                <input
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
                                            onChange={(option: SingleValue<{ value: string; label: string }>) => setFormData({ ...formData, status: option?.value || 'ACTIVE' })}
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
                                        <h3>Dirección y Empresa</h3>
                                    </div>

                                    {isSuperAdmin && !editingBranch && (
                                        <Select
                                            variant="modal"
                                            label="Empresa Propietaria"
                                            options={companies.map(c => ({ value: c.id.toString(), label: c.name }))}
                                            value={(() => {
                                                const company = companies.find(c => c.id.toString() === formData.companyId);
                                                return company ? { value: formData.companyId, label: company.name } : null;
                                            })()}
                                            onChange={(option: SingleValue<{ value: string; label: string }>) => setFormData({ ...formData, companyId: option?.value || '' })}
                                            placeholder="Seleccionar Empresa"
                                            required
                                        />
                                    )}

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Dirección Completa</label>
                                        <textarea
                                            className="modal-standard-input"
                                            style={{ minHeight: '100px', paddingTop: '12px', resize: 'vertical' }}
                                            value={formData.address}
                                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                                            placeholder="Ciudad, Barrio, Calle..."
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button variant="ghost" type="button" onClick={closeModal}>
                                Cancelar
                            </Button>
                            <Button variant="primary" type="submit">
                                {editingBranch ? 'Guardar Cambios' : 'Crear Sucursal'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
