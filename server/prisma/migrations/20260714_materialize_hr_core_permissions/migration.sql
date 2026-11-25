-- Materializa el catálogo y la matriz inicial de permisos de RH Fases 1-4.
-- Es aditiva e idempotente: migrate deploy no debe depender de ejecutar seed.ts.
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
    ('hr.workforce.self', 'Administrar solicitudes laborales propias');

-- El rol propietario conserva todas las capacidades administrativas y propias.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE r.`name` = 'SUPERADMIN'
  AND p.`name` IN (
    'hr.dashboard.read',
    'hr.employee.read',
    'hr.employee.manage',
    'hr.employee.sensitive.view',
    'hr.catalog.read',
    'hr.catalog.manage',
    'hr.geofence.read',
    'hr.geofence.manage',
    'hr.schedule.read',
    'hr.schedule.manage',
    'hr.schedule.publish',
    'hr.schedule.self',
    'hr.attendance.manage',
    'hr.attendance.review',
    'hr.attendance.self',
    'hr.biometric.self',
    'hr.biometric.manage',
    'hr.attendance.device.manage',
    'hr.workforce.read',
    'hr.workforce.manage',
    'hr.workforce.approve',
    'hr.workforce.self'
  );

-- El administrador de sucursal recibe únicamente visibilidad no sensible y
-- los portales propios, igual que la matriz canónica de seed.ts.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE r.`name` = 'ADMIN'
  AND p.`name` IN (
    'hr.dashboard.read',
    'hr.catalog.read',
    'hr.geofence.read',
    'hr.schedule.self',
    'hr.attendance.self',
    'hr.biometric.self',
    'hr.workforce.self'
  );

-- Todos los roles operativos internos conservan sólo sus portales propios.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE r.`name` IN ('CAJERO', 'MESERO', 'COCINA', 'CHEF', 'BODEGA', 'HOST')
  AND p.`name` IN (
    'hr.schedule.self',
    'hr.attendance.self',
    'hr.biometric.self',
    'hr.workforce.self'
  );
