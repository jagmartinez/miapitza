import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, FullScreenModal, LoadErrorState, PageContent, PageHeader, SegmentedControl, TableToolbar } from '@/ui';
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
    const statusOptions: { value: StatusFilter; label: string }[] = [
        { value: 'ALL', label: `Todas (${templates.length})` },
        { value: 'ACTIVE', label: `Activas (${activeCount})` },
        { value: 'INACTIVE', label: `Inactivas (${inactiveCount})` },
    ];

    return (
        <PageContent>
            <PageHeader
                breadcrumb={['Recursos humanos', 'Horarios']}
                title="Jornadas configuradas"
                description={`${templates.length} ${templates.length === 1 ? 'jornada reutilizable' : 'jornadas reutilizables'} para asignar en Horarios`}
                actions={(
                    <>
                        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/rh/horarios')} disabled={busy}>Volver a horarios</Button>
                        <Button variant="ghost" icon={RefreshCw} onClick={() => void load()} disabled={loading || busy}>Actualizar</Button>
                        {canManage && <Button variant="primary" icon={Plus} onClick={openCreate} disabled={loading || busy}>Nueva jornada</Button>}
                    </>
                )}
            />

            {!loading && loadError ? (
                <LoadErrorState message={loadError} onRetry={() => void load()} />
            ) : (
                <ShiftTemplateCatalog
                    templates={visibleTemplates}
                    canManage={canManage}
                    disabled={busy}
                    loading={loading}
                    onCreate={openCreate}
                    onEdit={openEdit}
                    onToggleActive={(template) => void toggleActive(template)}
                    toolbar={(
                        <TableToolbar>
                            <SegmentedControl<StatusFilter>
                                ariaLabel="Filtrar jornadas por estado"
                                options={statusOptions}
                                value={statusFilter}
                                onChange={(key) => { if (!busy) setStatusFilter(key); }}
                            />
                        </TableToolbar>
                    )}
                />
            )}

            <FullScreenModal
                isOpen={editorOpen}
                onClose={closeEditor}
                breadcrumb={['Recursos humanos', 'Jornadas configuradas']}
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
        </PageContent>
    );
}
