import { useState, useEffect } from 'react';
import { companiesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import LoadingSpinner from '../components/LoadingSpinner';
import { Plus, Building2, Edit2, CheckCircle, XCircle, FileText } from 'lucide-react';
import type { SingleValue } from 'react-select';
import { useAppToast } from '../context/ToastContext';
import './Companies.css';

interface Company {
    id: number;
    name: string;
    ruc: string | null;
    logo: string | null;
    active: boolean;
    createdAt: string;
    _count?: {
        branches: number;
        users: number;
    };
}

export default function Companies() {
    const { error: showError } = useAppToast();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<boolean | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        ruc: '',
        active: true
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadCompanies();
    }, []);

    const loadCompanies = async () => {
        try {
            const response = await companiesAPI.getAll();
            setCompanies(response.data.data);
        } catch (error) {
            console.error('Error loading companies:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            if (editingCompany) {
                await companiesAPI.update(editingCompany.id, formData);
            } else {
                await companiesAPI.create(formData);
            }
            loadCompanies();
            closeModal();
        } catch (error) {
            console.error('Error saving company:', error);
            showError('Error al guardar la empresa');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (company: Company) => {
        try {
            await companiesAPI.update(company.id, { active: !company.active });
            loadCompanies();
        } catch (error) {
            console.error('Error updating company status:', error);
        }
    };

    const openModal = (company?: Company) => {
        if (company) {
            setEditingCompany(company);
            setFormData({
                name: company.name,
                ruc: company.ruc || '',
                active: company.active
            });
        } else {
            setEditingCompany(null);
            setFormData({
                name: '',
                ruc: '',
                active: true
            });
        }
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setEditingCompany(null);
    };

    const filteredCompanies = statusFilter !== null
        ? companies.filter(c => c.active === statusFilter)
        : companies;


    if (loading) return <LoadingSpinner text="Cargando empresas..." />;

    return (
        <div className="companies-page">
            {/* Modern Header */}
            <div className="companies-header-new">
                <div className="header-title-section">
                    <h1><Building2 size={32} /> Gestión de Empresas</h1>
                </div>
                <Button variant="primary" onClick={() => openModal()}>
                    <Plus size={20} />
                    Nueva Empresa
                </Button>
            </div>

            {/* Filters Row */}
            <div className="companies-filters-row">
                <div className="company-status-filters">
                    <button
                        className={`company-status-btn ${statusFilter === null ? 'active' : ''}`}
                        onClick={() => setStatusFilter(null)}
                    >
                        Todas
                    </button>
                    <button
                        className={`company-status-btn active-filter ${statusFilter === true ? 'active' : ''}`}
                        onClick={() => setStatusFilter(true)}
                    >
                        Activas
                    </button>
                    <button
                        className={`company-status-btn inactive-filter ${statusFilter === false ? 'active' : ''}`}
                        onClick={() => setStatusFilter(false)}
                    >
                        Inactivas
                    </button>
                </div>

            </div>

            {/* Enhanced Companies Grid */}
            <div className="companies-grid-new">
                {filteredCompanies.map((company) => (
                    <div key={company.id} className={`company-card-new ${company.active ? 'active' : 'inactive'}`}>
                        {/* Status Badge */}
                        <div className={`status-badge-new ${company.active ? 'active' : 'inactive'}`}>
                            {company.active ? 'Activa' : 'Inactiva'}
                        </div>

                        {/* Card Body */}
                        <div className="company-card-body-new">
                            <div className="company-logo-new">
                                {company.logo ? (
                                    <img src={company.logo} alt={company.name} />
                                ) : (
                                    <Building2 size={40} />
                                )}
                            </div>

                            <div className="company-name-new">{company.name}</div>

                            <div className="company-ruc-new">
                                RUC: {company.ruc || 'No registrado'}
                            </div>

                            <div className="company-stats-new">
                                <div className="stat-item-new">
                                    <span className="stat-value-new">{company._count?.branches || 0}</span>
                                    <span className="stat-label-new">Sucursales</span>
                                </div>
                                <div className="stat-item-new">
                                    <span className="stat-value-new">{company._count?.users || 0}</span>
                                    <span className="stat-label-new">Usuarios</span>
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="company-card-actions-new">
                            <button
                                className="action-btn-new edit"
                                onClick={(e) => { e.stopPropagation(); openModal(company); }}
                                title="Editar"
                            >
                                <Edit2 size={20} />
                                <span>Editar</span>
                            </button>
                            <button
                                className={`action-btn-new ${company.active ? 'deactivate' : 'activate'}`}
                                onClick={(e) => { e.stopPropagation(); toggleActive(company); }}
                                title={company.active ? 'Desactivar' : 'Activar'}
                            >
                                {company.active ? (
                                    <>
                                        <XCircle size={20} />
                                        <span>Desactivar</span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle size={20} />
                                        <span>Activar</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {filteredCompanies.length === 0 && (
                <div className="no-companies-message">
                    <Building2 size={48} />
                    <p>No hay empresas {statusFilter !== null ? 'con este estado' : 'registradas'}</p>
                    <Button onClick={() => statusFilter !== null ? setStatusFilter(null) : openModal()}>
                        {statusFilter !== null ? 'Ver todas' : 'Crear primera empresa'}
                    </Button>
                </div>
            )}

            <Sidebar
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingCompany ? 'Editar Empresa' : 'Nueva Empresa'}
            >
                <div className="premium-modal-content companies-modal-content">
                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            <div className="modal-section animate-slide-in">
                                <div className="modal-section-header">
                                    <Building2 size={18} />
                                    <h3>Información General</h3>
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="company-name">Nombre de la Empresa</label>
                                    <input
                                        id="company-name"
                                        type="text"
                                        className="modal-standard-input"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Restaurante Mi Casa"
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div className="modal-input-group">
                                    <label className="modal-input-label" htmlFor="company-ruc">RUC (Registro Único de Contribuyente)</label>
                                    <div style={{ position: 'relative' }}>
                                        <FileText size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                                        <input
                                            id="company-ruc"
                                            type="text"
                                            className="modal-standard-input"
                                            style={{ paddingLeft: '36px' }}
                                            value={formData.ruc}
                                            onChange={e => setFormData({ ...formData, ruc: e.target.value })}
                                            placeholder="Ej: J0310000123456"
                                        />
                                    </div>
                                </div>

                                {editingCompany && (
                                    <Select
                                        variant="modal"
                                        label="Estado de la Empresa"
                                        options={[
                                            { value: 'true', label: 'Activa' },
                                            { value: 'false', label: 'Inactiva' }
                                        ]}
                                        value={formData.active ? { value: 'true', label: 'Activa' } : { value: 'false', label: 'Inactiva' }}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => setFormData({ ...formData, active: option?.value === 'true' })}
                                        isSearchable={false}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="modal-footer">
                            <Button variant="ghost" onClick={closeModal} type="button">
                                Cancelar
                            </Button>
                            <Button variant="primary" type="submit" disabled={saving}>
                                {saving ? 'Guardando...' : editingCompany ? 'Guardar Cambios' : 'Crear Empresa'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
