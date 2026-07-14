export interface PermissionPresentation {
    label: string;
    description: string;
    group: string;
}

const ACTIONS: Record<string, { label: string; description: string }> = {
    view: { label: 'Consultar', description: 'consultar la información y sus detalles' },
    read: { label: 'Consultar', description: 'consultar la información y sus detalles' },
    create: { label: 'Crear', description: 'crear nuevos registros' },
    update: { label: 'Editar', description: 'modificar registros existentes' },
    edit: { label: 'Editar', description: 'modificar registros existentes' },
    delete: { label: 'Eliminar', description: 'eliminar registros cuando las reglas del sistema lo permitan' },
    manage: { label: 'Administrar', description: 'consultar, crear y modificar registros' },
    process: { label: 'Procesar', description: 'ejecutar el flujo operativo asociado' },
    export: { label: 'Exportar', description: 'descargar la información para análisis externo' },
    approve: { label: 'Aprobar', description: 'aprobar o rechazar solicitudes' },
    issue: { label: 'Emitir', description: 'emitir el documento correspondiente' },
    cancel: { label: 'Cancelar', description: 'cancelar registros respetando las reglas operativas' },
    reverse: { label: 'Revertir', description: 'revertir transacciones autorizadas' },
    split: { label: 'Dividir', description: 'dividir una cuenta entre varios pagos o comensales' },
    transfer: { label: 'Transferir', description: 'transferir la operación a otro destino autorizado' },
    consolidate: { label: 'Consolidar', description: 'unificar operaciones relacionadas' },
    deliver: { label: 'Entregar', description: 'marcar productos u órdenes como entregados' },
    publish: { label: 'Publicar', description: 'publicar información para que entre en vigencia' },
    review: { label: 'Revisar', description: 'revisar y resolver incidencias' },
    self: { label: 'Acceso propio', description: 'consultar o gestionar únicamente la información propia' },
};

const RESOURCES: Record<string, string> = {
    user: 'Usuarios', users: 'Usuarios', role: 'Roles y permisos', roles: 'Roles y permisos', permissions: 'Permisos',
    branch: 'Sucursales', branches: 'Sucursales', table: 'Mesas', tables: 'Mesas', order: 'Órdenes', orders: 'Órdenes',
    pos: 'Punto de venta', payments: 'Pagos', invoices: 'Facturas', bills: 'Cuentas', kds: 'Cocina y KDS',
    kitchen: 'Cocina y KDS', menu: 'Menú', products: 'Productos', inventory: 'Inventario',
    purchases: 'Compras', suppliers: 'Proveedores', catering: 'Catering', reports: 'Reportes',
    reservations: 'Reservaciones', cash: 'Caja', settings: 'Configuración', recipes: 'Recetas', production: 'Producción',
};

const titleCase = (value: string) => value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function describePermission(name: string, storedDescription?: string | null): PermissionPresentation {
    const normalized = name.trim().toLowerCase();
    const tokens = normalized.split(/[._:-]+/).filter(Boolean);
    const actionFirst = !!ACTIONS[tokens[0]] && tokens.length > 1;
    const resourceKey = actionFirst ? tokens.slice(1).join(' ') : (tokens[0] || normalized);
    const actionKey = actionFirst ? tokens[0] : ([...tokens].reverse().find((token) => ACTIONS[token]) || 'manage');
    const resource = RESOURCES[resourceKey] || titleCase(resourceKey || 'Sistema');
    const action = ACTIONS[actionKey];
    return {
        label: `${action.label} ${resource}`,
        description: storedDescription?.trim() || `Permite ${action.description} en ${resource.toLowerCase()}.`,
        group: resource,
    };
}
