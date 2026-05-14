import { ValidationSchema } from './validate';

// Reusable param schemas
export const idParam: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
};

export const pagination: ValidationSchema = {
    query: {
        page: { type: 'number', min: 1 },
        limit: { type: 'number', min: 1, max: 100 },
    },
};

export const dateRange: ValidationSchema = {
    query: {
        dateFrom: { type: 'date' },
        dateTo: { type: 'date' },
    },
};

// ── Orders ──
export const createOrder: ValidationSchema = {
    body: {
        tableId: { type: 'number', min: 1 },
        orderType: { type: 'string', enum: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] },
    },
};

export const addOrderItem: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        menuItemId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 1 },
    },
};

export const updateOrderStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true },
    },
};

// ── Products ──
export const createProduct: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        unit: { type: 'string', required: true },
    },
};

export const updateProduct: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        name: { type: 'string', min: 1, max: 200 },
    },
};

// ── Users ──
export const createUser: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
        email: { type: 'email', required: true },
        username: { type: 'string', required: true, min: 3, max: 50 },
        password: { type: 'string', required: true, min: 8, max: 128 },
        roleId: { type: 'number', required: true, min: 1 },
    },
};

export const updateUser: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        name: { type: 'string', min: 1, max: 100 },
        email: { type: 'email' },
    },
};

// ── Categories ──
export const createCategory: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
    },
};

// ── Menu Items ──
export const createMenuItem: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        price: { type: 'number', required: true, min: 0 },
        categoryId: { type: 'number', required: true, min: 1 },
    },
};

export const addRecipe: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        productId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 0 },
    },
};

// ── Tables ──
export const createTable: ValidationSchema = {
    body: {
        number: { type: 'number', required: true, min: 1 },
        capacity: { type: 'number', required: true, min: 1 },
    },
};

export const updateTableStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true },
    },
};

// ── Warehouses ──
export const createWarehouse: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
    },
};

// ── Suppliers ──
export const createSupplier: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
    },
};

// ── Payments ──
export const createPayment: ValidationSchema = {
    body: {
        orderId: { type: 'number', required: true, min: 1 },
        amount: { type: 'number', required: true, min: 0 },
        paymentMethodId: { type: 'number', required: true, min: 1 },
    },
};

// ── Cash ──
export const openShift: ValidationSchema = {
    body: {
        cashRegisterId: { type: 'number', required: true, min: 1 },
        startAmount: { type: 'number', required: true, min: 0 },
    },
};

export const addCashMovement: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        amount: { type: 'number', required: true },
        type: { type: 'string', required: true, enum: ['IN', 'OUT'] },
        description: { type: 'string', required: true, min: 1 },
    },
};

export const createCashRegister: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
    },
};

// ── Reservations ──
export const createReservation: ValidationSchema = {
    body: {
        customerName: { type: 'string', required: true, min: 1, max: 200 },
        partySize: { type: 'number', required: true, min: 1 },
        date: { type: 'date', required: true },
    },
};

// ── Inventory Movements ──
export const createInventoryMovement: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        warehouseId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true },
        type: { type: 'string', required: true },
    },
};

export const transferInventory: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        fromWarehouseId: { type: 'number', required: true, min: 1 },
        toWarehouseId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 1 },
    },
};

// ── Companies / Branches ──
export const createCompany: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
    },
};

export const createBranch: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        code: { type: 'string', required: true, min: 1, max: 20 },
    },
};

// ── Roles ──
export const createRole: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 50 },
    },
};

// ── Permissions ──
export const createPermission: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
    },
};

// ── Modifiers ──
export const createModifierGroup: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
    },
};

export const createModifier: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
        price: { type: 'number', min: 0 },
    },
};

// ── Purchase Orders ──
export const addPOItem: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        productId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 1 },
        unitPrice: { type: 'number', required: true, min: 0 },
    },
};

// ── Catering ──
export const createCateringService: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        pricePerPerson: { type: 'number', required: true, min: 0 },
    },
};

export const createCateringEvent: ValidationSchema = {
    body: {
        customerName: { type: 'string', required: true, min: 1, max: 200 },
        eventDate: { type: 'date', required: true },
        guestCount: { type: 'number', required: true, min: 1 },
    },
};

// ── Split Bill ──
export const splitEvenly: ValidationSchema = {
    params: { orderId: { type: 'number', required: true, min: 1 } },
    body: {
        numberOfPeople: { type: 'number', required: true, min: 2 },
    },
};

export const splitByItems: ValidationSchema = {
    params: { orderId: { type: 'number', required: true, min: 1 } },
    body: {
        itemAssignments: { type: 'array', required: true, min: 1 },
    },
};

// ── Promotions ──
export const createPromotion: ValidationSchema = {
    body: {
        code: { type: 'string', required: true, min: 1, max: 50 },
        discountType: { type: 'string', required: true, enum: ['PERCENTAGE', 'FIXED'] },
        discountValue: { type: 'number', required: true, min: 0 },
    },
};

export const validatePromotion: ValidationSchema = {
    body: {
        code: { type: 'string', required: true },
        orderTotal: { type: 'number', required: true, min: 0 },
    },
};

// ── Advanced Features: Waste ──
export const recordWaste: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 0 },
        reason: { type: 'string', required: true, min: 1 },
        warehouseId: { type: 'number', required: true, min: 1 },
    },
};

// ── Advanced Features: Auto PO ──
export const createAutoPO: ValidationSchema = {
    body: {
        branchId: { type: 'number', required: true, min: 1 },
        supplierId: { type: 'number', required: true, min: 1 },
        items: { type: 'array', required: true, min: 1 },
    },
};

// ── Advanced Features: Dynamic Pricing ──
export const setBranchPrice: ValidationSchema = {
    params: {
        menuItemId: { type: 'number', required: true, min: 1 },
        branchId: { type: 'number', required: true, min: 1 },
    },
    body: {
        price: { type: 'number', required: true, min: 0 },
    },
};

// ── Advanced Features: Recipe Scaling ──
export const scaleRecipe: ValidationSchema = {
    params: { recipeId: { type: 'number', required: true, min: 1 } },
    body: {
        targetPortions: { type: 'number', required: true, min: 1 },
    },
};

export const calculateYield: ValidationSchema = {
    params: { menuItemId: { type: 'number', required: true, min: 1 } },
};

// ── Advanced Features: Bank Reconciliation ──
export const recordDeposit: ValidationSchema = {
    body: {
        amount: { type: 'number', required: true, min: 0 },
        depositDate: { type: 'date', required: true },
    },
};

export const markReconciled: ValidationSchema = {
    body: {
        shiftIds: { type: 'array', required: true, min: 1 },
        depositReference: { type: 'string', required: true, min: 1 },
    },
};

// ── Cash Arqueo ──
export const shiftIdParam: ValidationSchema = {
    params: { shiftId: { type: 'number', required: true, min: 1 } },
};

export const cashCount: ValidationSchema = {
    params: { shiftId: { type: 'number', required: true, min: 1 } },
    body: {
        bills: { type: 'object' },
        coins: { type: 'object' },
    },
};

export const closeShift: ValidationSchema = {
    params: { shiftId: { type: 'number', required: true, min: 1 } },
    body: {
        endAmount: { type: 'number', required: true, min: 0 },
    },
};

// ── Settings ──
export const updateSettings: ValidationSchema = {
    body: {
        restaurantName: { type: 'string' },
    },
};

export const updateCostingMethod: ValidationSchema = {
    body: {
        costingMethod: { type: 'string', required: true },
    },
};

// ── Delivery ──
export const updateDeliveryStatus: ValidationSchema = {
    params: { orderId: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true },
        platform: { type: 'string', required: true },
        externalOrderId: { type: 'string', required: true },
    },
};

// ── Backup ──
export const filenameParam: ValidationSchema = {
    params: { filename: { type: 'string', required: true, min: 1, max: 255, pattern: /^[a-zA-Z0-9._-]+$/ } },
};
