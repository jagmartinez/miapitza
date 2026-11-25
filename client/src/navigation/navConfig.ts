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
    ArrowUpDown,
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
    UserRoundCheck,
    Zap,
    Building2,
    Grid3x3,
    BookOpen,
    type LucideIcon,
} from 'lucide-react';
import type { User } from '../types';
import { getUserRoleNames } from '../utils/authz';
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
            { id: 'tables', to: '/tables', icon: Utensils, label: 'Mesas', roles: WAITER_TABLE },
            { id: 'kitchen', to: '/kitchen', icon: ChefHat, label: 'Cocina', roles: KITCHEN_ROLES },
            { id: 'reservations', to: '/reservations', icon: Calendar, label: 'Reservaciones', roles: HOST_ROLES },
            { id: 'catering', to: '/catering', icon: ConciergeBell, label: 'Catering', roles: CASHIER },
            { id: 'orders', to: '/orders', icon: ShoppingCart, label: 'Órdenes', roles: OPS },
            { id: 'cash-registers', to: '/cash-registers', icon: Wallet, label: 'Caja', roles: CASHIER },
            { id: 'menu', to: '/menu', icon: UtensilsCrossed, label: 'Menú', roles: CHEF_MGMT },
            { id: 'catering-services', to: '/catering-services', icon: Library, label: 'Catálogo Catering', roles: CASHIER },
            { id: 'categories', to: '/categories', icon: Tag, label: 'Categorías', roles: CHEF_MGMT },
            { id: 'menu-brands', to: '/menu-brands', icon: Tags, label: 'Marcas', roles: CHEF_MGMT },
            { id: 'promotions', to: '/promotions', icon: Ticket, label: 'Promociones', roles: ADMIN },
        ],
    },
    {
        id: 'inventario',
        label: 'Inventario',
        items: [
            { id: 'inventory', to: '/inventory', icon: Package, label: 'Inventario', roles: WAREHOUSE },
            { id: 'units-of-measure', to: '/units-of-measure', icon: Ruler, label: 'Unidades de Medida', roles: WAREHOUSE },
            { id: 'warehouses', to: '/warehouses', icon: Warehouse, label: 'Bodegas', roles: WAREHOUSE },
            { id: 'kardex', to: '/kardex', icon: ArrowUpDown, label: 'Kardex', roles: WAREHOUSE },
            { id: 'waste-report', to: '/waste-report', icon: TrendingDown, label: 'Reporte Mermas', roles: ADMIN },
            { id: 'cost-report', to: '/cost-report', icon: BarChart3, label: 'Reporte Costos', roles: ADMIN },
        ],
    },
    {
        id: 'compras',
        label: 'Compras',
        items: [
            { id: 'suppliers', to: '/suppliers', icon: Truck, label: 'Proveedores', roles: WAREHOUSE },
            { id: 'purchase-orders', to: '/purchase-orders', icon: ShoppingBag, label: 'Órdenes de Compra', roles: WAREHOUSE },
        ],
    },
    {
        id: 'produccion',
        label: 'Producción',
        items: [
            { id: 'production-recipes', to: '/production-recipes', icon: FlaskConical, label: 'Recetas de Producción', roles: WAREHOUSE },
            { id: 'production-orders', to: '/production-orders', icon: Factory, label: 'Producción', roles: WAREHOUSE },
            { id: 'production-dashboard', to: '/production-dashboard', icon: BarChart3, label: 'Panel de Producción', roles: WAREHOUSE },
        ],
    },
    {
        id: 'finanzas',
        label: 'Finanzas',
        items: [
            { id: 'invoices', to: '/invoices', icon: FileText, label: 'Facturas', roles: CASHIER },
            { id: 'bank-reconciliation', to: '/bank-reconciliation', icon: Wallet, label: 'Conciliación Bancaria', roles: ADMIN },
            { id: 'reporteria', to: '/reporteria', icon: ClipboardList, label: 'Reportería', roles: ADMIN },
        ],
    },
    {
        id: 'rh',
        label: 'Recursos humanos',
        items: [
            { id: 'rh', to: '/rh', icon: Briefcase, label: 'Panel RH', roles: HR_OWNER },
            { id: 'rh-personal', to: '/rh/personal', icon: Users, label: 'Personal', roles: HR_OWNER },
            { id: 'rh-horarios', to: '/rh/horarios', icon: Calendar, label: 'Horarios', roles: HR_OWNER },
            { id: 'rh-asistencia', to: '/rh/asistencia', icon: ClipboardList, label: 'Asistencia', roles: HR_OWNER },
            { id: 'rh-asistencia-configuracion', to: '/rh/asistencia/configuracion', icon: SlidersHorizontal, label: 'Configurar asistencia', roles: HR_OWNER },
            { id: 'rh-jornadas', to: '/rh/jornadas', icon: ClipboardList, label: 'Jornadas y extras', roles: HR_OWNER },
            { id: 'rh-ausencias', to: '/rh/ausencias', icon: Calendar, label: 'Permisos y vacaciones', roles: HR_OWNER },
            { id: 'rh-nomina', to: '/rh/nomina', icon: Wallet, label: 'Nómina y aguinaldo', roles: HR_OWNER },
            { id: 'rh-prestaciones', to: '/rh/prestaciones', icon: BadgeDollarSign, label: 'Viáticos, préstamos y deducciones', roles: HR_OWNER },
            { id: 'rh-mi-portal-horario', to: '/rh/mi-portal/horario', icon: Calendar, label: 'Mi horario', internalOnly: true },
            { id: 'rh-marcaje', to: '/rh/marcaje', icon: MapPin, label: 'Marcaje', internalOnly: true },
            { id: 'rh-biometria', to: '/rh/biometria', icon: UserRoundCheck, label: 'Mi biometría', internalOnly: true },
            { id: 'rh-mi-portal-gestion', to: '/rh/mi-portal/gestion', icon: Briefcase, label: 'Mi gestión RH', internalOnly: true },
            { id: 'rh-mi-portal-nomina', to: '/rh/mi-portal/nomina', icon: Wallet, label: 'Mis recibos', internalOnly: true },
            { id: 'rh-mi-portal-prestaciones', to: '/rh/mi-portal/prestaciones', icon: BadgeDollarSign, label: 'Mis prestaciones', internalOnly: true },
        ],
    },
    {
        id: 'config',
        label: 'Configuración',
        items: [
            { id: 'users', to: '/users', icon: Users, label: 'Usuarios', roles: ADMIN },
            { id: 'branches', to: '/branches', icon: MapPin, label: 'Sucursales', roles: ADMIN },
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
                    (!item.roles || roleNames.some((r) => item.roles!.includes(r))) &&
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
