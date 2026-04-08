import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { usersAPI, branchesAPI, companiesAPI, rolesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import { Users as UsersIcon, Plus, Edit2, Trash2, Shield, MapPin, Building2, Mail, User as UserIcon, Lock, Palette } from 'lucide-react';
import type { User, Branch, Company } from '../types';
import type { SingleValue } from 'react-select';

interface UserSavePayload {
    name: string;
    email: string;
    username: string;
    password?: string;
    roleId: number;
    roleIds: number[];
    branchId: number | null;
    status: string;
    color: string | null;
    companyId?: number;
}
import { useAuth } from '../hooks/useAuth';
import './Users.css';

function toApiPayload(payload: UserSavePayload): Record<string, unknown> {
    return payload as unknown as Record<string, unknown>;
}

export default function Users() {
    const { user: currentUser } = useAuth();
    const currentRoles = currentUser?.roles
        ? currentUser.roles.map(r => r.name)
        : [currentUser?.role?.name || ''];
    const isSuperAdmin = currentRoles.includes('SUPERADMIN');

    const [users, setUsers] = useState<User[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [availableRoles, setAvailableRoles] = useState<{ id: number; name: string }[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    // Sidebar State
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        username: '',
        password: '',
        roleId: '3',
        roleIds: [] as string[],
        companyId: '',
        branchId: '',
        status: 'ACTIVE',
        color: ''
    });
    const [activeTab, setActiveTab] = useState<'perfil' | 'acceso'>('perfil');

    const roleOptions = [
        { value: 'all', label: 'Todos los Roles' },
        ...availableRoles.map(r => ({ value: r.name, label: r.name }))
    ];

    const statusOptions = [
        { value: 'all', label: 'Cualquier Estado' },
        { value: 'ACTIVE', label: 'Activos' },
        { value: 'INACTIVE', label: 'Inactivos' }
    ];

    const loadData = useCallback(async (companyId?: string, isInitial = false) => {
        try {
            if (isInitial) setLoading(true);
            const [usersRes, branchesRes, rolesRes] = await Promise.all([
                usersAPI.getAll(isSuperAdmin ? { companyId } : undefined),
                branchesAPI.getAll(isSuperAdmin ? { companyId } : undefined),
                rolesAPI.getAll()
            ]);
            setUsers(usersRes.data.data);
            setBranches(branchesRes.data.data);
            setAvailableRoles(rolesRes.data.data || []);

            if (isSuperAdmin && companies.length === 0) {
                const compRes = await companiesAPI.getAll();
                setCompanies(compRes.data.data);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        } finally {
            if (isInitial) setLoading(false);
        }
    }, [companies.length, isSuperAdmin]);

    useEffect(() => {
        void loadData(undefined, true);
    }, [loadData]);

    const handleOpenSidebar = (user?: User) => {
        if (user) {
            setEditingUser(user);
            const userRoleIds = user.userRoles
                ? user.userRoles.map(ur => ur.role.id.toString())
                : [user.role.id.toString()];
            setFormData({
                name: user.name,
                email: user.email,
                username: user.username,
                password: '',
                roleId: user.role.id.toString(),
                roleIds: userRoleIds,
                companyId: user.companyId?.toString() || '',
                branchId: user.branchId?.toString() || '',
                status: user.status,
                color: user.color || ''
            });
        } else {
            setEditingUser(null);
            setFormData({
                name: '',
                email: '',
                username: '',
                password: '',
                roleId: '3',
                roleIds: [],
                companyId: '',
                branchId: '',
                status: 'ACTIVE',
                color: ''
            });
        }
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const selectedRoleIds = formData.roleIds.length > 0
                ? formData.roleIds.map(id => parseInt(id))
                : [parseInt(formData.roleId)];

            const payload: UserSavePayload = {
                name: formData.name,
                email: formData.email,
                username: formData.username,
                password: formData.password || undefined,
                roleId: selectedRoleIds[0],
                roleIds: selectedRoleIds,
                branchId: formData.branchId ? parseInt(formData.branchId) : null,
                status: formData.status,
                color: formData.color || null
            };

            if (isSuperAdmin && formData.companyId) {
                payload.companyId = parseInt(formData.companyId);
            }

            if (!payload.password && !editingUser) {
                alert('La contraseña es obligatoria para nuevos usuarios');
                return;
            }

            if (!payload.password) {
                delete payload.password;
            }

            if (editingUser) {
                await usersAPI.update(editingUser.id, toApiPayload(payload));
            } else {
                await usersAPI.create(toApiPayload(payload));
            }

            setIsSidebarOpen(false);
            loadData(formData.companyId);
        } catch (error: unknown) {
            console.error('Error saving user:', error);
            const msg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            const fallback = 'Error al guardar usuario';
            alert(`Error: ${msg || fallback}`);
        }
    };

    const handleDelete = async (id: number) => {
        if (!window.confirm('¿Estás seguro de desactivar este usuario?')) return;
        try {
            await usersAPI.delete(id);
            loadData(formData.companyId);
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Error al eliminar usuario');
        }
    };

    // Filter users based on search and filters
    const filteredUsers = users.filter(user => {
        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesSearch =
                user.name?.toLowerCase().includes(query) ||
                user.username?.toLowerCase().includes(query) ||
                user.email?.toLowerCase().includes(query);
            if (!matchesSearch) return false;
        }

        // Role filter (check all roles)
        if (roleFilter !== 'all') {
            const userRoleNames = user.userRoles
                ? user.userRoles.map(ur => ur.role.name)
                : [user.role?.name];
            if (!userRoleNames.includes(roleFilter)) return false;
        }

        // Status filter
        if (statusFilter !== 'all' && user.status !== statusFilter) {
            return false;
        }

        return true;
    });

    // Generate user initials
    const getUserInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    // Get role color
    const getRoleColor = (roleName: string) => {
        const colors: Record<string, string> = {
            'SUPERADMIN': '#9333EA',
            'ADMIN': '#2563EB',
            'WAITER': '#10B981',
            'MESERO': '#10B981',
            'KITCHEN': '#F59E0B',
            'CASHIER': '#06B6D4',
            'CAJERO': '#06B6D4'
        };
        return colors[roleName] || '#6B7280';
    };

    if (loading) return <div className="users-loading">Cargando usuarios...</div>;

    return (
        <div className="users-page">
            {/* Header */}
            <div className="users-header">
                <div>
                    <h1><UsersIcon size={32} /> Gestión de Usuarios</h1>
                </div>
                <Button onClick={() => handleOpenSidebar()}>
                    <Plus size={20} />
                    Nuevo Usuario
                </Button>
            </div>

            {/* Filters */}
            <div className="users-filters">
                {/* Search */}
                <div className="search-container">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Buscar por nombre, usuario o email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* Role Filter */}
                <div className="filter-group-container">
                    <Select
                        options={roleOptions}
                        value={roleOptions.find(opt => opt.value === roleFilter)}
                        onChange={(opt: SingleValue<{ value: string; label: string }>) => opt && setRoleFilter(opt.value)}
                        placeholder="Filtrar por Rol"
                        isSearchable={false}
                    />
                </div>

                <div className="filter-group-container">
                    <Select
                        options={statusOptions}
                        value={statusOptions.find(opt => opt.value === statusFilter)}
                        onChange={(opt: SingleValue<{ value: string; label: string }>) => opt && setStatusFilter(opt.value)}
                        placeholder="Estado"
                        isSearchable={false}
                    />
                </div>
            </div>

            {/* Users Grid */}
            {filteredUsers.length > 0 ? (
                <div className="users-grid">
                    {filteredUsers.map(user => {
                        const userAllRoles = user.userRoles
                            ? user.userRoles.map(ur => ur.role.name)
                            : [user.role?.name || ''];
                        return (
                        <div key={user.id} className="user-card" onClick={() => handleOpenSidebar(user)}>
                            {/* Role Badges */}
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', position: 'absolute', top: '12px', right: '12px', zIndex: 1 }}>
                                {userAllRoles.map((rn, i) => (
                                    <div key={i} className="user-role-badge" style={{ background: getRoleColor(rn), position: 'relative', top: 0, right: 0 }}>
                                        {rn}
                                    </div>
                                ))}
                            </div>

                            {/* Card Header with Avatar */}
                            <div className="user-card-header">
                                <div className="user-avatar-container">
                                    <div className="user-avatar" style={{ backgroundColor: user.color || getRoleColor(user.role?.name || '') }}>
                                        {getUserInitials(user.name)}
                                    </div>
                                    <div className={`user-status-dot ${user.status === 'ACTIVE' ? 'active' : 'inactive'}`} />
                                </div>
                                <div className="user-card-info">
                                    <h3 className="user-name">{user.name}</h3>
                                    {user.color && (
                                        <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: user.color, marginLeft: '6px', verticalAlign: 'middle', border: '1px solid var(--color-neutral-300)' }} />
                                    )}
                                </div>
                            </div>

                            {/* Card Body */}
                            <div className="user-card-body">
                                <div className="user-detail">
                                    <span className="detail-value">Usuario: <span className="username-tag">@{user.username}</span></span>
                                </div>
                                <div className="user-detail">
                                    <Mail size={16} />
                                    <span className="detail-value">{user.email}</span>
                                </div>
                                <div className="user-detail">
                                    <MapPin size={16} />
                                    <span className="detail-value">{user.branch?.name || 'Todas las Sucursales'}</span>
                                </div>
                                {isSuperAdmin && user.company && (
                                    <div className="user-detail">
                                        <Building2 size={16} />
                                        <span className="detail-value">{user.company.name}</span>
                                    </div>
                                )}
                            </div>

                            {/* Card Actions */}
                            <div className="user-card-actions">
                                <button className="action-btn-new" onClick={(e) => { e.stopPropagation(); handleOpenSidebar(user); }}>
                                    <Edit2 size={20} />
                                    <span>Editar</span>
                                </button>
                                {user.status === 'ACTIVE' && (
                                    <button className="action-btn-new delete" onClick={(e) => { e.stopPropagation(); handleDelete(user.id); }}>
                                        <Trash2 size={20} />
                                        <span>Desactivar</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        );
                    })}
                </div>
            ) : (
                <div className="users-empty">
                    <UsersIcon size={64} />
                    <h3>No se encontraron usuarios</h3>
                    <p>Intenta ajustar los filtros o crear un nuevo usuario para comenzar</p>
                </div>
            )}

            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => { setIsSidebarOpen(false); setActiveTab('perfil'); }}
                title={editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
            >
                <div className="premium-modal-content users-modal-content">
                    {/* Tabs Navigation */}
                    <div className="modal-tabs">
                        <div
                            className={`modal-tab ${activeTab === 'perfil' ? 'active' : ''}`}
                            onClick={() => setActiveTab('perfil')}
                        >
                            <UserIcon size={18} />
                            <span>Perfil</span>
                        </div>
                        <div
                            className={`modal-tab ${activeTab === 'acceso' ? 'active' : ''}`}
                            onClick={() => setActiveTab('acceso')}
                        >
                            <Shield size={18} />
                            <span>Rol y Acceso</span>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form-new">
                        <div className="modal-tab-content">
                            {/* 1. PERFIL TAB */}
                            {activeTab === 'perfil' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <UserIcon size={18} />
                                        <h3>Información de Perfil</h3>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Nombre Completo</label>
                                        <input
                                            type="text"
                                            className="modal-standard-input"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            placeholder="Ej: Juan Pérez"
                                            required
                                            autoFocus
                                        />
                                    </div>

                                    <div className="modal-form-row">
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Email</label>
                                            <input
                                                type="email"
                                                className="modal-standard-input"
                                                value={formData.email}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="juan@empresa.com"
                                                required
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label">Nombre de Usuario</label>
                                            <input
                                                type="text"
                                                className="modal-standard-input"
                                                value={formData.username}
                                                onChange={e => setFormData({ ...formData, username: e.target.value })}
                                                placeholder="jperez"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">
                                            {editingUser ? "Nueva Contraseña (dejar en blanco para no cambiar)" : "Contraseña"}
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                                            <input
                                                type="password"
                                                className="modal-standard-input"
                                                style={{ paddingLeft: '36px' }}
                                                value={formData.password}
                                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                                required={!editingUser}
                                                placeholder="Min. 6 caracteres"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 2. ACCESO TAB */}
                            {activeTab === 'acceso' && (
                                <div className="modal-section animate-slide-in">
                                    <div className="modal-section-header">
                                        <Shield size={18} />
                                        <h3>Configuración de Acceso</h3>
                                    </div>

                                    {isSuperAdmin && !editingUser && (
                                        <div className="modal-input-group">
                                            <Select
                                                variant="modal"
                                                label="Empresa"
                                                placeholder="Seleccionar Empresa"
                                                options={companies.map(c => ({ value: c.id, label: c.name }))}
                                                value={(() => {
                                                    const c = companies.find(co => co.id.toString() === formData.companyId);
                                                    return c ? { value: c.id, label: c.name } : null;
                                                })()}
                                                onChange={(option: SingleValue<{ value: number; label: string }>) => {
                                                    if (!option) return;
                                                    const cid = String(option.value);
                                                    setFormData({ ...formData, companyId: cid, branchId: '' });
                                                    loadData(cid);
                                                }}
                                                required
                                            />
                                        </div>
                                    )}

                                    <div className="modal-input-group">
                                        <label className="modal-input-label">Roles del Sistema (puede tener varios)</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                                            {availableRoles.map(r => {
                                                const isChecked = formData.roleIds.includes(r.id.toString());
                                                return (
                                                    <label key={r.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                                                        background: isChecked ? getRoleColor(r.name) + '20' : 'var(--color-neutral-100)',
                                                        border: `1.5px solid ${isChecked ? getRoleColor(r.name) : 'var(--color-neutral-200)'}`,
                                                        fontSize: '0.85rem', fontWeight: isChecked ? 600 : 400,
                                                        transition: 'all 0.15s ease'
                                                    }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {
                                                                const rid = r.id.toString();
                                                                let newIds: string[];
                                                                if (isChecked) {
                                                                    newIds = formData.roleIds.filter(id => id !== rid);
                                                                } else {
                                                                    newIds = [...formData.roleIds, rid];
                                                                }
                                                                if (newIds.length === 0) newIds = [formData.roleId];
                                                                setFormData({ ...formData, roleIds: newIds, roleId: newIds[0] });
                                                            }}
                                                            style={{ accentColor: getRoleColor(r.name) }}
                                                        />
                                                        <span style={{ color: isChecked ? getRoleColor(r.name) : 'inherit' }}>{r.name}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="modal-form-row">
                                        <Select
                                            variant="modal"
                                            label="Estado de Cuenta"
                                            options={[
                                                { value: 'ACTIVE', label: 'Activo' },
                                                { value: 'INACTIVE', label: 'Inactivo' }
                                            ]}
                                            value={{
                                                value: formData.status,
                                                label: formData.status === 'ACTIVE' ? 'Activo' : 'Inactivo'
                                            }}
                                            onChange={(option: SingleValue<{ value: string; label: string }>) => option && setFormData({ ...formData, status: option.value })}
                                            isDisabled={!editingUser}
                                            isSearchable={false}
                                        />

                                        <div className="modal-input-group">
                                            <label className="modal-input-label"><Palette size={14} style={{ marginRight: 4 }} />Color Identificador</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    type="color"
                                                    value={formData.color || '#6B7280'}
                                                    onChange={e => setFormData({ ...formData, color: e.target.value })}
                                                    style={{ width: '40px', height: '36px', border: 'none', borderRadius: '6px', cursor: 'pointer', padding: 0 }}
                                                />
                                                <span style={{ fontSize: '0.85rem', color: 'var(--color-neutral-500)' }}>
                                                    {formData.color || 'Sin color'}
                                                </span>
                                                {formData.color && (
                                                    <button type="button" onClick={() => setFormData({ ...formData, color: '' })}
                                                        style={{ fontSize: '0.75rem', color: 'var(--color-error)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                                        Quitar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <Select
                                        variant="modal"
                                        label="Asignar Sucursal"
                                        placeholder="Ninguna (Global / Superadmin)"
                                        options={[
                                            { value: '', label: 'Ninguna (Global / Superadmin)' },
                                            ...branches.map(b => ({ value: b.id.toString(), label: b.name }))
                                        ]}
                                        value={formData.branchId ? { value: formData.branchId, label: branches.find(b => b.id.toString() === formData.branchId)?.name || '' } : { value: '', label: 'Ninguna (Global / Superadmin)' }}
                                        onChange={(option: SingleValue<{ value: string; label: string }>) => option && setFormData({ ...formData, branchId: option.value })}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary">
                                {editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
