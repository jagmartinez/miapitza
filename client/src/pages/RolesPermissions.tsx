import { useState, useEffect } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { rolesAPI, permissionsAPI } from '../services/api';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { describePermission } from '../utils/permissionCatalog';
import styles from './RolesPermissions.module.css';
import { Button, Checkbox, DataTable, Field, FormSection, FullScreenModal, IconButton, Input, PageHeader, Textarea, type Column } from '@/ui';

interface PermissionRow {
    id: number;
    name: string;
    description?: string | null;
}

interface RoleRow {
    id: number;
    name: string;
    description?: string | null;
    permissions?: PermissionRow[];
    _count?: { users: number };
}

export default function RolesPermissions() {
    const { user } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const isSuperAdmin = hasAnyRole(user, ['SUPERADMIN']);

    const [roles, setRoles] = useState<RoleRow[]>([]);
    const [permissions, setPermissions] = useState<PermissionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingRole, setEditingRole] = useState<RoleRow | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        permissionIds: [] as number[]
    });

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        try {
            const [rolesRes, permissionsRes] = await Promise.all([
                rolesAPI.getAll(),
                permissionsAPI.getAll()
            ]);
            setRoles(rolesRes.data.data);
            setPermissions(permissionsRes.data.data);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar los roles y permisos');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenSidebar = (role?: RoleRow) => {
        if (role) {
            setEditingRole(role);
            setFormData({
                name: role.name,
                description: role.description || '',
                permissionIds: role.permissions?.map((p) => p.id) || []
            });
        } else {
            setEditingRole(null);
            setFormData({ name: '', description: '', permissionIds: [] });
        }
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingRole) {
                await rolesAPI.update(editingRole.id, formData);
            } else {
                await rolesAPI.create(formData);
            }
            setIsSidebarOpen(false);
            loadData();
        } catch (error) {
            console.error('Error saving role:', error);
            showError(getApiErrorMessage(error, 'Error al guardar el rol'));
        }
    };

    const handleDelete = async (id: number) => {
        if (!isSuperAdmin) {
            showWarning('Solo un superadministrador puede eliminar roles.');
            return;
        }
        if (!(await confirm('¿Estás seguro de eliminar este rol?', { title: 'Confirmar acción' }))) return;
        try {
            await rolesAPI.delete(id);
            loadData();
        } catch (error: unknown) {
            const msg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(msg || 'Error al eliminar el rol');
        }
    };

    const togglePermission = (permissionId: number) => {
        setFormData(prev => ({
            ...prev,
            permissionIds: prev.permissionIds.includes(permissionId)
                ? prev.permissionIds.filter(id => id !== permissionId)
                : [...prev.permissionIds, permissionId]
        }));
    };

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ui-text-muted)' }}>Cargando...</div>;

    const columns: Column<RoleRow>[] = [
        {
            key: 'name',
            header: 'Rol',
            render: (role) => (
                <div>
                    <strong>{role.name}</strong>
                    <div className={styles.muted}>{role.description || 'Sin descripción'}</div>
                </div>
            ),
        },
        { key: 'users', header: 'Usuarios', type: 'number', decimals: 0, render: (role) => role._count?.users || 0 },
        { key: 'permissions', header: 'Permisos', type: 'number', decimals: 0, render: (role) => role.permissions?.length || 0 },
        {
            key: 'summary',
            header: 'Capacidades',
            render: (role) => {
                const list = role.permissions || [];
                if (list.length === 0) return <span className={styles.muted}>Sin permisos asignados</span>;
                return (
                    <div className={styles.badges}>
                        {list.slice(0, 3).map((perm) => (
                            <span key={perm.id} className={styles.badge} title={perm.name}>{describePermission(perm.name, perm.description).label}</span>
                        ))}
                        {list.length > 3 && <span className={styles.badge}>+{list.length - 3} más</span>}
                    </div>
                );
            },
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (role) => (
                <div className={styles.actions}>
                    <IconButton size="sm" icon={Pencil} tooltip="Editar" onClick={() => handleOpenSidebar(role)} label={`Editar ${role.name}`} />
                    {isSuperAdmin && (
                        <IconButton size="sm" icon={Trash2} tone="danger" tooltip="Eliminar" onClick={() => handleDelete(role.id)} label={`Eliminar ${role.name}`} />
                    )}
                </div>
            ),
        },
    ];

    return (
        <div>
            <PageHeader
                title="Roles y Permisos"
                description="Gestiona los roles del sistema y sus capacidades"
                actions={(
                    <Button variant="primary" onClick={() => handleOpenSidebar()}>
                        <Plus size={18} /> Nuevo Rol
                    </Button>
                )}
            />

            <DataTable<RoleRow>
                columns={columns}
                rows={roles}
                rowKey={(role) => role.id}
                ariaLabel="Listado de roles"
                pagination={{ mode: 'client' }}
            />

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingRole ? 'Editar Rol' : 'Nuevo Rol'}
                footer={
                    <>
                        <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                            Cancelar
                        </Button>
                        <Button variant="primary" type="submit" form="role-form">
                            {editingRole ? 'Actualizar Rol' : 'Crear Rol'}
                        </Button>
                    </>
                }
            >
                <form id="role-form" onSubmit={handleSubmit}>
                    <FormSection title="Datos del rol">
                        <Field label="Nombre del rol" htmlFor="role-name" required>
                            <Input
                                id="role-name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Ej: ADMIN, MESERO..."
                                required
                            />
                        </Field>
                        <Field label="Descripción" htmlFor="role-description">
                            <Textarea
                                id="role-description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Describe las responsabilidades del rol..."
                            />
                        </Field>
                    </FormSection>

                    <FormSection title="Permisos" description={`${formData.permissionIds.length} seleccionados`}>
                        {permissions.length === 0 ? (
                            <p className={styles.muted}>No hay permisos registrados en el sistema</p>
                        ) : (
                            <div className={styles.permList}>
                                {permissions.map((perm) => {
                                    const presentation = describePermission(perm.name, perm.description);
                                    return (
                                        <div key={perm.id} className={styles.permItem}>
                                            <Checkbox
                                                label={<strong>{presentation.label}</strong>}
                                                checked={formData.permissionIds.includes(perm.id)}
                                                onChange={() => togglePermission(perm.id)}
                                            />
                                            <div className={styles.muted}>{presentation.description}</div>
                                            <div className={styles.muted} title="Código técnico del permiso">Código: {perm.name}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </FormSection>
                </form>
            </FullScreenModal>
        </div>
    );
}
