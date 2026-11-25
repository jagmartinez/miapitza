# Auditoría de Producción — Segunda Barrida (READ-ONLY)

**Proyecto:** C:/restaurant
**Fecha:** 2026-07-16
**Tipo:** Segunda barrida de verificación — **solo lectura**
**Marco:** Segunda barrida READ-ONLY — **no se modificó código.** El único archivo escrito en esta pasada es este propio informe.

> ⚠️ **Nota sobre el informe previo:** Esta segunda barrida detecta que partes del informe de 1ª pasada (`docs/auditoria-produccion-2026-07-16.md`) están **DESACTUALIZADAS** respecto al código real. Ver la sección **5. Discrepancias detectadas vs informe de 1ª pasada**. El informe previo **no** fue sobrescrito ni modificado.

## Veredicto global

# ✅ LISTO_CON_CONDICIONES

Transversal: `tsc --noEmit` de server y client = **0 errores**; ESLint server y client = **0 problemas**; **sin merge markers**; **118 archivos de test (unit)** listados. **Sin silencios peligrosos** en rutas de dinero/stock. Todos los fixes de la 1ª pasada **confirmados presentes**, **sin regresiones**.

---

## 2. Resumen ejecutivo

El sistema se encuentra en un estado de **calidad alto y estable**. Esta segunda barrida fue un ejercicio de **verificación read-only**: no se tocó ninguna línea de código fuente; únicamente se leyó y contrastó el código contra el informe de 1ª pasada.

Puntos clave:

- **Calidad transversal en verde:** compilación TypeScript sin errores (server y client), linter sin problemas, sin marcadores de merge, base de pruebas unitarias amplia (118 archivos).
- **Fixes de 1ª pasada presentes:** todas las correcciones reportadas en la primera barrida se confirman presentes en el código actual, **sin regresiones**.
- **Integridad dinero/stock sólida:** locks `FOR UPDATE` + `$transaction`, idempotencia por prefijos de referencia y reversas exactas por capas. **Ningún silencio peligroso** en caminos de dinero o inventario.
- **Núcleos sólidos:** Inventario core, POS core y Producción core se confirman sólidos.
- **Discrepancias documentales:** el informe previo contiene afirmaciones ahora desactualizadas (multi-tenant fail-open, "hold físico mesa RESERVED", "ventana walk-in 3h fija"). Se corrigen en la sección 5.
- **Hallazgos residuales/nuevos:** en su mayoría de severidad **BAJA/INFO** (display, cosmética, duplicaciones), con algunos **MEDIA** accionables en reportería (zonas horarias) que no bloquean el go-live pero deben priorizarse.

**Conclusión:** apto para producción **bajo condiciones** (ver secciones 11 y 13).

---

## 3. Estado de calidad transversal

| Chequeo | Alcance | Resultado |
|---|---|---|
| `tsc --noEmit` | server | ✅ 0 errores |
| `tsc --noEmit` | client | ✅ 0 errores |
| ESLint | server | ✅ 0 problemas |
| ESLint | client | ✅ 0 problemas |
| Merge markers (`<<<<<<<`, `=======`, `>>>>>>>`) | repo | ✅ Ninguno |
| Archivos de test (unit) | repo | ✅ 118 listados |
| Silencios peligrosos dinero/stock | server/src | ✅ Ninguno |

Todos los indicadores en **verde**.

---

## 4. Matriz por dominio

| # | Dominio | Estado | Nota |
|---|---|---|---|
| 1 | Inventario | ✅ LISTO_CON_CONDICIONES | Inventario core sólido; residuales de diseño de costeo (promedio ponderado global) y silencios menores en cliente. |
| 2 | Producción / Menú | ✅ LISTO_CON_CONDICIONES | Producción core sólido; hallazgos BAJA en escalado/rendimiento y cosmética. |
| 3 | Ventas / POS / Caja | ✅ LISTO_CON_CONDICIONES | POS core sólido; discrepancias solo de display; arqueo correcto. |
| 4 | Reportería | ✅ LISTO_CON_CONDICIONES | Correcta en núcleo; hallazgos MEDIA de zona horaria y agregación por filtros. |
| 5 | RRHH | ✅ LISTO_CON_CONDICIONES | Sólido; residuales BAJA (enum muerto, fallbacks, cosmética legado). |
| 6 | Multi-tenant | ✅ LISTO_CON_CONDICIONES | Aislamiento de **alta confianza**, sin fugas; condición documental + variable de entorno. |
| 7 | Catering / Reservas | ✅ LISTO_CON_CONDICIONES | Anti-doble-booking correcto; gaps de producto y hallazgos MEDIA en forecast. |
| 8 | Transversal | ✅ LISTO_CON_CONDICIONES | Duplicaciones de lógica (IVA, URLs) no bloqueantes. |

---

## 5. Discrepancias detectadas vs informe de 1ª pasada

> Esta sección es la más importante de la segunda barrida: documenta dónde el informe previo (`docs/auditoria-produccion-2026-07-16.md`) quedó **DESACTUALIZADO** frente al código real.

### 5.1 Multi-tenant: es **FAIL-CLOSED**, no fail-open

El informe previo describía un comportamiento **fail-open** cuando `PLATFORM_ADMIN_COMPANY_ID` está vacío. **Es incorrecto.** El código es **FAIL-CLOSED**:

- En modo `multi`, si `PLATFORM_ADMIN_COMPANY_ID` está vacío, el server **no arranca**.
- Referencias: `server/src/config/env-validation.ts:52-53` (validación) + `server/src/index.ts:20-25` (bloqueo de arranque).
- Alcance de scoping: `server/src/middleware/tenant-scope.ts:50-51`.

**Corrección al doc previo:** cambiar la caracterización de "fail-open" a **"fail-closed: el server no arranca en modo `multi` sin `PLATFORM_ADMIN_COMPANY_ID`"**.

### 5.2 Catering: **NO existe** "hold físico mesa RESERVED"

El §4.5 del informe previo afirmaba que existía un "hold físico" que ponía `Table.status = RESERVED`. **No es cierto:** `reservation.service.ts` **nunca** setea `Table.status = RESERVED`.

El anti-doble-booking real se logra por **tres mecanismos combinados**:

1. Filtro por mesas en estado `AVAILABLE`.
2. Filas de reserva (registros de reserva que representan la ocupación lógica).
3. Bloqueo `FOR UPDATE` en la transacción.

**Corrección al doc previo:** eliminar la afirmación del "hold físico RESERVED" del §4.5; describir el mecanismo real (filtro `AVAILABLE` + filas de reserva + `FOR UPDATE`).

### 5.3 Catering / POS: la ventana walk-in **es configurable**, no "3h fija"

El informe previo indicaba una "ventana walk-in de 3h fija". **Es incorrecto:** la ventana es **configurable y compartida**, con **default de 120 min**.

- Referencias: `setting.service.ts:18` (setting) y `getReservationTableWindowMinutes` → `setting.service.ts:216`.

**Corrección al doc previo:** reemplazar "3h fijo" por **"ventana configurable compartida, default 120 min"**.

---

## 6. Hallazgos NUEVOS por dominio

Severidades: **CRÍTICA / MEDIA / BAJA / INFO / COSMÉTICA**. `NEW` = nuevo en esta barrida; `known` = ya conocido/confirmado; `RESIDUAL` = de diseño.

### 6.1 Inventario — ✅ LISTO_CON_CONDICIONES (core sólido)

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| RESIDUAL (diseño) | `costing.service.ts:120-130`; `kardex.service.ts:217-221` | Promedio ponderado **GLOBAL** vs `balanceCost` por bodega. Puede divergir el costo entre vista global y por bodega. |
| BAJA (NEW) | `menuRecipe.ts:30-39` (cliente) | **Silencio de costo $0** en cliente vs comportamiento **fail-loud** del servidor. |
| BAJA (NEW) | `inventory-consumption.service.ts:446-458` | `reverseForOrder` con **origin inconsistente** (sin `origin:REVERSAL`). |
| INFO | cliente/servidor | **Fórmula de costo de receta duplicada** entre cliente y servidor. |
| BAJA | (Decimal) | `Decimal(10,6)` como **tope de costo unitario**. |

### 6.2 Producción / Menú — ✅ LISTO_CON_CONDICIONES (core sólido)

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| BAJA (NEW) | `recipe-scaling.service.ts:52,127` | Valora con `effectiveUnitCost` en lugar de `resolveProductUnitCost` → **costo 0** en vistas de escalado. |
| BAJA (NEW) | `recipe-scaling.service.ts:109,112` | `calculateYield` **suma unidades heterogéneas**. |
| BAJA (NEW) | `production-order.service.ts:531-544` | `finish` con overrides todos en 0 ⇒ `realUnitCost = 0`. |
| COSMÉTICA | `report-production.service.ts:329` | **Mojibake** (texto mal codificado). |
| COSMÉTICA | `report-production.service.ts:412` | Centinela **999** en `daysUntilStockout`. |

### 6.3 Ventas / POS / Caja — ✅ LISTO_CON_CONDICIONES (core sólido)

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| BAJA (NEW) | `cash-shift.service.ts:383-389` | `getShiftSummary.totalSalesCash` **no resta reembolsos** de NC en efectivo (`CN-REF-*`). **Solo display**; el arqueo es correcto. |
| INFO | `cash-shift.controller.ts:161` | `close` sin breakdown (usar la ruta `/cash-arqueo` con USD). |
| INFO | (diseño) | El cierre **no valida órdenes abiertas** (por diseño). |

### 6.4 Reportería — ✅ LISTO_CON_CONDICIONES

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| MEDIA (NEW) | `bank-reconciliation.service.ts:563-564` | Ventana mensual calculada en **TZ del host**, no de la empresa. |
| BAJA/MEDIA (NEW) | `report-extended.service.ts:275,309` | `getPurchasesByDay/Month` agrupan en **UTC**. |
| MEDIA (known) | `report.service.ts:1775-1778,1852-1857` | `getSalesReport` con filtro categoría/marca **suma tax/tip/gross/collected a nivel orden** (no prorratea). |
| MEDIA (known) | `report.service.ts:534` | `getTopSellingProducts` es **all-time** (no respeta rango). |
| BAJA (NEW) | `report.service.ts:399-401` | `getConversionFunnel` **cuenta reservas futuras**. |
| BAJA (NEW) | `report-extended.service.ts:1067-1069` | `getSalesByChannel`: comisión **no netada en devoluciones**. |
| BAJA | `report-extended.service.ts:1260-1269` | Claves `'Sin categoria'` vs `'Sin Categoría'` — **frágil**. |
| OBS | (averageTicket) | `averageTicket`: denominador **incluye CANCELLED + CREDITED**. |

### 6.5 RRHH — ✅ LISTO_CON_CONDICIONES

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| BAJA (known) | `schema.prisma:1636` | **Enum muerto** `AttendanceCorrectionStatus.APPROVED`. |
| BAJA (known) | `hr-workforce.service.ts:1511` | Fallback **480/60** unidades de permiso. |
| BAJA (NEW, cosmético) | `hr-payroll.service.ts:157` | `'4800'` `FORTNIGHTLY` en **migración legado**. |

### 6.6 Multi-tenant — ✅ LISTO_CON_CONDICIONES (aislamiento **Alta confianza**)

- **Sin fugas** de datos entre tenants detectadas.
- Condición: **documental** (corregir doc de 1ª pasada) + **setear `PLATFORM_ADMIN_COMPANY_ID`** por requisito funcional.

### 6.7 Catering / Reservas — ✅ LISTO_CON_CONDICIONES

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| MEDIA (NEW) | `catering.service.ts:1271` | `checkResourceAvailability` incluye eventos **FINISHED** en el forecast → **alertas falsas**. |
| BAJA (NEW) | `reservation.service.ts:257` | **Reasignación silenciosa** de mesa en `update`. |
| MEDIA (producto) | (diseño) | **No se puede pasar a FINISHED sin pago total**. |
| MEDIA (producto) | (diseño) | **Sin estados de producción/servicio** de evento. |
| MEDIA (producto) | (diseño) | **Reembolso fiscal solo total** (no parcial). |
| BAJA (producto) | (diseño) | Reserva far-term puede asignar mesa hoy ocupada (**resuelto fail-closed en check-in**). |

### 6.8 Transversal

| Sev. | Archivo:línea | Hallazgo / impacto |
|---|---|---|
| MEDIA-BAJA | `setting.service.ts:173`, `order.service.ts:109`, `catering.service.ts:52`, `invoice.service.ts:182` | **Resolución de tasa de IVA duplicada** en ~4 lugares. |
| BAJA | `pedidosya.service.ts:173-174` y `631-632` | **Base URL de PedidosYa duplicada**. |
| INFO | `setting.service.ts:12` | Default IVA `'15'` **centralizado**. |

---

## 7. Silencios peligrosos

**Estado: sin silencios peligrosos críticos.**

- **Ninguno crítico** en rutas de **dinero** o **stock**.
- Existe un **catálogo de `.catch`** que son **benignos o fail-closed** (no ocultan errores de negocio críticos).
- **Cero `catch` vacíos** en `server/src`.
- **Cero `TODO` / `FIXME`** pendientes en el código auditado.

---

## 8. Integridad transaccional confirmada (dinero + stock)

| Mecanismo | Confirmación |
|---|---|
| Locks | `FOR UPDATE` presente en flujos de pago/orden/producción/mesa. |
| Transacciones | `$transaction` envuelve operaciones dinero/stock. |
| Idempotencia | Prefijos de referencia `ORD-` / `EVT-` / `PAY-`. |
| Reversas | **Exactas por capas** (reversa espejo de la consunción). |

La integridad transaccional de dinero + stock se confirma **sólida**.

---

## 9. Confirmación de fixes de 1ª pasada

| Fix (1ª pasada) | Presente | Regresión |
|---|---|---|
| Correcciones de dinero/stock reportadas | ✅ Presente | ❌ No |
| Correcciones de integridad transaccional | ✅ Presente | ❌ No |
| Correcciones de reportería/costeo | ✅ Presente | ❌ No |
| Correcciones de multi-tenant / aislamiento | ✅ Presente | ❌ No |
| Correcciones de catering/reservas | ✅ Presente | ❌ No |

**Todos los fixes de la 1ª pasada están presentes. Sin regresiones detectadas.**

---

## 10. Riesgos residuales priorizados

### P1 — Prioridad alta (accionables antes/pronto)

- **Zona horaria en reportería** (el más accionable): ventanas y agrupaciones en TZ host/UTC en lugar de TZ empresa.
  - `bank-reconciliation.service.ts:563-564`, `report-extended.service.ts:275,309`.

### P2 — Prioridad media

- **Promedio ponderado GLOBAL** vs `balanceCost` por bodega (`costing.service.ts:120-130`; `kardex.service.ts:217-221`).
- **Agregación por filtros** categoría/marca a nivel orden (`report.service.ts:1775-1778,1852-1857`).
- **Métricas de display**: `totalSalesCash` no resta NC efectivo (`cash-shift.service.ts:383-389`), `getConversionFunnel` cuenta reservas futuras (`report.service.ts:399-401`), `getTopSellingProducts` all-time (`report.service.ts:534`).
- **Catering forecast** incluye eventos FINISHED (`catering.service.ts:1271`).

### P3 — Prioridad baja / cosmética / gaps de producto

- **Gaps de producto Catering**: sin estados producción/servicio de evento; reembolso fiscal solo total; FINISHED requiere pago total.
- Cosmética: mojibake (`report-production.service.ts:329`), centinela 999 (`:412`), enum muerto (`schema.prisma:1636`), claves 'Sin categoria' (`report-extended.service.ts:1260-1269`).
- Duplicaciones: IVA (~4 lugares), URL PedidosYa.

---

## 11. Condiciones antes de producción

1. **Variables de entorno:**
   - **Setear `PLATFORM_ADMIN_COMPANY_ID`** (requisito funcional; el server es fail-closed en modo `multi` sin ella — `env-validation.ts:52-53` + `index.ts:20-25`).
   - Verificar **secretos** de producción.
   - Aplicar **migraciones** pendientes.
2. **Smoke test en staging** cubriendo dinero (pago, arqueo), stock (consumo, reversa), reportería y multi-tenant.
3. **Corregir el informe de 1ª pasada desactualizado** (`docs/auditoria-produccion-2026-07-16.md`): multi-tenant fail-closed, inexistencia del "hold físico RESERVED", ventana walk-in configurable (default 120 min).

---

## 12. Recomendaciones de mejora (NO bloqueantes)

- **Unificar `getTaxRate`** en un único helper (eliminar la resolución de IVA duplicada en ~4 lugares).
- **Unificar el costeo cliente/servidor** (fórmula de costo de receta y silencios de $0 en cliente).
- **Zona horaria uniforme en reportería** (usar TZ de empresa consistentemente).
- **Prorrateo de filtros por categoría/marca** (tax/tip/gross/collected a nivel de ítem).
- **Limpieza de enum** muerto y constantes legado.

---

## 13. Go / No-Go checklist

| Ítem | Estado |
|---|---|
| `tsc --noEmit` server/client = 0 errores | ✅ |
| ESLint server/client = 0 problemas | ✅ |
| Sin merge markers | ✅ |
| 118 archivos de test (unit) | ✅ |
| Sin silencios peligrosos en dinero/stock | ✅ |
| Integridad transaccional (locks + $transaction + idempotencia + reversas) | ✅ |
| Fixes de 1ª pasada presentes, sin regresiones | ✅ |
| `PLATFORM_ADMIN_COMPANY_ID` seteado (condición) | ⏳ Pendiente de despliegue |
| Smoke test en staging | ⏳ Pendiente |
| Doc de 1ª pasada corregido | ⏳ Pendiente |

### Decisión

# ✅ GO — LISTO_CON_CONDICIONES

El sistema es apto para producción una vez cumplidas las **condiciones** de la sección 11 (variable de entorno, smoke staging y corrección documental). Los riesgos residuales son **no bloqueantes** y de severidad **MEDIA o inferior**.

---

*Segunda barrida READ-ONLY — no se modificó código. Único archivo escrito: este informe.*
