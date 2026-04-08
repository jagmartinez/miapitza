/**
 * menu-seed.ts – Seed idempotente para poblar la BD "restaurante"
 * con datos extraídos del menú de La Mia Pitza (imágenes OCR).
 *
 * Tablas afectadas (SOLO INSERT/UPDATE):
 *   Category, MenuItem, Product, Recipe, Table, CateringService
 *
 * Marcadores en campo `description`:
 *   [PRECIO ESTIMADO]  – precio calculado (promedio de categoría o estimación)
 *   [REVISIÓN OCR]     – nombre o precio con baja confianza de lectura
 *
 * Ejecución:  npx ts-node prisma/menu-seed.ts
 */

import { PrismaClient, MenuItemType, ProductType } from '@prisma/client';

const prisma = new PrismaClient();

const CID = 1; // companyId  – "Mi Restaurante"
const BID = 1; // branchId   – "Sucursal Principal"

const TAG_EST = '[PRECIO ESTIMADO]';
const TAG_OCR = '[REVISIÓN OCR]';

// ============================================================
// HELPERS  (upsert / findOrCreate según restricciones únicas)
// ============================================================

async function upsertCategory(name: string, desc: string, order: number) {
  return prisma.category.upsert({
    where: { companyId_name: { companyId: CID, name } },
    update: { description: desc, sortOrder: order },
    create: { companyId: CID, name, description: desc, sortOrder: order, active: true },
  });
}

/** MenuItem NO tiene unique(companyId,name,categoryId) → findFirst + create/update */
async function upsertMenuItem(
  categoryId: number,
  name: string,
  description: string,
  price: number,
  type: MenuItemType = 'PREPARED',
) {
  const existing = await prisma.menuItem.findFirst({
    where: { companyId: CID, name, categoryId },
  });
  if (existing) {
    return prisma.menuItem.update({
      where: { id: existing.id },
      data: { description, price, type, active: true },
    });
  }
  return prisma.menuItem.create({
    data: { companyId: CID, categoryId, name, description, price, type, active: true },
  });
}

/** Product tiene @@unique([companyId, sku]) */
async function upsertProduct(
  name: string,
  sku: string,
  unit: string,
  cost: number,
  type: ProductType = 'INGREDIENT',
  categoryId?: number,
) {
  return prisma.product.upsert({
    where: { companyId_sku: { companyId: CID, sku } },
    update: { name, unit, cost, currentAverageCost: cost, type, categoryId, active: true },
    create: {
      companyId: CID, name, sku, unit, cost,
      currentAverageCost: cost, lastPurchaseCost: cost,
      type, categoryId: categoryId ?? null, active: true,
    },
  });
}

/** Recipe tiene @@unique([menuItemId, productId]) */
async function upsertRecipe(menuItemId: number, productId: number, quantity: number, unit?: string) {
  return prisma.recipe.upsert({
    where: { menuItemId_productId: { menuItemId, productId } },
    update: { quantity, unit },
    create: { menuItemId, productId, quantity, unit },
  });
}

/** Table tiene @@unique([branchId, number]) */
async function upsertTable(number: string, capacity: number, location: string) {
  return prisma.table.upsert({
    where: { branchId_number: { branchId: BID, number } },
    update: { capacity, location, status: 'AVAILABLE' },
    create: { companyId: CID, branchId: BID, number, capacity, location, status: 'AVAILABLE' },
  });
}

/** CateringService NO tiene unique(companyId,name) → findFirst */
async function upsertCateringService(
  name: string, desc: string, internalCost: number, salePrice: number,
) {
  const existing = await prisma.cateringService.findFirst({ where: { companyId: CID, name } });
  if (existing) {
    return prisma.cateringService.update({
      where: { id: existing.id },
      data: { description: desc, internalCost, salePrice, active: true },
    });
  }
  return prisma.cateringService.create({
    data: { companyId: CID, name, description: desc, internalCost, salePrice, active: true },
  });
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('=== Menu Seed Start ===\n');

  // -------------------------------------------------------
  // 1. CATEGORÍAS
  // -------------------------------------------------------
  console.log('1/7  Categorías…');
  const catPizzas       = await upsertCategory('Pizzas', 'Bar Style Pizza – La Mia Pitza', 1);
  const catExtras       = await upsertCategory('Extras', 'Toppings adicionales para pizza', 2);
  const catPastas       = await upsertCategory('Pastas Frescas', 'Pastas artesanales frescas', 3);
  const catSalsas       = await upsertCategory('Salsas', 'Salsas para acompañar pastas frescas', 4);
  const catAntipastos   = await upsertCategory('Antipastos', 'Entradas estilo italiano', 5);
  const catPostres      = await upsertCategory('Postres', 'Postres de la casa', 6);
  const catBebidas      = await upsertCategory('Bebidas', 'Refrescos y bebidas sin alcohol', 7);
  const catVinosTintos  = await upsertCategory('Vinos Tintos', 'Selección de vinos tintos', 8);
  const catVinosBlancos = await upsertCategory('Vinos Blancos', 'Selección de vinos blancos', 9);
  const catEspumoso     = await upsertCategory('Vino Espumoso', 'Vinos espumosos y prosecco', 10);
  const catCatering     = await upsertCategory('Catering', 'Servicios de catering y eventos', 11);

  // -------------------------------------------------------
  // 2. PRODUCTOS / INGREDIENTES  (costos estimados en MXN)
  // -------------------------------------------------------
  console.log('2/7  Productos / ingredientes…');

  // --- Ingredientes de cocina ---
  const pMasaPizza        = await upsertProduct('Masa de pizza', 'ING-001', 'kg', 35);
  const pSalsaTomate      = await upsertProduct('Salsa de tomate', 'ING-002', 'L', 60);
  const pMozzarella       = await upsertProduct('Queso mozzarella', 'ING-003', 'kg', 180);
  const pRicotta          = await upsertProduct('Ricotta', 'ING-004', 'kg', 200);
  const pParmesano        = await upsertProduct('Queso parmesano', 'ING-005', 'kg', 400);
  const pPepperoni        = await upsertProduct('Pepperoni', 'ING-006', 'kg', 280);
  const pJamonSelva       = await upsertProduct('Jamón selva negra', 'ING-007', 'kg', 350);
  const pAlbahaca         = await upsertProduct('Albahaca fresca', 'ING-008', 'kg', 120);
  const pTomateCherry     = await upsertProduct('Tomate cherry', 'ING-009', 'kg', 80);
  const pHongos           = await upsertProduct('Hongos frescos', 'ING-010', 'kg', 90);
  const pProsciutto       = await upsertProduct('Prosciutto', 'ING-011', 'kg', 500);
  const pRucula           = await upsertProduct('Rúcula', 'ING-012', 'kg', 100);
  const pAceiteOliva      = await upsertProduct('Aceite de oliva', 'ING-013', 'L', 150);
  const pJalapeno         = await upsertProduct('Jalapeño', 'ING-014', 'kg', 50);
  const pCebolla          = await upsertProduct('Cebolla', 'ING-015', 'kg', 25);
  const pCebollaMorada    = await upsertProduct('Cebolla morada', 'ING-016', 'kg', 30);
  const pGorgonzola       = await upsertProduct('Gorgonzola', 'ING-017', 'kg', 350);
  const pPesto            = await upsertProduct('Pesto', 'ING-018', 'L', 200);
  const pBalsamico        = await upsertProduct('Vinagre balsámico', 'ING-019', 'L', 180);
  const pTocino           = await upsertProduct('Tocino / Pancetta', 'ING-020', 'kg', 250);
  const pPina             = await upsertProduct('Piña', 'ING-021', 'kg', 30);
  const pMiel             = await upsertProduct('Miel', 'ING-022', 'L', 120);
  const pRomero           = await upsertProduct('Romero fresco', 'ING-023', 'kg', 100);
  const pAceitunas        = await upsertProduct('Aceitunas negras', 'ING-024', 'kg', 150);
  const pAnchoas          = await upsertProduct('Anchoas', 'ING-025', 'kg', 400);
  const pChorizoIt        = await upsertProduct('Chorizo italiano de res', 'ING-026', 'kg', 220);
  const pVodka            = await upsertProduct('Vodka', 'ING-027', 'L', 250);
  const pAjo              = await upsertProduct('Ajo', 'ING-028', 'kg', 80);
  const pSalMarina        = await upsertProduct('Sal marina', 'ING-029', 'kg', 15);
  const pHierbas          = await upsertProduct('Hierbas mixtas', 'ING-030', 'kg', 150);
  const pMasaPasta        = await upsertProduct('Masa de pasta fresca', 'ING-031', 'kg', 45);
  const pEspinaca         = await upsertProduct('Espinaca', 'ING-032', 'kg', 70);
  const pHeladoVainilla   = await upsertProduct('Helado de vainilla', 'ING-033', 'L', 120);
  const pPanBanano        = await upsertProduct('Pan de banano', 'ING-034', 'unit', 30);
  const pPanZanahoria     = await upsertProduct('Pan de zanahoria', 'ING-035', 'unit', 30);
  const pBaseBrownie      = await upsertProduct('Brownie base', 'ING-036', 'unit', 25);
  const pBaseCheesecake   = await upsertProduct('Base cheesecake', 'ING-037', 'unit', 35);
  const pFresas           = await upsertProduct('Fresas', 'ING-038', 'kg', 90);
  const pCrema            = await upsertProduct('Crema para salsas', 'ING-039', 'L', 80);
  const pEncurtidos       = await upsertProduct('Encurtidos', 'ING-040', 'kg', 80);
  const pPanRusticoIng    = await upsertProduct('Pan rústico integral', 'ING-041', 'unit', 25);
  const pCebCaramelizada  = await upsertProduct('Cebolla caramelizada', 'ING-042', 'kg', 60);
  const pMielPicante      = await upsertProduct('Miel picante', 'ING-043', 'L', 150);
  const pSalsaBlanca      = await upsertProduct('Salsa blanca (béchamel)', 'ING-044', 'L', 70);
  const pPinaGolden       = await upsertProduct('Piña golden', 'ING-045', 'kg', 35);

  // --- Bebidas (venta directa) ---
  const pCocaCola      = await upsertProduct('Coca Cola', 'BEB-001', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pCocaZero      = await upsertProduct('Coca Zero', 'BEB-002', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pFantaNaranja  = await upsertProduct('Fanta Naranja', 'BEB-003', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pFantaRoja     = await upsertProduct('Fanta Roja', 'BEB-004', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pFrescaRef     = await upsertProduct('Fresca (refresco)', 'BEB-005', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pSprite        = await upsertProduct('Sprite', 'BEB-006', 'unit', 18, 'PRODUCT_FOR_SALE');
  const pAgua          = await upsertProduct('Agua purificada', 'BEB-007', 'unit', 8, 'PRODUCT_FOR_SALE');
  const pTeHelado      = await upsertProduct('Té helado / Limonada', 'BEB-008', 'L', 40, 'PRODUCT_FOR_SALE');

  // --- Vinos (venta directa, costo ≈ 35-45 % del precio de venta botella) ---
  const pAbelBonarda  = await upsertProduct('Abel Bonarda Malbec', 'VIN-001', 'unit', 280, 'PRODUCT_FOR_SALE');
  const pSanTelmo     = await upsertProduct('San Telmo Malbec', 'VIN-002', 'unit', 250, 'PRODUCT_FOR_SALE');
  const pSCCabernet   = await upsertProduct('Santa Carolina Cabernet Sauvignon', 'VIN-003', 'unit', 250, 'PRODUCT_FOR_SALE');
  const pSR3Medallas  = await upsertProduct('Santa Rita 3 Medallas Cabernet', 'VIN-004', 'unit', 270, 'PRODUCT_FOR_SALE');
  const pRiunite      = await upsertProduct('Riunite Lambrusco', 'VIN-005', 'unit', 270, 'PRODUCT_FOR_SALE');
  const pStHelena     = await upsertProduct('St. Helena Cabernet Sauvignon', 'VIN-006', 'unit', 400, 'PRODUCT_FOR_SALE');
  const pLaVielle     = await upsertProduct('La Vielle Ferme', 'VIN-007', 'unit', 500, 'PRODUCT_FOR_SALE');
  const p19Crimes     = await upsertProduct('19 Crimes', 'VIN-008', 'unit', 600, 'PRODUCT_FOR_SALE');
  const pFrontera     = await upsertProduct('Frontera Sauvignon Blanc', 'VIN-009', 'unit', 280, 'PRODUCT_FOR_SALE');
  const pSRPinot      = await upsertProduct('Santa Rita Pinot Grigio', 'VIN-010', 'unit', 380, 'PRODUCT_FOR_SALE');
  const pLFEChard     = await upsertProduct('Luis Felipe Edwards Chardonnay', 'VIN-011', 'unit', 300, 'PRODUCT_FOR_SALE');
  const pMionetto     = await upsertProduct('Mionetto Prosecco Brut', 'VIN-012', 'unit', 650, 'PRODUCT_FOR_SALE');

  // -------------------------------------------------------
  // 3. MENU ITEMS  (precios en MXN, del menú físico)
  // -------------------------------------------------------
  console.log('3/7  Menu items…');

  // ---- PIZZAS (17) ----
  const miCheeseBar  = await upsertMenuItem(catPizzas.id, 'Cheese Bar Pie', 'Clásica de queso con ricotta', 510);
  const miCapresse   = await upsertMenuItem(catPizzas.id, 'Capresse', 'Tomate cherry, mozzarella fresco y albahaca', 550);
  const miPepperoni  = await upsertMenuItem(catPizzas.id, 'Pepperoni', 'La de siempre', 565);
  const mi4Quesos    = await upsertMenuItem(catPizzas.id, '4 Quesos & Hongos', 'Salsa blanca, 4 quesos con hongos', 580);
  const miLaCotto    = await upsertMenuItem(catPizzas.id, 'La Cotto', 'Jamón selva negra y mozzarella fresco', 530);
  const miLaExtra    = await upsertMenuItem(catPizzas.id, 'La Extra', 'Pepperoni y hongos', 530);
  const miLaBianco   = await upsertMenuItem(catPizzas.id, 'La Bianco', 'Rúcula marinada y prosciutto encima de una cheese bar pie', 685);
  const miLaReina    = await upsertMenuItem(catPizzas.id, 'La Reina', 'Salsa de tomate natural, aceite de ajo rostizado, parmesano rayado', 560);
  const miDellaNonna = await upsertMenuItem(catPizzas.id, 'Della Nonna', 'Chorizo italiano de res, cebolla fina y ricotta', 560);
  const miDulceFiery = await upsertMenuItem(catPizzas.id, 'Dulce Fiery', 'Pepperoni, jalapeño, romero y miel', 570);
  const miMauiPitza  = await upsertMenuItem(catPizzas.id, 'Maui Pitza', 'Jamón selva negra, piña hawaiana, cebolla morada y tocino', 590);
  const miAllaVodka  = await upsertMenuItem(catPizzas.id, 'Alla Vodka', 'Salsa de tomate y vodka (elige 2 toppings). *No aplica Burratina', 575);
  const miLaMiaPitza = await upsertMenuItem(catPizzas.id, 'La Mia Pitza', 'Elige tus 4 favoritas y te la hacemos en 1', 675);
  const miBasilea    = await upsertMenuItem(catPizzas.id, 'Basilea', 'Pesto, mozzarella fresco, tomate cherry y reducción de balsámico', 595);
  const miSussanna   = await upsertMenuItem(catPizzas.id, 'La Sussanna', 'Jamón selva negra, hongos frescos, mozzarella fresco', 590);
  const miPedroni    = await upsertMenuItem(catPizzas.id, 'La Pedroni', 'Doble pepperoni, doble jalapeño', 585);
  const miFocaccia   = await upsertMenuItem(catPizzas.id, 'Focaccia', 'Pan crujiente artesanal, aromatizado con aceite de oliva, hierbas y sal marina', 260);

  // ---- EXTRAS / TOPPINGS (15) ----
  const miExChorizo   = await upsertMenuItem(catExtras.id, 'Chorizo italiano de res', 'Topping extra', 65);
  const miExCebCaram  = await upsertMenuItem(catExtras.id, 'Cebolla caramelizada', 'Topping extra', 60);
  const miExMielPic   = await upsertMenuItem(catExtras.id, '1/2 oz de miel picante', 'Topping extra', 30);
  const miExMozz      = await upsertMenuItem(catExtras.id, 'Mozzarella fresco', 'Topping extra', 40);
  const miExAceitunas = await upsertMenuItem(catExtras.id, 'Aceitunas negras', 'Topping extra', 65);
  const miExJamon     = await upsertMenuItem(catExtras.id, 'Jamón selva negra', 'Topping extra', 70);
  const miExGorgon    = await upsertMenuItem(catExtras.id, 'Gorgonzola', 'Topping extra', 60);
  const miExRucula    = await upsertMenuItem(catExtras.id, 'Rúcula marinada', 'Topping extra', 55);
  const miExHongos    = await upsertMenuItem(catExtras.id, 'Hongos frescos', 'Topping extra', 60);
  const miExPinaG     = await upsertMenuItem(catExtras.id, 'Piña golden', 'Topping extra', 35);
  const miExPepp      = await upsertMenuItem(catExtras.id, 'Pepperoni', 'Topping extra', 65);
  const miExAnchoas   = await upsertMenuItem(catExtras.id, 'Anchoas', 'Topping extra', 185);
  const miExRicotta   = await upsertMenuItem(catExtras.id, 'Ricotta', 'Topping extra', 40);
  const miExCebolla   = await upsertMenuItem(catExtras.id, 'Cebolla', 'Topping extra', 20);
  const miExJalap     = await upsertMenuItem(catExtras.id, 'Jalapeño', 'Topping extra', 20);

  // ---- PASTAS FRESCAS (4) – precio = promedio salsas ≈ 380  ----
  const miRaviolis     = await upsertMenuItem(catPastas.id, 'Raviolis ricotta y parmesano', `Pasta fresca artesanal. Precio varía según salsa elegida. ${TAG_EST}`, 380);
  const miMezzVerde    = await upsertMenuItem(catPastas.id, 'Mezzaluna verde de ricotta y espinaca', `Pasta fresca artesanal. Precio varía según salsa elegida. ${TAG_EST}`, 380);
  const miMezzParm     = await upsertMenuItem(catPastas.id, 'Mezzaluna de ricotta y parmesano', `Pasta fresca artesanal. Precio varía según salsa elegida. ${TAG_EST}`, 380);
  const miCanelones    = await upsertMenuItem(catPastas.id, 'Canelones ricotta y espinaca', `Pasta fresca artesanal. Precio varía según salsa elegida. ${TAG_EST}`, 380);

  // ---- SALSAS (4) – precio = pasta + salsa (precio final del plato) ----
  await upsertMenuItem(catSalsas.id, 'Salsa Tomate Natural', 'Precio del plato de pasta con esta salsa', 350);
  await upsertMenuItem(catSalsas.id, 'Salsa Alla Vodka', 'Precio del plato de pasta con esta salsa', 380);
  await upsertMenuItem(catSalsas.id, 'Salsa 4 Quesos', `Precio del plato de pasta con esta salsa. ${TAG_OCR} Precio 407 verificar`, 407);
  await upsertMenuItem(catSalsas.id, 'Salsa Pesto', 'Precio del plato de pasta con esta salsa', 390);

  // ---- ANTIPASTOS (3) ----
  const miRucHongos  = await upsertMenuItem(catAntipastos.id, 'Rúcula & hongos al vino', 'Hongos, pancetta al vino, sobre una cama de rúcula marinada y ricotta de la casa. ¡Excepcional!', 457);
  const miTablaAnt   = await upsertMenuItem(catAntipastos.id, 'Tabla de Antipasto', '2 rollitos de prosciutto, ricotta y rúcula marinada y 3 bruschettas variadas con frutos, tomates y quesos marinados', 587);
  const miPanRustico = await upsertMenuItem(catAntipastos.id, 'Pan Rústico', 'Prosciutto, rúcula marinada, ricotta fresca y encurtidos adentro de un pan rústico integral', 495);

  // ---- POSTRES (3) ----
  const miPanBanano  = await upsertMenuItem(catPostres.id, 'Pan de Banano o Zanahoria Ala Mode', 'Pan calentado al horno con helado de vainilla y miel', 145);
  const miBrownie    = await upsertMenuItem(catPostres.id, 'Brownie con Helado', 'Brownie artesanal acompañado de helado', 195);
  const miCheesecake = await upsertMenuItem(catPostres.id, 'Cheesecake de fresas', 'Cheesecake con topping de fresas caramelizadas', 250);

  // ---- BEBIDAS (9) – type DIRECT ----
  const miCocaCola     = await upsertMenuItem(catBebidas.id, 'Coca Cola', 'Refresco', 48, 'DIRECT');
  const miCocaZero     = await upsertMenuItem(catBebidas.id, 'Coca Zero', 'Refresco', 48, 'DIRECT');
  const miFantaNar     = await upsertMenuItem(catBebidas.id, 'Fanta Naranja', 'Refresco', 48, 'DIRECT');
  const miFantaRoja    = await upsertMenuItem(catBebidas.id, 'Fanta Roja', 'Refresco', 48, 'DIRECT');
  const miFrescaBeb    = await upsertMenuItem(catBebidas.id, 'Fresca', 'Refresco', 48, 'DIRECT');
  const miSprite       = await upsertMenuItem(catBebidas.id, 'Sprite', 'Refresco', 48, 'DIRECT');
  const miAgua         = await upsertMenuItem(catBebidas.id, 'Agua Purificada', 'Agua', 40, 'DIRECT');
  const miTeHeladoP    = await upsertMenuItem(catBebidas.id, 'Té Helado & Limonada (Pinta)', 'Presentación pinta', 130);
  const miTeHeladoV    = await upsertMenuItem(catBebidas.id, 'Té Helado & Limonada (Vaso)', 'Presentación vaso', 48);

  // ---- VINOS TINTOS (9) – type DIRECT ----
  const miAbelCopa     = await upsertMenuItem(catVinosTintos.id, 'Abel Bonarda Malbec (Copa)', `${TAG_OCR} Nombre puede variar`, 180, 'DIRECT');
  const miAbelBot      = await upsertMenuItem(catVinosTintos.id, 'Abel Bonarda Malbec (Botella)', `${TAG_OCR} Nombre puede variar`, 750, 'DIRECT');
  const miSanTelmoBot  = await upsertMenuItem(catVinosTintos.id, 'San Telmo Malbec (Botella)', 'Vino tinto argentino', 650, 'DIRECT');
  const miSCCabBot     = await upsertMenuItem(catVinosTintos.id, 'Santa Carolina Cabernet Sauvignon (Botella)', 'Vino tinto chileno', 650, 'DIRECT');
  const miSR3MedBot    = await upsertMenuItem(catVinosTintos.id, 'Santa Rita 3 Medallas Cabernet (Botella)', 'Vino tinto chileno', 700, 'DIRECT');
  const miRiuniteBot   = await upsertMenuItem(catVinosTintos.id, 'Riunite Lambrusco (Botella)', 'Vino tinto italiano', 700, 'DIRECT');
  const miStHelBot     = await upsertMenuItem(catVinosTintos.id, 'St. Helena Cabernet Sauvignon (Botella)', 'Vino tinto chileno', 1000, 'DIRECT');
  const miLaVielleBot  = await upsertMenuItem(catVinosTintos.id, 'La Vielle Ferme (Botella)', 'Vino tinto francés', 1250, 'DIRECT');
  const mi19CrimesBot  = await upsertMenuItem(catVinosTintos.id, '19 Crimes (Botella)', 'Vino tinto australiano', 1500, 'DIRECT');

  // ---- VINOS BLANCOS (4) – type DIRECT ----
  const miFrontCopa    = await upsertMenuItem(catVinosBlancos.id, 'Frontera Sauvignon Blanc (Copa)', 'Vino blanco chileno', 180, 'DIRECT');
  const miFrontBot     = await upsertMenuItem(catVinosBlancos.id, 'Frontera Sauvignon Blanc (Botella)', 'Vino blanco chileno', 750, 'DIRECT');
  const miSRPinotBot   = await upsertMenuItem(catVinosBlancos.id, 'Santa Rita Pinot Grigio (Botella)', 'Vino blanco chileno', 990, 'DIRECT');
  const miLFEChardBot  = await upsertMenuItem(catVinosBlancos.id, 'Luis Felipe Edwards Chardonnay (Botella)', 'Vino blanco chileno', 800, 'DIRECT');

  // ---- VINO ESPUMOSO (1) – type DIRECT ----
  const miMionettoBot  = await upsertMenuItem(catEspumoso.id, 'Mionetto Prosecco Brut (Botella)', 'Vino espumoso italiano', 1600, 'DIRECT');

  // -------------------------------------------------------
  // 4. RECETAS  (BOM: menuItem → product → cantidad)
  // -------------------------------------------------------
  console.log('4/7  Recetas (BOM)…');

  // -- Cheese Bar Pie --
  await upsertRecipe(miCheeseBar.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miCheeseBar.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miCheeseBar.id, pMozzarella.id, 0.15, 'kg');
  await upsertRecipe(miCheeseBar.id, pRicotta.id, 0.08, 'kg');

  // -- Capresse --
  await upsertRecipe(miCapresse.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miCapresse.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miCapresse.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miCapresse.id, pTomateCherry.id, 0.08, 'kg');
  await upsertRecipe(miCapresse.id, pAlbahaca.id, 0.01, 'kg');

  // -- Pepperoni --
  await upsertRecipe(miPepperoni.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miPepperoni.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miPepperoni.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miPepperoni.id, pPepperoni.id, 0.10, 'kg');

  // -- 4 Quesos & Hongos --
  await upsertRecipe(mi4Quesos.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(mi4Quesos.id, pSalsaBlanca.id, 0.10, 'L');
  await upsertRecipe(mi4Quesos.id, pMozzarella.id, 0.08, 'kg');
  await upsertRecipe(mi4Quesos.id, pParmesano.id, 0.04, 'kg');
  await upsertRecipe(mi4Quesos.id, pGorgonzola.id, 0.04, 'kg');
  await upsertRecipe(mi4Quesos.id, pRicotta.id, 0.04, 'kg');
  await upsertRecipe(mi4Quesos.id, pHongos.id, 0.08, 'kg');

  // -- La Cotto --
  await upsertRecipe(miLaCotto.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miLaCotto.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miLaCotto.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miLaCotto.id, pJamonSelva.id, 0.08, 'kg');

  // -- La Extra --
  await upsertRecipe(miLaExtra.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miLaExtra.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miLaExtra.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miLaExtra.id, pPepperoni.id, 0.06, 'kg');
  await upsertRecipe(miLaExtra.id, pHongos.id, 0.06, 'kg');

  // -- La Bianco (sin salsa roja, base cheese bar pie) --
  await upsertRecipe(miLaBianco.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miLaBianco.id, pMozzarella.id, 0.15, 'kg');
  await upsertRecipe(miLaBianco.id, pRicotta.id, 0.08, 'kg');
  await upsertRecipe(miLaBianco.id, pRucula.id, 0.05, 'kg');
  await upsertRecipe(miLaBianco.id, pProsciutto.id, 0.06, 'kg');

  // -- La Reina --
  await upsertRecipe(miLaReina.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miLaReina.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miLaReina.id, pParmesano.id, 0.06, 'kg');
  await upsertRecipe(miLaReina.id, pAjo.id, 0.02, 'kg');
  await upsertRecipe(miLaReina.id, pAceiteOliva.id, 0.02, 'L');

  // -- Della Nonna --
  await upsertRecipe(miDellaNonna.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miDellaNonna.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miDellaNonna.id, pChorizoIt.id, 0.08, 'kg');
  await upsertRecipe(miDellaNonna.id, pCebolla.id, 0.04, 'kg');
  await upsertRecipe(miDellaNonna.id, pRicotta.id, 0.06, 'kg');

  // -- Dulce Fiery --
  await upsertRecipe(miDulceFiery.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miDulceFiery.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miDulceFiery.id, pPepperoni.id, 0.08, 'kg');
  await upsertRecipe(miDulceFiery.id, pJalapeno.id, 0.04, 'kg');
  await upsertRecipe(miDulceFiery.id, pRomero.id, 0.005, 'kg');
  await upsertRecipe(miDulceFiery.id, pMiel.id, 0.03, 'L');

  // -- Maui Pitza --
  await upsertRecipe(miMauiPitza.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miMauiPitza.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miMauiPitza.id, pMozzarella.id, 0.10, 'kg');
  await upsertRecipe(miMauiPitza.id, pJamonSelva.id, 0.06, 'kg');
  await upsertRecipe(miMauiPitza.id, pPina.id, 0.06, 'kg');
  await upsertRecipe(miMauiPitza.id, pCebollaMorada.id, 0.03, 'kg');
  await upsertRecipe(miMauiPitza.id, pTocino.id, 0.05, 'kg');

  // -- Alla Vodka (pizza) --
  await upsertRecipe(miAllaVodka.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miAllaVodka.id, pSalsaTomate.id, 0.08, 'L');
  await upsertRecipe(miAllaVodka.id, pVodka.id, 0.03, 'L');
  await upsertRecipe(miAllaVodka.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miAllaVodka.id, pCrema.id, 0.04, 'L');

  // -- La Mia Pitza (personalizada, masa doble, base genérica) --
  await upsertRecipe(miLaMiaPitza.id, pMasaPizza.id, 0.30, 'kg');
  await upsertRecipe(miLaMiaPitza.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miLaMiaPitza.id, pMozzarella.id, 0.15, 'kg');

  // -- Basilea --
  await upsertRecipe(miBasilea.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miBasilea.id, pPesto.id, 0.06, 'L');
  await upsertRecipe(miBasilea.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miBasilea.id, pTomateCherry.id, 0.06, 'kg');
  await upsertRecipe(miBasilea.id, pBalsamico.id, 0.02, 'L');

  // -- La Sussanna --
  await upsertRecipe(miSussanna.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miSussanna.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miSussanna.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miSussanna.id, pJamonSelva.id, 0.06, 'kg');
  await upsertRecipe(miSussanna.id, pHongos.id, 0.06, 'kg');

  // -- La Pedroni (doble pepperoni + doble jalapeño) --
  await upsertRecipe(miPedroni.id, pMasaPizza.id, 0.25, 'kg');
  await upsertRecipe(miPedroni.id, pSalsaTomate.id, 0.10, 'L');
  await upsertRecipe(miPedroni.id, pMozzarella.id, 0.12, 'kg');
  await upsertRecipe(miPedroni.id, pPepperoni.id, 0.14, 'kg');
  await upsertRecipe(miPedroni.id, pJalapeno.id, 0.06, 'kg');

  // -- Focaccia --
  await upsertRecipe(miFocaccia.id, pMasaPizza.id, 0.30, 'kg');
  await upsertRecipe(miFocaccia.id, pAceiteOliva.id, 0.04, 'L');
  await upsertRecipe(miFocaccia.id, pHierbas.id, 0.005, 'kg');
  await upsertRecipe(miFocaccia.id, pSalMarina.id, 0.005, 'kg');

  // -- EXTRAS (cada uno = porción del ingrediente correspondiente) --
  await upsertRecipe(miExChorizo.id, pChorizoIt.id, 0.03, 'kg');
  await upsertRecipe(miExCebCaram.id, pCebCaramelizada.id, 0.04, 'kg');
  await upsertRecipe(miExMielPic.id, pMielPicante.id, 0.015, 'L');   // ½ oz ≈ 15 ml
  await upsertRecipe(miExMozz.id, pMozzarella.id, 0.04, 'kg');
  await upsertRecipe(miExAceitunas.id, pAceitunas.id, 0.03, 'kg');
  await upsertRecipe(miExJamon.id, pJamonSelva.id, 0.03, 'kg');
  await upsertRecipe(miExGorgon.id, pGorgonzola.id, 0.03, 'kg');
  await upsertRecipe(miExRucula.id, pRucula.id, 0.02, 'kg');
  await upsertRecipe(miExHongos.id, pHongos.id, 0.04, 'kg');
  await upsertRecipe(miExPinaG.id, pPinaGolden.id, 0.04, 'kg');
  await upsertRecipe(miExPepp.id, pPepperoni.id, 0.03, 'kg');
  await upsertRecipe(miExAnchoas.id, pAnchoas.id, 0.02, 'kg');
  await upsertRecipe(miExRicotta.id, pRicotta.id, 0.04, 'kg');
  await upsertRecipe(miExCebolla.id, pCebolla.id, 0.03, 'kg');
  await upsertRecipe(miExJalap.id, pJalapeno.id, 0.03, 'kg');

  // -- PASTAS FRESCAS --
  await upsertRecipe(miRaviolis.id, pMasaPasta.id, 0.20, 'kg');
  await upsertRecipe(miRaviolis.id, pRicotta.id, 0.10, 'kg');
  await upsertRecipe(miRaviolis.id, pParmesano.id, 0.04, 'kg');

  await upsertRecipe(miMezzVerde.id, pMasaPasta.id, 0.20, 'kg');
  await upsertRecipe(miMezzVerde.id, pRicotta.id, 0.10, 'kg');
  await upsertRecipe(miMezzVerde.id, pEspinaca.id, 0.06, 'kg');

  await upsertRecipe(miMezzParm.id, pMasaPasta.id, 0.20, 'kg');
  await upsertRecipe(miMezzParm.id, pRicotta.id, 0.10, 'kg');
  await upsertRecipe(miMezzParm.id, pParmesano.id, 0.04, 'kg');

  await upsertRecipe(miCanelones.id, pMasaPasta.id, 0.20, 'kg');
  await upsertRecipe(miCanelones.id, pRicotta.id, 0.10, 'kg');
  await upsertRecipe(miCanelones.id, pEspinaca.id, 0.06, 'kg');

  // -- ANTIPASTOS --
  await upsertRecipe(miRucHongos.id, pRucula.id, 0.06, 'kg');
  await upsertRecipe(miRucHongos.id, pHongos.id, 0.10, 'kg');
  await upsertRecipe(miRucHongos.id, pTocino.id, 0.06, 'kg');
  await upsertRecipe(miRucHongos.id, pRicotta.id, 0.05, 'kg');

  await upsertRecipe(miTablaAnt.id, pProsciutto.id, 0.08, 'kg');
  await upsertRecipe(miTablaAnt.id, pRicotta.id, 0.06, 'kg');
  await upsertRecipe(miTablaAnt.id, pRucula.id, 0.04, 'kg');
  await upsertRecipe(miTablaAnt.id, pTomateCherry.id, 0.05, 'kg');

  await upsertRecipe(miPanRustico.id, pPanRusticoIng.id, 1, 'unit');
  await upsertRecipe(miPanRustico.id, pProsciutto.id, 0.06, 'kg');
  await upsertRecipe(miPanRustico.id, pRucula.id, 0.03, 'kg');
  await upsertRecipe(miPanRustico.id, pRicotta.id, 0.05, 'kg');
  await upsertRecipe(miPanRustico.id, pEncurtidos.id, 0.04, 'kg');

  // -- POSTRES --
  await upsertRecipe(miPanBanano.id, pPanBanano.id, 1, 'unit');
  await upsertRecipe(miPanBanano.id, pHeladoVainilla.id, 0.10, 'L');
  await upsertRecipe(miPanBanano.id, pMiel.id, 0.02, 'L');

  await upsertRecipe(miBrownie.id, pBaseBrownie.id, 1, 'unit');
  await upsertRecipe(miBrownie.id, pHeladoVainilla.id, 0.10, 'L');

  await upsertRecipe(miCheesecake.id, pBaseCheesecake.id, 1, 'unit');
  await upsertRecipe(miCheesecake.id, pFresas.id, 0.08, 'kg');

  // -- BEBIDAS (DIRECT 1:1) --
  await upsertRecipe(miCocaCola.id, pCocaCola.id, 1, 'unit');
  await upsertRecipe(miCocaZero.id, pCocaZero.id, 1, 'unit');
  await upsertRecipe(miFantaNar.id, pFantaNaranja.id, 1, 'unit');
  await upsertRecipe(miFantaRoja.id, pFantaRoja.id, 1, 'unit');
  await upsertRecipe(miFrescaBeb.id, pFrescaRef.id, 1, 'unit');
  await upsertRecipe(miSprite.id, pSprite.id, 1, 'unit');
  await upsertRecipe(miAgua.id, pAgua.id, 1, 'unit');
  await upsertRecipe(miTeHeladoP.id, pTeHelado.id, 0.473, 'L');  // 1 pinta ≈ 473 ml
  await upsertRecipe(miTeHeladoV.id, pTeHelado.id, 0.25, 'L');

  // -- VINOS (DIRECT: copa = fracción de botella) --
  await upsertRecipe(miAbelCopa.id, pAbelBonarda.id, 0.20, 'unit');
  await upsertRecipe(miAbelBot.id, pAbelBonarda.id, 1, 'unit');
  await upsertRecipe(miSanTelmoBot.id, pSanTelmo.id, 1, 'unit');
  await upsertRecipe(miSCCabBot.id, pSCCabernet.id, 1, 'unit');
  await upsertRecipe(miSR3MedBot.id, pSR3Medallas.id, 1, 'unit');
  await upsertRecipe(miRiuniteBot.id, pRiunite.id, 1, 'unit');
  await upsertRecipe(miStHelBot.id, pStHelena.id, 1, 'unit');
  await upsertRecipe(miLaVielleBot.id, pLaVielle.id, 1, 'unit');
  await upsertRecipe(mi19CrimesBot.id, p19Crimes.id, 1, 'unit');
  await upsertRecipe(miFrontCopa.id, pFrontera.id, 0.20, 'unit');
  await upsertRecipe(miFrontBot.id, pFrontera.id, 1, 'unit');
  await upsertRecipe(miSRPinotBot.id, pSRPinot.id, 1, 'unit');
  await upsertRecipe(miLFEChardBot.id, pLFEChard.id, 1, 'unit');
  await upsertRecipe(miMionettoBot.id, pMionetto.id, 1, 'unit');

  // -------------------------------------------------------
  // 5. MESAS  (20: T01–T20)
  // -------------------------------------------------------
  console.log('5/7  Mesas…');

  const tables: { n: string; cap: number; loc: string }[] = [
    // Terraza (6)
    { n: 'T01', cap: 2, loc: 'Terraza' }, { n: 'T02', cap: 2, loc: 'Terraza' },
    { n: 'T03', cap: 4, loc: 'Terraza' }, { n: 'T04', cap: 4, loc: 'Terraza' },
    { n: 'T05', cap: 6, loc: 'Terraza' }, { n: 'T06', cap: 6, loc: 'Terraza' },
    // Salón A (7)
    { n: 'T07', cap: 2, loc: 'Salón A' }, { n: 'T08', cap: 2, loc: 'Salón A' },
    { n: 'T09', cap: 4, loc: 'Salón A' }, { n: 'T10', cap: 4, loc: 'Salón A' },
    { n: 'T11', cap: 4, loc: 'Salón A' }, { n: 'T12', cap: 6, loc: 'Salón A' },
    { n: 'T13', cap: 6, loc: 'Salón A' },
    // Salón B (7)
    { n: 'T14', cap: 2, loc: 'Salón B' }, { n: 'T15', cap: 2, loc: 'Salón B' },
    { n: 'T16', cap: 4, loc: 'Salón B' }, { n: 'T17', cap: 4, loc: 'Salón B' },
    { n: 'T18', cap: 4, loc: 'Salón B' }, { n: 'T19', cap: 6, loc: 'Salón B' },
    { n: 'T20', cap: 6, loc: 'Salón B' },
  ];
  for (const t of tables) await upsertTable(t.n, t.cap, t.loc);

  // -------------------------------------------------------
  // 6. CATÁLOGO DE CATERING  (7 servicios)
  // -------------------------------------------------------
  console.log('6/7  Catering services…');

  await upsertCateringService(
    'Coffee Break Básico',
    `Café, agua, galletas y fruta de temporada. ${TAG_EST}`, 60, 120);
  await upsertCateringService(
    'Coffee Break Ejecutivo',
    `Café de especialidad, jugos, mini sándwiches, fruta y repostería. ${TAG_EST}`, 120, 220);
  await upsertCateringService(
    'Pizza Party',
    `Selección de pizzas del menú La Mia Pitza en formato buffet. ${TAG_EST}`, 180, 350);
  await upsertCateringService(
    'Pasta + Antipasto',
    `Estación de pastas frescas con salsas a elegir y tabla de antipastos. ${TAG_EST}`, 200, 420);
  await upsertCateringService(
    'Tabla de Vinos y Quesos',
    `Selección de vinos tintos/blancos con tabla de quesos artesanales. ${TAG_EST}`, 250, 500);
  await upsertCateringService(
    'Servicio de Mesero (hora)',
    `Mesero profesional por hora para evento. ${TAG_EST}`, 80, 180);
  await upsertCateringService(
    'Montaje y Vajilla (evento)',
    `Montaje completo: mantelería, vajilla, cristalería y cubertería. ${TAG_EST}`, 300, 600);

  // -------------------------------------------------------
  // 7. RESUMEN
  // -------------------------------------------------------
  const counts = {
    categories: await prisma.category.count({ where: { companyId: CID } }),
    menuItems:  await prisma.menuItem.count({ where: { companyId: CID } }),
    products:   await prisma.product.count({ where: { companyId: CID } }),
    recipes:    await prisma.recipe.count(),
    tables:     await prisma.table.count({ where: { companyId: CID } }),
    catering:   await prisma.cateringService.count({ where: { companyId: CID } }),
  };

  console.log('\n7/7  Resumen final:');
  console.log(`  Categorías:        ${counts.categories}`);
  console.log(`  Menu Items:        ${counts.menuItems}`);
  console.log(`  Productos/Insumos: ${counts.products}`);
  console.log(`  Recetas (BOM):     ${counts.recipes}`);
  console.log(`  Mesas:             ${counts.tables}`);
  console.log(`  Servicios Catering:${counts.catering}`);
  console.log('\n=== Menu Seed Complete ===');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
