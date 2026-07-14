import { useState, useEffect, useCallback } from 'react';
import Select from '../components/Select';
import { usersAPI, branchesAPI, companiesAPI, rolesAPI } from '../services/api';
import Button from '../components/Button';
import Sidebar from '../components/Sidebar';
import PageHeader from '../components/PageHeader';
import ViewToggle from '../components/ViewToggle';
import CatalogTable, { type CatalogColumn } from '../components/CatalogTable';
import { useViewMode } from '../hooks/useViewMode';
import { Users as UsersIcon, Plus, Edit2, UserX, UserCheck, Shield, MapPin, Building2, Mail, User as UserIcon, Lock, Palette } from 'lucide-react';
import type { User, Branch, Company } from '../types';
import type { SingleValue } from 'react-select';

interface UserSavePayload {
    name: string;
    email: string;
    username: string;
    password?: string;
    roleId: number;
    roleIds: number[];
    branchId?: number | null;
    branchIds?: number[];
    status: string;
    color: string | null;
    companyId?: number;
}
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import './Users.css';

function toApiPayload(payload: UserSavePayload): Record<string, unknown> {
    return payload as unknown as Record<string, unknown>;
}

export default function Users() {
    const { user: currentUser } = useAuth();
    const { confirm } = useConfirmDialog();
    const { error: showError, warning: showWarning } = useAppToast();
    const isSuperAdmin = hasAnyRole(currentUser, ['SUPERADMIN']);
    const canManageUserStatus = hasAnyRole(currentUser, ['SUPERADMIN', 'ADMIN']);

    const [users, setUsers] = useState<User[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [availableRoles, setAvailableRoles] = useState<{ id: number; name: string }[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const { viewMode, setViewMode } = useViewMode('users');

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
        branchIds: [] as string[],
        status: 'ACTIVE',
        color: ''
    });
    const [activeTab, setActiveTab] = useState<'perfil' | 'acceso'>('perfil');
    const [saving, setSaving] = useState(false);

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
            const allowedIds = user.allowedBranches && user.allowedBranches.length > 0
                ? user.allowedBranches.map(ab => ab.branch.id.toString())
                : (user.branchId ? [user.branchId.toString()] : []);
            setFormData({
                name: user.name,
                email: user.email,
                username: user.username,
                password: '',
                roleId: user.role.id.toString(),
                roleIds: userRoleIds,
                companyId: user.companyId?.toString() || '',
                branchId: user.branchId?.toString() || '',
                branchIds: allowedIds,
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
                branchIds: [],
                status: 'ACTIVE',
                color: ''
            });
        }
        setIsSidebarOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name?.trim()) {
            showError('El nombre es obligatorio');
            setActiveTab('perfil');
            return;
        }
        if (!formData.email?.trim()) {
            showError('El email es obligatorio');
            setActiveTab('perfil');
            return;
        }
        if (!formData.username?.trim()) {
            showError('El nombre de usuario es obligatorio');
            setActiveTab('perfil');
            return;
        }

        const selectedRoleIds = formData.roleIds.length > 0
            ? formData.roleIds.map(id => parseInt(id))
            : [parseInt(formData.roleId)];

        if (selectedRoleIds.length === 0 || selectedRoleIds.some(Number.isNaN)) {
            showError('Selecciona al menos un rol');
            setActiveTab('acceso');
            return;
        }

        if (isSuperAdmin && !editingUser && !formData.companyId) {
            showError('Selecciona una empresa');
            setActiveTab('acceso');
            return;
        }

        if (!editingUser && !formData.password?.trim()) {
            showWarning('La contraseña es obligatoria para nuevos usuarios');
            setActiveTab('perfil');
            return;
        }

        setSaving(true);
        try {
            const payload: UserSavePayload = {
                name: formData.name.trim(),
                email: formData.email.trim(),
                username: formData.username.trim(),
                password: formData.password || undefined,
                roleId: selectedRoleIds[0],
                roleIds: selectedRoleIds,
                status: formData.status,
                color: formData.color || null
            };

            // Branch assignment/rotation is SUPERADMIN-only. A SUPERADMIN sends the
            // permitted set + active branch. A non-superadmin may only set the
            // active branch when CREATING a user (it becomes the permitted set).
            if (isSuperAdmin) {
                payload.branchId = formData.branchId ? parseInt(formData.branchId) : null;
                payload.branchIds = formData.branchIds.map(id => parseInt(id));
            } else if (!editingUser) {
                payload.branchId = formData.branchId ? parseInt(formData.branchId) : null;
            }

            if (isSuperAdmin && formData.companyId) {
                payload.companyId = parseInt(formData.companyId);
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
            showError(`Error: ${msg || fallback}`);
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (targetUser: User) => {
        if (!canManageUserStatus) {
            showWarning('No tienes permisos para cambiar el estado de usuarios.');
            return;
        }
        const activating = targetUser.status !== 'ACTIVE';
        const verb = activating ? 'reactivar' : 'inhabilitar';
        if (!(await confirm(`¿Deseas ${verb} a ${targetUser.name}? Su historial se conservará.`, { title: `${activating ? 'Reactivar' : 'Inhabilitar'} usuario` }))) return;
        try {
            await usersAPI.update(targetUser.id, { status: activating ? 'ACTIVE' : 'INACTIVE' });
            loadData(formData.companyId);
        } catch (error: unknown) {
            console.error('Error changing user status:', error);
            const msg = typeof error === 'object' && error !== null && 'response' in error
                ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
                : undefined;
            showError(msg || `No se pudo ${verb} el usuario`);
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
            <PageHeader
                title="Gestión de Usuarios"
                icon={UsersIcon}
                actions={
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <ViewToggle value={viewMode} onChange={setViewMode} />
                        <Button onClick={() => handleOpenSidebar()}>
                            <Plus size={20} />
                            Nuevo Usuario
                        </Button>
                    </div>
                }
            />

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

            {/* Table view */}
            {viewMode === 'table' && filteredUsers.length > 0 && (
                <CatalogTable<User>
                    rows={filteredUsers}
                    rowKey={(u) => u.id}
                    resetKey={`${searchQuery}|${roleFilter}|${statusFilter}`}
                    columns={[
                        {
                            key: 'name',
                            header: 'Usuario',
                            render: (u) => (
                                <div className="catalog-cell-stack">
                                    <span className="cell-title">{u.name}</span>
                                    <span className="cell-sub">@{u.username}</span>
                                </div>
                            )
                        },
                        { key: 'email', header: 'Email', render: (u) => u.email || '-' },
                        {
                            key: 'roles',
                            header: 'Rol',
                            render: (u) => {
                                const roles = u.userRoles ? u.userRoles.map(ur => ur.role.name) : [u.role?.name || ''];
                                return (
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {roles.filter(Boolean).map((rn, i) => (
                                            <span key={i} className="user-role-badge" style={{ background: getRoleColor(rn), position: 'relative', top: 0, right: 0 }}>{rn}</span>
                                        ))}
                                    </div>
                                );
                            }
                        },
                        { key: 'branch', header: 'Sucursal', render: (u) => u.branch?.name || 'Todas las Sucursales' },
                        ...(isSuperAdmin ? [{
                            key: 'company',
                            header: 'Empresa',
                            render: (u: User) => u.company?.name || '-'
                        }] : []),
                        {
                            key: 'status',
                            header: 'Estado',
                            render: (u) => <span className={`catalog-pill ${u.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>{u.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</span>
                        },
                        {
                            key: 'actions',
                            header: 'Acciones',
                            align: 'right',
                            render: (u) => (
                                <div className="catalog-table-actions">
                                    <button className="catalog-action-btn" onClick={() => handleOpenSidebar(u)} title="Editar">
                                        <Edit2 size={16} />
                                    </button>
                                    {canManageUserStatus && (
                                        <button className={`catalog-action-btn ${u.status === 'ACTIVE' ? 'danger' : ''}`} onClick={() => handleStatusChange(u)} title={u.status === 'ACTIVE' ? 'Inhabilitar sin borrar historial' : 'Reactivar usuario'}>
                                            {u.status === 'ACTIVE' ? <UserX size={16} /> : <UserCheck size={16} />}
                                        </button>
                                    )}
                                </div>
                            )
                        }
                    ] as CatalogColumn<User>[]}
                />
            )}

            {/* Users Grid */}
            {viewMode === 'cards' && filteredUsers.length > 0 && (
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
                                {canManageUserStatus && (
                                    <button className={`action-btn-new ${user.status === 'ACTIVE' ? 'delete' : ''}`} onClick={(e) => { e.stopPropagation(); handleStatusChange(user); }}>
                                        {user.status === 'ACTIVE' ? <UserX size={20} /> : <UserCheck size={20} />}
                                        <span>{user.status === 'ACTIVE' ? 'Inhabilitar' : 'Reactivar'}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}

            {filteredUsers.length === 0 && (
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
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'perfil' ? 'active' : ''}`}
                            onClick={() => setActiveTab('perfil')}
                        >
                            <UserIcon size={18} />
                            <span>Perfil</span>
                        </button>
                        <button
                            type="button"
                            className={`modal-tab ${activeTab === 'acceso' ? 'active' : ''}`}
                            onClick={() => setActiveTab('acceso')}
                        >
                            <Shield size={18} />
                            <span>Rol y Acceso</span>
                        </button>
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
                                        <label className="modal-input-label" htmlFor="user-name">Nombre Completo</label>
                                        <input
                                            id="user-name"
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
                                            <label className="modal-input-label" htmlFor="user-email">Email</label>
                                            <input
                                                id="user-email"
                                                type="email"
                                                className="modal-standard-input"
                                                value={formData.email}
                                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="juan@empresa.com"
                                                required
                                            />
                                        </div>
                                        <div className="modal-input-group">
                                            <label className="modal-input-label" htmlFor="user-username">Nombre de Usuario</label>
                                            <input
                                                id="user-username"
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
                                        <label className="modal-input-label" htmlFor="user-password">
                                            {editingUser ? "Nueva Contraseña (dejar en blanco para no cambiar)" : "Contraseña"}
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-neutral-400)' }} />
                                            <input
                                                id="user-password"
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
                                        <label className="modal-input-label" id="user-roles-label">Roles del Sistema (puede tener varios)</label>
                                        <div role="group" aria-labelledby="user-roles-label" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                                            {availableRoles.map(r => {
                                                const isChecked = formData.roleIds.includes(r.id.toString());
                                                return (
                                                    <label key={r.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                                                        background: isChecked ? getRoleColor(r.name) + '20' : 'var(--color-background)',
                                                        border: `1.5px solid ${isChecked ? getRoleColor(r.name) : 'var(--color-border)'}`,
                                                        color: 'var(--color-text)',
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
                                            <label className="modal-input-label" htmlFor="user-color"><Palette size={14} style={{ marginRight: 4 }} />Color Identificador</label>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <input
                                                    id="user-color"
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

                                    {isSuperAdmin ? (
                                        <>
                                            <div className="modal-input-group">
                                                <label className="modal-input-label" id="user-branches-label">Sucursales permitidas (rotación)</label>
                                                <div role="group" aria-labelledby="user-branches-label" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                                                    {branches.map(b => {
                                                        const bid = b.id.toString();
                                                        const isChecked = formData.branchIds.includes(bid);
                                                        return (
                                                            <label key={b.id} style={{
                                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                                padding: '6px 12px', borderRadius: '8px', cursor: 'pointer',
                                                                background: isChecked ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'var(--color-background)',
                                                                border: `1.5px solid ${isChecked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                                color: isChecked ? 'var(--color-primary)' : 'var(--color-text)',
                                                                fontSize: '0.85rem', fontWeight: isChecked ? 600 : 400,
                                                            }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={() => {
                                                                        const next = isChecked
                                                                            ? formData.branchIds.filter(id => id !== bid)
                                                                            : [...formData.branchIds, bid];
                                                                        // If the active branch is removed from the permitted set, clear it.
                                                                        const nextActive = next.includes(formData.branchId) ? formData.branchId : '';
                                                                        setFormData({ ...formData, branchIds: next, branchId: nextActive });
                                                                    }}
                                                                />
                                                                <span>{b.name}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                                <small style={{ color: 'var(--color-neutral-500)' }}>El usuario solo verá información de su sucursal activa. El superadmin rota la sucursal activa entre las permitidas.</small>
                                            </div>

                                            <Select
                                                variant="modal"
                                                label="Sucursal activa"
                                                placeholder="Ninguna (Global / Superadmin)"
                                                options={[
                                                    { value: '', label: 'Ninguna (Global / Superadmin)' },
                                                    ...branches
                                                        .filter(b => formData.branchIds.includes(b.id.toString()))
                                                        .map(b => ({ value: b.id.toString(), label: b.name }))
                                                ]}
                                                value={formData.branchId ? { value: formData.branchId, label: branches.find(b => b.id.toString() === formData.branchId)?.name || '' } : { value: '', label: 'Ninguna (Global / Superadmin)' }}
                                                onChange={(option: SingleValue<{ value: string; label: string }>) => option && setFormData({ ...formData, branchId: option.value })}
                                            />
                                        </>
                                    ) : (
                                        <Select
                                            variant="modal"
                                            label="Sucursal activa"
                                            placeholder="Seleccionar sucursal"
                                            options={[
                                                { value: '', label: 'Sin sucursal' },
                                                ...branches.map(b => ({ value: b.id.toString(), label: b.name }))
                                            ]}
                                            value={formData.branchId ? { value: formData.branchId, label: branches.find(b => b.id.toString() === formData.branchId)?.name || '' } : { value: '', label: 'Sin sucursal' }}
                                            onChange={(option: SingleValue<{ value: string; label: string }>) => option && setFormData({ ...formData, branchId: option.value })}
                                            isDisabled={!!editingUser}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <Button type="button" variant="ghost" onClick={() => setIsSidebarOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="primary" disabled={saving}>
                                {saving ? 'Guardando...' : editingUser ? 'Guardar Cambios' : 'Crear Usuario'}
                            </Button>
                        </div>
                    </form>
                </div>
            </Sidebar>
        </div>
    );
}
