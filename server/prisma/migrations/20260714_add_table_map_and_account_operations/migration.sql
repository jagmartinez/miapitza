-- Persisted table-map geometry with optimistic concurrency.
ALTER TABLE `Table`
    ADD COLUMN `mapX` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mapY` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mapWidth` INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN `mapHeight` INTEGER NOT NULL DEFAULT 80,
    ADD COLUMN `mapShape` ENUM('RECTANGLE', 'SQUARE', 'ROUND') NOT NULL DEFAULT 'RECTANGLE',
    ADD COLUMN `mapRotation` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `mapVersion` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `layoutUpdatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Immutable provenance used by atomic consolidation and partial transfers.
ALTER TABLE `Order`
    ADD COLUMN `consolidatedIntoOrderId` INTEGER NULL;

ALTER TABLE `OrderItem`
    ADD COLUMN `originOrderId` INTEGER NULL,
    ADD COLUMN `originTableId` INTEGER NULL;

CREATE INDEX `OrderItem_originOrderId_idx` ON `OrderItem`(`originOrderId`);
CREATE INDEX `OrderItem_originTableId_idx` ON `OrderItem`(`originTableId`);

-- Granular permissions are data, not frontend-only role checks. INSERT IGNORE
-- keeps deployment idempotent when a permission was provisioned manually.
INSERT IGNORE INTO `Permission` (`name`, `description`) VALUES
    ('tables.map.view', 'Ver el mapa y estado de mesas'),
    ('tables.map.edit', 'Editar posiciones y geometría del mapa'),
    ('tables.create', 'Crear mesas'),
    ('tables.edit', 'Editar datos de mesas'),
    ('tables.status.manage', 'Reservar, habilitar o inhabilitar mesas'),
    ('tables.delete', 'Eliminar mesas sin dependencias activas'),
    ('tables.transfer', 'Trasladar consumos entre mesas'),
    ('tables.consolidate', 'Consolidar cuentas de varias mesas');

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` = 'SUPERADMIN'
    AND p.`name` LIKE 'tables.%';

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    r.`name` = 'ADMIN'
    AND p.`name` LIKE 'tables.%';

INSERT IGNORE INTO `_PermissionToRole` (`A`, `B`)
SELECT p.`id`, r.`id`
FROM `Permission` p
JOIN `Role` r
WHERE
    (r.`name` = 'MESERO' AND p.`name` IN ('tables.map.view', 'tables.transfer', 'tables.status.manage'))
    OR (r.`name` = 'CAJERO' AND p.`name` IN ('tables.map.view', 'tables.consolidate'))
    OR (r.`name` = 'HOST' AND p.`name` IN ('tables.map.view', 'tables.edit', 'tables.status.manage'));
