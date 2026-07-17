-- Tenant ADMIN is the highest authority provisioned inside customer companies.
-- Grant the canonical tenant-wide operational and RH permissions without
-- touching custom roles or removing any existing permission assignment.
INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
    ('hr.dashboard.read', 'Ver tablero de RH'),
    ('hr.employee.read', 'Ver expedientes de empleados'),
    ('hr.employee.manage', 'Administrar expedientes de empleados'),
    ('hr.employee.sensitive.view', 'Ver datos sensibles de empleados'),
    ('hr.catalog.read', 'Ver catálogos organizacionales de RH'),
    ('hr.catalog.manage', 'Administrar catálogos organizacionales de RH'),
    ('hr.geofence.read', 'Ver configuración de geocercas'),
    ('hr.geofence.manage', 'Administrar configuración de geocercas'),
    ('hr.schedule.read', 'Ver horarios de personal'),
    ('hr.schedule.manage', 'Administrar horarios de personal'),
    ('hr.schedule.publish', 'Publicar horarios de personal'),
    ('hr.schedule.self', 'Consultar horario propio'),
    ('hr.attendance.manage', 'Administrar asistencia'),
    ('hr.attendance.review', 'Revisar incidencias de asistencia'),
    ('hr.attendance.self', 'Registrar y consultar asistencia propia'),
    ('hr.biometric.self', 'Administrar biometría propia'),
    ('hr.biometric.manage', 'Administrar biometría del personal'),
    ('hr.attendance.device.manage', 'Administrar dispositivos de asistencia'),
    ('hr.workforce.read', 'Ver gestión de fuerza laboral'),
    ('hr.workforce.manage', 'Administrar gestión de fuerza laboral'),
    ('hr.workforce.approve', 'Aprobar solicitudes de fuerza laboral'),
    ('hr.workforce.self', 'Administrar solicitudes laborales propias'),
    ('hr.payroll.read', 'Ver nómina'),
    ('hr.payroll.manage', 'Preparar y calcular nómina'),
    ('hr.payroll.approve', 'Aprobar, pagar y revertir nómina'),
    ('hr.payroll.self', 'Consultar colillas propias'),
    ('hr.benefits.read', 'Ver beneficios laborales'),
    ('hr.benefits.manage', 'Administrar beneficios laborales'),
    ('hr.benefits.approve', 'Aprobar y revertir beneficios laborales'),
    ('hr.benefits.self', 'Consultar beneficios propios');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE r.`name` = 'ADMIN'
  AND r.`companyId` IS NOT NULL
  AND p.`name` IN (
    'view_users', 'create_user', 'edit_user', 'delete_user',
    'view_branches', 'create_branch', 'edit_branch', 'delete_branch',
    'view_orders', 'create_order', 'edit_order', 'delete_order',
    'view_menu', 'create_menu', 'edit_menu', 'delete_menu',
    'view_inventory', 'create_inventory', 'edit_inventory', 'view_reports',
    'tables.map.view', 'tables.map.edit', 'tables.create', 'tables.edit',
    'tables.status.manage', 'tables.delete', 'tables.transfer', 'tables.consolidate',
    'kds.view', 'kds.manage',
    'orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.deliver',
    'invoices.issue', 'invoices.view', 'invoices.cancel', 'invoices.credit',
    'payments.process', 'payments.reverse', 'bills.split',
    'hr.dashboard.read',
    'hr.employee.read', 'hr.employee.manage', 'hr.employee.sensitive.view',
    'hr.catalog.read', 'hr.catalog.manage',
    'hr.geofence.read', 'hr.geofence.manage',
    'hr.schedule.read', 'hr.schedule.manage', 'hr.schedule.publish', 'hr.schedule.self',
    'hr.attendance.manage', 'hr.attendance.review', 'hr.attendance.self',
    'hr.biometric.self', 'hr.biometric.manage', 'hr.attendance.device.manage',
    'hr.workforce.read', 'hr.workforce.manage', 'hr.workforce.approve', 'hr.workforce.self',
    'hr.payroll.read', 'hr.payroll.manage', 'hr.payroll.approve', 'hr.payroll.self',
    'hr.benefits.read', 'hr.benefits.manage', 'hr.benefits.approve', 'hr.benefits.self'
  );
