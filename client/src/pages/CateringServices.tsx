import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Pencil, ClipboardList, Search } from 'lucide-react';
import { cateringAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { getUserRoleNames } from '../utils/authz';
import { useCurrency } from '../hooks/useCurrency';
import {
    Badge, Button, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    PageContent, PageHeader, TableToolbar, Textarea, formatNumber, type Column, type Tone,
} from '@/ui';
import styles from './catalog.module.css';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';

interface CateringServiceRow {
    id: number;
    name: string;
    description?: string;
    internalCost: number;
    salePrice: number;
}

const marginPct = (s: { internalCost: number; salePrice: number }) =>
    s.salePrice > 0 ? ((s.salePrice - s.internalCost) / s.salePrice) * 100 : 0;
const marginTone = (pct: number): Tone => (pct >= 50 ? 'success' : pct >= 20 ? 'warning' : 'danger');
export default function CateringServices() {
    const { user } = useAuth();
    const { formatMoney: money } = useCurrency();
    const { confirm } = useConfirmDialog();
    const { warning: showWarning, error: showError } = useAppToast();
    const userRoleNames = getUserRoleNames(user);
    const canManageCatering = userRoleNames.some((role) => ['SUPERADMIN', 'ADMIN'].includes(role));
    const [services, setServices] = useState<CateringServiceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingService, setEditingService] = useState<CateringServiceRow | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        internalCost: '',
        salePrice: ''
    });

    const loadServices = useCallback(async () => {
        try {
            setLoading(true);
            const response = await cateringAPI.getAllServices();
            setServices(response.data.data);
        } catch (error) {
            console.error('Error loading services:', error);
            showError(getApiErrorMessage(error, 'No se pudieron cargar los servicios de catering'));
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadServices();
    }, [loadServices]);

    const handleOpenSidebar = (service?: CateringServiceRow) => {
        if (!canManageCatering) {
            showWarning('No tienes permisos para gestionar servicios de catering');
            return;
        }
        if (service) {
            setEditingService(service);
            setFormData({
                name: service.name,
                description: service.description || '',
                internalCost: service.internalCost.toString(),
                salePrice: service.salePrice.toString()
            });
        } else {
            setEditingService(null);
            setFormData({
                name: '',
                description: '',
                internalCost: '',
                salePrice: ''
            });
        }
        setIsSidebarOpen(true);
    };

    const handleSave = async () => {
        if (saving) return;
        if (!canManageCatering) {
            showWarning('No tienes permisos para guardar servicios');
            return;
        }
        if (!formData.name.trim()) {
                showError('El nombre del servicio es obligatorio.');
            return;
        }
        const internalCost = Number(formData.internalCost);
        const salePrice = Number(formData.salePrice);
        if (
            formData.internalCost.trim() === '' ||
            formData.salePrice.trim() === '' ||
            !Number.isFinite(internalCost) ||
            !Number.isFinite(salePrice) ||
            internalCost < 0 ||
            salePrice < 0
        ) {
            showError('Ingresa costos y precios válidos, mayores o iguales a cero.');
            return;
        }
        try {
            setSaving(true);
            const data = {
                ...formData,
                internalCost: parseFloat(formData.internalCost) || 0,
                salePrice: parseFloat(formData.salePrice) || 0
            };

            if (editingService) {
                await cateringAPI.updateService(editingService.id, data);
            } else {
                await cateringAPI.createService(data);
            }

            loadServices();
            setIsSidebarOpen(false);
        } catch (error) {
            console.error('Error saving service:', error);
            showError(getApiErrorMessage(error, 'No se pudo guardar el servicio de catering'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: number) => {
        if (!canManageCatering) {
            showWarning('No tienes permisos para eliminar servicios');
            return;
        }
        if (!(await confirm('¿Está seguro de eliminar este servicio del catálogo?', { title: 'Confirmar acción' }))) return;
        try {
            await cateringAPI.deleteService(id);
            loadServices();
        } catch (error) {
            console.error('Error deleting service:', error);
            notifyError(error, 'No se pudo eliminar el servicio de catering');
        }
    };

    const filteredServices = services.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const draftCost = parseFloat(formData.internalCost) || 0;
    const draftPrice = parseFloat(formData.salePrice) || 0;
    const draftMargin = draftPrice > 0 ? ((draftPrice - draftCost) / draftPrice) * 100 : null;

    const columns: Column<CateringServiceRow>[] = [
        {
            key: 'name',
            header: 'Servicio',
            render: (s) => (
                <div className={styles.cellStack}>
                    <span className={styles.cellTitle}>{s.name}</span>
                    {s.description && <span className={styles.muted}>{s.description}</span>}
                </div>
            )
        },
        { key: 'cost', header: 'Costo', type: 'money', render: (s) => money(s.internalCost) },
        { key: 'sale', header: 'Venta', type: 'money', render: (s) => money(s.salePrice) },
        {
            key: 'margin',
            header: 'Margen',
            type: 'percent',
            render: (s) => {
                const m = marginPct(s);
                return <Badge tone={marginTone(m)}>{formatNumber(m, 1)} %</Badge>;
            }
        },
        ...(canManageCatering ? [{
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (s: CateringServiceRow) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} label={`Editar ${s.name}`} tooltip="Editar" onClick={() => handleOpenSidebar(s)} />
                    <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" label={`Eliminar ${s.name}`} onClick={() => handleDelete(s.id)} />
                </div>
            )
        }] : [])
    ] as Column<CateringServiceRow>[];

    return (
        <PageContent>
            <PageHeader
                title="Catálogo de servicios"
                description="Gestiona servicios, costos y precios de catering"
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()} disabled={!canManageCatering}>
                        Nuevo servicio
                    </Button>
                )}
            />

            <DataTable<CateringServiceRow>
                ariaLabel="Servicios de catering"
                rows={filteredServices}
                rowKey={(s) => s.id}
                columns={columns}
                loading={loading}
                resetKey={searchQuery}
                onRowClick={canManageCatering ? (s) => handleOpenSidebar(s) : undefined}
                empty={<EmptyState icon={ClipboardList} title="No hay servicios registrados en el catálogo" />}
                toolbar={(
                    <TableToolbar>
                        <Input
                            type="search"
                            aria-label="Buscar en el catálogo"
                            placeholder="Buscar en el catálogo"
                            prefix={<Search size={14} aria-hidden="true" />}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </TableToolbar>
                )}
            />

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingService ? `Editar: ${editingService.name}` : 'Nuevo servicio de catering'}
                breadcrumb={['Catering', 'Servicios']}
                aside={(
                    <div className={styles.summary} aria-label="Resumen del servicio">
                        <h3>Resumen</h3>
                        <div className={styles.summaryRow}><span>Costo</span><strong>{money(draftCost)}</strong></div>
                        <div className={styles.summaryRow}><span>Precio de venta</span><strong>{money(draftPrice)}</strong></div>
                        <div className={styles.summaryRow}><span>Utilidad</span><strong>{money(draftPrice - draftCost)}</strong></div>
                        <div className={styles.summaryRow}>
                            <span>Margen</span>
                            <strong>{draftMargin === null ? '—' : `${formatNumber(draftMargin, 1)} %`}</strong>
                        </div>
                    </div>
                )}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="catering-service-form" loading={saving} disabled={!canManageCatering}>
                            {editingService ? 'Guardar cambios' : 'Guardar servicio'}
                        </Button>
                    </>
                )}
            >
                <form
                    id="catering-service-form"
                    className={styles.stack}
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleSave();
                    }}
                >
                    <FormSection step={1} title="Información general" description="Cómo aparece el servicio en las cotizaciones.">
                        <Field label="Nombre del servicio" htmlFor="catering-service-name" required>
                            <Input
                                id="catering-service-name"
                                placeholder="Ej: Servicio de Mesoneros Premium"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                autoComplete="off"
                                required
                            />
                        </Field>
                        <Field label="Descripción / detalles" htmlFor="catering-service-description">
                            <Textarea
                                id="catering-service-description"
                                rows={4}
                                placeholder="Describa qué incluye este servicio..."
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                            />
                        </Field>
                    </FormSection>

                    <FormSection step={2} title="Costos y precios" description="El margen se recalcula al instante en el resumen.">
                        <FormGrid>
                            <Field label="Costo interno" htmlFor="catering-service-cost" required>
                                <Input
                                    id="catering-service-cost"
                                    type="number"
                                    className="ui-input--number"
                                    placeholder="0.00"
                                    value={formData.internalCost}
                                    onChange={e => setFormData({ ...formData, internalCost: e.target.value })}
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    required
                                />
                            </Field>
                            <Field label="Precio de venta" htmlFor="catering-service-price" required>
                                <Input
                                    id="catering-service-price"
                                    type="number"
                                    className="ui-input--number"
                                    placeholder="0.00"
                                    value={formData.salePrice}
                                    onChange={e => setFormData({ ...formData, salePrice: e.target.value })}
                                    min="0"
                                    step="0.01"
                                    inputMode="decimal"
                                    required
                                />
                            </Field>
                        </FormGrid>
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
