import { useState, useEffect } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notifyError } from '../services/notify';
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { rolesAPI, permissionsAPI } from '../services/api';
import { Plus, Pencil, Trash2, Search, ShieldCheck } from 'lucide-react';
import { describePermission } from '../utils/permissionCatalog';
import styles from './RolesPermissions.module.css';
import {
    Badge, Button, Checkbox, DataTable, EmptyState, Field, FormSection, FullScreenModal, IconButton, Input, LoadErrorState,
    PageContent, PageHeader, TableToolbar, Textarea, type Column,
} from '@/ui';

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
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [permSearch, setPermSearch] = useState('');
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
            setLoadError(null);
            const [rolesRes, permissionsRes] = await Promise.all([
                rolesAPI.getAll(),
                permissionsAPI.getAll()
            ]);
            setRoles(rolesRes.data.data);
            setPermissions(permissionsRes.data.data);
        } catch (error) {
            notifyError(error, 'No se pudieron cargar los roles y permisos');
            setLoadError(getApiErrorMessage(error, 'No se pudieron cargar los roles y permisos'));
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
        setPermSearch('');
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
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
        } finally {
            setSaving(false);
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

    const q = search.trim().toLowerCase();
    const filteredRoles = roles.filter((role) => !q || role.name.toLowerCase().includes(q) || (role.description ?? '').toLowerCase().includes(q));
    const pq = permSearch.trim().toLowerCase();
    const filteredPermissions = permissions.filter((perm) => {
        if (!pq) return true;
        return perm.name.toLowerCase().includes(pq) || describePermission(perm.name, perm.description).label.toLowerCase().includes(pq);
    });

    const columns: Column<RoleRow>[] = [
        {
            key: 'name',
            header: 'Rol',
            render: (role) => (
                <div className={styles.roleCell}>
                    <strong>{role.name}</strong>
                    <span className={styles.muted}>{role.description || 'Sin descripción'}</span>
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
                            <span key={perm.id} title={perm.name}><Badge>{describePermission(perm.name, perm.description).label}</Badge></span>
                        ))}
                        {list.length > 3 && <Badge>+{list.length - 3} más</Badge>}
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
        <PageContent>
            <PageHeader
                title="Roles y Permisos"
                description="Gestiona los roles del sistema y sus capacidades"
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()} disabled={Boolean(loadError)}>
                        Nuevo rol
                    </Button>
                )}
            />

            {loadError ? (
                <LoadErrorState message={loadError} onRetry={() => { setLoading(true); void loadData(); }} />
            ) : (
                <DataTable<RoleRow>
                    columns={columns}
                    rows={filteredRoles}
                    rowKey={(role) => role.id}
                    ariaLabel="Listado de roles"
                    loading={loading}
                    resetKey={q}
                    onRowClick={handleOpenSidebar}
                    empty={<EmptyState icon={ShieldCheck} title="No se encontraron roles" description="Ajusta la búsqueda o crea un nuevo rol." />}
                    toolbar={(
                        <TableToolbar>
                            <Input
                                type="search"
                                aria-label="Buscar roles"
                                placeholder="Buscar por nombre o descripción"
                                prefix={<Search size={14} aria-hidden="true" />}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </TableToolbar>
                    )}
                />
            )}

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingRole ? 'Editar rol' : 'Nuevo rol'}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button variant="primary" type="submit" form="role-form" loading={saving}>
                            {editingRole ? 'Guardar cambios' : 'Crear rol'}
                        </Button>
                    </>
                )}
            >
                <form id="role-form" onSubmit={handleSubmit} className={styles.stack}>
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
                            <>
                                <Input
                                    type="search"
                                    aria-label="Buscar permisos"
                                    placeholder="Buscar permiso"
                                    prefix={<Search size={14} aria-hidden="true" />}
                                    value={permSearch}
                                    onChange={(e) => setPermSearch(e.target.value)}
                                />
                                <div className={styles.permList}>
                                    {filteredPermissions.map((perm) => {
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
                            </>
                        )}
                    </FormSection>
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
