import { describe, expect, it } from 'vitest';
import { describePermission } from './permissionCatalog';

describe('permission presentation', () => {
    it('turns technical permission codes into clear operational copy', () => {
        expect(describePermission('orders.create')).toEqual({
            label: 'Crear Órdenes',
            description: 'Permite crear nuevos registros en órdenes.',
            group: 'Órdenes',
        });
    });

    it('keeps a curated database description when available', () => {
        expect(describePermission('reports.export', 'Descarga reportes aprobados.').description)
            .toBe('Descarga reportes aprobados.');
    });

    it('supports legacy action-first permission names', () => {
        expect(describePermission('view_users').label).toBe('Consultar Usuarios');
        expect(describePermission('create_order').label).toBe('Crear Órdenes');
    });
});
