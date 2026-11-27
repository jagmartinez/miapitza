import { useState, useEffect, useCallback, useRef } from 'react';
import { usersAPI, branchesAPI, companiesAPI, rolesAPI } from '../services/api';
import { Users as UsersIcon, Plus, Pencil, Power, Lock, Search } from 'lucide-react';
import type { User, Branch, Company, UserAccountType } from '../types';

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
    accountType: UserAccountType;
    companyId?: number;
}
import { useAuth } from '../hooks/useAuth';
import { useConfirmDialog } from '../context/ConfirmContext';
import { useAppToast } from '../context/ToastContext';
import { hasAnyRole } from '../utils/authz';
import { createLatestRequestGuard } from '../utils/latestRequest';
import styles from './catalog.module.css';
import {
    AppSelect, Badge, Button, Checkbox, DataTable, EmptyState, Field, FormGrid, FormSection, FullScreenModal, IconButton, Input,
    LoadErrorState, PageContent, PageHeader, SegmentedControl, TableToolbar, type Column,
} from '@/ui';
import { getApiErrorMessage } from '../utils/apiError';

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
    const [loadError, setLoadError] = useState<string | null>(null);
    const lastRequestedCompanyId = useRef<string | undefined>(undefined);
    const loadRequestGuard = useRef(createLatestRequestGuard());

    // Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'INACTIVE'>('all');

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
        color: '',
        accountType: 'EXTERNAL' as UserAccountType
    });
    const [activeTab, setActiveTab] = useState<'perfil' | 'acceso'>('perfil');
    const [saving, setSaving] = useState(false);

    const roleOptions = [
        { value: 'all', label: 'Todos los roles' },
        ...availableRoles.map(r => ({ value: r.name, label: r.name }))
    ];

    const statusOptions: { value: 'all' | 'ACTIVE' | 'INACTIVE'; label: string }[] = [
        { value: 'all', label: 'Todos' },
        { value: 'ACTIVE', label: 'Activos' },
        { value: 'INACTIVE', label: 'Inactivos' }
    ];

    const accountTypeOptions: Array<{ value: UserAccountType; label: string }> = [
        { value: 'INTERNAL', label: 'Interno · ligado a personal' },
        { value: 'EXTERNAL', label: 'Externo · solo acceso al sistema' },
    ];
    const accountStatusOptions = [
        { value: 'ACTIVE', label: 'Activo' },
        { value: 'INACTIVE', label: 'Inactivo' },
    ];

    const loadData = useCallback(async (companyId?: string, isInitial = false) => {
        const requestId = loadRequestGuard.current.begin();
        try {
            lastRequestedCompanyId.current = companyId;
            if (isInitial) setLoading(true);
            const [usersRes, branchesRes, rolesRes] = await Promise.all([
                usersAPI.getAll(isSuperAdmin ? { companyId } : undefined),
                branchesAPI.getAll(isSuperAdmin ? { companyId } : undefined),
                rolesAPI.getAll(isSuperAdmin ? { companyId } : undefined)
            ]);
            if (!loadRequestGuard.current.isCurrent(requestId)) return;
            setUsers(usersRes.data.data);
            setBranches(branchesRes.data.data);
            setAvailableRoles(rolesRes.data.data || []);

            if (isSuperAdmin && companies.length === 0) {
                const compRes = await companiesAPI.getAll();
                if (!loadRequestGuard.current.isCurrent(requestId)) return;
                setCompanies(compRes.data.data);
            }
            setLoadError(null);
        } catch (error) {
            if (!loadRequestGuard.current.isCurrent(requestId)) return;
            console.error('Error loading data:', error);
            setLoadError(getApiErrorMessage(error, 'No se pudieron cargar los usuarios y sus catálogos (la consulta y las acciones quedan bloqueadas hasta reintentar)'));
        } finally {
            if (loadRequestGuard.current.isCurrent(requestId)) setLoading(false);
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
                color: user.color || '',
                accountType: user.accountType || (user.employee ? 'INTERNAL' : 'EXTERNAL')
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
                color: '',
                accountType: 'EXTERNAL'
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

        if (editingUser?.employee && formData.accountType === 'EXTERNAL') {
            showError('La cuenta no puede convertirse en externa mientras conserve un expediente laboral histórico.');
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
                color: formData.color || null,
                accountType: formData.accountType
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

    const roleNamesOf = (u: User) => (u.userRoles ? u.userRoles.map(ur => ur.role.name) : [u.role?.name || '']).filter(Boolean);

    const columns: Column<User>[] = [
        {
            key: 'name',
            header: 'Usuario',
            render: (u) => (
                <span className={styles.cellTitle}>
                    <span className={styles.swatch} style={{ background: u.color || 'var(--ui-border)' }} aria-hidden="true" />
                    <span className={styles.cellStack}>
                        <span>{u.name}</span>
                        <span className={styles.muted}>@{u.username}</span>
                    </span>
                </span>
            )
        },
        { key: 'email', header: 'Email', accessor: (u) => u.email || '—', hideBelow: 'lg' },
        {
            key: 'roles',
            header: 'Rol',
            render: (u) => (
                <div className={styles.inline}>
                    {roleNamesOf(u).map((rn) => <Badge key={rn} tone="primary">{rn}</Badge>)}
                </div>
            )
        },
        { key: 'branch', header: 'Sucursal', accessor: (u) => u.branch?.name || 'Todas las sucursales' },
        ...(isSuperAdmin ? [{
            key: 'company',
            header: 'Empresa',
            accessor: (u: User) => u.company?.name || '—'
        }] : []),
        {
            key: 'accountType',
            header: 'Tipo',
            render: (u) => {
                const accountType = u.accountType || (u.employee ? 'INTERNAL' : 'EXTERNAL');
                return (
                    <div className={styles.cellStack}>
                        <span>{accountType === 'INTERNAL' ? 'Interno' : 'Externo'}</span>
                        {accountType === 'INTERNAL' && (
                            <span className={styles.muted}>
                                {u.employee ? `Expediente ${u.employee.employeeCode || u.employee.employeeNumber || `#${u.employee.id}`}` : 'Vínculo pendiente'}
                            </span>
                        )}
                    </div>
                );
            }
        },
        {
            key: 'status',
            header: 'Estado',
            render: (u) => <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'} dot>{u.status === 'ACTIVE' ? 'Activo' : 'Inactivo'}</Badge>
        },
        {
            key: 'actions',
            header: 'Acciones',
            type: 'actions',
            width: '100px',
            render: (u) => (
                <div className={styles.rowActions}>
                    <IconButton size="sm" icon={Pencil} tooltip="Editar" label={`Editar ${u.name}`} onClick={() => handleOpenSidebar(u)} />
                    {canManageUserStatus && (
                        <IconButton
                            size="sm"
                            icon={Power}
                            tone={u.status === 'ACTIVE' ? 'danger' : 'primary'}
                            tooltip={u.status === 'ACTIVE' ? 'Desactivar' : 'Activar'}
                            label={u.status === 'ACTIVE' ? `Inhabilitar ${u.name} sin borrar historial` : `Reactivar ${u.name}`}
                            onClick={() => handleStatusChange(u)}
                        />
                    )}
                </div>
            )
        }
    ] as Column<User>[];

    const activeBranchOptions = isSuperAdmin
        ? [
            { value: '', label: 'Ninguna (Global / Superadmin)' },
            ...branches.filter(b => formData.branchIds.includes(b.id.toString())).map(b => ({ value: b.id.toString(), label: b.name }))
        ]
        : [
            { value: '', label: 'Sin sucursal' },
            ...branches.map(b => ({ value: b.id.toString(), label: b.name }))
        ];

    return (
        <PageContent>
            <PageHeader
                title="Usuarios"
                description="Cuentas de acceso, roles y sucursales permitidas"
                actions={(
                    <Button variant="primary" icon={Plus} onClick={() => handleOpenSidebar()} disabled={Boolean(loadError)}>
                        Nuevo usuario
                    </Button>
                )}
            />

            {loadError ? (
                <LoadErrorState
                    message={loadError}
                    onRetry={() => { void loadData(lastRequestedCompanyId.current, true); }}
                />
            ) : (
                <DataTable<User>
                    ariaLabel="Listado de usuarios"
                    rows={filteredUsers}
                    rowKey={(u) => u.id}
                    columns={columns}
                    loading={loading && users.length === 0}
                    resetKey={`${searchQuery}|${roleFilter}|${statusFilter}`}
                    onRowClick={(u) => handleOpenSidebar(u)}
                    empty={(
                        <EmptyState
                            icon={UsersIcon}
                            title="No se encontraron usuarios"
                            description="Intenta ajustar los filtros o crear un nuevo usuario para comenzar."
                        />
                    )}
                    toolbar={(
                        <TableToolbar>
                            <Input
                                type="search"
                                aria-label="Buscar usuarios"
                                placeholder="Buscar por nombre, usuario o email"
                                prefix={<Search size={14} aria-hidden="true" />}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                            <AppSelect isClearable={false} aria-label="Filtrar por rol" options={roleOptions} value={roleFilter} onChange={(v) => { if (v) setRoleFilter(String(v)); }} placeholder="Filtrar por rol" />
                            <SegmentedControl ariaLabel="Estado" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                        </TableToolbar>
                    )}
                />
            )}

            <FullScreenModal
                isOpen={isSidebarOpen}
                onClose={() => { setIsSidebarOpen(false); setActiveTab('perfil'); }}
                title={editingUser ? 'Editar usuario' : 'Nuevo usuario'}
                subtitle={editingUser ? `@${editingUser.username}` : undefined}
                breadcrumb={['Configuración', 'Usuarios']}
                tabs={[
                    { id: 'perfil', label: 'Perfil' },
                    { id: 'acceso', label: 'Rol y acceso' },
                ]}
                activeTab={activeTab}
                onTabChange={(id) => setActiveTab(id as 'perfil' | 'acceso')}
                footer={({ requestClose }) => (
                    <>
                        <Button onClick={requestClose}>Cancelar</Button>
                        <Button type="submit" form="user-form" variant="primary" loading={saving}>
                            {editingUser ? 'Guardar cambios' : 'Crear usuario'}
                        </Button>
                    </>
                )}
            >
                <form id="user-form" onSubmit={handleSubmit} className={styles.stack}>
                    {activeTab === 'perfil' && (
                        <FormSection step={1} title="Información de perfil" description="Datos con los que la persona inicia sesión.">
                            <FormGrid>
                                <Field label="Nombre completo" htmlFor="user-name" required>
                                    <Input
                                        id="user-name"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Ej: Juan Pérez"
                                        required
                                        autoFocus
                                    />
                                </Field>
                                <Field label="Email" htmlFor="user-email" required>
                                    <Input
                                        id="user-email"
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        placeholder="juan@empresa.com"
                                        required
                                    />
                                </Field>
                                <Field label="Nombre de usuario" htmlFor="user-username" required>
                                    <Input
                                        id="user-username"
                                        value={formData.username}
                                        onChange={e => setFormData({ ...formData, username: e.target.value })}
                                        placeholder="jperez"
                                        required
                                    />
                                </Field>
                                <Field
                                    label={editingUser ? 'Nueva contraseña' : 'Contraseña'}
                                    htmlFor="user-password"
                                    required={!editingUser}
                                    hint={editingUser ? 'Déjala en blanco para no cambiarla.' : undefined}
                                >
                                    <Input
                                        id="user-password"
                                        type="password"
                                        prefix={<Lock size={14} aria-hidden="true" />}
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                        required={!editingUser}
                                        maxLength={72}
                                        autoComplete="new-password"
                                        placeholder="Mín. 8: mayúscula, minúscula, número y símbolo"
                                    />
                                </Field>
                            </FormGrid>
                        </FormSection>
                    )}

                    {activeTab === 'acceso' && (
                        <>
                            <FormSection step={1} title="Cuenta" description="Tipo, estado y color identificador.">
                                <FormGrid>
                                    {isSuperAdmin && !editingUser && (
                                        <Field label="Empresa" htmlFor="user-company" required>
                                            <AppSelect
                                                isClearable={false}
                                                inputId="user-company"
                                                options={companies.map(c => ({ value: c.id.toString(), label: c.name }))}
                                                value={formData.companyId || null}
                                                onChange={(cid) => {
                                                    if (!cid) return;
                                                    setFormData({ ...formData, companyId: cid, branchId: '' });
                                                    loadData(cid);
                                                }}
                                                placeholder="Seleccionar empresa"
                                            />
                                        </Field>
                                    )}
                                    <Field
                                        label="Tipo de cuenta"
                                        htmlFor="user-account-type"
                                        hint={formData.accountType === 'INTERNAL'
                                            ? editingUser?.employee
                                                ? `Vinculado al expediente ${editingUser.employee.employeeCode || editingUser.employee.employeeNumber || `#${editingUser.employee.id}`} · ${editingUser.employee.status}.`
                                                : 'La cuenta quedará interna únicamente cuando exista un expediente laboral válido.'
                                            : 'Crea primero la cuenta externa y conviértela en interna desde Recursos Humanos > Personal, capturando el expediente y la fecha de ingreso.'}
                                    >
                                        <AppSelect isClearable={false} inputId="user-account-type" options={accountTypeOptions.filter((o) => o.value === formData.accountType)} value={formData.accountType} onChange={() => undefined} isDisabled />
                                    </Field>
                                    <Field label="Estado de cuenta" htmlFor="user-status">
                                        <AppSelect isClearable={false} isSearchable={false} inputId="user-status" options={accountStatusOptions} value={formData.status} onChange={(v) => { if (v) setFormData({ ...formData, status: String(v) as typeof formData.status }); }} isDisabled={!editingUser} />
                                    </Field>
                                    <Field label="Color identificador" htmlFor="user-color" hint={formData.color || 'Sin color'}>
                                        <div className={styles.inline}>
                                            <input
                                                id="user-color"
                                                type="color"
                                                className={styles.colorInput}
                                                style={{ width: 56 }}
                                                value={formData.color || '#6B7280'}
                                                onChange={e => setFormData({ ...formData, color: e.target.value })}
                                            />
                                            {formData.color && (
                                                <Button size="sm" variant="ghost" onClick={() => setFormData({ ...formData, color: '' })}>Quitar color</Button>
                                            )}
                                        </div>
                                    </Field>
                                </FormGrid>
                            </FormSection>

                            <FormSection step={2} title="Roles del sistema" description="Puede tener varios; el primero marcado es el principal.">
                                <div role="group" aria-label="Roles del sistema" className={styles.checkGrid}>
                                    {availableRoles.map(r => {
                                        const isChecked = formData.roleIds.includes(r.id.toString());
                                        return (
                                            <Checkbox
                                                key={r.id}
                                                label={r.name}
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
                                            />
                                        );
                                    })}
                                </div>
                            </FormSection>

                            <FormSection
                                step={3}
                                title="Sucursales"
                                description={isSuperAdmin
                                    ? 'El usuario solo verá información de su sucursal activa. El superadmin rota la sucursal activa entre las permitidas.'
                                    : undefined}
                            >
                                {isSuperAdmin && (
                                    <div role="group" aria-label="Sucursales permitidas (rotación)" className={styles.checkGrid}>
                                        {branches.map(b => {
                                            const bid = b.id.toString();
                                            const isChecked = formData.branchIds.includes(bid);
                                            return (
                                                <Checkbox
                                                    key={b.id}
                                                    label={b.name}
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
                                            );
                                        })}
                                    </div>
                                )}
                                <FormGrid>
                                    <Field label="Sucursal activa" htmlFor="user-active-branch">
                                        <AppSelect
                                            isClearable={false}
                                            inputId="user-active-branch"
                                            options={activeBranchOptions}
                                            value={formData.branchId}
                                            onChange={(v) => v !== null && setFormData({ ...formData, branchId: v })}
                                            placeholder={isSuperAdmin ? 'Ninguna (Global / Superadmin)' : 'Seleccionar sucursal'}
                                            isDisabled={!isSuperAdmin && !!editingUser}
                                        />
                                    </Field>
                                </FormGrid>
                            </FormSection>
                        </>
                    )}
                </form>
            </FullScreenModal>
        </PageContent>
    );
}
