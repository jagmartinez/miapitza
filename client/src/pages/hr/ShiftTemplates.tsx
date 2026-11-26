import { type ComponentProps, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock3, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, FullScreenModal } from '@/ui';
import LoadingSpinner from '../../components/LoadingSpinner';
import {
    ShiftTemplateCatalog,
    ShiftTemplateForm,
    type ShiftTemplateFormValues,
} from '../../components/hr/ShiftTemplateCatalog';
import { HrHero, HrPage, HrTabs, type HrFact, type HrTabItem, HrTablePanel, HrPanelState } from '../../components/hr/layout/HrWorkspace';
import { getScheduleErrorMessage, scheduleClient } from '../../components/hr/scheduleClient';
import { ROLES, HR_OWNER } from '../../constants/roles';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import type { HrShiftTemplate, HrShiftTemplateCreatePayload } from '../../types/hr-schedule';
import { getUserRoleNames, hasPermission } from '../../utils/authz';
import './shift-templates.css';
import './layouts/horarios.css';

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type MutationKind = 'save' | 'status';

function payloadFor(
    values: ShiftTemplateFormValues,
): HrShiftTemplateCreatePayload {
    return {
        name: values.name,
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: values.breakMinutes,
        notes: values.notes,
        color: values.color,
    };
}

// lucide 0.294 icons carry propTypes that do not match the kit's icon prop type.
const HERO_ICON = Clock3 as unknown as NonNullable<ComponentProps<typeof HrHero>['icon']>;

export default function ShiftTemplates() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { success: showSuccess, error: showError } = useAppToast();
    const [templates, setTemplates] = useState<HrShiftTemplate[]>([]);
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mutationKind, setMutationKind] = useState<MutationKind | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<HrShiftTemplate | null>(null);
    const [editorError, setEditorError] = useState<string | null>(null);

    const roleNames = getUserRoleNames(user);
    const hasCompanyWideRole = roleNames.includes(ROLES.SUPERADMIN) || roleNames.includes(ROLES.ADMIN);
    const canManage = hasCompanyWideRole && hasPermission(user, 'hr.schedule.manage', HR_OWNER);
    const busy = mutationKind !== null;
    const saving = mutationKind === 'save';
    const visibleTemplates = useMemo(
        () => templates.filter((template) =>
            statusFilter === 'ALL' ||
            (statusFilter === 'ACTIVE' ? template.active !== false : template.active === false)
        ),
        [statusFilter, templates],
    );

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            setTemplates(await scheduleClient.getShiftTemplates());
        } catch (error) {
            setTemplates([]);
            setLoadError(getScheduleErrorMessage(error, 'No fue posible cargar las jornadas configuradas.'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const openCreate = () => {
        if (!canManage || busy) return;
        setEditingTemplate(null);
        setEditorError(null);
        setEditorOpen(true);
    };

    const openEdit = (template: HrShiftTemplate) => {
        if (!canManage || busy) return;
        setEditingTemplate(template);
        setEditorError(null);
        setEditorOpen(true);
    };

    const closeEditor = () => {
        if (saving) return;
        setEditorOpen(false);
        setEditingTemplate(null);
        setEditorError(null);
    };

    const refreshAfterMutation = async (saved: HrShiftTemplate) => {
        try {
            setTemplates(await scheduleClient.getShiftTemplates());
            setLoadError(null);
        } catch {
            setTemplates((current) => [
                ...current.filter((template) => template.id !== saved.id),
                saved,
            ].sort((left, right) => left.name.localeCompare(right.name, 'es')));
            showError('La jornada fue guardada, pero no fue posible refrescar el catálogo completo.');
        }
    };

    const saveTemplate = async (values: ShiftTemplateFormValues) => {
        if (busy) return;
        setMutationKind('save');
        setEditorError(null);
        try {
            const payload = payloadFor(values);
            const saved = editingTemplate
                ? await scheduleClient.updateShiftTemplate(editingTemplate.id, {
                    ...payload,
                    expectedRevision: editingTemplate.revision,
                })
                : await scheduleClient.createShiftTemplate(payload);
            await refreshAfterMutation(saved);
            showSuccess(editingTemplate ? 'Jornada actualizada.' : 'Jornada creada.');
            setEditorOpen(false);
            setEditingTemplate(null);
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status === 409 && editingTemplate) {
                try {
                    const latest = await scheduleClient.getShiftTemplates();
                    setTemplates(latest);
                    setEditingTemplate(latest.find((template) => template.id === editingTemplate.id) ?? editingTemplate);
                    setEditorError('Otra persona modificó esta jornada. Recargamos la versión vigente; revisa los datos antes de guardar otra vez.');
                } catch {
                    setEditorError('Otra persona modificó esta jornada y no fue posible recargarla. Cierra el editor y vuelve a intentarlo.');
                }
            } else {
                setEditorError(getScheduleErrorMessage(error, 'No fue posible guardar la jornada.'));
            }
        } finally {
            setMutationKind(null);
        }
    };

    const toggleActive = async (template: HrShiftTemplate) => {
        if (busy) return;
        const activating = template.active === false;
        if (!activating) {
            const accepted = await confirm(
                'La jornada dejará de estar disponible para nuevas asignaciones. Los horarios ya guardados conservarán su información.',
                { title: `Desactivar ${template.name}`, confirmText: 'Desactivar', variant: 'warning' },
            );
            if (!accepted) return;
        }
        setMutationKind('status');
        try {
            const saved = await scheduleClient.setShiftTemplateActive(template.id, activating, template.revision);
            await refreshAfterMutation(saved);
            showSuccess(activating ? 'Jornada reactivada.' : 'Jornada desactivada.');
        } catch (error) {
            const status = (error as { response?: { status?: number } })?.response?.status;
            if (status === 409) {
                try {
                    setTemplates(await scheduleClient.getShiftTemplates());
                    showError('La jornada cambió mientras realizabas la acción. El catálogo fue recargado.');
                } catch {
                    showError('La jornada cambió y no fue posible recargar el catálogo.');
                }
            } else {
                showError(getScheduleErrorMessage(error, 'No fue posible cambiar el estado de la jornada.'));
            }
        } finally {
            setMutationKind(null);
        }
    };

    const activeCount = templates.filter((template) => template.active !== false).length;
    const inactiveCount = templates.length - activeCount;
    const overnightCount = templates.filter((template) => template.crossesMidnight).length;
    const companyWideCount = templates.filter((template) => template.branchId === null).length;
    const ready = !loading && !loadError;
    const heroFacts: HrFact[] = [
        { label: 'Jornadas', value: ready ? templates.length : '—', hint: 'En el catálogo' },
        { label: 'Activas', value: ready ? activeCount : '—', hint: 'Disponibles para asignar', tone: ready && activeCount > 0 ? 'success' : 'default' },
        { label: 'Inactivas', value: ready ? inactiveCount : '—', hint: 'Solo histórico', tone: ready && inactiveCount > 0 ? 'warning' : 'default' },
        { label: 'Cruzan medianoche', value: ready ? overnightCount : '—', hint: 'Terminan al día siguiente' },
        { label: 'Todas las sucursales', value: ready ? companyWideCount : '—', hint: 'Sin sucursal fija', tone: 'accent' },
    ];
    const statusTabs: HrTabItem<StatusFilter>[] = [
        { key: 'ALL', label: 'Todas', count: templates.length },
        { key: 'ACTIVE', label: 'Activas', count: activeCount },
        { key: 'INACTIVE', label: 'Inactivas', count: inactiveCount },
    ];

    return (
        <HrPage className="hr-shift-templates-page hr-hz-page hr-hz-templates">
            <HrHero
                eyebrow="Recursos humanos"
                icon={HERO_ICON}
                title="Jornadas configuradas"
                subtitle={`${templates.length} ${templates.length === 1 ? 'jornada reutilizable' : 'jornadas reutilizables'} para asignar en Horarios`}
                actions={(
                    <>
                        <Button variant="ghost" onClick={() => navigate('/rh/horarios')} disabled={busy}>
                            <ArrowLeft size={17} aria-hidden="true" /> Volver a horarios
                        </Button>
                        <Button variant="ghost" onClick={() => void load()} disabled={loading || busy}>
                            <RefreshCw size={17} aria-hidden="true" /> Actualizar
                        </Button>
                        {canManage && <Button variant="primary" onClick={openCreate} disabled={loading || busy}><Plus size={17} aria-hidden="true" /> Nueva jornada</Button>}
                    </>
                )}
                facts={heroFacts}
            />

            <div className={`hr-hz-status-tabs${busy ? ' is-busy' : ''}`} aria-busy={busy || undefined}>
                <HrTabs<StatusFilter>
                    items={statusTabs}
                    active={statusFilter}
                    onChange={(key) => { if (!busy) setStatusFilter(key); }}
                    ariaLabel="Filtrar jornadas por estado"
                    idPrefix="hr-shift-templates"
                />
            </div>

            <HrTablePanel
                id={`hr-shift-templates-panel-${statusFilter.toLowerCase()}`}
                role="tabpanel"
                aria-labelledby={`hr-shift-templates-tab-${statusFilter.toLowerCase()}`}
                className="hr-hz-catalog"
            >
                {loading && <HrPanelState><LoadingSpinner text="Cargando jornadas configuradas…" /></HrPanelState>}
                {!loading && loadError && (
                    <HrPanelState role="alert">
                        <AlertTriangle size={42} aria-hidden="true" />
                        <p className="state-error">{loadError}</p>
                        <Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /> Reintentar</Button>
                    </HrPanelState>
                )}
                {!loading && !loadError && (
                    <ShiftTemplateCatalog
                        templates={visibleTemplates}
                        canManage={canManage}
                        disabled={busy}
                        onCreate={openCreate}
                        onEdit={openEdit}
                        onToggleActive={(template) => void toggleActive(template)}
                    />
                )}
            </HrTablePanel>

            <FullScreenModal
                isOpen={editorOpen}
                onClose={closeEditor}
                title={editingTemplate ? 'Editar jornada' : 'Nueva jornada'}
            >
                <ShiftTemplateForm
                    template={editingTemplate}
                    saving={saving}
                    error={editorError}
                    onCancel={closeEditor}
                    onSubmit={saveTemplate}
                />
            </FullScreenModal>
        </HrPage>
    );
}
