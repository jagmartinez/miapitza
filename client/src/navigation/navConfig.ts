import {
    LayoutDashboard,
    Utensils,
    ChefHat,
    Calendar,
    ConciergeBell,
    ShoppingCart,
    Wallet,
    UtensilsCrossed,
    Library,
    Tag,
    Tags,
    Ticket,
    Package,
    Ruler,
    Warehouse,
    Landmark,
    TrendingDown,
    BarChart3,
    Truck,
    ShoppingBag,
    FlaskConical,
    Factory,
    FileText,
    ClipboardList,
    Briefcase,
    Users,
    SlidersHorizontal,
    BadgeDollarSign,
    MapPin,
    Zap,
    Building2,
    Grid3x3,
    BookOpen,
    ClipboardCheck,
    MessageSquare,
    Clock3,
    type LucideIcon,
} from 'lucide-react';
import type { User } from '../types';
import { getUserRoleNames, hasPermission } from '../utils/authz';
import {
    ROLES,
    WAITER_TABLE,
    KITCHEN_ROLES,
    HOST_ROLES,
    CASHIER,
    OPS,
    CHEF_MGMT,
    ADMIN,
    WAREHOUSE,
    HR_OWNER,
    PLATFORM_ADMIN,
} from '../constants/roles';

export type AuthUser = User;

export interface NavItem {
    id: string;
    label: string;
    to: string;
    icon: LucideIcon;
    permission?: string;
    roles?: readonly string[];
    /** Solo para empleados internos con ficha de RH. */
    internalOnly?: boolean;
}
export interface NavGroup { id: string; label: string; items: NavItem[] }

const ALL_ROLES: string[] = Object.values(ROLES);

export const NAV_GROUPS: NavGroup[] = [
    {
        id: 'operacion',
        label: 'Operación',
        items: [
            { id: 'dashboard', to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
            { id: 'tables', to: '/tables', icon: Utensils, label: 'Mesas', roles: WAITER_TABLE, permission: 'tables.map.view' },
            { id: 'kitchen', to: '/kitchen', icon: ChefHat, label: 'Cocina', roles: KITCHEN_ROLES, permission: 'kds.view' },
            { id: 'reservations', to: '/reservations', icon: Calendar, label: 'Reservaciones', roles: HOST_ROLES },
            { id: 'catering', to: '/catering', icon: ConciergeBell, label: 'Catering', roles: CASHIER },
            { id: 'orders', to: '/orders', icon: ShoppingCart, label: 'Órdenes', roles: OPS, permission: 'orders.view' },
            { id: 'cash-registers', to: '/cash-registers', icon: Wallet, label: 'Caja', roles: CASHIER },
            { id: 'menu', to: '/menu', icon: UtensilsCrossed, label: 'Menú', roles: CHEF_MGMT, permission: 'view_menu' },
            { id: 'catering-services', to: '/catering-services', icon: Library, label: 'Catálogo Catering', roles: CASHIER },
            { id: 'categories', to: '/categories', icon: Tag, label: 'Categorías', roles: CHEF_MGMT, permission: 'view_menu' },
            { id: 'menu-brands', to: '/menu-brands', icon: Tags, label: 'Marcas', roles: CHEF_MGMT, permission: 'view_menu' },
            { id: 'promotions', to: '/promotions', icon: Ticket, label: 'Promociones', roles: ADMIN },
        ],
    },
    {
        id: 'inventario',
        label: 'Inventario',
        items: [
            { id: 'inventory', to: '/inventory', icon: Package, label: 'Inventario', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'units-of-measure', to: '/units-of-measure', icon: Ruler, label: 'Unidades de Medida', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'inventario-conteos', to: '/inventario/conteos', icon: ClipboardCheck, label: 'Conteos de inventario', roles: ADMIN },
            { id: 'warehouses', to: '/warehouses', icon: Warehouse, label: 'Bodegas', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'waste-report', to: '/waste-report', icon: TrendingDown, label: 'Reporte Mermas', roles: ADMIN, permission: 'view_reports' },
            { id: 'cost-report', to: '/cost-report', icon: BarChart3, label: 'Reporte Costos', roles: ADMIN, permission: 'view_reports' },
        ],
    },
    {
        id: 'compras',
        label: 'Compras',
        items: [
            { id: 'suppliers', to: '/suppliers', icon: Truck, label: 'Proveedores', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'purchase-orders', to: '/purchase-orders', icon: ShoppingBag, label: 'Órdenes de Compra', roles: WAREHOUSE, permission: 'view_inventory' },
        ],
    },
    {
        id: 'produccion',
        label: 'Producción',
        items: [
            { id: 'production-recipes', to: '/production-recipes', icon: FlaskConical, label: 'Recetas de Producción', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'production-orders', to: '/production-orders', icon: Factory, label: 'Producción', roles: WAREHOUSE, permission: 'view_inventory' },
            { id: 'production-dashboard', to: '/production-dashboard', icon: BarChart3, label: 'Panel de Producción', roles: WAREHOUSE, permission: 'view_inventory' },
        ],
    },
    {
        id: 'finanzas',
        label: 'Finanzas',
        items: [
            { id: 'invoices', to: '/invoices', icon: FileText, label: 'Facturas', roles: CASHIER, permission: 'invoices.view' },
            { id: 'bank-reconciliation', to: '/bank-reconciliation', icon: Wallet, label: 'Conciliación Bancaria', roles: ADMIN, permission: 'view_reports' },
            { id: 'encuestas', to: '/encuestas', icon: MessageSquare, label: 'Encuestas NPS', roles: ADMIN, permission: 'surveys.view' },
            { id: 'reporteria', to: '/reporteria', icon: ClipboardList, label: 'Reportería', roles: ADMIN, permission: 'view_reports' },
        ],
    },
    {
        id: 'rh',
        label: 'Recursos humanos',
        items: [
            { id: 'rh', to: '/rh', icon: Briefcase, label: 'Panel RH', roles: HR_OWNER, permission: 'hr.dashboard.read' },
            { id: 'rh-personal', to: '/rh/personal', icon: Users, label: 'Personal', roles: HR_OWNER, permission: 'hr.employee.read' },
            { id: 'rh-horarios', to: '/rh/horarios', icon: Calendar, label: 'Horarios', roles: HR_OWNER, permission: 'hr.schedule.read' },
            { id: 'rh-jornadas-config', to: '/rh/horarios/jornadas', icon: Clock3, label: 'Jornadas configuradas', roles: HR_OWNER, permission: 'hr.schedule.read' },
            { id: 'rh-asistencia', to: '/rh/asistencia', icon: ClipboardList, label: 'Asistencia', roles: HR_OWNER, permission: 'hr.attendance.review' },
            { id: 'rh-jornadas', to: '/rh/jornadas', icon: ClipboardList, label: 'Jornadas y extras', roles: HR_OWNER, permission: 'hr.workforce.read' },
            { id: 'rh-ausencias', to: '/rh/ausencias', icon: Calendar, label: 'Solicitudes y vacaciones', roles: HR_OWNER, permission: 'hr.workforce.read' },
            { id: 'rh-nomina', to: '/rh/nomina', icon: Wallet, label: 'Nómina y aguinaldo', roles: HR_OWNER, permission: 'hr.payroll.read' },
            { id: 'rh-configuracion-legal', to: '/rh/nomina/configuracion-legal', icon: Landmark, label: 'Reglas IR, INSS e INATEC', roles: HR_OWNER, permission: 'hr.payroll.manage' },
            { id: 'rh-prestaciones', to: '/rh/prestaciones', icon: BadgeDollarSign, label: 'Préstamos y viáticos', roles: HR_OWNER, permission: 'hr.benefits.read' },
            { id: 'rh-asistencia-configuracion', to: '/rh/asistencia/configuracion', icon: SlidersHorizontal, label: 'Configurar asistencia', roles: HR_OWNER, permission: 'hr.attendance.manage' },
        ],
    },
    {
        id: 'config',
        label: 'Configuración',
        items: [
            { id: 'users', to: '/users', icon: Users, label: 'Usuarios', roles: ADMIN, permission: 'view_users' },
            { id: 'branches', to: '/branches', icon: MapPin, label: 'Sucursales', roles: ADMIN, permission: 'view_branches' },
            { id: 'integraciones-pedidosya', to: '/integraciones/pedidosya', icon: Zap, label: 'PedidosYa', roles: ADMIN },
            { id: 'companies', to: '/companies', icon: Building2, label: 'Empresas', roles: PLATFORM_ADMIN },
            { id: 'roles-permissions', to: '/roles-permissions', icon: Users, label: 'Roles y Permisos', roles: ADMIN },
            { id: 'settings', to: '/settings', icon: Grid3x3, label: 'Configuración', roles: ADMIN },
            { id: 'manual', to: '/manual', icon: BookOpen, label: 'Manual', roles: ALL_ROLES },
        ],
    },
];

/** Mismas reglas que tenía Layout.tsx: roles del usuario e internalOnly para empleados internos. */
export function visibleNav(groups: NavGroup[], user: AuthUser | null | undefined): NavGroup[] {
    const roleNames = getUserRoleNames(user);
    const isInternalEmployee = user?.accountType === 'INTERNAL' && Boolean(user.employeeId);
    return groups
        .map((group) => ({
            ...group,
            items: group.items.filter(
                (item) =>
                    (item.permission
                        ? hasPermission(user, item.permission, item.roles ? [...item.roles] : undefined)
                        : !item.roles || roleNames.some((r) => item.roles!.includes(r))) &&
                    (!item.internalOnly || isInternalEmployee),
            ),
        }))
        .filter((group) => group.items.length > 0);
}

/** Ítem activo: la ruta más específica que coincide con la actual. */
export function activeNavId(groups: NavGroup[], pathname: string): string | undefined {
    let best: NavItem | undefined;
    for (const g of groups) for (const it of g.items) {
        const match = pathname === it.to || pathname.startsWith(it.to + '/');
        if (match && (!best || it.to.length > best.to.length)) best = it;
    }
    return best?.id;
}
