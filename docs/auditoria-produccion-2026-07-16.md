# Auditoría de preparación para producción

| Campo | Valor |
|---|---|
| **Repositorio** | `C:/restaurant` |
| **Fecha** | 2026-07-16 |
| **Método** | 8 agentes especializados en paralelo + consolidación cruzada |
| **Veredicto global** | **LISTO_CON_CONDICIONES** |
| **Evidencia automática** | `tsc --noEmit` OK · Jest unitario server **109 suites / 622 tests PASS** |

---

## 1. Resumen ejecutivo

El monorepo converge en un árbol coherente tras la pasada del 2026-07-16: sin marcadores de conflicto, imports nuevos resueltos (`tenant-scope`, `company-provisioning`, `hr-shift-minutes`) y alias fiscal `tax_rate` / `taxRate` alineado entre servidor, POS, Settings y Catering.

La consolidación **no** alteró lógica de negocio de servicios; solo corrigió drift de tests cruzados. El go-live es viable para un **tenant operativo bien aprovisionado**, con secretos y migraciones aplicados, y smoke de dinero/caja/stock firmado en staging.

**No** se certifica como plataforma multi-empresa abierta sin fijar `PLATFORM_ADMIN_COMPANY_ID`. Residual aceptado: algunas queries secundarias de reportería aún filtran `PAID` + ventana `closedAt` sin el predicado explícito `closedAt: { not: null }` que ya usan dashboard/COGS vía `settledWhere`.

---

## 2. Matriz por dominio

| # | Dominio / agente | Veredicto | Una línea |
|---|---|---|---|
| 1 | Cross-cut / silencios | `READY_WITH_FIXES` | Alias `tax_rate`↔`taxRate`; silencios de CostReport/Reports endurecidos |
| 2 | Inventario / Compras / Costos | `READY_WITH_FIXES` | Sync avg FIFO, cancel prod WA, `allowNegative` FIFO fail-closed, COGS ledger `ORD-*` |
| 3 | Ventas / POS / Caja | `READY_WITH_FIXES` | Impuesto autoritativo, turno mismo día, arqueo USD fail-closed, resumen `PAY-*` |
| 4 | Producción / Menú / Cocina | `READY_WITH_FIXES` | Wave READY con líneas sin enviar; PREPARED exige receta; delivery guard |
| 5 | Catering / Reservaciones | `READY_WITH_FIXES` | Alertas, TZ, mesa `RESERVED`, walk-in 3h, `NO_SHOW`, inventario fail-closed |
| 6 | Multi-tenant (empresas/sucursales/marcas) | `READY_WITH_FIXES` | IDOR gated por `PLATFORM_ADMIN_COMPANY_ID`; roles tenant sin SUPERADMIN |
| 7 | RRHH | `READY_WITH_FIXES` | Planilla $0 sin silencio; cancel schedule UI; leave units; `hr-shift-minutes` |
| 8 | Reportería / BI | `READY_WITH_FIXES` | `settledWhere` en charts; TZ periodos; KPI sin ceros falsos; COGS ledger + extended |
| — | **Consolidación** | `READY_WITH_FIXES` | Drift tests: redteam `closedAt` + mocks provisioning; árbol coherente |

**Veredicto consolidado de dominios:** todos `READY_WITH_FIXES` → global **LISTO_CON_CONDICIONES**.

---

## 3. Condiciones obligatorias antes de producción

| Prioridad | Condición | Detalle |
|---|---|---|
| **Dura** | `PLATFORM_ADMIN_COMPANY_ID` | Debe apuntar al `companyId` del operador de plataforma. Vacío = cualquier SUPERADMIN opera cross-tenant (legado). Documentado en `.env.example` y `server/.env.example`. |
| Dura | Secretos | `JWT_SECRET`, `TWO_FA_ENCRYPTION_KEY`, `DATABASE_URL`, `CLIENT_URL` reales (no defaults débiles). |
| Dura | Flags demo / biometría | `ALLOW_DEMO_SEED=false`; `HR_FACE_PROVIDER=disabled` o proveedor/clave biométrica real. |
| Ops | Migraciones | Prisma aplicadas; schema `up to date`. |
| Ops | Storage / backup | Volume `STORAGE_DIR` persistente; `BACKUP_ADMIN_COMPANY_ID` si se usa API de backup. |
| Fiscal / caja | Settings por empresa | Validar `tax_rate` post-deploy; tasa de cambio operativa > 0 para arqueos con USD. |
| Smoke | Staging firmado | Ver checklist §9 y §10. |

---

## 4. Correcciones implementadas

### 4.1 Cross-cut (silencios / arquitectura)

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/setting.service.ts` | Canonicalización lectura/escritura: clave canónica `tax_rate`, alias legacy `taxRate` en lecturas |
| `client/src/pages/Settings.tsx` | Formulario lee `tax_rate \|\| taxRate`; persiste canónico |
| `client/src/pages/POS.tsx` | `resolveConfiguredTaxRate` evita IVA 0 por mismatch de clave |
| `client/src/pages/CostReport.tsx` | Errores de carga/filtro ya no se tragan en silencio |
| `client/src/pages/Reports.tsx` | Fallos de filtros/reportes visibles al operador |

### 4.2 Inventario / Compras / Costos

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/costing.service.ts` | `syncFifoCurrentAverageCost` — promedio de display/receta alineado a capas restantes |
| `server/src/services/inventory-engine.service.ts` | Sync avg FIFO en OUT (no en IN, para no corromper `previousAvgCost` de historial) |
| `server/src/services/production-order.service.ts` | Cancelación: restore WA de insumos; `allowNegative` **rechazado** bajo costeo FIFO |
| `server/src/services/report.service.ts` (`getCostReport`) | COGS prioriza neto de movimientos ledger `ORD-*` (incl. modificadores); fallback receta×avg solo sin ledger |
| `server/src/services/purchase-order.service.ts` (y reportes asociados) | Agregación legacy de cantidades PO en UOM base corregida |
| Tests | `fifo-costing.service.test.ts`, `inventory-engine.service.test.ts`, `cost-report-cogs-ledger.test.ts` |

### 4.3 POS / Caja / Facturación

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/order.service.ts` | Impuesto autoritativo desde settings de empresa en cambios de líneas / pricing (cliente no es fuente de verdad) |
| `server/src/services/invoice.service.ts` | Re-sync de tax desde `tax_rate` antes de congelar snapshot fiscal |
| `server/src/services/setting.service.ts` | `getTaxRate` canónico para POS/factura |
| `server/src/services/cash-shift.service.ts` / orden-crédito | Turno de caja **mismo día** (TZ empresa) para operaciones sensibles |
| `server/src/services/cash-arqueo.service.ts` | Arqueo con USD: tasa de cambio ≤ 0 → fail-closed |
| Resumen de ventas caja | Matching de ingresos `PAY-*` (no subdeclarar por patrón incorrecto) |
| Tests | `cash-arqueo.validation.test.ts`, `invoice.service.test.ts`, redteam transaccional |

### 4.4 Producción / Menú / Cocina

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/order.service.ts` | `deriveStatusFromItems`: ola de cocina terminada **no** marca READY si hay líneas sin enviar; delivery/cancel guards |
| `server/src/services/menu-item.service.ts` | Ítems `PREPARED` nuevos requieren receta (no activos “vacíos” por defecto) |
| `server/src/services/production-recipe.service.ts` | Fail-closed si rendimiento base ≤ 0 tras conversión UOM |
| `client/src/utils/menuRecipe.ts` (+ tests) | Readiness de receta en UI alineada a reglas de servidor |
| Handoff FIFO | ACK de consumo producción verificado contra motor inventario |

### 4.5 Catering / Reservaciones

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/catering.service.ts` | Alertas de disponibilidad; TZ en bounds de día; impuestos leen `tax_rate\|taxRate`; inventario fail-closed (evento ausente / UOM inválida → throw) |
| `server/src/services/reservation.service.ts` | Hold físico mesa → `RESERVED` en ventana cercana; release al mover/cancelar; `NO_SHOW` |
| `server/src/services/order.service.ts` | Walk-in: ventana de conflicto con reservación ampliada a **3h** |
| `client/src/pages/Catering.tsx`, `CateringServices.tsx` | Toasts/errores visibles (fin del silencio UI) |
| `client/src/pages/Reservations.tsx` | Acciones `NO_SHOW`, errores de carga visibles |

### 4.6 Multi-tenant

| Archivo | Qué se corrigió |
|---|---|
| `server/src/utils/tenant-scope.ts` | Overrides `companyId` solo para operador de plataforma |
| `server/src/services/company-provisioning.service.ts` | Roles baseline del tenant **sin** SUPERADMIN |
| `server/src/services/company.service.ts` | Provisioning en la misma transacción de alta |
| Controllers | `branch.controller.ts`, `user.controller.ts`, `company.controller.ts`, `role.controller.ts` — resolución de owner company para platform admin |
| `server/src/services/branch.service.ts`, `user.service.ts` | Update/delete cross-tenant por owner company |
| `.env.example`, `server/.env.example` | Documentación de `PLATFORM_ADMIN_COMPANY_ID` |
| Tests | `tenant-scope.test.ts`, `company-settings-provisioning.test.ts` |

### 4.7 RRHH

| Archivo | Qué se corrigió |
|---|---|
| `client/src/components/hr/payroll-operation-workspace.tsx` | Totales/neto: sin pintar `$0` cuando el cálculo está pendiente o ausente |
| `client/src/components/hr/scheduleClient.ts`, `client/src/pages/hr/Schedules.tsx` | Contraflujo UI de cancelación de horario/turno |
| `server/src/services/hr-workforce.service.ts` / payroll | Unidades de leave desde configuración legal; atribución por asignaciones de sucursal |
| `client/src/pages/hr/TimeClock.tsx` (+ attendance) | Errores de reloj/asistencia visibles (no silent fail) |
| `server/src/utils/hr-shift-minutes.ts` | Minutos programados compartidos (asistencia ↔ nómina) |
| Contratos UI | `payrollUi`, `scheduleClient`, attendance/self-service contracts actualizados |

### 4.8 Reportería

| Archivo | Qué se corrigió |
|---|---|
| `server/src/services/report.service.ts` | Helper `settledWhere` — merge de predicados de liquidación + ventana `closedAt` sin pisar filtros (fix crítico en `getSalesChart`) |
| Mismo | Periodos “hoy/semana/mes/año” con bounds TZ de la empresa |
| `client/src/pages/Dashboard.tsx`, widgets BI | KPI no pintan ceros falsos si el widget falla al hidratar |
| `server/src/services/report-extended.service.ts` | Rutas COGS extended alineadas a ledger-first `ORD-*` (channel / food-cost / margin) |
| `client/src/pages/CostReport.tsx` | Copy KPI alineado a fuente ledger |
| Tests | `bi-dashboard-metrics`, `report-timezone`, `sales-report-reconciliation`, `cost-report-cogs-ledger`, `report-extended-cogs-ledger` |

### 4.9 Consolidación (solo drift de tests)

| Archivo | Qué se corrigió |
|---|---|
| `server/src/tests/unit/transactional-redteam.service.test.ts` | Expectativa dashboard alineada a `closedAt: { not: null, gte }` (`settledWhere`) |
| `server/src/tests/unit/company-settings-provisioning.test.ts` | Mocks tipados para que `tsc --noEmit` pase |

Ningún cambio de lógica de negocio en consolidación.

---

## 5. Verificaciones cruzadas (handoffs)

| Handoff | Resultado | Notas |
|---|---|---|
| Catering ↔ Inventario | OK | OUT solo en `FINISHED` con ref `EVT-{id}`; path evento ausente fail-closed |
| Catering ↔ POS/Caja | OK | `CAT-PAY-*` / `REV-CAT-PAY-*` en ledger de caja; no rompen matching `PAY-*` de ventas POS |
| Cocina ↔ POS | OK | READY solo cuando todas las líneas enviadas están DONE; unsent no “desaparece” del KDS como READY |
| COGS reconcile (Inv ↔ Reportería) | OK | `getCostReport` + extended priorizan neto ledger `ORD-*`; receta×WAC = fallback |
| Producción FIFO ACK | OK | Consumo/cancel con capas; `allowNegative` incompatible con FIFO |
| Reserva → Order dine-in | OK | Check-in crea OPEN con `reservationId`; reglas pago/factura POS siguen vigentes |
| Impuesto cross-cut | OK | Servidor autoritativo + alias settings + catering/POS/Settings coherentes |

---

## 6. Pendiente / gaps de producto aceptados

| Prio | Gap | Impacto | Tratamiento |
|---|---|---|---|
| **P1** | `PLATFORM_ADMIN_COMPANY_ID` vacío en deploys multi-empresa | Superficie IDOR operativa (cualquier SUPERADMIN) | **Condición de go-live** — setear en prod |
| **P2** | Catering sin factura fiscal | Gap de producto, no bug de integridad de pagos/caja | Documentado; no bloquea tenant POS-first |
| **P2** | Sin APIs de reverse para waste / transfer / manual | Compensación manual por movimiento | Aceptado; no construir en esta pasada |
| **P2** | Sin reembolso fiscal parcial | Solo reverse completo de pago + nota de crédito según flujo existente | Aceptado |
| **P2** | Queries secundarias en `report.service.ts` (~L323, L688+) sin `closedAt: { not: null }` explícito | Bajo riesgo si invariante pago↔`closedAt` se mantiene | Deuda técnica acotada |
| **P2** | Suite consolidación = unit Jest; no re-ejecución full integration/E2E/harness release | Cobertura de runtime incompleta en esta pasada | Smoke + integration staging recomendados |
| **P3** | `DIRECT` sin receta = sin descuento de stock | Diseño: ítem directo no consume BOM | Operar con receta o aceptar no-stock |
| **P3** | PREPARED existentes con BOM vacío no auto-remediados | Solo altas nuevas endurecidas | Script/ops de auditoría de catálogo |
| **P3** | BI top products all-time (sin ventana de fechas) | KPI puede confundir “hoy” vs histórico | Filtrar por periodo en siguiente iteración |
| **P3** | Cambios amplios de layout UI HR/POS | Riesgo UX, no dinero | QA visual en staging |

---

## 7. Silencios peligrosos: antes → ahora

| Antes | Ahora |
|---|---|
| POS leía `taxRate` mientras DB/settings persistían `tax_rate` → IVA 0 silencioso | Alias bidireccional + write canónico `tax_rate`; servidor recalcula tax |
| Planilla / UI fiscal mostraba `$0` sin evidencia de cálculo | Anomalía / “Pendiente de cálculo”; no silencio monetario |
| Arqueo USD con tasa 0 | Fail-closed con error explícito |
| Charts/KPI rellenando ceros o series all-time al fallar merge de filtros | `settledWhere` + hidratación sin inventar ceros |
| COGS por receta×avg ignorando ledger real | Ledger `ORD-*` primero (cost + extended) |
| CostReport/Reports tragaban errores de filtro | Error visible al operador |
| SUPERADMIN cross-tenant libre | Gate por `PLATFORM_ADMIN_COMPANY_ID` (**aún opt-in**: vacío = legado) |
| Evento catering ausente / UOM inválida soft-return | Throw fail-closed |
| TimeClock / attendance fallos silenciosos | Errores de UI |

---

## 8. Go / No-Go checklist

| Estado | Ítem |
|---|---|
| [x] | Sin conflict markers en `server/src` / `client/src` |
| [x] | `npm run typecheck` (server) PASS |
| [x] | Jest unit: **622/622 PASS** (tenant, FIFO, COGS ledger, caja, payment reversal, invoice, dashboard, provisioning, redteam, etc.) |
| [x] | Alias fiscal y settlement dashboard coherentes entre agentes |
| [x] | Dominios en `READY_WITH_FIXES` sin rotura cruzada post-merge |
| [ ] | **`PLATFORM_ADMIN_COMPANY_ID` seteado** en producción multi-tenant |
| [ ] | Secretos prod + migraciones + `ALLOW_DEMO_SEED=false` |
| [ ] | Smoke staging firmado por ops (ver §10) |
| [ ] | (Recomendado) `test:integration` / harness release en staging antes del cutover |

**Go condicionado:** sí, para go-live de un tenant controlado tras cumplir env/ops arriba.

**No-Go:** si se expone multi-empresa sin `PLATFORM_ADMIN_COMPANY_ID`, o sin smoke de dinero/caja/stock en staging.

---

## 9. Próximos pasos recomendados

1. **Staging smoke (mínimo):**
   - POS: cobro → KDS → factura → arqueo (NIO + USD con tasa > 0).
   - Inventario: compra → recepción → OUT FIFO; verificar avg post-OUT.
   - Producción: finish → cancel (restore WA/FIFO); PREPARED sin receta bloqueado.
   - Catering: cobro `CAT-PAY-*` → finish → OUT `EVT-*`; reverse pago.
   - RRHH: corrida de nómina con asistencia incompleta → debe anomalizar, no `$0` silencioso.
2. **Hardening multi-tenant:** fijar y auditar `PLATFORM_ADMIN_COMPANY_ID`; probar que SUPERADMIN de otra empresa **no** puede override `companyId`.
3. **Auditoría SUPERADMIN read-only:** inventario de usuarios con rol SUPERADMIN; restringir a compañía operador; revisar accesos de backup (`BACKUP_ADMIN_COMPANY_ID`).
4. **Deuda reportería P2:** unificar queries secundarias bajo `settledWhere`; ventana de fechas en top products BI.
5. **Catálogo menú:** script ops para listar `PREPARED` activos con BOM vacío (no auto-remediar sin decisión de negocio).

---

## 10. Referencias de evidencia

| Artefacto | Ubicación / valor |
|---|---|
| Env multi-tenant | `.env.example`, `server/.env.example` → `PLATFORM_ADMIN_COMPANY_ID` |
| Runbook previo | `docs/production-go-live-runbook.md` |
| Auditoría anterior (2026-07-12) | `docs/PRODUCTION_READINESS_AUDIT_2026-07-12.md` |
| Suite unitaria consolidada | 109 suites · **622 tests PASS** · `tsc` OK |

---

*Informe generado a partir de los outcomes de los 8 agentes de dominio y la consolidación del 2026-07-16. No inventa capacidades no verificadas en esa pasada.*
