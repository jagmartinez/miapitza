/**
 * operational-seed.ts – Seed idempotente de datos OPERATIVOS
 *
 * Pobla: Proveedores, OCs, Kardex/Inventario, Reservaciones,
 *        Ventas (21), Caja (aperturas/cierres), Catering Events.
 *
 * Restricción: SOLO INSERT/UPDATE — NO CREATE/ALTER/DROP.
 * Idempotente: segunda ejecución no duplica.
 *
 * Ejecución:  npx ts-node --transpile-only prisma/operational-seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../src/utils/password-policy';
import { resolveDemoSeedConfig } from '../src/utils/demo-seed-security';

const prisma = new PrismaClient();

let CID: number;
let BID: number;

// ============================================================
// HELPERS
// ============================================================

/** UTC date: N days before 2026-02-10 at HH:MM */
function dt(daysAgo: number, h = 12, m = 0): Date {
  return new Date(Date.UTC(2026, 1, 10 - daysAgo, h, m, 0));
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

/** Break cash amount into MXN bill/coin denominations */
function denominations(amount: number) {
  const result: { type: string; denom: number; count: number }[] = [];
  let rem = Math.round(amount);
  for (const d of [1000, 500, 200, 100, 50, 20]) {
    const c = Math.floor(rem / d);
    if (c > 0) { result.push({ type: 'BILL', denom: d, count: c }); rem -= c * d; }
  }
  for (const d of [10, 5, 2, 1]) {
    const c = Math.floor(rem / d);
    if (c > 0) { result.push({ type: 'COIN', denom: d, count: c }); rem -= c * d; }
  }
  return result;
}

// Report
const R: Record<string, number> = {};
const W: string[] = []; // warnings
function inc(k: string, n = 1) { R[k] = (R[k] || 0) + n; }

// ============================================================
// DATA DEFINITIONS
// ============================================================

const SUPPLIERS = [
  { name: 'Distribuidora Lácteos del Norte', taxId: 'LDN040115', contact: 'Carlos Mendoza', phone: '555-101-0001', email: 'ventas@lacteosn.mx', type: 'Lácteos', skus: ['ING-003','ING-004','ING-005','ING-017','ING-039'] },
  { name: 'Carnes y Embutidos San Miguel', taxId: 'CES050217', contact: 'Roberto Ávila', phone: '555-102-0002', email: 'pedidos@csmiguel.mx', type: 'Carnes y Embutidos', skus: ['ING-006','ING-007','ING-011','ING-020','ING-026'] },
  { name: 'Frutas y Verduras La Huerta', taxId: 'FVH060312', contact: 'Ana López', phone: '555-103-0003', email: 'ventas@lahuerta.mx', type: 'Frutas y Verduras', skus: ['ING-008','ING-009','ING-010','ING-012','ING-014','ING-015','ING-016','ING-021','ING-024','ING-028','ING-032','ING-038','ING-045'] },
  { name: 'Molinos y Harinas El Trigo', taxId: 'MHT070415', contact: 'Pedro Ramírez', phone: '555-104-0004', email: 'ventas@eltrigo.mx', type: 'Harinas y Sales', skus: ['ING-001','ING-029','ING-031'] },
  { name: 'Importadora de Vinos Santa Cruz', taxId: 'IVS080518', contact: 'Eduardo Navarro', phone: '555-105-0005', email: 'import@vinossc.mx', type: 'Vinos', skus: ['VIN-001','VIN-002','VIN-003','VIN-004','VIN-005','VIN-006','VIN-007','VIN-008','VIN-009','VIN-010','VIN-011','VIN-012'] },
  { name: 'Refrescos y Bebidas del Pacífico', taxId: 'RBP090611', contact: 'Laura Sánchez', phone: '555-106-0006', email: 'dist@bebidasp.mx', type: 'Bebidas', skus: ['BEB-001','BEB-002','BEB-003','BEB-004','BEB-005','BEB-006','BEB-007','BEB-008'] },
  { name: 'Aceites y Especias Mediterráneo', taxId: 'AEM100714', contact: 'Sofía Herrera', phone: '555-107-0007', email: 'ventas@aceitesm.mx', type: 'Aceites y Especias', skus: ['ING-013','ING-018','ING-019','ING-022','ING-023','ING-027','ING-030','ING-043'] },
  { name: 'Mariscos y Pescados del Golfo', taxId: 'MPG110817', contact: 'Fernando Ortiz', phone: '555-108-0008', email: 'ventas@mariscog.mx', type: 'Mariscos', skus: ['ING-025'] },
  { name: 'Panadería y Repostería Dulce Arte', taxId: 'PRD120910', contact: 'Isabel Torres', phone: '555-109-0009', email: 'pedidos@dulceart.mx', type: 'Panadería', skus: ['ING-034','ING-035','ING-036','ING-037','ING-041'] },
  { name: 'Suministros Generales La Central', taxId: 'SGL131013', contact: 'Miguel Flores', phone: '555-110-0010', email: 'ventas@lacentral.mx', type: 'Suministros', skus: ['ING-002','ING-033','ING-040','ING-042','ING-044'] },
];

// PO rounds: days-ago & quantity multiplier (deterministic, no random)
const PO_ROUNDS = [
  { daysAgo: 25, mul: 1.0 },
  { daysAgo: 15, mul: 1.2 },
  { daysAgo: 5,  mul: 0.8 },
];

// Order item: [categoryName, menuItemName, qty]
type OI = [string, string, number];

const ORDERS: {
  day: number; h: number; m: number;
  table: string | null; customer: string;
  items: OI[]; discount: number; tip: number;
  pay: 'Efectivo' | 'Tarjeta' | 'Mixto';
}[] = [
  // ── Day -5 (Feb 5) ──
  { day:5, h:13, m:0,  table:'T03', customer:'Carlos Ruiz',
    items:[['Pizzas','Pepperoni',1],['Pizzas','Capresse',1],['Bebidas','Coca Cola',2]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:5, h:14, m:30, table:'T09', customer:'Ana Martínez',
    items:[['Pastas Frescas','Raviolis ricotta y parmesano',1],['Vinos Tintos','San Telmo Malbec (Botella)',1]],
    discount:0, tip:0, pay:'Tarjeta' },
  { day:5, h:19, m:0,  table:'T14', customer:'Familia Rodríguez',
    items:[['Pizzas','Maui Pitza',1],['Pizzas','La Cotto',1],['Pizzas','Pepperoni',1],['Antipastos','Tabla de Antipasto',1],['Bebidas','Sprite',3]],
    discount:0, tip:100, pay:'Efectivo' },
  { day:5, h:20, m:30, table:null,  customer:'Pedro Gómez',
    items:[['Pizzas','4 Quesos & Hongos',2]],
    discount:0, tip:0, pay:'Tarjeta' },
  // ── Day -4 (Feb 6) ──
  { day:4, h:12, m:30, table:'T05', customer:'Lucía Fernández',
    items:[['Pizzas','Dulce Fiery',1],['Extras','Mozzarella fresco',1],['Postres','Brownie con Helado',1],['Bebidas','Agua Purificada',2]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:4, h:14, m:0,  table:'T10', customer:'Grupo Ejecutivo',
    items:[['Pastas Frescas','Canelones ricotta y espinaca',1],['Pastas Frescas','Mezzaluna verde de ricotta y espinaca',1],['Vinos Blancos','Frontera Sauvignon Blanc (Botella)',1]],
    discount:0, tip:80, pay:'Tarjeta' },
  { day:4, h:18, m:0,  table:'T01', customer:'María Soto',
    items:[['Antipastos','Rúcula & hongos al vino',1],['Postres','Cheesecake de fresas',1],['Bebidas','Coca Zero',2]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:4, h:20, m:0,  table:'T16', customer:'Pareja Díaz',
    items:[['Pizzas','La Bianco',1],['Pizzas','Basilea',1],['Bebidas','Fanta Naranja',2]],
    discount:50, tip:0, pay:'Mixto' },
  // ── Day -3 (Feb 7) ──
  { day:3, h:13, m:0,  table:'T07', customer:'Javier Morales',
    items:[['Pizzas','Alla Vodka',1],['Extras','Pepperoni',1],['Vinos Tintos','Riunite Lambrusco (Botella)',1]],
    discount:0, tip:0, pay:'Tarjeta' },
  { day:3, h:14, m:30, table:'T12', customer:'Familia Herrera',
    items:[['Pizzas','La Reina',1],['Pizzas','Della Nonna',1],['Pastas Frescas','Mezzaluna de ricotta y parmesano',1],['Bebidas','Fresca',2]],
    discount:0, tip:150, pay:'Efectivo' },
  { day:3, h:19, m:30, table:'T19', customer:'Grupo Celebración',
    items:[['Antipastos','Pan Rústico',1],['Pizzas','La Sussanna',2],['Vinos Tintos','Abel Bonarda Malbec (Botella)',1]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:3, h:21, m:0,  table:null,  customer:'Roberto Mendoza',
    items:[['Pizzas','Cheese Bar Pie',2],['Pizzas','La Extra',1]],
    discount:0, tip:0, pay:'Tarjeta' },
  // ── Day -2 (Feb 8) ──
  { day:2, h:12, m:0,  table:'T02', customer:'Elena Vargas',
    items:[['Pizzas','La Pedroni',1],['Postres','Pan de Banano o Zanahoria Ala Mode',1],['Bebidas','Té Helado & Limonada (Vaso)',2]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:2, h:13, m:30, table:'T11', customer:'Diego y Carmen',
    items:[['Pastas Frescas','Raviolis ricotta y parmesano',2],['Bebidas','Sprite',2]],
    discount:0, tip:0, pay:'Tarjeta' },
  { day:2, h:18, m:30, table:'T04', customer:'Andrés Ríos',
    items:[['Pizzas','La Mia Pitza',1],['Pizzas','Focaccia',1],['Antipastos','Rúcula & hongos al vino',1]],
    discount:0, tip:120, pay:'Efectivo' },
  { day:2, h:20, m:0,  table:'T17', customer:'Pareja López',
    items:[['Pizzas','Capresse',1],['Vinos Blancos','Santa Rita Pinot Grigio (Botella)',1],['Postres','Cheesecake de fresas',1]],
    discount:0, tip:0, pay:'Mixto' },
  { day:2, h:21, m:30, table:null,  customer:'Oficina Torres',
    items:[['Pizzas','Pepperoni',2],['Bebidas','Coca Cola',2]],
    discount:0, tip:0, pay:'Tarjeta' },
  // ── Day -1 (Feb 9) ──
  { day:1, h:12, m:0,  table:'T06', customer:'Familia Navarro',
    items:[['Pizzas','Maui Pitza',1],['Pizzas','La Cotto',1],['Pizzas','Dulce Fiery',1],['Extras','Jalapeño',2],['Bebidas','Fanta Roja',3]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:1, h:14, m:0,  table:'T08', customer:'Sofía Herrera',
    items:[['Pastas Frescas','Canelones ricotta y espinaca',1],['Antipastos','Tabla de Antipasto',1],['Vinos Tintos','La Vielle Ferme (Botella)',1]],
    discount:0, tip:200, pay:'Tarjeta' },
  { day:1, h:19, m:0,  table:'T13', customer:'Manuel Ortiz',
    items:[['Pizzas','4 Quesos & Hongos',1],['Pizzas','La Extra',1],['Postres','Brownie con Helado',1],['Bebidas','Agua Purificada',2]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:1, h:21, m:0,  table:'T20', customer:'Grupo Amigos',
    items:[['Pizzas','La Bianco',1],['Pizzas','Focaccia',1],['Bebidas','Coca Cola',2]],
    discount:100, tip:80, pay:'Efectivo' },
  // ── Day 0 (Feb 10 — hoy) ──
  { day:0, h:12, m:30, table:'T03', customer:'Sandra Gutiérrez',
    items:[['Pizzas','Cheese Bar Pie',1],['Bebidas','Coca Cola',1],['Postres','Pan de Banano o Zanahoria Ala Mode',1]],
    discount:0, tip:0, pay:'Efectivo' },
  { day:0, h:13, m:45, table:'T10', customer:'Familia Méndez',
    items:[['Pizzas','La Bianco',1],['Pizzas','Pepperoni',1],['Antipastos','Tabla de Antipasto',1],['Bebidas','Sprite',2]],
    discount:0, tip:80, pay:'Tarjeta' },
  { day:0, h:14, m:15, table:null, customer:'Oficina Central',
    items:[['Pizzas','4 Quesos & Hongos',3],['Bebidas','Coca Zero',3]],
    discount:0, tip:0, pay:'Tarjeta' },
];

const RESERVATIONS = [
  { day:5, h:19, m:0,  name:'Laura Jiménez',         phone:'555-201-0001', people:4, status:'COMPLETED' as const, notes:'Zona: Terraza' },
  { day:5, h:20, m:30, name:'Ricardo Peña',           phone:'555-201-0002', people:2, status:'COMPLETED' as const, notes:'Zona: Salón A' },
  { day:4, h:13, m:0,  name:'Grupo Empresarial MX',   phone:'555-201-0003', people:6, status:'COMPLETED' as const, notes:'Zona: Salón B' },
  { day:4, h:20, m:0,  name:'Patricia Moreno',        phone:'555-201-0004', people:4, status:'CANCELLED' as const, notes:'Canceló por enfermedad' },
  { day:3, h:14, m:0,  name:'Tomás Sánchez',          phone:'555-201-0005', people:2, status:'COMPLETED' as const, notes:'Zona: Terraza' },
  { day:3, h:19, m:30, name:'Cumpleaños Diana',       phone:'555-201-0006', people:8, status:'COMPLETED' as const, notes:'Zona: Salón A, decoración especial' },
  { day:2, h:12, m:30, name:'Isabel Guzmán',          phone:'555-201-0007', people:4, status:'COMPLETED' as const, notes:'Zona: Terraza' },
  { day:2, h:20, m:0,  name:'Alberto Vega',           phone:'555-201-0008', people:2, status:'NO_SHOW'   as const, notes:'' },
  { day:1, h:13, m:0,  name:'Familia Castillo',       phone:'555-201-0009', people:6, status:'COMPLETED' as const, notes:'Zona: Salón B' },
  { day:1, h:19, m:0,  name:'Claudia Ramos',          phone:'555-201-0010', people:4, status:'CONFIRMED' as const, notes:'Zona: Terraza' },
  { day:0, h:14, m:0,  name:'Martín Delgado',         phone:'555-201-0011', people:4, status:'PENDING'   as const, notes:'Zona: Salón A' },
  { day:-1,h:20, m:0,  name:'Valentina Cruz',         phone:'555-201-0012', people:6, status:'CONFIRMED' as const, notes:'Zona: Salón B' },
  { day:-2,h:19, m:30, name:'Óscar Medina',           phone:'555-201-0013', people:2, status:'PENDING'   as const, notes:'Zona: Terraza' },
  { day:-4,h:20, m:0,  name:'San Valentín – Pareja Ruiz', phone:'555-201-0014', people:2, status:'CONFIRMED' as const, notes:'Zona: Terraza, mesa con velas' },
];

// ============================================================
// MAIN
// ============================================================
async function main() {
  const demoConfig = resolveDemoSeedConfig(process.env, 'operational');
  CID = demoConfig.companyId;
  BID = demoConfig.branchId!;
  const [companyFixture, branchFixture] = await Promise.all([
    prisma.company.findUnique({ where: { id: CID }, select: { id: true, active: true } }),
    prisma.branch.findFirst({ where: { id: BID, companyId: CID, status: 'ACTIVE' }, select: { id: true } })
  ]);
  if (!companyFixture?.active || !branchFixture) {
    throw new Error('DEMO_SEED_COMPANY_ID/DEMO_SEED_BRANCH_ID no identifican una empresa y sucursal activa compatibles');
  }
  console.log('=== Operational Seed Start ===\n');

  // ─────────────────────────────────────────────────────────
  // Phase 0 · Load existing data & build lookups
  // ─────────────────────────────────────────────────────────
  console.log('Phase 0 · Loading existing data…');

  const allProducts  = await prisma.product.findMany({ where: { companyId: CID } });
  const allMI        = await prisma.menuItem.findMany({
    where: { companyId: CID },
    include: { recipes: true, category: true },
  });
  const allTables    = await prisma.table.findMany({ where: { companyId: CID } });
  const allPM        = await prisma.paymentMethod.findMany({
    where: { active: true, OR: [{ companyId: CID }, { companyId: null }] }
  });
  const allCatSvc    = await prisma.cateringService.findMany({ where: { companyId: CID } });

  const prodBySku    = new Map(allProducts.filter(p => p.sku).map(p => [p.sku!, p]));
  const tableByNum   = new Map(allTables.map(t => [t.number, t]));
  const paymentMethod = (type: 'CASH' | 'CARD' | 'BANK_TRANSFER') => {
    const method = allPM.find((candidate) => candidate.type === type && candidate.companyId === CID)
      ?? allPM.find((candidate) => candidate.type === type && candidate.companyId === null);
    if (!method) throw new Error(`Falta método de pago activo/configurado de tipo ${type} para el fixture`);
    return method;
  };
  const cashPaymentMethod = paymentMethod('CASH');
  const cardPaymentMethod = paymentMethod('CARD');
  const transferPaymentMethod = paymentMethod('BANK_TRANSFER');
  const catSvcByName = new Map(allCatSvc.map(s => [s.name, s]));

  /** Lookup menu item by category name + item name */
  const miLookup = (cat: string, name: string) =>
    allMI.find(mi => mi.category.name === cat && mi.name === name);

  console.log(`  ${allProducts.length} products, ${allMI.length} menuItems, ${allTables.length} tables\n`);

  // ─────────────────────────────────────────────────────────
  // Phase 1 · Roles + Users
  // ─────────────────────────────────────────────────────────
  console.log('Phase 1 · Roles & Users…');
  const hpwd = await bcrypt.hash(demoConfig.password, BCRYPT_ROUNDS);

  // Ensure custom roles exist (compound unique: companyId + name)
  let bodegaRole = await prisma.role.findFirst({ where: { companyId: CID, name: 'BODEGA' } });
  if (!bodegaRole) {
    bodegaRole = await prisma.role.create({ data: {
      companyId: CID, name: 'BODEGA', description: 'Warehouse / Inventory Staff',
    }});
    console.log('  + role BODEGA');
  }

  let chefRole = await prisma.role.findFirst({ where: { companyId: CID, name: 'CHEF' } });
  if (!chefRole) {
    chefRole = await prisma.role.create({ data: {
      companyId: CID, name: 'CHEF', description: 'Head Chef / Kitchen Manager',
    }});
    console.log('  + role CHEF');
  }
  const baseRoles = await prisma.role.findMany({
    where: { companyId: CID, name: { in: ['MESERO', 'CAJERO', 'COCINA'] } }
  });
  const roleByName = new Map(baseRoles.map((role) => [role.name, role]));
  const waiterRole = roleByName.get('MESERO');
  const cashierRole = roleByName.get('CAJERO');
  const kitchenRole = roleByName.get('COCINA');
  if (!waiterRole || !cashierRole || !kitchenRole) {
    throw new Error('Faltan roles MESERO/CAJERO/COCINA en la empresa seleccionada');
  }

  const pwdNow = new Date(); // password already set, no forced change for seed users

  let mesero = await prisma.user.findFirst({ where: { username: 'mesero1' } });
  if (mesero && (mesero.companyId !== CID || mesero.branchId !== BID)) {
    throw new Error('mesero1 ya pertenece a otra empresa o sucursal');
  }
  if (!mesero) {
    mesero = await prisma.user.create({ data: {
      companyId: CID, branchId: BID, name: 'Juan Pérez', email: 'juan@restaurant.com',
      username: 'mesero1', password: hpwd, roleId: waiterRole.id, status: 'ACTIVE',
      mustChangePassword: false, passwordChangedAt: pwdNow,
    }});
    console.log('  + mesero1');
  }

  let cajero = await prisma.user.findFirst({ where: { username: 'cajero1' } });
  if (cajero && (cajero.companyId !== CID || cajero.branchId !== BID)) {
    throw new Error('cajero1 ya pertenece a otra empresa o sucursal');
  }
  if (!cajero) {
    cajero = await prisma.user.create({ data: {
      companyId: CID, branchId: BID, name: 'María García', email: 'maria@restaurant.com',
      username: 'cajero1', password: hpwd, roleId: cashierRole.id, status: 'ACTIVE',
      mustChangePassword: false, passwordChangedAt: pwdNow,
    }});
    console.log('  + cajero1');
  }

  let cocina = await prisma.user.findFirst({ where: { username: 'cocina1' } });
  if (cocina && (cocina.companyId !== CID || cocina.branchId !== BID)) {
    throw new Error('cocina1 ya pertenece a otra empresa o sucursal');
  }
  if (!cocina) {
    cocina = await prisma.user.create({ data: {
      companyId: CID, branchId: BID, name: 'Carlos Martínez', email: 'carlos@restaurant.com',
      username: 'cocina1', password: hpwd, roleId: kitchenRole.id, status: 'ACTIVE',
      mustChangePassword: false, passwordChangedAt: pwdNow,
    }});
    console.log('  + cocina1');
  }

  let bodega = await prisma.user.findFirst({ where: { username: 'bodega1' } });
  if (bodega && (bodega.companyId !== CID || bodega.branchId !== BID)) {
    throw new Error('bodega1 ya pertenece a otra empresa o sucursal');
  }
  if (!bodega) {
    bodega = await prisma.user.create({ data: {
      companyId: CID, branchId: BID, name: 'Luis Ramírez', email: 'luis@restaurant.com',
      username: 'bodega1', password: hpwd, roleId: bodegaRole.id, status: 'ACTIVE',
      mustChangePassword: false, passwordChangedAt: pwdNow,
    }});
    console.log('  + bodega1');
  }

  let chef = await prisma.user.findFirst({ where: { username: 'chef1' } });
  if (chef && (chef.companyId !== CID || chef.branchId !== BID)) {
    throw new Error('chef1 ya pertenece a otra empresa o sucursal');
  }
  if (!chef) {
    chef = await prisma.user.create({ data: {
      companyId: CID, branchId: BID, name: 'Roberto Silva', email: 'roberto@restaurant.com',
      username: 'chef1', password: hpwd, roleId: chefRole.id, status: 'ACTIVE',
      mustChangePassword: false, passwordChangedAt: pwdNow,
    }});
    console.log('  + chef1');
  }

  await prisma.user.updateMany({
    where: { id: { in: [mesero.id, cajero.id, cocina.id, bodega.id, chef.id] }, companyId: CID, branchId: BID },
    data: { password: hpwd, mustChangePassword: false, passwordChangedAt: pwdNow }
  });

  // ─────────────────────────────────────────────────────────
  // Phase 2 · Warehouse
  // ─────────────────────────────────────────────────────────
  console.log('Phase 2 · Warehouse…');
  let warehouse = await prisma.warehouse.findFirst({
    where: { companyId: CID, branchId: BID, name: 'Principal' },
  });
  if (!warehouse) {
    warehouse = await prisma.warehouse.create({
      data: { companyId: CID, branchId: BID, type: 'BRANCH', name: 'Principal', code: 'MAIN-OPS' },
    });
  }

  // ─────────────────────────────────────────────────────────
  // Phase 3 · Suppliers (10)
  // ─────────────────────────────────────────────────────────
  console.log('Phase 3 · Suppliers…');
  const supMap = new Map<string, { id: number; skus: string[] }>();

  for (const sd of SUPPLIERS) {
    let s = await prisma.supplier.findFirst({ where: { companyId: CID, name: sd.name } });
    if (!s) {
      s = await prisma.supplier.create({ data: {
        companyId: CID, name: sd.name, taxId: sd.taxId, contact: sd.contact,
        phone: sd.phone, email: sd.email, supplyType: sd.type, active: true,
      }});
      inc('suppliers');
    }
    supMap.set(sd.name, { id: s.id, skus: sd.skus });
  }
  console.log(`  ${R.suppliers || 0} new`);

  // ─────────────────────────────────────────────────────────
  // Phase 4 · Purchase Orders + Items
  // ─────────────────────────────────────────────────────────
  console.log('Phase 4 · Purchase orders…');

  for (const sd of SUPPLIERS) {
    const sup = supMap.get(sd.name)!;
    const nPOs = sd.skus.length <= 3 ? 2 : 3;

    for (let i = 0; i < nPOs; i++) {
      const round = PO_ROUNDS[i];
      const invNum = `OC-${sd.taxId.substring(0, 3)}-${String(i + 1).padStart(3, '0')}`;

      if (await prisma.purchaseOrder.findFirst({ where: { companyId: CID, invoiceNumber: invNum } }))
        continue;

      const poItems: { productId: number; quantity: number; cost: number; subtotal: number }[] = [];
      for (const sku of sup.skus) {
        const prod = prodBySku.get(sku);
        if (!prod) { W.push(`SKU ${sku} not found`); continue; }
        const baseQty = prod.unit === 'kg' ? 10 : prod.unit === 'L' ? 5 : 24;
        const qty = r2(baseQty * round.mul);
        const cost = Number(prod.cost);
        poItems.push({ productId: prod.id, quantity: qty, cost, subtotal: r2(qty * cost) });
      }

      const total = r2(poItems.reduce((s, x) => s + x.subtotal, 0));
      await prisma.purchaseOrder.create({
        data: {
          companyId: CID, branchId: BID, supplierId: sup.id,
          date: dt(round.daysAgo, 10), status: 'RECEIVED', total,
          invoiceNumber: invNum, notes: `Compra regular – ${sd.name}`,
          items: { create: poItems },
        },
      });
      inc('pos');
      inc('poItems', poItems.length);
    }
  }
  console.log(`  ${R.pos || 0} POs, ${R.poItems || 0} items`);

  // ─────────────────────────────────────────────────────────
  // Phase 5 · Inventory IN + Stock + Cost History
  // ─────────────────────────────────────────────────────────
  console.log('Phase 5 · Inventory IN…');

  const rcvdPOs = await prisma.purchaseOrder.findMany({
    where: { companyId: CID, status: 'RECEIVED' },
    include: { items: true },
    orderBy: { date: 'asc' },
  });

  // In-memory stock tracker: productId → { qty, totalCost, avgCost }
  const stk = new Map<number, { qty: number; tc: number; ac: number }>();

  async function applySupplementalWarehouseMovements() {
    const supplemental = await prisma.inventoryMovement.findMany({
      where: {
        companyId: CID,
        warehouseId: warehouse!.id,
        OR: [
          { transferGroupId: { not: null } },
          { type: 'ADJUSTMENT' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    for (const mv of supplemental) {
      const current = stk.get(mv.productId) || { qty: 0, tc: 0, ac: Number(mv.unitCost || 0) };
      const qty = Number(mv.quantity);
      const unitCost = Number(mv.unitCost || current.ac || 0);
      const totalCost = Number(mv.totalCost || (qty * unitCost));

      if (mv.type === 'IN' || (mv.type === 'ADJUSTMENT' && qty >= 0)) {
        current.qty = r2(current.qty + qty);
        current.tc = r2(current.tc + totalCost);
      } else {
        current.qty = r2(current.qty - qty);
        current.tc = r2(Math.max(0, current.tc - totalCost));
      }

      current.ac = current.qty > 0 ? r2(current.tc / current.qty) : unitCost;
      stk.set(mv.productId, current);
    }
  }

  for (const po of rcvdPOs) {
    for (const item of po.items) {
      const ref = `PO-${po.invoiceNumber}-${item.productId}`;
      const prev = stk.get(item.productId) || { qty: 0, tc: 0, ac: 0 };
      const inQty = Number(item.quantity);
      const inCost = Number(item.subtotal);
      const newQty = r2(prev.qty + inQty);
      const newTc  = r2(prev.tc + inCost);
      const newAc  = r2(newTc / newQty);
      stk.set(item.productId, { qty: newQty, tc: newTc, ac: newAc });

      // Skip if movement already exists
      if (await prisma.inventoryMovement.findFirst({ where: { companyId: CID, reference: ref } }))
        continue;

      await prisma.inventoryMovement.create({ data: {
        warehouseId: warehouse.id, productId: item.productId, userId: cajero!.id,
        companyId: CID, type: 'IN', quantity: inQty,
        reason: 'Compra', reference: ref,
        unitCost: Number(item.cost), totalCost: inCost,
        balanceQty: newQty, balanceCost: newTc,
        createdAt: po.date,
      }});
      inc('invIn');

      await prisma.product.update({
        where: { id: item.productId },
        data: { currentAverageCost: newAc, lastPurchaseCost: Number(item.cost), cost: newAc },
      });

      await prisma.productCostHistory.create({ data: {
        productId: item.productId, companyId: CID, purchaseOrderItemId: item.id,
        quantity: inQty, unitCost: Number(item.cost),
        previousAvgCost: prev.ac, newAvgCost: newAc,
        previousStock: prev.qty, newStock: newQty,
        createdAt: po.date,
      }});
      inc('costHist');
    }
  }

  // Upsert Stock records
  for (const [pid, d] of stk) {
    await prisma.stock.upsert({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: pid } },
      update: { quantity: d.qty },
      create: { warehouseId: warehouse.id, productId: pid, companyId: CID, quantity: d.qty },
    });
    inc('stockUps');
  }
  console.log(`  ${R.invIn || 0} IN movements, ${R.costHist || 0} cost histories, ${R.stockUps || 0} stocks`);

  // ─────────────────────────────────────────────────────────
  // Phase 6 · Customers + Catering Events (2)
  // ─────────────────────────────────────────────────────────
  console.log('Phase 6 · Customers & Catering…');

  async function getOrCreateCustomer(name: string, email: string, phone: string) {
    let c = await prisma.customer.findFirst({ where: { companyId: CID, name } });
    if (!c) { c = await prisma.customer.create({ data: { companyId: CID, name, email, phone } }); inc('customers'); }
    return c;
  }

  const cust1 = await getOrCreateCustomer('Ricardo Solís', 'rsolis@gruposol.mx', '555-301-0001');
  const cust2 = await getOrCreateCustomer('Familia García-López', 'garcia.lopez@mail.mx', '555-301-0002');

  // Event 1 — Conferencia
  if (!await prisma.cateringEvent.findFirst({ where: { companyId: CID, title: 'Conferencia Empresarial Grupo Sol' } })) {
    const svc1 = catSvcByName.get('Coffee Break Ejecutivo');
    const svc2 = catSvcByName.get('Pizza Party');
    const svcItems: any[] = [];
    if (svc1) svcItems.push({ cateringServiceId: svc1.id, quantity: 50, unitPrice: Number(svc1.salePrice), subtotal: r2(50 * Number(svc1.salePrice)) });
    if (svc2) svcItems.push({ cateringServiceId: svc2.id, quantity: 50, unitPrice: Number(svc2.salePrice), subtotal: r2(50 * Number(svc2.salePrice)) });
    const tot = svcItems.reduce((s: number, x: any) => s + x.subtotal, 0);
    const adv = r2(tot * 0.3);
    await prisma.cateringEvent.create({ data: {
      companyId: CID, branchId: BID, customerId: cust1.id,
      title: 'Conferencia Empresarial Grupo Sol',
      date: dt(-5, 9), peopleCount: 50, status: 'RESERVED',
      totalAmount: tot, balance: r2(tot - adv),
      location: 'Hotel Grand Plaza – Salón Diamante', notes: 'Incluye equipo audiovisual',
      services: { create: svcItems },
      payments: { create: [{ paymentMethodId: transferPaymentMethod.id, amount: adv, type: 'ADVANCE', date: dt(10) }] },
    }});
    inc('cateringEvents');
  }

  // Event 2 — Boda
  if (!await prisma.cateringEvent.findFirst({ where: { companyId: CID, title: 'Boda García-López' } })) {
    const svcs = ['Pasta + Antipasto', 'Tabla de Vinos y Quesos', 'Servicio de Mesero (hora)', 'Montaje y Vajilla (evento)'];
    const qtys = [100, 100, 8, 1];
    const svcItems: any[] = [];
    svcs.forEach((sn, i) => {
      const sv = catSvcByName.get(sn);
      if (sv) svcItems.push({ cateringServiceId: sv.id, quantity: qtys[i], unitPrice: Number(sv.salePrice), subtotal: r2(qtys[i] * Number(sv.salePrice)) });
    });
    const tot2 = svcItems.reduce((s: number, x: any) => s + x.subtotal, 0);
    await prisma.cateringEvent.create({ data: {
      companyId: CID, branchId: BID, customerId: cust2.id,
      title: 'Boda García-López',
      date: dt(-18, 17), peopleCount: 100, status: 'QUOTED',
      totalAmount: tot2, balance: tot2,
      location: 'Jardín Las Palmas', notes: 'Cotización pendiente de aprobación',
      services: { create: svcItems },
    }});
    inc('cateringEvents');
  }
  console.log(`  ${R.customers || 0} customers, ${R.cateringEvents || 0} catering events`);

  // ─────────────────────────────────────────────────────────
  // Phase 6b · Catering: menu items + cláusulas de contrato
  // ─────────────────────────────────────────────────────────
  console.log('Phase 6b · Catering menu items & cláusulas…');

  // Menu items per event
  const cateringMenuDefs: { title: string; items: OI[] }[] = [
    { title: 'Conferencia Empresarial Grupo Sol', items: [
      ['Pizzas','Cheese Bar Pie',8], ['Pizzas','Pepperoni',8],
      ['Pizzas','4 Quesos & Hongos',6], ['Pizzas','Capresse',6],
      ['Pizzas','Focaccia',4],
      ['Bebidas','Coca Cola',25], ['Bebidas','Agua Purificada',25],
    ]},
    { title: 'Boda García-López', items: [
      ['Pastas Frescas','Raviolis ricotta y parmesano',25],
      ['Pastas Frescas','Canelones ricotta y espinaca',25],
      ['Pastas Frescas','Mezzaluna verde de ricotta y espinaca',25],
      ['Pastas Frescas','Mezzaluna de ricotta y parmesano',25],
      ['Antipastos','Tabla de Antipasto',15], ['Antipastos','Pan Rústico',10],
      ['Vinos Blancos','Frontera Sauvignon Blanc (Botella)',15],
      ['Vinos Tintos','San Telmo Malbec (Botella)',15],
      ['Postres','Cheesecake de fresas',50],
    ]},
  ];

  // Contract clauses per event
  const cateringClauses: Record<string, object> = {
    'Conferencia Empresarial Grupo Sol': {
      manifiestan: 'La Mia Pitza S.A. de C.V. (en adelante EL PROVEEDOR) y Grupo Sol S.A. de C.V. representado por el Sr. Ricardo Solís (en adelante EL CLIENTE) celebran el presente contrato de prestación de servicios de catering.',
      objetoContrato: 'EL PROVEEDOR se compromete a proporcionar servicio de Coffee Break Ejecutivo y Pizza Party para 50 personas, incluyendo alimentos, bebidas, montaje y personal de servicio.',
      duracionServicio: 'El servicio se prestará el 15 de febrero de 2026, de las 09:00 a las 15:00 horas, en el Hotel Grand Plaza – Salón Diamante.',
      gastosServicio: 'Los gastos de transporte, montaje, personal y limpieza están incluidos en el precio pactado. Requerimientos adicionales se cotizarán por separado con 48 horas de anticipación.',
      demoraPago: 'En caso de demora en el pago, se aplicará un recargo del 2% mensual sobre el saldo pendiente a partir del día siguiente al vencimiento.',
      obligacionesProveedor: 'Entregar alimentos y bebidas en condiciones óptimas de calidad e higiene. Cumplir horarios. Contar con personal uniformado y capacitado. Retirar equipo al término del evento.',
      obligacionesCliente: 'Proporcionar acceso al área de montaje 2 horas antes del evento. Realizar anticipo del 30% al confirmar el servicio. Liquidar saldo restante 3 días hábiles antes del evento.',
    },
    'Boda García-López': {
      manifiestan: 'La Mia Pitza S.A. de C.V. (en adelante EL PROVEEDOR) y la Familia García-López, representada por el(la) Sr(a). García-López (en adelante EL CLIENTE) celebran el presente contrato de prestación de servicios de catering para evento social.',
      objetoContrato: 'EL PROVEEDOR se compromete a proporcionar servicios de estación de Pastas Frescas con 4 salsas, Antipastos variados, Tabla de Vinos y Quesos, servicio de 8 meseros profesionales y montaje completo de vajilla para 100 personas.',
      duracionServicio: 'El servicio se prestará el 28 de febrero de 2026, de las 17:00 a las 01:00 horas del día siguiente, en Jardín Las Palmas.',
      gastosServicio: 'El precio incluye transporte, montaje, desmontaje, personal de servicio y vajilla completa. Electricidad, agua y acceso al venue son responsabilidad del cliente.',
      demoraPago: 'En caso de demora en el pago se aplicará un recargo del 2% mensual sobre el saldo. La no liquidación 7 días antes del evento faculta a EL PROVEEDOR a suspender el servicio.',
      obligacionesProveedor: 'Proveer alimentos frescos y de calidad. Asignar 8 meseros profesionales uniformados. Instalar montaje completo: mantelería, vajilla, cristalería y cubertería. Coordinar tiempos con organizador del evento.',
      obligacionesCliente: 'Confirmar número final de invitados 10 días antes. Proporcionar acceso al área de montaje 4 horas antes. Cubrir anticipo del 40% al confirmar y liquidar saldo 7 días antes del evento.',
    },
  };

  for (const def of cateringMenuDefs) {
    const event = await prisma.cateringEvent.findFirst({ where: { companyId: CID, title: def.title } });
    if (!event) continue;

    // Update clauses if null
    if (!event.clauses) {
      await prisma.cateringEvent.update({
        where: { id: event.id },
        data: { clauses: cateringClauses[def.title] || {} },
      });
      inc('cateringClauses');
    }

    // Add menu items if none exist
    const existingMI = await prisma.cateringMenuItem.count({ where: { cateringEventId: event.id } });
    if (existingMI > 0) continue;

    for (const [cat, name, qty] of def.items) {
      const mi = miLookup(cat, name);
      if (!mi) { W.push(`Catering MI not found: ${cat}/${name}`); continue; }
      const price = Number(mi.price);
      await prisma.cateringMenuItem.create({ data: {
        cateringEventId: event.id, menuItemId: mi.id,
        quantity: qty, unitPrice: price, subtotal: r2(qty * price),
      }});
      inc('cateringMenuItems');
    }
  }
  console.log(`  ${R.cateringMenuItems || 0} menu items, ${R.cateringClauses || 0} clauses updated`);

  // ─────────────────────────────────────────────────────────
  // Phase 7 · Reservations (14)
  // ─────────────────────────────────────────────────────────
  console.log('Phase 7 · Reservations…');

  for (const rd of RESERVATIONS) {
    const date = dt(rd.day, rd.h, rd.m);
    if (await prisma.reservation.findFirst({ where: { companyId: CID, customerName: rd.name, date } }))
      continue;
    await prisma.reservation.create({ data: {
      companyId: CID, branchId: BID, customerName: rd.name,
      phone: rd.phone, date, peopleCount: rd.people,
      status: rd.status, notes: rd.notes || null,
    }});
    inc('reservations');
  }
  console.log(`  ${R.reservations || 0} new`);

  // ─────────────────────────────────────────────────────────
  // Phase 8 · Cash Register
  // ─────────────────────────────────────────────────────────
  console.log('Phase 8 · Cash register…');
  let register = await prisma.cashRegister.findFirst({ where: { companyId: CID, name: 'Caja Principal' } });
  if (!register) {
    register = await prisma.cashRegister.create({ data: {
      companyId: CID, branchId: BID, name: 'Caja Principal', status: 'CLOSED',
    }});
    inc('cashRegisters');
  }

  // ─────────────────────────────────────────────────────────
  // Phase 9 · Orders (21) + Items + Payments
  // ─────────────────────────────────────────────────────────
  console.log('Phase 9 · Orders…');

  // Track cash amounts per day for Phase 11
  const cashByDay = new Map<number, { orderId: number; cashAmt: number; at: Date }[]>();

  for (const od of ORDERS) {
    const orderAt = dt(od.day, od.h, od.m);
    const closeAt = new Date(orderAt.getTime() + 45 * 60_000);

    // Idempotency
    const existing = await prisma.order.findFirst({
      where: { companyId: CID, customerName: od.customer, createdAt: orderAt },
      include: { payments: true },
    });

    if (existing) {
      const cashAmt = existing.payments
        .filter((p: any) => p.paymentMethodId === cashPaymentMethod.id)
        .reduce((s: number, p: any) => s + Number(p.amount), 0);
      if (!cashByDay.has(od.day)) cashByDay.set(od.day, []);
      cashByDay.get(od.day)!.push({ orderId: existing.id, cashAmt, at: orderAt });
      continue;
    }

    // Resolve items & compute totals
    const resolved: { menuItemId: number; qty: number; price: number; subtotal: number }[] = [];
    for (const [cat, name, qty] of od.items) {
      const mi = miLookup(cat, name);
      if (!mi) { W.push(`MenuItem not found: ${cat}/${name}`); continue; }
      const price = Number(mi.price);
      resolved.push({ menuItemId: mi.id, qty, price, subtotal: r2(price * qty) });
    }

    const subtotal = r2(resolved.reduce((s, x) => s + x.subtotal, 0));
    const total    = r2(subtotal - od.discount);
    const payTotal = r2(total + od.tip);
    const tableId  = od.table ? tableByNum.get(od.table)?.id ?? null : null;

    const order = await prisma.order.create({ data: {
      companyId: CID, branchId: BID,
      tableId, userId: mesero!.id, cashRegisterId: register!.id,
      customerName: od.customer,
      orderType: od.table ? 'DINE_IN' : 'TAKEOUT',
      status: 'DELIVERED', financialStatus: 'PAID', total, discount: od.discount, tipAmount: od.tip, tax: 0,
      createdAt: orderAt, updatedAt: closeAt, closedAt: closeAt, deliveredAt: closeAt,
      items: { create: resolved.map(ri => ({
        menuItemId: ri.menuItemId, quantity: ri.qty, price: ri.price, subtotal: ri.subtotal,
        status: 'DONE', sentAt: orderAt, startedAt: orderAt, finishedAt: closeAt,
      })) },
    }});
    inc('orders');
    inc('orderItems', resolved.length);

    // Payments
    let cashAmt = 0;
    if (od.pay === 'Efectivo') {
      await prisma.payment.create({ data: { orderId: order.id, paymentMethodId: cashPaymentMethod.id, methodType: 'CASH', amount: payTotal, createdAt: closeAt } });
      cashAmt = payTotal;
      inc('payments');
    } else if (od.pay === 'Tarjeta') {
      await prisma.payment.create({ data: { orderId: order.id, paymentMethodId: cardPaymentMethod.id, methodType: 'CARD', amount: payTotal, createdAt: closeAt } });
      inc('payments');
    } else { // Mixto
      const half = r2(payTotal / 2);
      await prisma.payment.create({ data: { orderId: order.id, paymentMethodId: cashPaymentMethod.id, methodType: 'CASH', amount: half, createdAt: closeAt } });
      await prisma.payment.create({ data: { orderId: order.id, paymentMethodId: cardPaymentMethod.id, methodType: 'CARD', amount: r2(payTotal - half), createdAt: closeAt } });
      cashAmt = half;
      inc('payments', 2);
    }

    if (!cashByDay.has(od.day)) cashByDay.set(od.day, []);
    cashByDay.get(od.day)!.push({ orderId: order.id, cashAmt, at: orderAt });
  }
  console.log(`  ${R.orders || 0} orders, ${R.orderItems || 0} items, ${R.payments || 0} payments`);

  // ─────────────────────────────────────────────────────────
  // Phase 10 · Inventory OUT (BOM consumption from orders)
  // ─────────────────────────────────────────────────────────
  console.log('Phase 10 · Inventory OUT…');

  const paidOrders = await prisma.order.findMany({
    where: { companyId: CID, financialStatus: 'PAID', status: { not: 'CANCELLED' }, createdAt: { gte: dt(6, 0), lte: dt(-1, 23, 59) } },
    include: { items: { include: { menuItem: { include: { recipes: true } } } } },
    orderBy: { createdAt: 'asc' },
  });

  for (const order of paidOrders) {
    // Aggregate consumption by product across all order items
    const consumption = new Map<number, number>();
    for (const oi of order.items) {
      for (const recipe of oi.menuItem.recipes) {
        const q = Number(recipe.quantity) * oi.quantity;
        consumption.set(recipe.productId, (consumption.get(recipe.productId) || 0) + q);
      }
    }

    for (const [productId, totalQty] of consumption) {
      const ref = `ORD-${order.id}-${productId}`;
      const consumeQty = r2(totalQty);
      const sd = stk.get(productId);
      if (!sd) { W.push(`No stock for product ${productId}`); continue; }

      // Always update in-memory tracker (even if movement already exists)
      const outCost = r2(sd.ac * consumeQty);
      sd.qty = r2(sd.qty - consumeQty);
      sd.tc  = r2(Math.max(0, sd.tc - outCost));

      // Skip DB insert if movement already exists
      if (await prisma.inventoryMovement.findFirst({ where: { companyId: CID, reference: ref } }))
        continue;

      await prisma.inventoryMovement.create({ data: {
        warehouseId: warehouse.id, productId, userId: mesero!.id,
        companyId: CID, type: 'OUT', quantity: consumeQty,
        reason: 'Venta', reference: ref,
        unitCost: sd.ac, totalCost: outCost,
        balanceQty: sd.qty, balanceCost: sd.tc,
        createdAt: order.closedAt || order.createdAt,
      }});
      inc('invOut');
    }
  }

  await applySupplementalWarehouseMovements();

  // Update stock records with final quantities
  for (const [pid, d] of stk) {
    await prisma.stock.upsert({
      where: { warehouseId_productId: { warehouseId: warehouse.id, productId: pid } },
      update: { quantity: d.qty },
      create: { warehouseId: warehouse.id, productId: pid, companyId: CID, quantity: d.qty },
    });
  }
  console.log(`  ${R.invOut || 0} OUT movements`);

  // ─────────────────────────────────────────────────────────
  // Phase 11 · Cash Shifts + Movements + Counts
  // ─────────────────────────────────────────────────────────
  console.log('Phase 11 · Cash shifts…');

  const START_AMT = 2000;
  const salesDays = [5, 4, 3, 2, 1, 0];

  for (const day of salesDays) {
    const openAt  = dt(day, 10, 0);
    const closeAt = dt(day, 22, 30);

    if (await prisma.cashShift.findFirst({ where: { companyId: CID, cashRegisterId: register!.id, startDate: openAt } }))
      continue;

    const dayOrds = cashByDay.get(day) || [];
    const totalCashIn = dayOrds.reduce((s, o) => s + o.cashAmt, 0);
    const expected = r2(START_AMT + totalCashIn);
    const diff     = day === 1 ? -25 : 0; // Day 1 has small deficit
    const counted  = r2(expected + diff);

    const shift = await prisma.cashShift.create({ data: {
      companyId: CID, cashRegisterId: register!.id, userId: cajero!.id,
      startDate: openAt, endDate: closeAt,
      startAmount: START_AMT, endAmount: counted, difference: diff,
      notes: diff !== 0 ? 'Diferencia menor controlada' : null,
    }});
    inc('cashShifts');

    // Cash movements for each cash-paying order
    for (const o of dayOrds) {
      if (o.cashAmt > 0) {
        await prisma.cashMovement.create({ data: {
          shiftId: shift.id, type: 'IN', amount: o.cashAmt,
          description: `Venta #${o.orderId}`,
          reference: `ORDER-${o.orderId}`,
          createdAt: o.at,
        }});
        inc('cashMovements');
      }
    }

    // Cash counts at closing
    for (const d of denominations(counted)) {
      await prisma.cashCount.create({ data: {
        shiftId: shift.id, type: d.type, denomination: d.denom, count: d.count,
      }});
      inc('cashCounts');
    }
  }
  console.log(`  ${R.cashShifts || 0} shifts, ${R.cashMovements || 0} movements, ${R.cashCounts || 0} counts`);

  // ─────────────────────────────────────────────────────────
  // Phase 12 · Validation + Report
  // ─────────────────────────────────────────────────────────
  console.log('\n========== VALIDACIÓN ==========');

  // Negative stock check
  const finalStocks = await prisma.stock.findMany({
    where: { companyId: CID },
    include: { product: true, warehouse: true },
  });
  let negCount = 0;
  for (const s of finalStocks) {
    if (Number(s.quantity) < 0) {
      negCount++;
      W.push(`Stock negativo: ${s.product.name} en ${s.warehouse.name} = ${s.quantity}`);
    }
  }
  console.log(`  Stocks negativos: ${negCount === 0 ? 'NINGUNO ✓' : negCount + ' ✗'}`);

  // Verify inventory balance per warehouse/product: sum(IN) - sum(OUT) == stock
  const invMoves = await prisma.inventoryMovement.findMany({ where: { companyId: CID } });
  const balCheck = new Map<string, { inQty: number; outQty: number }>();
  for (const mv of invMoves) {
    const key = `${mv.warehouseId}:${mv.productId}`;
    const e = balCheck.get(key) || { inQty: 0, outQty: 0 };
    if (mv.type === 'IN') e.inQty += Number(mv.quantity);
    else if (mv.type === 'OUT') e.outQty += Number(mv.quantity);
    else if (mv.type === 'TRANSFER') e.outQty += Number(mv.quantity);
    balCheck.set(key, e);
  }
  let balErrors = 0;
  for (const s of finalStocks) {
    const key = `${s.warehouseId}:${s.productId}`;
    const b = balCheck.get(key);
    if (!b) continue;
    const expected = r2(b.inQty - b.outQty);
    const actual = Number(s.quantity);
    if (Math.abs(expected - actual) > 0.02) {
      balErrors++;
      W.push(`Balance error: product ${s.product.name} warehouse=${s.warehouse.code}: expected=${expected}, actual=${actual}`);
    }
  }
  console.log(`  Balance inventario: ${balErrors === 0 ? 'CUADRADO ✓' : balErrors + ' errores ✗'}`);

  // Cash shift coherence
  const shifts = await prisma.cashShift.findMany({
    where: { companyId: CID },
    include: { movements: true },
  });
  let cashErrors = 0;
  for (const sh of shifts) {
    if (!sh.endDate || sh.endAmount === null) {
      continue;
    }
    const cashIn = sh.movements.filter((m: any) => m.type === 'IN').reduce((s: number, m: any) => s + Number(m.amount), 0);
    const expectedEnd = r2(Number(sh.startAmount) + cashIn);
    const diff = r2(Number(sh.endAmount) - expectedEnd);
    if (Math.abs(diff - Number(sh.difference || 0)) > 0.02) {
      cashErrors++;
      W.push(`Cash shift ${sh.id}: expected diff=${diff}, recorded=${sh.difference}`);
    }
  }
  console.log(`  Arqueos coherentes: ${cashErrors === 0 ? 'OK ✓' : cashErrors + ' errores ✗'}`);

  // Final counts
  const FC = {
    suppliers:      await prisma.supplier.count({ where: { companyId: CID } }),
    pos:            await prisma.purchaseOrder.count({ where: { companyId: CID } }),
    poItems:        await prisma.purchaseOrderItem.count(),
    orders:         await prisma.order.count({ where: { companyId: CID } }),
    orderItems:     await prisma.orderItem.count(),
    payments:       await prisma.payment.count(),
    reservations:   await prisma.reservation.count({ where: { companyId: CID } }),
    cateringEvents: await prisma.cateringEvent.count({ where: { companyId: CID } }),
    customers:      await prisma.customer.count({ where: { companyId: CID } }),
    invMovements:   await prisma.inventoryMovement.count({ where: { companyId: CID } }),
    stocks:         await prisma.stock.count({ where: { companyId: CID } }),
    cashShifts:     await prisma.cashShift.count({ where: { companyId: CID } }),
    cashMovements:  await prisma.cashMovement.count(),
    cashCounts:     await prisma.cashCount.count(),
    costHistories:  await prisma.productCostHistory.count({ where: { companyId: CID } }),
  };

  console.log('\n========== REPORTE FINAL ==========');
  console.log(`  Proveedores:           ${FC.suppliers}`);
  console.log(`  Órdenes de compra:     ${FC.pos}  (items: ${FC.poItems})`);
  console.log(`  Mov. inventario total: ${FC.invMovements}  (IN: ${R.invIn || 0}, OUT: ${R.invOut || 0})`);
  console.log(`  Historial de costos:   ${FC.costHistories}`);
  console.log(`  Stocks:                ${FC.stocks}`);
  console.log(`  Clientes:              ${FC.customers}`);
  console.log(`  Eventos catering:      ${FC.cateringEvents}`);
  console.log(`  Reservaciones:         ${FC.reservations}`);
  console.log(`  Ventas (órdenes):      ${FC.orders}  (items: ${FC.orderItems})`);
  console.log(`  Pagos:                 ${FC.payments}`);
  console.log(`  Turnos de caja:        ${FC.cashShifts}`);
  console.log(`  Mov. de caja:          ${FC.cashMovements}`);
  console.log(`  Conteos de caja:       ${FC.cashCounts}`);

  if (W.length > 0) {
    console.log(`\n  ⚠ Advertencias (${W.length}):`);
    for (const w of W) console.log(`    · ${w}`);
  } else {
    console.log('\n  Sin advertencias.');
  }

  console.log('\n=== Operational Seed Complete ===');
}

main()
  .catch((e) => { console.error('Seed error:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
