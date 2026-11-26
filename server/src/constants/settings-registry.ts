export type SettingType = 'string' | 'number' | 'integer' | 'boolean' | 'enum';
export type SettingGroup = 'organizacion' | 'ventas' | 'operacion' | 'metas' | 'rrhh' | 'seguridad';

export interface SettingDef {
    key: string;
    type: SettingType;
    default: string;
    group: SettingGroup;
    section: string;
    label: string;
    description: string;
    /** Numbers: minimum value. Strings: minimum length. */
    min?: number;
    /** Numbers: maximum value. Strings: maximum length. */
    max?: number;
    options?: { value: string; label: string }[];
    prefix?: string;
    suffix?: string;
    branchable: boolean;
    readOnly?: 'system' | 'legal-version';
}

export interface SettingSection {
    id: string;
    group: SettingGroup;
    title: string;
    description: string;
    note?: string;
}

export const SETTINGS_SECTIONS: readonly SettingSection[] = [
    { id: 'empresa', group: 'organizacion', title: 'Empresa', description: 'Datos fiscales y regionales del negocio.' },
    { id: 'facturacion', group: 'ventas', title: 'Facturación e impuestos', description: 'Impuesto, series y pie de los comprobantes.' },
    { id: 'propinas', group: 'ventas', title: 'Propinas y cobro', description: 'Propina sugerida, redondeo y precios con impuesto.' },
    { id: 'canales', group: 'ventas', title: 'Canales de venta', description: 'Comisiones de plataformas de reparto.' },
    { id: 'caja', group: 'operacion', title: 'Caja', description: 'Fondo inicial, retiros forzados y arqueo.' },
    { id: 'inventario', group: 'operacion', title: 'Inventario', description: 'Venta sin existencias, mermas y cobertura.' },
    { id: 'cocina', group: 'operacion', title: 'Cocina y salón', description: 'Tiempos de cocina y ventana de reservas.' },
    { id: 'metas', group: 'metas', title: 'Metas del negocio', description: 'Objetivos que alimentan los tableros de BI.', note: 'Una sucursal puede tener su propia meta; si no, hereda la de la empresa.' },
    { id: 'finanzas', group: 'metas', title: 'Finanzas', description: 'Gastos fijos y referencias financieras.' },
    { id: 'seguridad', group: 'seguridad', title: 'Seguridad', description: 'Sesiones, contraseñas y autenticación.' }
];

type DefInput = Omit<SettingDef, 'branchable'> & { branchable?: boolean };
const D = (def: DefInput): SettingDef => ({ branchable: false, ...def });

export const SETTINGS_REGISTRY: readonly SettingDef[] = [
    // Empresa
    D({ key: 'restaurant_name', type: 'string', default: 'Mi Restaurante', group: 'organizacion', section: 'empresa', label: 'Nombre comercial', description: 'Aparece en tickets y facturas.', min: 1, max: 120 }),
    D({ key: 'ruc', type: 'string', default: '', group: 'organizacion', section: 'empresa', label: 'RUC', description: 'Identificación fiscal de la empresa.', max: 40 }),
    D({ key: 'timezone', type: 'string', default: 'America/Managua', group: 'organizacion', section: 'empresa', label: 'Zona horaria', description: 'Define el cierre de día y los reportes.', min: 1, max: 64 }),
    D({ key: 'currency_symbol', type: 'string', default: 'C$', group: 'organizacion', section: 'empresa', label: 'Símbolo de moneda', description: 'Se antepone a los importes.', min: 1, max: 5 }),
    // Facturación
    D({ key: 'tax_rate', type: 'number', default: '15', group: 'ventas', section: 'facturacion', label: 'Impuesto (IVA)', description: 'Tasa aplicada a las ventas.', min: 0, max: 100, suffix: '%' }),
    D({ key: 'invoicePrefix', type: 'string', default: 'F', group: 'ventas', section: 'facturacion', label: 'Prefijo de factura', description: 'Prefijo de la numeración de facturas.', max: 10 }),
    D({ key: 'credit_note_series', type: 'string', default: 'NC', group: 'ventas', section: 'facturacion', label: 'Serie de nota de crédito', description: 'Prefijo de la numeración de notas de crédito.', max: 10 }),
    D({ key: 'invoiceFooter', type: 'string', default: '', group: 'ventas', section: 'facturacion', label: 'Pie del comprobante', description: 'Texto al final de tickets y facturas.', max: 191 }),
    D({ key: 'fiscal_tax_id_length', type: 'integer', default: '14', group: 'ventas', section: 'facturacion', label: 'Longitud del identificador fiscal', description: 'Caracteres esperados en la cédula o RUC del cliente.', min: 1, max: 40 }),
    D({ key: 'fiscal_jurisdiction', type: 'string', default: '', group: 'ventas', section: 'facturacion', label: 'Jurisdicción fiscal', description: 'Código definido por la empresa. Sin él, notas de crédito y anulaciones quedan bloqueadas.', max: 32 }),
    D({ key: 'fiscal_tax_id_charset', type: 'enum', default: '', group: 'ventas', section: 'facturacion', label: 'Caracteres del identificador fiscal', description: 'Tipo de caracteres permitidos en RUC/NIT.', options: [{ value: 'DIGITS', label: 'Solo dígitos' }, { value: 'ALPHANUMERIC', label: 'Alfanumérico y guion' }] }),
    // Propinas y cobro
    D({ key: 'tipEnabled', type: 'boolean', default: 'false', group: 'ventas', section: 'propinas', label: 'Propina sugerida', description: 'Agrega la propina sugerida a la cuenta.', branchable: true }),
    D({ key: 'tipRate', type: 'number', default: '0', group: 'ventas', section: 'propinas', label: 'Porcentaje de propina', description: 'Porcentaje sobre el subtotal.', min: 0, max: 100, suffix: '%', branchable: true }),
    D({ key: 'pos.priceIncludesTax', type: 'boolean', default: 'true', group: 'ventas', section: 'propinas', label: 'Precios incluyen impuesto', description: 'Los precios del menú ya traen el impuesto.' }),
    D({ key: 'pos.cashRounding', type: 'enum', default: 'none', group: 'ventas', section: 'propinas', label: 'Redondeo en efectivo', description: 'Redondeo del total pagado en efectivo.', options: [{ value: 'none', label: 'Sin redondeo' }, { value: '0.50', label: 'A 0.50' }, { value: '1.00', label: 'A 1.00' }] }),
    // Canales
    D({ key: 'channel.pedidosYaCommissionPct', type: 'number', default: '18', group: 'ventas', section: 'canales', label: 'Comisión PedidosYa', description: 'Comisión retenida por la plataforma.', min: 0, max: 100, suffix: '%' }),
    // Caja
    D({ key: 'cash.openingFloat', type: 'number', default: '2000', group: 'operacion', section: 'caja', label: 'Fondo inicial de caja', description: 'Efectivo con el que abre cada turno.', min: 0, prefix: 'C$', branchable: true }),
    D({ key: 'cash.forcedDropAbove', type: 'number', default: '30000', group: 'operacion', section: 'caja', label: 'Retiro forzado desde', description: 'Efectivo en caja que obliga a hacer un retiro.', min: 0, prefix: 'C$', branchable: true }),
    D({ key: 'cash.closeWithDifferenceNeedsSupervisor', type: 'boolean', default: 'true', group: 'operacion', section: 'caja', label: 'Cierre con diferencia requiere supervisor', description: 'Exige autorización si el arqueo no cuadra.' }),
    D({ key: 'cash_reconciliation_tolerance', type: 'number', default: '1', group: 'operacion', section: 'caja', label: 'Tolerancia de arqueo', description: 'Diferencia aceptada sin autorización.', min: 0, prefix: 'C$', branchable: true }),
    // Inventario
    D({ key: 'inventory.sellWithoutStock', type: 'enum', default: 'warn', group: 'operacion', section: 'inventario', label: 'Venta sin existencias', description: 'Qué hace el POS cuando no hay stock.', options: [{ value: 'block', label: 'Bloquear' }, { value: 'warn', label: 'Advertir' }, { value: 'allow', label: 'Permitir' }] }),
    D({ key: 'inventory.wasteTolerancePct', type: 'number', default: '3', group: 'operacion', section: 'inventario', label: 'Tolerancia de merma', description: 'Merma aceptada antes de alertar.', min: 0, max: 100, suffix: '%', branchable: true }),
    D({ key: 'inventory.coverageDays', type: 'integer', default: '7', group: 'operacion', section: 'inventario', label: 'Días de cobertura', description: 'Cobertura objetivo de inventario.', min: 1, max: 365, suffix: 'días', branchable: true }),
    // Cocina
    D({ key: 'kitchen.targetMinutes', type: 'integer', default: '15', group: 'operacion', section: 'cocina', label: 'Tiempo objetivo de cocina', description: 'Minutos objetivo por comanda.', min: 1, max: 240, suffix: 'min', branchable: true }),
    D({ key: 'kitchen.newTicketSound', type: 'boolean', default: 'true', group: 'operacion', section: 'cocina', label: 'Sonido de comanda nueva', description: 'Suena en la pantalla de cocina.' }),
    D({ key: 'kds_warning_minutes', type: 'integer', default: '3', group: 'operacion', section: 'cocina', label: 'Aviso KDS', description: 'Minutos para marcar una comanda en advertencia.', min: 1, max: 240, suffix: 'min', branchable: true }),
    D({ key: 'kds_urgent_minutes', type: 'integer', default: '10', group: 'operacion', section: 'cocina', label: 'Urgente KDS', description: 'Minutos para marcar una comanda como urgente.', min: 1, max: 240, suffix: 'min', branchable: true }),
    D({ key: 'reservation_table_window_minutes', type: 'integer', default: '120', group: 'operacion', section: 'cocina', label: 'Ventana de reserva por mesa', description: 'Minutos que una reserva bloquea la mesa.', min: 15, max: 720, suffix: 'min' }),
    // Metas
    D({ key: 'goal.monthlySales', type: 'number', default: '0', group: 'metas', section: 'metas', label: 'Meta de ventas mensuales', description: 'Ventas objetivo del mes.', min: 0, prefix: 'C$', branchable: true }),
    D({ key: 'goal.foodCostPct', type: 'number', default: '32', group: 'metas', section: 'metas', label: 'Costo de alimentos objetivo', description: 'Porcentaje sobre ventas.', min: 0, max: 100, suffix: '%', branchable: true }),
    D({ key: 'goal.foodCostGapPts', type: 'number', default: '1', group: 'metas', section: 'metas', label: 'Brecha tolerada de costo', description: 'Puntos sobre la meta antes de alertar.', min: 0, max: 100, suffix: 'pts' }),
    D({ key: 'goal.grossMarginPct', type: 'number', default: '68', group: 'metas', section: 'metas', label: 'Margen bruto objetivo', description: 'Porcentaje sobre ventas.', min: 0, max: 100, suffix: '%' }),
    D({ key: 'goal.avgTicket', type: 'number', default: '550', group: 'metas', section: 'metas', label: 'Ticket promedio objetivo', description: 'Venta promedio por cuenta.', min: 0, prefix: 'C$', branchable: true }),
    D({ key: 'goal.laborCostMaxPct', type: 'number', default: '25', group: 'metas', section: 'metas', label: 'Costo laboral máximo', description: 'Porcentaje máximo sobre ventas.', min: 0, max: 100, suffix: '%', branchable: true }),
    D({ key: 'goal.operatingMarginPct', type: 'number', default: '25', group: 'metas', section: 'metas', label: 'Margen operativo objetivo', description: 'Porcentaje sobre ventas.', min: 0, max: 100, suffix: '%' }),
    // Finanzas
    D({ key: 'finance.fixedMonthlyExpenses', type: 'number', default: '0', group: 'metas', section: 'finanzas', label: 'Gastos fijos mensuales', description: 'Renta, servicios y otros gastos fijos.', min: 0, prefix: 'C$', branchable: true }),
    // Seguridad
    D({ key: 'password_expiry_days', type: 'integer', default: '90', group: 'seguridad', section: 'seguridad', label: 'Vencimiento de contraseña', description: '0 desactiva el vencimiento; sin valor se usan 90 días.', min: 0, max: 3650, suffix: 'días' }),
    D({ key: 'session_timeout_minutes', type: 'integer', default: '30', group: 'seguridad', section: 'seguridad', label: 'Cierre de sesión por inactividad', description: 'Minutos sin actividad.', min: 1, max: 1440, suffix: 'min' }),
    D({ key: 'security.twoFactorRequired', type: 'enum', default: 'none', group: 'seguridad', section: 'seguridad', label: 'Verificación en dos pasos', description: 'A quién se le exige.', options: [{ value: 'none', label: 'Nadie' }, { value: 'admins', label: 'Administradores' }, { value: 'all', label: 'Todos' }] }),
    D({ key: 'security.maxFailedLogins', type: 'integer', default: '5', group: 'seguridad', section: 'seguridad', label: 'Intentos fallidos de acceso', description: 'Intentos antes de bloquear la cuenta.', min: 1, max: 20 })
];

/** Keys the scoped API may write (every non read-only registry entry). */
export const WRITABLE_SETTING_KEYS: readonly string[] = SETTINGS_REGISTRY.filter((d) => !d.readOnly).map((d) => d.key);
