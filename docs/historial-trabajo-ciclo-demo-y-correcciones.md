# Historial de trabajo — Ciclo demo, producción y correcciones

Documento de referencia consolidado para futuras mejoras, correcciones y onboarding técnico.  
**Última actualización:** junio 2026  
**Repositorio:** `https://github.com/jagmartinez/miapitza.git`  
**Rama principal:** `main`

---

## 1. Resumen ejecutivo

En esta serie de sesiones se trabajó en tres frentes principales:

1. **Motor de inventario y correcciones UoM** (commits previos a la demo): unificación del descargue, costeo en unidad base, modificadores POS, migración de BD.
2. **Script de demostración end-to-end** (`DEMO-CYCLE`): compra → producción → menú → caja → cocina → venta → factura → merma, ejecutable de forma idempotente en producción.
3. **Correcciones de UX/datos en producción**: filtros de fecha, pantallas que no cargaban (Panel Producción, Kardex, Facturas, Dashboard), y crash por montos string desde Prisma Decimal.

**Infraestructura de producción (Railway):**

| Servicio | URL / nombre |
|----------|----------------|
| API | `https://miapitza-production.up.railway.app` |
| Web | `https://miapitza-web-production.up.railway.app` |
| Proyecto Railway | `mellow-elegance` |
| Servicios | `miapitza` (API), `miapitza-web` (cliente), `MySQL` |

---

## 2. Contexto del sistema

### 2.1 Stack

- **Backend:** Node 20+, TypeScript, Express, Prisma, MySQL (`server/`)
- **Frontend:** React, Vite, TypeScript (`client/`)
- **Deploy:** Railway (API con Dockerfile en `server/`, cliente en `miapitza-web`)

### 2.2 Flujos operativos del ERP (independientes pero encadenables)

| Flujo | Qué descuenta inventario | Cuándo |
|-------|--------------------------|--------|
| **Compra (OC)** | — | Entrada IN al recibir |
| **Producción** | Insumos OUT / semielaborado IN | Al finalizar orden de producción |
| **Receta de menú** | — (solo costea) | Al calcular margen |
| **Venta (POS/orden)** | Receta del **menú** OUT | Al pagar orden (PAID) |
| **Merma** | Producto OUT | Al registrar merma |

**Importante:** Receta de **producción** y receta de **menú** no se sincronizan solas. La producción abastece stock; la venta consume lo definido en la receta del plato.

### 2.3 Costeo

- Método por defecto: **promedio ponderado** al recibir compras (`currentAverageCost` en unidad base).
- Stock mínimo y reportes de inventario: en **unidad base** del producto.

---

## 3. Trabajo previo (sesiones anteriores, ya en `main`)

### 3.1 Commit `0899482` — Motor de inventario y UoM

**Incluye:**

- `InventoryEngineService`: motor unificado de movimientos (FIFO por capas `InventoryBatch`).
- Migración: `20260619_add_inventory_engine_foundation`.
- Fixes UoM: compras sin `purchaseUnit`, fail-fast en conversión 1:1 silenciosa, reportes en unidad base, costeo menú, mermas, import auto-configura unidades.
- **Modificadores POS:** selección en cliente + `modifierIds` en `OrderService.create`.
- Fix UX: bloqueo POS si sucursal sin almacén.
- `Inventory.tsx`: precio venta solo para `PRODUCT_FOR_SALE`/`BOTH`; `minStock` en unidad base.
- Carpeta `prisma/migrations/manual/` movida a `prisma/manual-migrations/` (bloqueaba `migrate deploy`).
- **39 tests unitarios** pasando en el momento del commit.

### 3.2 Auditoría end-to-end (referencia)

Se realizó auditoría con agentes especializados cubriendo: producto/compra/costeo, recetas/producción, menú/venta/descargue, datos/kardex. Hallazgos críticos fueron remediados en commits posteriores (costeo global, pago PAID, consumo idempotente, etc.).

---

## 4. Script demo `DEMO-CYCLE`

### 4.1 Ubicación y ejecución

**Archivo:** `server/src/scripts/demo-pizza-cycle.ts`  
**Compilado:** `server/dist/scripts/demo-pizza-cycle.js`

```bash
# Local (con BD configurada)
cd server
npx ts-node --transpile-only src/scripts/demo-pizza-cycle.ts
npx ts-node --transpile-only src/scripts/demo-pizza-cycle.ts --dry-run

# Producción (desde contenedor API en Railway)
railway ssh --service miapitza -- node dist/scripts/demo-pizza-cycle.js
```

**Prefijo de datos:** `DEMO-CYCLE` — permite re-ejecutar sin colisionar con datos operativos reales (salvo que se creen nuevas órdenes de venta cada vez).

### 4.2 Fases del ciclo (orden de ejecución)

| Fase | Acción | Resultado visible |
|------|--------|-------------------|
| 0 | Setup: sucursal, almacén, usuario, proveedor | Almacén vinculado a sucursal si faltaba |
| 1 | **Compra** OC insumos (harina, tomate, aceite, orégano, mozzarella) | Kardex IN, costos promedio |
| 2 | **Recetas producción** masa (10 uds) y salsa (5000 g) | Recetas activas en Producción |
| 3 | **Órdenes producción** 20 masas + 10 kg salsa | Panel Producción, stock semielaborados |
| 4 | **Menú** `DEMO-CYCLE Pizza Margarita` @ C$450 + receta | Costos/margen en menú |
| 5 | **Caja** turno abierto (fondo C$1000) | Pantalla Caja |
| 6 | **Venta completa** cocina → pago **efectivo** → factura | Órdenes, Facturas, Dashboard, turno |
| 7 | **Cocina activa** orden pendiente `DEMO-CYCLE Cocina (activa)` | Pantalla Cocina (IN_PREPARATION) |
| 8 | **Merma** 200 g salsa, motivo Vencimiento | Reporte Mermas |

### 4.3 Productos demo

| SKU / nombre | Tipo | Unidad |
|--------------|------|--------|
| `DEMO-CYCLE-HARINA` (si no existe Harina en catálogo) | INGREDIENT | kg |
| Insumos reales del catálogo (tomate, aceite, etc.) si existen | INGREDIENT | — |
| `DEMO-CYCLE-MASA` | INTERMEDIATE | unidad |
| `DEMO-CYCLE-SALSA` | INTERMEDIATE | g |
| `DEMO-CYCLE Pizza Margarita` | Menú (PREPARED) | — |

### 4.4 Receta menú (por pizza)

- 1 × masa demo (unidad)
- 150 g salsa demo
- 0.15 × mozzarella (unidad)

### 4.5 Recetas de producción

**Masa (rendimiento 10 uds):**

- 2500 g harina + 1 aceite → 10 masas

**Salsa (rendimiento 5000 g):**

- 6 latas tomate + 0.5 aceite + 0.1 orégano → 5 kg salsa

### 4.6 Flujo de venta (por qué importa cada paso)

El script **no** crea una venta “directa” pagada con tarjeta porque:

- **Cocina** solo muestra órdenes en `SENT_TO_KITCHEN`, `IN_PREPARATION`, `READY` — las PAID desaparecen de Cocina.
- **Caja/turno** solo registra movimientos IN para pagos en **Efectivo** (`PaymentService`: `EFECTIVO` / `CASH`). Tarjeta no alimenta el turno.

Por eso el script:

1. Abre o reutiliza turno de caja.
2. Crea orden → `sendToKitchen` → `startItem` / `finishItem` → pago efectivo → `InvoiceService.generateInvoice`.
3. Crea una **segunda** orden dejada en cocina para demostración en vivo.

### 4.7 Idempotencia y re-ejecución

| Elemento | Comportamiento al re-ejecutar |
|----------|-------------------------------|
| Insumos | Busca catálogo; crea `DEMO-CYCLE-*` solo si faltan |
| Productos intermedios | Por SKU, no duplica |
| Recetas producción | Reutiliza ACTIVE/DRAFT o activa |
| OC compra | **Crea nueva OC** cada ejecución |
| Orden venta pagada | **Crea nueva orden** cada ejecución |
| Orden cocina activa | Reutiliza si ya existe `DEMO-CYCLE Cocina (activa)` |
| Merma | **Registra nueva** cada ejecución (+200 g) |
| Turno caja | Reutiliza turno abierto del usuario demo |

### 4.8 Pre-requisitos en BD de producción

- Empresa, sucursal, usuario ACTIVE, proveedor, categoría menú.
- Método de pago **Efectivo** (o `CASH`).
- Sucursal con almacén (el script vincula almacén central si falta).
- Ingredientes: si el catálogo no tiene Harina, el script la crea; tomate/aceite/etc. se resuelven por nombre parcial.

---

## 5. Bugs encontrados y correcciones

### 5.1 Filtro de fechas `dateTo` (UTC medianoche)

**Síntoma:** Panel Producción, reportes de ventas, mermas y Kardex mostraban **0 registros** el mismo día de la actividad.

**Causa:** `new Date('YYYY-MM-DD')` = medianoche UTC. Registros creados después de 00:00 UTC quedaban fuera del rango.

**Solución:** Utilidad `server/src/utils/date-range.ts`:

- `parseQueryDateFrom`: inicio del día UTC (00:00:00.000)
- `parseQueryDateTo`: fin del día UTC (23:59:59.999)

**Archivos que usan la utilidad (aplicado en sesión):**

- `server/src/controllers/production-report.controller.ts`
- `server/src/controllers/report.controller.ts`
- `server/src/controllers/report-extended.controller.ts`
- `server/src/controllers/report-production.controller.ts`
- `server/src/controllers/order.controller.ts` (`endDate`)
- `server/src/controllers/kardex.controller.ts`
- `server/src/routes/advanced-features.routes.ts` (reporte mermas)

**Commit principal:** `da53998`, ampliado en `66bb377`.

### 5.2 Panel Producción vacío con recetas activas

- **Recetas activas: 2** no depende del filtro de fechas → se veían.
- **Órdenes: 0** sí dependía del filtro → corregido con 5.1.

### 5.3 Crash `e.toFixed is not a function`

**Síntoma:** `/invoices`, `/dashboard` y otras pantallas con error boundary “Algo salió mal”.

**Causa:** Prisma serializa `Decimal` como **string** en JSON (`"900.00"`). `formatMoney` / `formatCurrency` llamaban `.toFixed()` directo.

**Solución:**

- `client/src/utils/currency.ts`: `coerceMoneyAmount()` + `formatCurrency` / `formatCurrencyIntl` robustos.
- `client/src/pages/InvoiceHistory.tsx`: coerción al mapear órdenes.
- `client/src/context/CurrencyContext.tsx`: `formatMoney(amount: unknown)`.

**Commits:** `c6cfbaf`, `29d8cd6`.

### 5.4 Pantalla Facturas incompleta

**Antes:** `window.print()` en botones Ver/Descargar; sin filtro de fechas en API; filtro “Hoy” ocultaba datos.

**Después (`66bb377`, `c6cfbaf`):**

- API `invoicesAPI.downloadPdf` → `/api/invoices/:id/pdf`
- Filtro por defecto **Este mes**
- Rango de fechas enviado al backend
- Estado de error visible

### 5.5 Kardex sin datos / difícil de usar

**Correcciones (`3fb5e20`, `66bb377`):**

- Selector de **producto** en la página (antes solo vía `?productId=` desde Inventario).
- Fechas por defecto: inicio de mes → hoy.
- Filtro `dateTo` en backend.
- Coerción numérica en celdas (`.toFixed`).

**Cómo ver movimientos demo:** Inventario → producto `DEMO-CYCLE Masa pizza` o `DEMO-CYCLE Salsa roja` → Kardex, o `/kardex` con selector y rango junio 2026.

### 5.6 Build Docker fallido del script demo

**Causa:** Errores TS en closures (`company`/`user` possibly null) y `warehouse.create` sin `code`.

**Commit:** `9dcc752`.

### 5.7 Insumos faltantes en producción

**Causa:** Catálogo prod sin Harina con SKU esperado.

**Solución:** `resolveRawIngredient()` crea insumos `DEMO-CYCLE-*` si no encuentra catálogo.

**Commit:** `fad6917`.

### 5.8 `report-extended.controller` — scope de sucursal

Se reemplazó lógica duplicada (`role === 'SUPERADMIN'`) por `resolveBranchScope()` de `branch-scope.ts` para alinear permisos con el resto del API.

---

## 6. Commits de esta línea de trabajo (referencia rápida)

| Commit | Descripción |
|--------|-------------|
| `bb8ec2e` | Script demo inicial `demo-pizza-cycle.ts` |
| `9dcc752` | Fix TS + warehouse `code` para build Docker |
| `fad6917` | Fallback insumos DEMO si faltan en catálogo |
| `da53998` | Fix `dateTo` panel producción |
| `66bb377` | Demo: merma + factura; date filters reportes; InvoiceHistory |
| `c6cfbaf` | Fix crash Facturas (totals string) |
| `3fb5e20` | Flujo completo: caja, cocina, kardex UI |
| `29d8cd6` | `coerceMoneyAmount` global (Dashboard) |

**Base anterior relevante:** `0899482` (inventory engine + UoM + POS modifiers).

---

## 7. Archivos clave

### 7.1 Backend

| Archivo | Rol |
|---------|-----|
| `server/src/scripts/demo-pizza-cycle.ts` | Script ciclo demo |
| `server/src/utils/date-range.ts` | Parseo fechas query (inclusive end-of-day) |
| `server/src/services/production-report.service.ts` | Panel y reportes producción |
| `server/src/services/kardex.service.ts` | Generación Kardex |
| `server/src/services/inventory-engine.service.ts` | Motor movimientos / FIFO |
| `server/src/services/payment.service.ts` | Pago; efectivo → turno caja |
| `server/src/services/cash-shift.service.ts` | Apertura/cierre turno |
| `server/src/services/waste-report.service.ts` | Mermas |
| `server/src/services/invoice.service.ts` | Número fiscal + PDF |
| `server/src/utils/branch-scope.ts` | SUPERADMIN vs sucursal activa |

### 7.2 Frontend

| Archivo | Rol |
|---------|-----|
| `client/src/pages/ProductionDashboard.tsx` | Panel producción |
| `client/src/pages/Kardex.tsx` | Kardex inventario |
| `client/src/pages/InvoiceHistory.tsx` | Historial facturas |
| `client/src/pages/Dashboard.tsx` | Dashboard BI / KPIs |
| `client/src/pages/Kitchen.tsx` | Pantalla cocina |
| `client/src/pages/CashShift.tsx` | Turno de caja |
| `client/src/pages/Orders.tsx` | Órdenes (filtro 24h default) |
| `client/src/utils/currency.ts` | `formatCurrency`, `coerceMoneyAmount` |
| `client/src/services/api.ts` | `invoicesAPI`, reportes, órdenes |

### 7.3 Documentación existente relacionada

- `docs/production-go-live-runbook.md` — despliegue y smoke tests
- `TODO.md` — pendientes generales del repo

---

## 8. Guía de verificación en producción

Tras ejecutar el script demo y desplegar API + web:

| Pantalla | Ruta | Qué buscar | Filtros recomendados |
|----------|------|------------|----------------------|
| Panel Producción | `/production-dashboard` | 2+ órdenes finalizadas | Desde 01/06 — Hasta hoy → **Actualizar** |
| Recetas producción | `/production-recipes` | Recetas masa/salsa ACTIVE | — |
| Inventario | `/inventory` | `DEMO-CYCLE*` | — |
| Kardex | `/kardex` | Movimientos IN/OUT | Producto DEMO; mes actual |
| Menú / Costos | `/menu` | Pizza Margarita C$450 | — |
| Cocina | `/kitchen` | Orden `DEMO-CYCLE Cocina (activa)` | 24h / 7d |
| Órdenes | `/orders` | Orden pagada reciente (#27+) | **7 días** |
| Caja | `/cash-shift` | Turno abierto; IN por ventas | — |
| Facturas | `/invoices` | FAC / orden pagada | **Este mes** |
| Reporte ventas | `/reports` → Ventas | C$900+ en periodo | Mes actual |
| Reporte mermas | `/waste-report` | 200 g salsa | Mes actual |
| Dashboard | `/dashboard` | Ventas hoy, facturas, top | Ctrl+F5 tras deploy |

---

## 9. Despliegue

### 9.1 API (`miapitza`)

- Push a `main` → Railway build desde `server/` (Dockerfile).
- El script demo se incluye en imagen si `npm run build` compila `src/scripts/*.ts`.
- Migraciones: ver runbook; en prod históricamente también `db push` fallback.

### 9.2 Web (`miapitza-web`)

- Requiere **redeploy explícito** si no está conectado a GitHub auto-deploy.
- Comando usado: `railway redeploy --service miapitza-web --yes`
- Tras deploy frontend: **Ctrl+F5** o incógnito (bundle cache).

### 9.3 Ejecutar demo en prod

```bash
# Requiere Railway CLI autenticado y acceso al proyecto
railway ssh --service miapitza -- node dist/scripts/demo-pizza-cycle.js
```

**Nota:** `railway run` desde local con `mysql.railway.internal` **no** alcanza la BD; usar SSH al contenedor o URL pública MySQL si se configura.

---

## 10. Datos de ejemplo en producción (última corrida documentada)

Valores orientativos — cada re-ejecución incrementa IDs:

| Entidad | Referencia |
|---------|------------|
| OC compra demo | OC #30+ |
| Producción | PRD-000001 (masa), PRD-000002 (salsa) |
| Venta pagada | Orden #27+ (`DEMO-CYCLE Cliente Demo`, C$900, 2 pizzas) |
| Cocina activa | Orden #28+ (`DEMO-CYCLE Cocina (activa)`) |
| Plato menú | `DEMO-CYCLE Pizza Margarita` |
| Costo MP pizza | ~C$33.64, margen ~92.5% |

---

## 11. Limitaciones conocidas

1. ~~**Re-ejecutar demo** crea órdenes de venta y OCs adicionales~~ → **Resuelto:** flag `--once` (y endpoint admin que lo usa) omite crear venta/compra si ya existe una demo del día. Sin `--once` el comportamiento histórico se mantiene.
2. **Cocina:** solo órdenes no pagadas en estados de cocina; la venta demo completada no permanece en Cocina (por diseño).
3. **Pagos tarjeta** no aparecen en movimientos del turno de caja (solo efectivo). *(Por diseño en `PaymentService`.)*
4. ~~**Órdenes (UI):** filtro default 24h~~ → **Resuelto:** filtro default ahora **7d** (`Orders.tsx`); la opción 24h sigue disponible.
5. **Decimal → string:** cualquier pantalla nueva que use `.toFixed` directo puede romperse; usar siempre `formatMoney` / `coerceMoneyAmount`.
6. **Fechas:** cualquier endpoint nuevo que parsee `YYYY-MM-DD` debe usar `date-range.ts`.
7. **Migraciones prod:** baseline pendiente para `migrate deploy` limpio (ver conversaciones previas).
8. **`miapitza-web`:** verificar conexión GitHub → auto-deploy en cada push.
9. **Script `explore-prod-db.ts`:** existe local sin commit; auxiliar para inspección BD.

---

## 12. Pendientes / mejoras futuras sugeridas

### 12.1 Demo y datos

- [x] Flag `--once` en demo script: no crea venta/compra si ya existe una demo del día. *(Detección: venta por `customerName='DEMO-CYCLE Cliente Demo'` + `createdAt>=hoy`; compra por `notes='DEMO-CYCLE Compra insumos demo'` + `supplierId` + `date>=hoy` — `PurchaseOrder` usa `date`, no `createdAt`.)*
- [x] Endpoint admin protegido `POST /api/admin/seed-demo-cycle` (evita SSH manual). Solo **SUPERADMIN** (`PLATFORM_ADMINS`); body opcional `{ once?: boolean; dryRun?: boolean }` (por defecto `once:true`). Sigue requiriendo `ALLOW_DEMO_SCRIPTS=1`.
- [x] Documentado usuario/rol de ejecución: el script corre como el **primer usuario `ACTIVE`** de la empresa (`prisma.user.findFirst({ where:{ companyId, status:'ACTIVE' } })`); **no filtra por rol**.

### 12.2 Producto / UX

- [x] Dashboard: respuestas API ya normalizadas a `number` en backend (`report.service.ts`, commit `86e27a0` "Coerce dashboard report amounts to numbers on the API."). Verificado método por método contra los `Decimal` del schema.
- [x] Kardex: al entrar desde el hub Reportes sin `productId`, autoselecciona el primer producto de la lista (`Kardex.tsx`); respeta el `productId` de la URL si viene.
- [x] Orders default filter: **7d** en lugar de 24h (`Orders.tsx`).
- [ ] Conectar `miapitza-web` a CI/CD en Railway. *(Operación/infra — fuera de alcance de código.)*

### 12.3 Técnicos (de auditorías previas)

- [ ] Baseline migraciones prod para `prisma migrate deploy`. *(Requiere acceso a BD de prod — operación.)*
- [ ] Estandarizar unidad base MASS → gramos en catálogo. *(Migración de datos invasiva, discutida y no implementada; no se aborda por riesgo sin decisión explícita.)*
- [x] Reversión costo producción cancelada: **ya implementado** en `ProductionOrderService.cancel` (reversa de inventario + `CostingService.reverseProductionCost` dentro de la transacción).
- [ ] Ampliar tests integración con BD real en CI. *(Requiere BD en CI — operación.)*

### 12.4 Seguridad / operación

- [ ] Rotar credenciales demo si algún seed las creó. *(Operación.)*
- [x] Ejecución del script demo restringida a env var `ALLOW_DEMO_SCRIPTS=1` (aplica también al endpoint admin; en `--dry-run` no se exige).

---

## 13. Troubleshooting

| Problema | Verificación | Acción |
|----------|--------------|--------|
| Panel producción en 0 | Filtro fechas | Hasta = hoy; Actualizar; confirmar deploy `da53998+` |
| Kardex vacío | Producto seleccionado | Elegir `DEMO-CYCLE Masa`; rango mes actual |
| Facturas / Dashboard crash | Consola `toFixed` | Deploy web `29d8cd6+`; hard refresh |
| Cocina vacía | Solo orden PAID | Buscar `DEMO-CYCLE Cocina (activa)` o re-ejecutar script |
| Caja sin movimientos | Método pago | Demo usa **Efectivo**; tarjeta no cuenta en turno |
| Script/endpoint demo “Ejecución bloqueada” | Falta env var | Definir `ALLOW_DEMO_SCRIPTS=1` (no requerido en `--dry-run`) |
| `POST /api/admin/seed-demo-cycle` da 403 | Rol del usuario | El endpoint es solo **SUPERADMIN** |
| Script falla “No Efectivo” | `PaymentMethod` | Crear método Efectivo activo en configuración |
| Script falla “No almacén” | `Warehouse` por branch | Script intenta vincular central; revisar sucursal |
| SSH script not found | Deploy API | Confirmar commit `bb8ec2e+` y build exitoso |
| Railway CLI timeout | Red / GraphQL | Reintentar; usar dashboard Railway |

---

## 14. Comandos útiles de desarrollo

```bash
# Backend
cd server
npm run build
npm run test:unit
npm run typecheck

# Cliente
cd client
npm run typecheck
npm run build

# Git — commits recientes demo/correcciones
git log --oneline -10

# Health prod
curl https://miapitza-production.up.railway.app/health
```

---

## 15. Glosario

| Término | Significado |
|---------|-------------|
| **UoM** | Unit of Measure — unidades y conversiones |
| **Kardex** | Libro mayor de movimientos por producto |
| **OC** | Orden de compra |
| **Semielaborado** | Producto `INTERMEDIATE` (masa, salsa) |
| **Descargue** | Salida de inventario por venta o producción |
| **Turno** | `CashShift` abierto por cajero en una `CashRegister` |
| **DEMO-CYCLE** | Prefijo de datos generados por el script demo |

---

## 16. Changelog del documento

| Fecha | Cambio |
|-------|--------|
| 2026-06 | Creación inicial consolidando sesión demo, fixes producción, script, despliegue Railway |
| 2026-06 | Resueltos pendientes §12: `--once` + guard `ALLOW_DEMO_SCRIPTS` + endpoint admin seed (solo SUPERADMIN) + doc usuario de ejecución; Orders default 7d; Kardex autoselección de producto; verificado Dashboard a `number` y reversión de costo de producción cancelada. Pendientes restantes son de operación/infra (CI/CD, baseline migraciones, rotar credenciales, tests con BD real, MASS→g). Validado: typecheck server+client, 39 tests unit, build cliente |

---

*Para ampliar este documento: añadir sección por cada nuevo commit relacionado, actualizar tabla §10 con IDs reales tras cada corrida del script, y marcar ítems completados en §12.*
