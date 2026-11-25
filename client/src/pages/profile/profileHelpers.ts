export type ProfileTab = 'resumen' | 'seguridad' | 'preferencias' | 'notificaciones';

export const PROFILE_TABS: { id: ProfileTab; label: string }[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'seguridad', label: 'Seguridad y accesos' },
    { id: 'preferencias', label: 'Preferencias' },
    { id: 'notificaciones', label: 'Notificaciones' },
];

/** Los enlaces antiguos (`?tab=hr`, `?tab=2fa`...) siguen abriendo la pestaña que ahora contiene esa información. */
const LEGACY_TAB: Record<string, ProfileTab> = {
    info: 'resumen',
    hr: 'resumen',
    stats: 'resumen',
    permissions: 'seguridad',
    security: 'seguridad',
    sessions: 'seguridad',
    '2fa': 'seguridad',
    settings: 'preferencias',
};

export function resolveProfileTab(param: string | null): ProfileTab {
    if (!param) return 'resumen';
    if (PROFILE_TABS.some((t) => t.id === param)) return param as ProfileTab;
    return LEGACY_TAB[param] ?? 'resumen';
}

export function axiosErr(err: unknown, fallback: string): string {
    if (typeof err === 'object' && err !== null && 'response' in err) {
        const m = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        if (typeof m === 'string' && m) return m;
    }
    return fallback;
}

export interface Completeness {
    pct: number;
    missing: string[];
}

/** Completitud real del perfil: campos personales llenos y expediente laboral vinculado (solo cuentas internas). */
export function profileCompleteness(
    data: { name?: string; email?: string; nif?: string; phone?: string; address?: string },
    employeeLinked: boolean | null,
): Completeness {
    const checks: [string, boolean][] = [
        ['nombre', Boolean(data.name?.trim())],
        ['correo', Boolean(data.email?.trim())],
        ['cédula', Boolean(data.nif?.trim())],
        ['teléfono', Boolean(data.phone?.trim())],
        ['dirección', Boolean(data.address?.trim())],
    ];
    if (employeeLinked !== null) checks.push(['expediente laboral', employeeLinked]);
    const filled = checks.filter(([, ok]) => ok).length;
    return {
        pct: Math.round((filled / checks.length) * 100),
        missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
    };
}

export const HOME_PAGE_OPTIONS = [
    { value: '/dashboard', label: 'Panel principal' },
    { value: '/pos', label: 'Punto de venta' },
    { value: '/orders', label: 'Órdenes' },
    { value: '/kitchen', label: 'Cocina' },
    { value: '/tables', label: 'Mesas' },
    { value: '/reporteria', label: 'Reportería' },
];

export const NOTIFICATION_EVENTS: { id: string; label: string; hint: string }[] = [
    { id: 'approvals', label: 'Aprobaciones pendientes', hint: 'Solicitudes que esperan tu decisión' },
    { id: 'lowStock', label: 'Stock bajo', hint: 'Productos por debajo del mínimo' },
    { id: 'cashShift', label: 'Turnos de caja', hint: 'Aperturas, cierres y diferencias' },
    { id: 'reservations', label: 'Reservaciones', hint: 'Nuevas reservaciones y cambios' },
    { id: 'payroll', label: 'Nómina', hint: 'Recibos y cierres de quincena' },
];

export const NOTIFICATION_CHANNELS: { id: string; label: string }[] = [
    { id: 'app', label: 'En la app' },
    { id: 'email', label: 'Correo' },
];
