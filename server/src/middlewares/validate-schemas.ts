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
        orderType: { type: 'string', enum: ['DINE_IN', 'TAKEOUT', 'DELIVERY'] },
        customerName: { type: 'string', max: 191 },
        customerTaxId: { type: 'string', max: 100 },
        customerTaxIdType: { type: 'string', max: 50 },
        customerFiscalAddress: { type: 'string', max: 1000 },
        customerEmail: { type: 'string', max: 191 },
        customerPhone: { type: 'string', max: 50 },
    },
};

export const updateFiscalCustomer: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        customerName: { type: 'string', max: 191 },
        customerTaxId: { type: 'string', max: 100 },
        customerTaxIdType: { type: 'string', max: 50 },
        customerFiscalAddress: { type: 'string', max: 1000 },
        customerEmail: { type: 'string', max: 191 },
        customerPhone: { type: 'string', max: 50 },
    },
};

export const addOrderItem: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        menuItemId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 1, integer: true },
    },
};

export const updateOrderStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true, enum: ['OPEN', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED'] },
    },
};

// ── Products ──
export const createProduct: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        unit: { type: 'string', required: true },
        cost: { type: 'number', min: 0 },
    },
};

export const updateProduct: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        name: { type: 'string', min: 1, max: 200 },
        cost: { type: 'number', min: 0 },
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
        accountType: { type: 'string', enum: ['INTERNAL', 'EXTERNAL'] },
    },
};

export const updateUser: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        name: { type: 'string', min: 1, max: 100 },
        email: { type: 'email' },
        accountType: { type: 'string', enum: ['INTERNAL', 'EXTERNAL'] },
    },
};

// ── Categories ──
export const createCategory: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
        codePrefix: { type: 'string', required: false, min: 2, max: 10 },
    },
};

// ── Menu Brands (marcas) ──
export const createMenuBrand: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 100 },
        color: { type: 'string', required: false, max: 20 },
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
        quantity: { type: 'number', required: true, min: 0.001 },
        unit: { type: 'string', required: false, min: 1, max: 20 },
    },
};

export const updateRecipe: ValidationSchema = {
    params: { recipeId: { type: 'number', required: true, min: 1 } },
    body: {
        quantity: { type: 'number', required: false, min: 0.001 },
        unit: { type: 'string', required: false, min: 1, max: 20 },
    },
};

// ── Tables ──
export const createTable: ValidationSchema = {
    body: {
        // `number` is stored as String in Prisma (allows "01", "A2", "VIP-1", etc.)
        number: { type: 'string', required: true, min: 1, max: 20 },
        capacity: { type: 'number', required: true, min: 1 },
    },
};

export const updateTableStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true, enum: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE'] },
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
        orderId: { type: 'number', required: true, min: 1, integer: true },
        amount: { type: 'number', required: true, min: 0.01 },
        paymentMethodId: { type: 'number', required: true, min: 1, integer: true },
        reference: { type: 'string', max: 191 },
        payerName: { type: 'string', max: 191 },
    },
};

export const updateTableLayout: ValidationSchema = {
    body: {
        branchId: { type: 'number', required: true, min: 1, integer: true },
        tables: { type: 'array', required: true, min: 1, max: 250 }
    }
};

export const tableFloorPlanParams: ValidationSchema = {
    params: { branchId: { type: 'number', required: true, min: 1, integer: true } },
};

export const updateTableFloorPlan: ValidationSchema = {
    params: { branchId: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        expectedVersion: { type: 'number', required: true, min: 0, integer: true },
        canvas: {
            type: 'object', required: true, properties: {
                width: { type: 'number', required: true, min: 640, max: 10000, integer: true },
                height: { type: 'number', required: true, min: 480, max: 10000, integer: true },
            }
        },
        areas: {
            type: 'array', required: true, max: 50, items: {
                type: 'object', properties: {
                    id: { type: 'number', min: 1, integer: true },
                    clientKey: { type: 'string', min: 1, max: 100 },
                    name: { type: 'string', required: true, min: 1, max: 100 },
                    kind: { type: 'string', enum: ['DINING', 'TERRACE', 'BAR', 'PRIVATE', 'TAKEAWAY', 'OTHER'] },
                    x: { type: 'number', required: true, min: 0, max: 10000, integer: true },
                    y: { type: 'number', required: true, min: 0, max: 10000, integer: true },
                    width: { type: 'number', required: true, min: 160, max: 10000, integer: true },
                    height: { type: 'number', required: true, min: 140, max: 10000, integer: true },
                    rotation: { type: 'number', min: 0, max: 359, integer: true },
                    shape: { type: 'string', enum: ['RECTANGLE', 'ROUNDED', 'OVAL', 'L_SHAPE'] },
                    color: { type: 'string', max: 16 },
                    expectedVersion: { type: 'number', min: 0, integer: true },
                }
            }
        },
        deletedAreaIds: { type: 'array', max: 50, items: { type: 'number', min: 1, integer: true } },
        tables: {
            type: 'array', required: true, max: 250, items: {
                type: 'object', properties: {
                    id: { type: 'number', required: true, min: 1, integer: true },
                    areaId: { type: 'number', min: 1, integer: true },
                    areaClientKey: { type: 'string', min: 1, max: 100 },
                    x: { type: 'number', required: true, min: 0, max: 10000, integer: true },
                    y: { type: 'number', required: true, min: 0, max: 10000, integer: true },
                    width: { type: 'number', required: true, min: 56, max: 400, integer: true },
                    height: { type: 'number', required: true, min: 56, max: 400, integer: true },
                    rotation: { type: 'number', min: 0, max: 359, integer: true },
                    shape: { type: 'string', enum: ['RECTANGLE', 'SQUARE', 'ROUND'] },
                    expectedVersion: { type: 'number', required: true, min: 0, integer: true },
                }
            }
        }
    }
};

export const consolidateTables: ValidationSchema = {
    body: {
        destinationTableId: { type: 'number', required: true, min: 1, integer: true },
        sourceTableIds: { type: 'array', required: true, min: 1, max: 50 },
        primaryOrderId: { type: 'number', min: 1, integer: true },
        reason: { type: 'string', max: 500 }
    }
};

export const transferTableConsumption: ValidationSchema = {
    body: {
        sourceTableId: { type: 'number', required: true, min: 1, integer: true },
        destinationTableId: { type: 'number', required: true, min: 1, integer: true },
        orderId: { type: 'number', required: true, min: 1, integer: true },
        items: { type: 'array', max: 250 },
        reason: { type: 'string', max: 500 }
    }
};

export const addCateringPayment: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        amount: { type: 'number', required: true, min: 0.01 },
        paymentMethodId: { type: 'number', required: true, min: 1, integer: true },
        type: { type: 'string', enum: ['ADVANCE', 'FINAL_SETTLEMENT'] },
        reference: { type: 'string', max: 191 },
    },
};

export const reverseCateringPayment: ValidationSchema = {
    params: {
        id: { type: 'number', required: true, min: 1, integer: true },
        paymentId: { type: 'number', required: true, min: 1, integer: true },
    },
    body: { reason: { type: 'string', required: true, min: 3, max: 500 } },
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
        peopleCount: { type: 'number', required: true, min: 1 },
        date: { type: 'date', required: true },
        phone: { type: 'string', max: 30 },
        email: { type: 'email' },
        notes: { type: 'string', max: 1000 },
        branchId: { type: 'number', min: 1 },
    },
};

// ── Inventory Movements ──
export const createInventoryMovement: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        warehouseId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 0.000001 },
        type: { type: 'string', required: true, enum: ['IN', 'OUT', 'ADJUSTMENT'] },
    },
};

export const transferInventory: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        fromWarehouseId: { type: 'number', required: true, min: 1 },
        toWarehouseId: { type: 'number', required: true, min: 1 },
        quantity: { type: 'number', required: true, min: 0.000001 },
    },
};

// ── Companies / Branches ──
export const createCompany: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        ruc: { type: 'string', max: 50 },
        logo: { type: 'string', max: 500 },
    },
};

export const updateCompany: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        name: { type: 'string', min: 1, max: 200 },
        ruc: { type: 'string', max: 50 },
        logo: { type: 'string', max: 500 },
        active: { type: 'boolean' },
    },
};

export const createBranch: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        code: { type: 'string', required: true, min: 1, max: 20 },
        companyId: { type: 'number', min: 1, integer: true },
        address: { type: 'string', max: 500 },
        phone: { type: 'string', max: 50 },
        latitude: { type: 'number', required: true, min: -90, max: 90 },
        longitude: { type: 'number', required: true, min: -180, max: 180 },
        geofenceRadiusM: { type: 'number', required: true, min: 10, max: 10000, integer: true },
        maxLocationAccuracyM: { type: 'number', required: true, min: 1, max: 5000, integer: true },
        timezone: { type: 'string', max: 64 },
        attendanceEnabled: { type: 'boolean' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    },
};

export const updateBranch: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        name: { type: 'string', min: 1, max: 200 },
        code: { type: 'string', min: 1, max: 20 },
        address: { type: 'string', max: 500 },
        phone: { type: 'string', max: 50 },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    },
};

// ── Roles ──
export const createRole: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 50 },
        description: { type: 'string', max: 1000 },
        permissionIds: {
            type: 'array',
            max: 500,
            items: { type: 'number', min: 1, integer: true }
        },
    },
};

export const updateRole: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        name: { type: 'string', min: 1, max: 50 },
        description: { type: 'string', max: 1000 },
        permissionIds: {
            type: 'array',
            max: 500,
            items: { type: 'number', min: 1, integer: true }
        },
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
        extraPrice: { type: 'number', min: 0 },
        // Optional inventory link: consume `consumeQuantity` of `productId` (in `unitId`).
        productId: { type: 'number', min: 1 },
        consumeQuantity: { type: 'number', min: 0 },
        unitId: { type: 'number', min: 1 },
    },
};

// ── Purchase Orders ──
export const addPOItem: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        productId: { type: 'number', required: true, min: 1 },
        // Allow fractional purchase quantities (e.g. 0.5 kg, 2.5 L).
        quantity: { type: 'number', required: true, min: 0.0001 },
        // The service and client use `cost` (cost per purchase unit), not `unitPrice`.
        cost: { type: 'number', required: true, min: 0 },
        purchaseUnit: { type: 'string', required: false, max: 20 },
    },
};

// ── Catering ──
export const createCateringService: ValidationSchema = {
    body: {
        name: { type: 'string', required: true, min: 1, max: 200 },
        internalCost: { type: 'number', required: true, min: 0 },
        salePrice: { type: 'number', required: true, min: 0 },
    },
};

export const createCateringEvent: ValidationSchema = {
    body: {
        customerName: { type: 'string', required: true, min: 1, max: 200 },
        title: { type: 'string', required: true, min: 1, max: 200 },
        date: { type: 'date', required: true },
        peopleCount: { type: 'number', required: true, min: 1 },
        branchId: { type: 'number', required: true, min: 1 },
        services: { type: 'array' },
        menuItems: { type: 'array' },
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
    params: { orderId: { type: 'number', required: true, min: 1, integer: true } },
    body: {
        itemAssignments: {
            type: 'array',
            required: true,
            min: 1,
            items: {
                type: 'object',
                properties: {
                    personName: { type: 'string', required: true, min: 1, max: 200 },
                    itemIds: {
                        type: 'array',
                        min: 1,
                        items: { type: 'number', min: 1, integer: true }
                    },
                    items: {
                        type: 'array',
                        min: 1,
                        items: {
                            type: 'object',
                            properties: {
                                orderItemId: { type: 'number', required: true, min: 1, integer: true },
                                quantity: { type: 'number', required: true, min: 1, integer: true }
                            }
                        }
                    }
                }
            }
        },
    },
};

// ── Promotions ──
export const createPromotion: ValidationSchema = {
    body: {
        code: { type: 'string', required: true, min: 1, max: 50 },
        name: { type: 'string', required: true, min: 1, max: 200 },
        type: { type: 'string', required: true, enum: ['PERCENTAGE', 'FIXED_AMOUNT'] },
        value: { type: 'number', required: true, min: 0 },
        minOrderAmount: { type: 'number', min: 0 },
        maxDiscount: { type: 'number', min: 0 },
        validFrom: { type: 'date' },
        validTo: { type: 'date' },
        usageLimit: { type: 'number', min: 1 },
    },
};

export const addPurchasePayment: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        amount: { type: 'number', required: true, min: 0.01 },
        date: { type: 'date', required: false },
        bank: { type: 'string', required: false, max: 100 },
        referenceNumber: { type: 'string', required: false, max: 191 },
        observations: { type: 'string', required: false, max: 1000 }
    }
};

export const reversePurchasePayment: ValidationSchema = {
    params: {
        id: { type: 'number', required: true, min: 1 },
        paymentId: { type: 'number', required: true, min: 1 }
    },
    body: { reason: { type: 'string', required: true, min: 1, max: 500 } }
};

export const reversePurchaseReceipt: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: { reason: { type: 'string', required: true, min: 1, max: 500 } }
};

export const updatePromotion: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        code: { type: 'string', min: 1, max: 50 },
        name: { type: 'string', min: 1, max: 200 },
        type: { type: 'string', enum: ['PERCENTAGE', 'FIXED_AMOUNT'] },
        value: { type: 'number', min: 0 },
        minOrderAmount: { type: 'number', min: 0 },
        maxDiscount: { type: 'number', min: 0 },
        validFrom: { type: 'date' },
        validTo: { type: 'date' },
        usageLimit: { type: 'number', min: 1 },
        active: { type: 'boolean' },
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
        quantity: { type: 'number', required: true, min: 0.000001 },
        reason: { type: 'string', required: true, min: 1 },
        warehouseId: { type: 'number', required: true, min: 1 },
        // Optional unit of the entered quantity; converted to base before costing.
        // Omitted means the quantity is already expressed in the product base unit.
        unit: { type: 'string', required: false, min: 1 },
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
        date: { type: 'date', required: true },
        amount: { type: 'number', required: true, min: 0.01 },
        bankAccount: { type: 'string', required: true, min: 1, max: 191 },
        reference: { type: 'string', required: true, min: 1, max: 191 },
        notes: { type: 'string', max: 191 },
        shiftIds: { type: 'array' },
    },
};

export const reverseDeposit: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: { reason: { type: 'string', required: true, min: 1, max: 191 } },
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
        bills: { type: 'array', required: true },
        coins: { type: 'array', required: true },
        usdBills: { type: 'array' },
        exchangeRate: { type: 'number', min: 0 },
    },
};

export const closeShift: ValidationSchema = {
    params: { shiftId: { type: 'number', required: true, min: 1 } },
    body: {
        endAmount: { type: 'number', required: true, min: 0 },
        bills: { type: 'array' },
        coins: { type: 'array' },
        usdBills: { type: 'array' },
        exchangeRate: { type: 'number', min: 0 },
        forceClose: { type: 'boolean' },
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

// ── Production Recipes (BOM) ──
export const createProductionRecipe: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        yieldQuantity: { type: 'number', required: true, min: 0.000001 },
        components: { type: 'array', required: true, min: 1 },
    },
};

export const updateProductionRecipe: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        yieldQuantity: { type: 'number', required: false, min: 0.000001 },
    },
};

export const setProductionRecipeStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true, enum: ['DRAFT', 'ACTIVE', 'INACTIVE'] },
    },
};

// ── Production Orders ──
export const previewProduction: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        plannedQuantity: { type: 'number', required: true, min: 0.000001 },
        warehouseId: { type: 'number', required: true, min: 1 },
    },
};

export const createProductionOrder: ValidationSchema = {
    body: {
        productId: { type: 'number', required: true, min: 1 },
        plannedQuantity: { type: 'number', required: true, min: 0.000001 },
        warehouseId: { type: 'number', required: true, min: 1 },
    },
};

export const setProductionOrderStatus: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        status: { type: 'string', required: true, enum: ['DRAFT', 'PENDING', 'IN_PROGRESS'] },
    },
};

export const finishProductionOrder: ValidationSchema = {
    params: { id: { type: 'number', required: true, min: 1 } },
    body: {
        producedQuantity: { type: 'number', required: false, min: 0 },
        allowNegative: { type: 'boolean', required: false },
    },
};
