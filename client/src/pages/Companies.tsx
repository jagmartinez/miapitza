import { useState, useEffect } from 'react';
import { companiesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import Select from '../components/Select';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import LoadingSpinner from '../components/LoadingSpinner';
import { Plus, Building2, Edit2, CheckCircle, XCircle, FileText } from 'lucide-react';
import type { SingleValue } from 'react-select';
import { useAppToast } from '../context/ToastContext';
import { resolveAssetUrl } from '../utils/assets';
import './Companies.css';

interface Company {
    id: number;
    name: string;
    ruc: string | null;
    logo: string | null;
    payrollTaxRegime: TaxRegime;
    payrollIncomeTaxWithholding: boolean;
    payrollTaxRegimeReference: string | null;
    payrollIncomeTaxException: string | null;
    payrollTaxProfileReady: boolean;
    active: boolean;
    createdAt: string;
    _count?: {
        branches: number;
        users: number;
    };
}

type TaxRegime = 'GENERAL' | 'SIMPLIFIED_FIXED_QUOTA' | 'SPECIAL' | 'EXEMPT' | 'OTHER';

const TAX_REGIMES: Array<{ value: TaxRegime; label: string }> = [
    { value: 'GENERAL', label: 'Régimen general' },
    { value: 'SIMPLIFIED_FIXED_QUOTA', label: 'Cuota fija / simplificado' },
    { value: 'SPECIAL', label: 'Régimen especial' },
    { value: 'EXEMPT', label: 'Exento' },
    { value: 'OTHER', label: 'Otro' },
];

const defaultCompanyForm = () => ({
    name: '',
    ruc: '',
    active: true,
    payrollTaxRegime: 'GENERAL' as TaxRegime,
    payrollIncomeTaxWithholding: true,
    payrollTaxRegimeReference: '',
    payrollIncomeTaxException: '',
});

export default function Companies() {
    const { error: showError } = useAppToast();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<boolean | null>(null);
    const { viewMode, setViewMode } = useViewMode('companies');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);
    const [formData, setFormData] = useState(defaultCompanyForm);
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
                active: company.active,
                payrollTaxRegime: company.payrollTaxRegime || 'GENERAL',
                payrollIncomeTaxWithholding: company.payrollIncomeTaxWithholding ?? true,
                payrollTaxRegimeReference: company.payrollTaxRegimeReference || '',
                payrollIncomeTaxException: company.payrollIncomeTaxException || '',
            });
        } else {
            setEditingCompany(null);
            setFormData(defaultCompanyForm());
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <ViewToggle value={viewMode} onChange={setViewMode} />
                    <Button variant="primary" onClick={() => openModal()}>
                        <Plus size={20} />
                        Nueva Empresa
                    </Button>
                </div>
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

            {/* Table view */}
            {viewMode === 'table' && filteredCompanies.length > 0 && (
                <CatalogTable<Company>
                    rows={filteredCompanies}
                    rowKey={(c) => c.id}
                    resetKey={statusFilter}
                    columns={[
                        {
                            key: 'name',
                            header: 'Empresa',
                            render: (c) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{c.name}</span>
                                    <span className="cell-sub">RUC: {c.ruc || 'No registrado'}</span>
                                </div>
                            )
                        },
                        { key: 'branches', header: 'Sucursales', align: 'center', render: (c) => c._count?.branches || 0 },
                        { key: 'users', header: 'Usuarios', align: 'center', render: (c) => c._count?.users || 0 },
                        {
                            key: 'taxRegime',
                            header: 'Perfil fiscal',
                            render: (c) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{TAX_REGIMES.find((item) => item.value === c.payrollTaxRegime)?.label ?? c.payrollTaxRegime}</span>
                                    <span className="cell-sub">{!c.payrollTaxProfileReady ? 'Perfil fiscal pendiente' : c.payrollIncomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral'}</span>
                                </div>
                            )
                        },
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (c) => <span className={`catalog-pill ${c.active ? 'ok' : 'neutral'}`}>{c.active ? 'Activa' : 'Inactiva'}</span>
                        },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (c) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => openModal(c)} title="Editar">
                                        <Edit2 size={16} />
                                    </button>
                                    <button
                                        className={`catalog-action-btn ${c.active ? 'danger' : ''}`}
                                        onClick={() => toggleActive(c)}
                                        title={c.active ? 'Desactivar' : 'Activar'}
                                    >
                                        {c.active ? <XCircle size={16} /> : <CheckCircle size={16} />}
                                    </button>
                                </div>
                            )
                        }
                    ] as CatalogColumn<Company>[]}
                />
            )}

            {/* Enhanced Companies Grid */}
            {viewMode === 'cards' && (
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
                                    <img src={resolveAssetUrl(company.logo)} alt={company.name} />
                                ) : (
                                    <Building2 size={40} />
                                )}
                            </div>

                            <div className="company-name-new">{company.name}</div>

                            <div className="company-ruc-new">
                                RUC: {company.ruc || 'No registrado'}
                            </div>

                            <div className="company-tax-profile-summary">
                                <strong>{TAX_REGIMES.find((item) => item.value === company.payrollTaxRegime)?.label ?? company.payrollTaxRegime}</strong>
                                <span>{!company.payrollTaxProfileReady ? 'Perfil fiscal pendiente' : company.payrollIncomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral'}</span>
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
            )}

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
                            <div className="modal-content-group">
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

                                <div className="company-tax-profile-form" aria-labelledby="company-tax-profile-title">
                                    <div className="modal-section-header">
                                        <FileText size={18} />
                                        <div>
                                            <h3 id="company-tax-profile-title">Perfil fiscal para nómina</h3>
                                            <p>Se administra aquí. Cada nueva versión legal toma estos datos y conserva una copia para auditoría.</p>
                                        </div>
                                    </div>
                                    <Select
                                        variant="modal"
                                        label="Régimen tributario registrado"
                                        options={TAX_REGIMES}
                                        value={TAX_REGIMES.find((item) => item.value === formData.payrollTaxRegime)}
                                        onChange={(option: SingleValue<{ value: TaxRegime; label: string }>) => {
                                            if (!option) return;
                                            const stopsWithholding = ['SIMPLIFIED_FIXED_QUOTA', 'EXEMPT'].includes(option.value);
                                            setFormData({
                                                ...formData,
                                                payrollTaxRegime: option.value,
                                                payrollIncomeTaxWithholding: stopsWithholding ? false : formData.payrollIncomeTaxWithholding,
                                                payrollIncomeTaxException: formData.payrollIncomeTaxException,
                                            });
                                        }}
                                        isSearchable={false}
                                    />
                                    <Select
                                        variant="modal"
                                        label="Retención de IR laboral"
                                        options={[
                                            { value: 'true', label: 'Sí, la empresa retiene IR laboral' },
                                            { value: 'false', label: 'No retiene IR laboral' },
                                        ]}
                                        value={formData.payrollIncomeTaxWithholding
                                            ? { value: 'true', label: 'Sí, la empresa retiene IR laboral' }
                                            : { value: 'false', label: 'No retiene IR laboral' }}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => setFormData({
                                            ...formData,
                                            payrollIncomeTaxWithholding: option?.value === 'true',
                                            payrollIncomeTaxException: option?.value === 'true' ? '' : formData.payrollIncomeTaxException,
                                        })}
                                        isSearchable={false}
                                    />
                                    <div className="modal-input-group company-tax-reference">
                                        <label className="modal-input-label" htmlFor="company-tax-reference">Referencia o respaldo fiscal</label>
                                        <input
                                            id="company-tax-reference"
                                            className="modal-standard-input"
                                            value={formData.payrollTaxRegimeReference}
                                            onChange={(event) => setFormData({ ...formData, payrollTaxRegimeReference: event.target.value })}
                                            placeholder="Constancia DGI, resolución o referencia verificable"
                                            maxLength={500}
                                            required
                                        />
                                    </div>
                                    {!formData.payrollIncomeTaxWithholding && (
                                        <div className="modal-input-group company-tax-reference">
                                            <label className="modal-input-label" htmlFor="company-tax-exception">Fundamento para no retener IR laboral</label>
                                            <textarea
                                                id="company-tax-exception"
                                                className="modal-standard-input"
                                                rows={3}
                                                value={formData.payrollIncomeTaxException}
                                                onChange={(event) => setFormData({ ...formData, payrollIncomeTaxException: event.target.value })}
                                                placeholder="Resolución, excepción o justificación fiscal aplicable"
                                                minLength={3}
                                                maxLength={500}
                                                required
                                            />
                                        </div>
                                    )}
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
