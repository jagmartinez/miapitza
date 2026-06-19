export interface User {
  id: number;
  name: string;
  email: string;
  username: string;
  role: {
    id: number;
    name: string;
  };
  roles?: {
    id: number;
    name: string;
  }[];
  userRoles?: {
    role: {
      id: number;
      name: string;
    };
  }[];
  companyId: number;
  company?: Company;
  branchId: number | null;
  branch?: {
    id: number;
    name: string;
  };
  allowedBranches?: {
    branch: { id: number; name: string; code?: string };
  }[];
  status: string;
  color?: string | null;
  nif?: string;
  address?: string;
  phone?: string;
  createdAt?: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: User;
    requires2FA?: boolean;
    mustChangePassword?: boolean;
    passwordExpired?: boolean;
    sessionTimeoutMinutes?: number;
  };
}

export interface Table {
  id: number;
  number: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'OUT_OF_SERVICE';
  location?: string;
  branchId: number;
  branch?: {
    id: number;
    name: string;
    code?: string;
  };
}

export interface ModifierOption {
  id: number;
  name: string;
  price: number;
  active?: boolean;
}

export interface ModifierGroupWithModifiers {
  id: number;
  name: string;
  description?: string | null;
  minSelect: number;
  maxSelect: number | null;
  modifiers: ModifierOption[];
}

export interface MenuItem {
  id: number;
  name: string;
  description?: string;
  price: number;
  defaultPrice?: number;
  categoryId: number;
  branchId?: number | null;
  brandId?: number | null;
  brand?: {
    id: number;
    name: string;
    color?: string | null;
  };
  branchAvailability?: {
    branchId: number;
    branchName: string;
    price: number;
    active: boolean;
  }[];
  category: {
    id: number;
    name: string;
  };
  recipes?: {
    id: number;
    productId: number;
    quantity: number;
    unit?: string;
    product: {
      id: number;
      name: string;
      unit: string;
      cost: number;
    };
  }[];
  images?: {
    id: number;
    imageUrl: string;
  }[];
  modifierGroups?: ModifierGroupWithModifiers[];
  _count?: {
    recipes?: number;
    modifierGroups?: number;
  };
  active: boolean;
}

export interface Order {
  id: number;
  branchId: number;
  tableId?: number;
  table?: {
    id: number;
    number: string;
  };
  userId: number;
  total: number;
  subtotal?: number;
  tax?: number;
  discount?: number;
  tipAmount?: number;
  status: 'OPEN' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'PAID' | 'CANCELLED';
  customerName?: string;
  cancelledById?: number;
  cancelledBy?: { id: number; name: string };
  cancelReason?: string;
  cancelledAt?: string;
  firstStartedAt?: string | null;
  readyAt?: string | null;
  items: OrderItem[];
  payments?: Payment[];
  createdAt: string;
  user: User & { color?: string | null };
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  menuItem: MenuItem;
  quantity: number;
  price: number;
  subtotal: number;
  notes?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE';
  sentAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface Payment {
  id: number;
  orderId: number;
  paymentMethodId: number;
  paymentMethod: {
    id: number;
    name: string;
  };
  amount: number;
  reference?: string;
  payerName?: string;
  registeredById?: number;
}

export interface UnitOfMeasure {
  id: number;
  companyId: number;
  name: string;
  abbreviation: string;
  measurementType: 'MASS' | 'VOLUME' | 'UNIT' | 'PACKAGE';
  systemFactor: number;
  active: boolean;
}

export interface ProductAllowedUnit {
  unitId: number;
  abbreviation: string;
  name: string;
  conversionFactor: number;
  isBase: boolean;
  isDefault: boolean;
}

export interface Product {
  id: number;
  name: string;
  sku?: string;
  unit: string;
  baseUnitId?: number;
  baseUnit?: UnitOfMeasure;
  cost: number;
  price?: number;
  minStock: number;
  categoryId?: number;
  type: ProductType;
  storageType?: 'PERISHABLE' | 'FROZEN' | 'NON_PERISHABLE' | null;
  observation?: string | null;
  active: boolean;
  allowedUnits?: ProductAllowedUnit[];
  currentAverageCost?: number;
  lastPurchaseCost?: number;
}

export type ProductType = 'INGREDIENT' | 'PRODUCT_FOR_SALE' | 'BOTH' | 'INTERMEDIATE' | 'PACKAGING';

export type ProductionRecipeStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE';

export interface ProductionRecipeComponent {
  id?: number;
  componentProductId: number;
  componentProduct?: Pick<Product, 'id' | 'name' | 'sku' | 'type' | 'unit'> & { currentAverageCost?: number };
  quantity: number;
  unitId?: number | null;
  unit?: string | null;
  notes?: string | null;
}

export interface RecipeCostLine {
  componentProductId: number;
  componentName: string;
  componentType: string;
  unit: string;
  baseUnit: string;
  quantity: number;
  baseQuantity: number;
  unitCost: number;
  totalCost: number;
}

export interface RecipeCost {
  batchCost: number;
  yieldBaseQuantity: number;
  yieldBaseUnit: string;
  unitCost: number;
  lines: RecipeCostLine[];
}

export interface ProductionRecipe {
  id: number;
  companyId: number;
  productId: number;
  product?: Pick<Product, 'id' | 'name' | 'sku' | 'type' | 'unit'>;
  name: string;
  version: number;
  status: ProductionRecipeStatus;
  yieldQuantity: number;
  yieldUnitId?: number | null;
  yieldUnit?: { id: number; name: string; abbreviation: string } | null;
  notes?: string | null;
  createdBy?: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
  components: ProductionRecipeComponent[];
  cost?: RecipeCost | null;
}

export type ProductionOrderStatus = 'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

export interface ProductionOrderItem {
  id: number;
  componentProductId: number;
  componentProduct?: Pick<Product, 'id' | 'name' | 'sku' | 'type' | 'unit'>;
  requiredQuantity: number;
  consumedQuantity: number;
  unitId?: number | null;
  unit?: string | null;
  unitCost: number;
  totalCost: number;
}

export interface ProductionOrder {
  id: number;
  companyId: number;
  branchId: number;
  code: string;
  productId: number;
  product?: Pick<Product, 'id' | 'name' | 'sku' | 'type' | 'unit'>;
  recipeId?: number | null;
  recipe?: { id: number; name: string; version: number; yieldQuantity: number } | null;
  warehouseId: number;
  warehouse?: { id: number; name: string; code?: string };
  status: ProductionOrderStatus;
  plannedQuantity: number;
  producedQuantity: number;
  estimatedCost: number;
  estimatedUnitCost: number;
  realCost: number;
  realUnitCost: number;
  userId: number;
  user?: { id: number; name: string };
  notes?: string | null;
  date: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ProductionOrderItem[];
}

export interface ProductionRequirementLine {
  componentProductId: number;
  componentName: string;
  componentType: string;
  unit: string;
  requiredQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
  producible: boolean;
  unitCost: number;
  totalCost: number;
}

export interface ProductionPreview {
  productId: number;
  recipeId: number;
  plannedQuantity: number;
  yieldBaseQuantity: number;
  estimatedCost: number;
  estimatedUnitCost: number;
  canProduce: boolean;
  requirements: ProductionRequirementLine[];
}

export interface MenuBrand {
  id: number;
  name: string;
  color?: string | null;
  sortOrder: number;
  active: boolean;
  _count?: {
    menuItems?: number;
  };
}

export interface Branch {
  id: number;
  companyId: number;
  company?: Company;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  status: string;
  _count?: {
    users: number;
    tables: number;
    warehouses: number;
  };
}

export interface Supplier {
  id: number;
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  supplyType?: string;
  active: boolean;
}

export interface PurchaseOrder {
  id: number;
  branchId: number;
  supplierId: number;
  date: string;
  status: 'DRAFT' | 'ISSUED' | 'RECEIVED' | 'CANCELLED';
  total: number;
  notes?: string;
  invoiceNumber?: string;
  invoicePdf?: string;
  invoiceDate?: string;
  invoiceType?: 'CASH' | 'CREDIT';
  paymentDueDate?: string;
  bank?: string;
  transferNumber?: string;
  paidAmount?: number;
  paymentStatus?: 'PENDING' | 'PARTIAL' | 'PAID';
  supplier?: Supplier;
  items?: PurchaseOrderItem[];
  payments?: PurchaseOrderPayment[];
  branch?: Branch;
  _count?: { items: number };
}

export interface PurchaseOrderPayment {
  id: number;
  purchaseOrderId: number;
  amount: number;
  date: string;
  bank?: string;
  referenceNumber?: string;
  observations?: string;
  createdAt: string;
}

export interface PurchaseOrderItem {
  id: number;
  purchaseOrderId: number;
  productId: number;
  product?: Product;
  quantity: number;
  cost: number;
  subtotal: number;
  purchaseUnit?: string;
  conversionFactor?: number;
  baseQuantity?: number;
  baseCost?: number;
}

export interface CashRegister {
  id: number;
  branchId: number | null;
  name: string;
  status: 'OPEN' | 'CLOSED';
  branch?: Branch;
}

export interface Warehouse {
  id: number;
  companyId?: number;
  name: string;
  code: string;
  branchId?: number | null;
  type: 'CENTRAL' | 'BRANCH';
  branch?: Branch | null;
  _count?: {
    stocks: number;
    movements: number;
  };
}

export interface CashShift {
  id: number;
  cashRegisterId: number;
  userId: number;
  startDate: string;
  endDate?: string;
  startAmount: number;
  endAmount?: number;
  difference?: number;
  notes?: string;
  user?: User;
  cashRegister?: CashRegister;
  register?: CashRegister;
  movements?: CashMovement[];
}

export interface CashClosePreview {
  expectedAmount: number;
  endAmount: number;
  difference: number;
  status: 'CUADRADO' | 'SOBRANTE' | 'FALTANTE';
  withinTolerance: boolean;
  tolerance: number;
}

export interface CashMovement {
  id: number;
  shiftId: number;
  type: 'IN' | 'OUT';
  amount: number;
  description?: string;
  reference?: string;
  createdAt: string;
  documentDate?: string;
  documentType?: 'FACTURA' | 'RECIBO_GASTO' | 'RECIBO_CAJA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  documentNumber?: string;
  supplierId?: number;
  supplier?: {
    id: number;
    name: string;
  };
}

export interface InventoryMovement {
  id: number;
  type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER';
  quantity: number;
  reference?: string;
  reason?: string | null;
  transferGroupId?: string | null;
  createdAt: string;
  warehouse?: Warehouse;
  product?: Product;
  user?: {
    id: number;
    name: string;
  };
}

export interface StockAlertItem {
  productId: number;
  productName: string;
  warehouseId: number;
  warehouseName: string;
  currentStock: number;
  minStock: number;
  deficit?: number;
  branchName?: string;
  priority?: 'LOW' | 'URGENT';
}

export interface AutoPurchaseSuggestion {
  productId: number;
  productName: string;
  warehouseId: number;
  warehouseName: string;
  currentStock?: number;
  minStock?: number;
  suggestedQuantity: number;
  estimatedCost?: number;
  estimatedUnitCost?: number;
  estimatedTotalCost?: number;
  priority: 'LOW' | 'URGENT' | 'NORMAL';
}

export interface PaymentMethod {
  id: number;
  name: string;
  active: boolean;
}

export interface Company {
  id: number;
  name: string;
  ruc: string | null;
  logo: string | null;
  active: boolean;
  createdAt: string;
}
