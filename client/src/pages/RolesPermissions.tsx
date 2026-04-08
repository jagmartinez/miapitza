import { useState, useEffect } from 'react';
import { rolesAPI, permissionsAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { Plus, Edit, Trash2, Shield } from 'lucide-react';
import './RolesPermissions.css';

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
            console.error('Error loading data:', error);
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
            alert('Error al guardar el rol');
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('¿Estás seguro de eliminar este rol?')) return;
        try {
            await rolesAPI.delete(id);
            loadData();
        } catch (error: unknown) {
            const msg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            alert(msg || 'Error al eliminar el rol');
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

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-secondary)' }}>Cargando...</div>;

    return (
        <div className="roles-permissions-page">
            <div className="rp-header">
                <div>
                    <h1><Shield size={28} /> Roles y Permisos</h1>
                    <p>Gestiona los roles del sistema y sus capacidades</p>
                </div>
                <Button onClick={() => handleOpenSidebar()}>
                    <Plus size={18} /> Nuevo Rol
                </Button>
            </div>

            <div className="roles-grid">
                {roles.map(role => (
                    <div key={role.id} className="role-card-new">
                        <div className="role-card-header">
                            <div className={`role-icon ${role.name.toLowerCase()}`}>
                                <Shield size={22} />
                            </div>
                            <div className="role-info">
                                <h3>{role.name}</h3>
                                <p>{role.description || 'Sin descripción'}</p>
                            </div>
                        </div>

                        <div className="role-card-body">
                            <div className="role-stats">
                                <div className="role-stat">
                                    <span className="role-stat-label">Usuarios</span>
                                    <span className="role-stat-value">{role._count?.users || 0}</span>
                                </div>
                                <div className="role-stat">
                                    <span className="role-stat-label">Permisos</span>
                                    <span className="role-stat-value">{role.permissions?.length || 0}</span>
                                </div>
                            </div>

                            <div className="role-permissions">
                                {role.permissions?.slice(0, 3).map((perm) => (
                                    <span key={perm.id} className="perm-badge">{perm.name}</span>
                                ))}
                                {(role.permissions?.length || 0) > 3 && (
                                    <span className="perm-badge more">+{(role.permissions?.length || 0) - 3} más</span>
                                )}
                                {(!role.permissions || role.permissions.length === 0) && (
                                    <span className="perm-badge more">Sin permisos asignados</span>
                                )}
                            </div>
                        </div>

                        <div className="role-card-actions">
                            <button className="role-action-btn" onClick={() => handleOpenSidebar(role)}>
                                <Edit size={15} /> Editar
                            </button>
                            <button className="role-action-btn delete" onClick={() => handleDelete(role.id)}>
                                <Trash2 size={15} /> Eliminar
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                title={editingRole ? 'Editar Rol' : 'Nuevo Rol'}
            >
                <form onSubmit={handleSubmit} className="role-form">
                    <div className="rp-form-group">
                        <label>Nombre del Rol</label>
                        <input
                            type="text"
                            className="rp-input"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Ej: ADMIN, MESERO..."
                            required
                        />
                    </div>

                    <div className="rp-form-group">
                        <label>Descripción</label>
                        <textarea
                            className="rp-input"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Describe las responsabilidades del rol..."
                        />
                    </div>

                    <div className="rp-perms-section">
                        <label className="rp-perms-title">Permisos</label>
                        <div className="rp-perms-list">
                            {permissions.length === 0 ? (
                                <div className="rp-empty-perms">No hay permisos registrados en el sistema</div>
                            ) : permissions.map(perm => (
                                <label key={perm.id} className="rp-perm-item">
                                    <input
                                        type="checkbox"
                                        checked={formData.permissionIds.includes(perm.id)}
                                        onChange={() => togglePermission(perm.id)}
                                    />
                                    <div>
                                        <div className="rp-perm-name">{perm.name}</div>
                                        {perm.description && <div className="rp-perm-desc">{perm.description}</div>}
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="rp-form-actions">
                        <Button type="button" variant="secondary" onClick={() => setIsSidebarOpen(false)} fullWidth>
                            Cancelar
                        </Button>
                        <Button type="submit" fullWidth>
                            {editingRole ? 'Actualizar Rol' : 'Crear Rol'}
                        </Button>
                    </div>
                </form>
            </Sidebar>
        </div>
    );
}
