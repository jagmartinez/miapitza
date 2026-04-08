export type Language = 'es' | 'en';

export const translations = {
    es: {
        common: {
            dashboard: 'Panel de Control',
            pos: 'Punto de Venta',
            kitchen: 'Cocina',
            inventory: 'Inventario',
            settings: 'Configuración',
            logout: 'Cerrar Sesión',
            loading: 'Cargando...',
            save: 'Guardar',
            cancel: 'Cancelar',
            edit: 'Editar',
            delete: 'Eliminar',
            actions: 'Acciones'
        },
        pos: {
            newOrder: 'Nueva Orden',
            search: 'Buscar productos...',
            total: 'Total',
            pay: 'Pagar',
            empty: 'La orden está vacía'
        },
        inventory: {
            products: 'Productos',
            stock: 'Existencias',
            suppliers: 'Proveedores',
            purchaseOrders: 'Órdenes de Compra'
        }
    },
    en: {
        common: {
            dashboard: 'Dashboard',
            pos: 'Point of Sale',
            kitchen: 'Kitchen',
            inventory: 'Inventory',
            settings: 'Settings',
            logout: 'Logout',
            loading: 'Loading...',
            save: 'Save',
            cancel: 'Cancel',
            edit: 'Edit',
            delete: 'Delete',
            actions: 'Actions'
        },
        pos: {
            newOrder: 'New Order',
            search: 'Search products...',
            total: 'Total',
            pay: 'Pay',
            empty: 'Order is empty'
        },
        inventory: {
            products: 'Products',
            stock: 'Stock',
            suppliers: 'Suppliers',
            purchaseOrders: 'Purchase Orders'
        }
    }
};

export type TranslationKeys =
    | 'common.dashboard' | 'common.pos' | 'common.kitchen' | 'common.inventory'
    | 'common.settings' | 'common.logout' | 'common.loading' | 'common.save'
    | 'common.cancel' | 'common.edit' | 'common.delete' | 'common.actions'
    | 'pos.newOrder' | 'pos.search' | 'pos.total' | 'pos.pay' | 'pos.empty'
    | 'inventory.products' | 'inventory.stock' | 'inventory.suppliers' | 'inventory.purchaseOrders';
