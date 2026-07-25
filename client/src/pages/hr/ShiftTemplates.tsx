import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock3, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/Button';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';
import Sidebar from '../../components/Sidebar';
import {
    ShiftTemplateCatalog,
    ShiftTemplateForm,
    type ShiftTemplateFormValues,
} from '../../components/hr/ShiftTemplateCatalog';
import { getScheduleErrorMessage, scheduleClient } from '../../components/hr/scheduleClient';
import { ROLES, HR_OWNER } from '../../constants/roles';
import { useConfirmDialog } from '../../context/ConfirmContext';
import { useAppToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import type { HrShiftTemplate, HrShiftTemplateCreatePayload } from '../../types/hr-schedule';
import { getUserRoleNames, hasPermission } from '../../utils/authz';
import './shift-templates.css';

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

    return (
        <div className="page-wrapper hr-shift-templates-page">
            <PageHeader
                title="Jornadas configuradas"
                subtitle={`${templates.length} ${templates.length === 1 ? 'jornada reutilizable' : 'jornadas reutilizables'} para asignar en Horarios`}
                icon={Clock3}
                actions={(
                    <div className="hr-template-page-actions">
                        <Button variant="ghost" onClick={() => navigate('/rh/horarios')} disabled={busy}>
                            <ArrowLeft size={17} aria-hidden="true" /> Volver a horarios
                        </Button>
                        <Button variant="ghost" onClick={() => void load()} disabled={loading || busy}>
                            <RefreshCw size={17} aria-hidden="true" /> Actualizar
                        </Button>
                        {canManage && <Button onClick={openCreate} disabled={loading || busy}><Plus size={17} aria-hidden="true" /> Nueva jornada</Button>}
                    </div>
                )}
            />

            <div className="hr-template-status-filter" role="group" aria-label="Filtrar jornadas por estado">
                <button type="button" aria-pressed={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} disabled={busy}>Todas</button>
                <button type="button" aria-pressed={statusFilter === 'ACTIVE'} onClick={() => setStatusFilter('ACTIVE')} disabled={busy}>Activas</button>
                <button type="button" aria-pressed={statusFilter === 'INACTIVE'} onClick={() => setStatusFilter('INACTIVE')} disabled={busy}>Inactivas</button>
            </div>

            {loading && <LoadingSpinner text="Cargando jornadas configuradas…" />}
            {!loading && loadError && (
                <div className="state-placeholder" role="alert">
                    <AlertTriangle size={42} aria-hidden="true" />
                    <p className="state-error">{loadError}</p>
                    <Button variant="ghost" onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /> Reintentar</Button>
                </div>
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

            <Sidebar
                isOpen={editorOpen}
                onClose={closeEditor}
                title={editingTemplate ? 'Editar jornada' : 'Nueva jornada'}
                width="normal"
                closeOnBackdrop={!saving}
                closeOnEscape={!saving}
            >
                <ShiftTemplateForm
                    template={editingTemplate}
                    saving={saving}
                    error={editorError}
                    onCancel={closeEditor}
                    onSubmit={saveTemplate}
                />
            </Sidebar>
        </div>
    );
}
