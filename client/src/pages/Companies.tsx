import { useState, useEffect } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { companiesAPI } from '../services/api';
import { Plus, Building2, Pencil, Power, FileText, Search } from 'lucide-react';
import { useAppToast } from '../context/ToastContext';
import { resolveAssetUrl } from '../utils/assets';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, SegmentedControl, TableToolbar, Textarea, type Column,
} from '@/ui';

type StatusFilter = 'all' | 'active' | 'inactive';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'active', label: 'Activas' },
    { value: 'inactive', label: 'Inactivas' },
];

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
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState('');
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
            notifyError(error, 'No se pudieron cargar las empresas');
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
            showError(getApiErrorMessage(error, 'Error al guardar la empresa'));
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (company: Company) => {
        try {
            await companiesAPI.update(company.id, { active: !company.active });
            loadCompanies();
        } catch (error) {
            notifyError(error, 'No se pudo cambiar el estado de la empresa');
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

    const q = search.trim().toLowerCase();
    const filteredCompanies = companies.filter((c) => {
        if (statusFilter === 'active' && !c.active) return false;
        if (statusFilter === 'inactive' && c.active) return false;
        return !q || c.name.toLowerCase().includes(q) || (c.ruc ?? '').toLowerCase().includes(q);
    });

    const columns: Column<Company>[] = [
        {
            key: 'name',
            header: 'Empresa',
            render: (c) => (
                <span className={styles.cellTitle}>
                    {c.logo
                        ? <img src={resolveAssetUrl(c.logo)} alt="" width={24} height={24} style={{ objectFit: 'contain', borderRadius: 4 }} />
                        : <Building2 size={16} aria-hidden="true" />}
                    <span className={styles.cellStack}>
                        <span>{c.name}</span>
                        <span className={styles.muted}>RUC: {c.ruc || 'No registrado'}</span>
                    </span>
                </span>
            )
        },
        { key: 'branches', header: 'Sucursales', type: 'number', decimals: 0, accessor: (c) => c._count?.branches || 0 },
        { key: 'users', header: 'Usuarios', type: 'number', decimals: 0, accessor: (c) => c._count?.users || 0 },
        {
            key: 'taxRegime',
            header: 'Perfil fiscal',
            render: (c) => (
                <div className={styles.cellStack}>
                    <span>{TAX_REGIMES.find((item) => item.value === c.payrollTaxRegime)?.label ?? c.payrollTaxRegime}</span>
                    {!c.payrollTaxProfileReady
                        ? <Badge tone="warning">Perfil fiscal pendiente</Badge>
                        : <span className={styles.muted}>{c.payrollIncomeTaxWithholding ? 'Retiene IR laboral' : 'No retiene IR laboral'}</span>}
                </div>
            )
        },
        {
            key: 'status',
            header: 'Estado',
            render: (c) => <Badge tone={c.active ? 'success' : 'neutral'} dot>{c.active ? 'Activa' : 'Inactiva'}</Badge>
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (c) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} label={`Editar ${c.name}`} tooltip="Editar" onClick={() => openModal(c)} />
                    <IconButton
                        size="sm"
                        icon={Power}
                        tone={c.active ? 'danger' : 'primary'}
                        tooltip={c.active ? 'Desactivar' : 'Activar'}
                        label={`${c.active ? 'Desactivar' : 'Activar'} ${c.name}`}
                        onClick={() => toggleActive(c)}
                    />
                </div>
            )
        }
    ] as Column<Company>[];

    return (
        <PageContent>
            <PageHeader
                title="Empresas"
                description={`${companies.filter((c) => c.active).length} activas · ${companies.length} registradas`}
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                        Nueva empresa
                    </Button>
                )}
            />

            <DataTable<Company>
                ariaLabel="Listado de empresas"
                rows={filteredCompanies}
                rowKey={(c) => c.id}
                columns={columns}
                loading={loading}
                resetKey={`${statusFilter}|${q}`}
                onRowClick={(c) => openModal(c)}
                empty={companies.length === 0 ? (
                    <EmptyState
                        icon={Building2}
                        title="No hay empresas registradas"
                        action={<Button variant="primary" onClick={() => openModal()}>Crear primera empresa</Button>}
                    />
                ) : 'No hay empresas con este filtro.'}
                toolbar={(
                    <TableToolbar>
                        <Input
                            type="search"
                            aria-label="Buscar empresa"
                            placeholder="Buscar por nombre o RUC"
                            prefix={<Search size={14} aria-hidden="true" />}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <SegmentedControl ariaLabel="Estado" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={isModalOpen}
                onClose={closeModal}
                title={editingCompany ? 'Editar empresa' : 'Nueva empresa'}
                breadcrumb={['Configuración', 'Empresas']}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="company-form" loading={saving}>
                            {editingCompany ? 'Guardar cambios' : 'Crear empresa'}
                        </Button>
                    </>
                )}
            >
                <form id="company-form" onSubmit={handleSubmit} className={styles.stack}>
                    <FormSection step={1} title="Información general">
                        <FormGrid>
                            <Field label="Nombre de la empresa" htmlFor="company-name" required>
                                <Input
                                    id="company-name"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ej: Restaurante Mi Casa"
                                    required
                                    autoFocus
                                />
                            </Field>
                            <Field label="RUC (Registro Único de Contribuyente)" htmlFor="company-ruc">
                                <Input
                                    id="company-ruc"
                                    prefix={<FileText size={14} aria-hidden="true" />}
                                    value={formData.ruc}
                                    onChange={e => setFormData({ ...formData, ruc: e.target.value })}
                                    placeholder="Ej: J0310000123456"
                                />
                            </Field>
                            {editingCompany && (
                                <Field label="Estado de la empresa" htmlFor="company-active">
                                    <AppSelect
                                        isClearable={false}
                                        isSearchable={false}
                                        inputId="company-active"
                                        options={[
                                            { value: 'true', label: 'Activa' },
                                            { value: 'false', label: 'Inactiva' }
                                        ]}
                                        value={formData.active ? 'true' : 'false'}
                                        onChange={(v) => setFormData({ ...formData, active: v === 'true' })}
                                    />
                                </Field>
                            )}
                        </FormGrid>
                    </FormSection>

                    <FormSection
                        step={2}
                        title="Perfil fiscal para nómina"
                        description="Se administra aquí. Cada nueva versión legal toma estos datos y conserva una copia para auditoría."
                    >
                        <FormGrid>
                            <Field label="Régimen tributario registrado" htmlFor="company-tax-regime">
                                <AppSelect
                                    inputId="company-tax-regime"
                                    isClearable={false}
                                    options={TAX_REGIMES}
                                    value={formData.payrollTaxRegime ?? null}
                                    onChange={(value) => {
                                        if (!value) return;
                                        const stopsWithholding = ['SIMPLIFIED_FIXED_QUOTA', 'EXEMPT'].includes(value);
                                        setFormData({
                                            ...formData,
                                            payrollTaxRegime: value as TaxRegime,
                                            payrollIncomeTaxWithholding: stopsWithholding ? false : formData.payrollIncomeTaxWithholding,
                                            payrollIncomeTaxException: formData.payrollIncomeTaxException,
                                        });
                                    }}
                                />
                            </Field>
                            <Field label="Retención de IR laboral" htmlFor="company-ir-withholding">
                                <AppSelect
                                    inputId="company-ir-withholding"
                                    isClearable={false}
                                    options={[
                                        { value: 'true', label: 'Sí, la empresa retiene IR laboral' },
                                        { value: 'false', label: 'No retiene IR laboral' },
                                    ]}
                                    value={formData.payrollIncomeTaxWithholding ? 'true' : 'false'}
                                    onChange={(value) => setFormData({
                                        ...formData,
                                        payrollIncomeTaxWithholding: value === 'true',
                                        payrollIncomeTaxException: value === 'true' ? '' : formData.payrollIncomeTaxException,
                                    })}
                                />
                            </Field>
                            <Field label="Referencia o respaldo fiscal" htmlFor="company-tax-reference" required>
                                <Input
                                    id="company-tax-reference"
                                    value={formData.payrollTaxRegimeReference}
                                    onChange={(event) => setFormData({ ...formData, payrollTaxRegimeReference: event.target.value })}
                                    placeholder="Constancia DGI, resolución o referencia verificable"
                                    maxLength={500}
                                    required
                                />
                            </Field>
                        </FormGrid>
                        {!formData.payrollIncomeTaxWithholding && (
                            <Field label="Fundamento para no retener IR laboral" htmlFor="company-tax-exception" required>
                                <Textarea
                                    id="company-tax-exception"
                                    rows={3}
                                    value={formData.payrollIncomeTaxException}
                                    onChange={(event) => setFormData({ ...formData, payrollIncomeTaxException: event.target.value })}
                                    placeholder="Resolución, excepción o justificación fiscal aplicable"
                                    minLength={3}
                                    maxLength={500}
                                    required
                                />
                            </Field>
                        )}
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
