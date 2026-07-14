-- Granular operational permissions. These inserts are additive and idempotent
-- so deployments with manually provisioned permissions remain safe.
INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
    ('orders.view', 'Ver ordenes'),
    ('orders.create', 'Crear ordenes'),
    ('orders.edit', 'Modificar ordenes e items'),
    ('orders.cancel', 'Cancelar ordenes'),
    ('orders.deliver', 'Marcar ordenes como entregadas'),
    ('invoices.issue', 'Emitir facturas'),
    ('invoices.view', 'Ver facturas ya emitidas'),
    ('invoices.cancel', 'Anular facturas'),
    ('payments.process', 'Procesar pagos'),
    ('payments.reverse', 'Revertir pagos'),
    ('bills.split', 'Dividir cuentas');

-- Super administrators and administrators preserve their existing operational
-- access while the permission model becomes configurable.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` IN ('SUPERADMIN', 'ADMIN')
    AND (
        p.`name` LIKE 'orders.%'
        OR p.`name` LIKE 'invoices.%'
        OR p.`name` LIKE 'payments.%'
        OR p.`name` = 'bills.split'
    );

-- Cashiers retain order creation/delivery, invoice issuance, payment processing
-- and bill splitting. The legacy fallback still covers their narrower edit
-- endpoints without granting send-to-kitchen through orders.edit.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` = 'CAJERO'
    AND p.`name` IN (
        'orders.view',
        'orders.create',
        'orders.deliver',
        'invoices.issue',
        'invoices.view',
        'payments.process',
        'bills.split'
    );

-- Waiters keep the operational order lifecycle and bill splitting, but do not
-- gain invoice or payment authority.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` = 'MESERO'
    AND p.`name` IN (
        'orders.view',
        'orders.create',
        'orders.edit',
        'orders.cancel',
        'orders.deliver',
        'bills.split'
    );

-- All remaining built-in roles could already read orders after authentication.
INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` IN ('HOST', 'COCINA', 'CHEF', 'BODEGA')
    AND p.`name` = 'orders.view';
