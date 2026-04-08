import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsAPI, uploadAPI, backupAPI } from '../services/api';
import Card from '../components/Card';
import Button from '../components/Button';
import Input from '../components/Input';
import { Settings as SettingsIcon, Building2, FileText, Users, Database, Upload } from 'lucide-react';
import './Settings.css';

type SettingsTab = 'general' | 'company' | 'invoice' | 'roles' | 'system';

export default function Settings() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string>('');

    const [formData, setFormData] = useState({
        // General
        companyName: '',
        taxRate: '',
        currency_symbol: '$',

        // Company
        nif: '',
        address: '',
        phone: '',
        email: '',
        logoUrl: '',

        // Invoice
        invoicePrefix: 'INV',
        invoiceFooter: '',
        invoiceTerms: '',

        // System
        enablePromotions: 'false',

        // Security
        password_expiry_days: '90',
        session_timeout_minutes: '30'
    });

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const res = await settingsAPI.getAll();
            const settings = res.data.data;
            setFormData({
                companyName: settings.companyName || '',
                taxRate: settings.taxRate || '',
                currency_symbol: settings.currency_symbol || settings.currency || '$',
                nif: settings.nif || '',
                address: settings.address || '',
                phone: settings.phone || '',
                email: settings.email || '',
                logoUrl: settings.logoUrl || '',
                invoicePrefix: settings.invoicePrefix || 'INV',
                invoiceFooter: settings.invoiceFooter || '',
                invoiceTerms: settings.invoiceTerms || '',
                enablePromotions: settings.enablePromotions || 'false',
                password_expiry_days: settings.password_expiry_days || '90',
                session_timeout_minutes: settings.session_timeout_minutes || '30'
            });
            if (settings.logoUrl) {
                setLogoPreview(settings.logoUrl);
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setLogoFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            // If there's a logo file, upload it first
            if (logoFile) {
                const formDataUpload = new FormData();
                formDataUpload.append('logo', logoFile);
                const uploadRes = await uploadAPI.uploadLogo(formDataUpload);
                formData.logoUrl = uploadRes.data.data.url;
            }

            await settingsAPI.update(formData);
            alert('Configuración guardada correctamente');
            loadSettings();
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Error al guardar la configuración');
        } finally {
            setSaving(false);
        }
    };

    const handleCreateBackup = async () => {
        try {
            const res = await backupAPI.create();
            alert(`Respaldo creado exitosamente: ${res.data.data.filename}`);
        } catch (error) {
            console.error('Error creating backup:', error);
            alert('Error al crear el respaldo');
        }
    };

    const tabs = [
        { id: 'general' as SettingsTab, label: 'General', icon: <SettingsIcon size={18} /> },
        { id: 'company' as SettingsTab, label: 'Empresa', icon: <Building2 size={18} /> },
        { id: 'invoice' as SettingsTab, label: 'Facturación', icon: <FileText size={18} /> },
        { id: 'roles' as SettingsTab, label: 'Roles y Permisos', icon: <Users size={18} /> },
        { id: 'system' as SettingsTab, label: 'Sistema', icon: <Database size={18} /> }
    ];

    if (loading) return <div>Cargando...</div>;

    return (
        <div className="settings-page">
            <div className="page-header">
                <div>
                    <h1>Configuración</h1>
                    <p className="page-subtitle">Configuración global del sistema</p>
                </div>
            </div>

            <div className="settings-tabs">
                {tabs.map(tab => (
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

            <Card>
                <form onSubmit={handleSubmit} className="settings-form">
                    {activeTab === 'general' && (
                        <div className="settings-section">
                            <h3>Configuración General</h3>
                            <Input
                                label="Nombre de la Empresa"
                                value={formData.companyName}
                                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                                placeholder="Mi Restaurante"
                            />
                            <div className="form-row">
                                <Input
                                    label="Tasa de Impuesto (%)"
                                    type="number"
                                    step="0.01"
                                    value={formData.taxRate}
                                    onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })}
                                    placeholder="16"
                                />
                                <Input
                                    label="Símbolo de Moneda"
                                    value={formData.currency_symbol}
                                    onChange={(e) => setFormData({ ...formData, currency_symbol: e.target.value })}
                                    placeholder="$"
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'company' && (
                        <div className="settings-section">
                            <h3>Información de la Empresa</h3>

                            <div className="logo-upload-section">
                                <label className="input-label">Logo de la Empresa</label>
                                <div className="logo-upload-container">
                                    {logoPreview && (
                                        <div className="logo-preview">
                                            <img src={logoPreview} alt="Logo preview" />
                                        </div>
                                    )}
                                    <label className="upload-btn">
                                        <Upload size={18} />
                                        <span>Seleccionar Logo</span>
                                        <input
                                            type="file"
                                            accept=".png,.jpg,.jpeg,.gif,.webp"
                                            onChange={handleLogoChange}
                                            style={{ display: 'none' }}
                                        />
                                    </label>
                                </div>
                            </div>

                            <Input
                                label="NIF / Tax ID"
                                value={formData.nif}
                                onChange={(e) => setFormData({ ...formData, nif: e.target.value })}
                                placeholder="B12345678"
                            />
                            <Input
                                label="Dirección"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Calle Principal #123"
                            />
                            <div className="form-row">
                                <Input
                                    label="Teléfono"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+1 234 567 8900"
                                />
                                <Input
                                    label="Email"
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="contacto@mirestaurante.com"
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'invoice' && (
                        <div className="settings-section">
                            <h3>Configuración de Facturación</h3>
                            <Input
                                label="Prefijo de Factura"
                                value={formData.invoicePrefix}
                                onChange={(e) => setFormData({ ...formData, invoicePrefix: e.target.value })}
                                placeholder="INV"
                            />
                            <div className="input-group">
                                <label className="input-label">Texto de Pie de Página</label>
                                <textarea
                                    className="input"
                                    rows={3}
                                    value={formData.invoiceFooter}
                                    onChange={(e) => setFormData({ ...formData, invoiceFooter: e.target.value })}
                                    placeholder="Gracias por su preferencia"
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label">Términos y Condiciones</label>
                                <textarea
                                    className="input"
                                    rows={4}
                                    value={formData.invoiceTerms}
                                    onChange={(e) => setFormData({ ...formData, invoiceTerms: e.target.value })}
                                    placeholder="Términos y condiciones de venta..."
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'roles' && (
                        <div className="settings-section">
                            <h3>Roles y Permisos</h3>
                            <p className="section-description">
                                Gestiona los roles del sistema y sus permisos asociados.
                                Cada rol puede tener múltiples permisos que determinan qué acciones pueden realizar los usuarios.
                            </p>
                            <Button
                                type="button"
                                variant="primary"
                                onClick={() => navigate('/roles-permissions')}
                            >
                                <Users size={18} />
                                Gestionar Roles y Permisos
                            </Button>
                        </div>
                    )}

                    {activeTab === 'system' && (
                        <div className="settings-section">
                            <h3>Configuración del Sistema</h3>

                            <div className="input-group">
                                <label className="input-label">
                                    <input
                                        type="checkbox"
                                        checked={formData.enablePromotions === 'true'}
                                        onChange={(e) => setFormData({
                                            ...formData,
                                            enablePromotions: e.target.checked ? 'true' : 'false'
                                        })}
                                    />
                                    <span style={{ marginLeft: '8px' }}>Habilitar Sistema de Promociones</span>
                                </label>
                            </div>

                            <h4 style={{ marginTop: '24px' }}>Seguridad</h4>
                            <div className="form-row">
                                <Input
                                    label="Expiración de contraseña (días)"
                                    type="number"
                                    min="0"
                                    value={formData.password_expiry_days}
                                    onChange={(e) => setFormData({ ...formData, password_expiry_days: e.target.value })}
                                    placeholder="90"
                                />
                                <Input
                                    label="Cierre por inactividad (minutos)"
                                    type="number"
                                    min="5"
                                    value={formData.session_timeout_minutes}
                                    onChange={(e) => setFormData({ ...formData, session_timeout_minutes: e.target.value })}
                                    placeholder="30"
                                />
                            </div>
                            <p className="section-description" style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
                                Contraseña 0 = sin expiración. Inactividad mínimo 5 min.
                            </p>

                            <div className="system-actions">
                                <h4>Respaldo de Base de Datos</h4>
                                <p className="section-description">
                                    Genera un respaldo de la base de datos para mantener tus datos seguros.
                                </p>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleCreateBackup}
                                >
                                    <Database size={18} />
                                    Generar Respaldo
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="form-actions">
                        <Button type="submit" variant="primary" disabled={saving}>
                            {saving ? 'Guardando...' : 'Guardar Configuración'}
                        </Button>
                    </div>
                </form>
            </Card>
        </div>
    );
}
