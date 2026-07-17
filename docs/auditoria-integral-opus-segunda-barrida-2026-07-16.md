# Auditoría independiente y reparación de la segunda barrida de Opus 4.8 High

**Proyecto:** `C:\restaurant`

**Fecha:** 2026-07-16

**Documento revisado:** `docs/auditoria-produccion-2da-barrida-2026-07-16.md`

**Alcance:** revisión estática, reparación, pruebas unitarias, integración sobre MySQL desechable, E2E y harness operativo local.
**Estado:** `LISTO_CON_CONDICIONES` para el código consolidado; no equivale a despliegue ni certificación del ambiente productivo.

## Resumen técnico

La segunda barrida de Opus fue útil: identificó 13 defectos corregibles que sí existían. Sin embargo, su veredicto `GO` no estaba sustentado por la evidencia descrita en el propio informe: contar 118 archivos de pruebas no demuestra que las pruebas pasen, los prefijos de referencias no constituyen por sí solos idempotencia, y una revisión read-only no puede afirmar ausencia de regresiones transaccionales.

La revisión independiente clasificó los 33 señalamientos residuales/nuevos de Opus así:

| Disposición | Cantidad | Resultado |
|---|---:|---|
| Defecto confirmado y corregido | 13 | Código y regresiones focales añadidas |
| Observación válida, deuda o gap sin cambio seguro | 13 | Documentado; no se inventó política ni dato |
| Falso positivo como defecto o contrato intencional | 6 | No se alteró el flujo correcto |
| Informativo, no era un hallazgo | 1 | Sin acción |
| **Total** | **33** | **Todos revisados** |

Durante la consolidación se detectó además un defecto no señalado por Opus: el resumen de caja iba a incluir devoluciones POS pero omitía cobros y reversos de Catering. Se corrigió para reconciliar `PAY-*`, `CAT-PAY-*`, `REV-PAY-*`, `CN-REF-*` y `REV-CAT-PAY-*` sin confundir gastos ordinarios.

## Qué estaba bien y qué estaba mal en las conclusiones de Opus

### Aciertos documentales

1. El modo multiempresa falla cerrado si falta `PLATFORM_ADMIN_COMPANY_ID`.
2. Reservas no crea un hold físico cambiando `Table.status` a `RESERVED`; la ocupación futura es lógica y se serializa con bloqueos.
3. La ventana de reserva/walk-in es configurable y su valor por defecto es 120 minutos.

### Correcciones necesarias al informe de Opus

1. Las rutas citadas para tenencia son incorrectas. Los archivos reales son `server/src/utils/env-validation.ts` y `server/src/utils/tenant-scope.ts`, no `config/` ni `middleware/`.
2. `PLATFORM_ADMIN_COMPANY_ID` no es una condición universal. En modo `multi` es obligatoria; en modo `single` debe estar vacía.
3. “118 archivos de test listados” no demuestra “sin regresiones”. Opus no documentó ejecución de unitarios, integración, E2E ni harness.
4. Los prefijos `ORD-`, `EVT-` y `PAY-` son correlación/procedencia. La idempotencia real depende de claves de idempotencia, restricciones únicas, locks, comparación de payload y ledger durable.
5. “Reversas exactas por capas” no puede generalizarse desde presencia de código. Se certificó aquí mediante pruebas de integración de FIFO, promedio ponderado, NC, cancelación y concurrencia.
6. “Sin silencios peligrosos” era demasiado absoluto. No hay `catch` vacío crítico, pero sí existen supresiones explícitas de errores de limpieza de archivos y audio; son benignas y están fuera de dinero/stock. El `$0` de `menuRecipe` es preview de UI, no posting.
7. El `GO` productivo de Opus era prematuro. Esta revisión certifica el árbol local; no verificó secretos, variables, migraciones aplicadas ni smoke del despliegue real.

## Matriz integral de hallazgos

### Inventario, costeo, producción y menú

| Hallazgo de Opus | Clasificación final | Acción y razonamiento |
|---|---|---|
| Promedio global vs `balanceCost` por bodega | Contrato intencional | `Product.currentAverageCost` es corporativo; Kardex conserva el saldo local histórico. Cambiarlo habría reescrito semántica y costo histórico. Se aclaró el comentario, no la lógica. |
| `menuRecipe` puede mostrar costo `$0` | Deuda UX baja | Es preview. La UOM inválida muestra `—` y la validación bloquea guardar. El server sigue autoritativo y fail-loud. |
| `reverseForOrder` sin `origin: REVERSAL` | Confirmado y corregido | La restitución ahora persiste origen, grupo y clave de reversa estructurados. |
| Fórmula de receta duplicada cliente/server | Gap arquitectónico | El cliente previsualiza; el servidor convierte UOM y publica. Unificar exige cambiar contrato API/UI, no duplicar más cálculo. |
| `Decimal(10,6)` limita costo unitario | Gap real de esquema | Requiere migración y decisión de rango/precisión. No se cambió el esquema sin requisito financiero. |
| Escalado usa costo directo | Confirmado y corregido | Usa `resolveProductUnitCost`, incluida BOM activa de productos intermedios no producidos aún. |
| Yield suma unidades heterogéneas | Confirmado y corregido | Normaliza mediante `systemFactor`, publica unidad canónica y rechaza mezcla de masa/volumen/unidades. |
| Finalización con overrides todos cero | Confirmado y corregido | Se rechaza antes de la transacción y se repite la guarda después del lock. Mezcla cero/positivo sigue válida. |
| Mojibake en reporte de producción | Confirmado y corregido | Texto UTF-8 corregido, sin cambio lógico. |
| Centinela `999` para agotamiento | Confirmado y corregido | Sin demanda devuelve `null`; el promedio presenta `N/D` y no inventa un horizonte. |

Contraflujos certificados: una producción con consumo total cero no muta orden ni stock; una mezcla publica solo consumos positivos; dos finalizaciones concurrentes producen una sola confirmación; cancelar restaura stock, capas FIFO y costo; la reversa de venta conserva procedencia e idempotencia.

### Caja, banco y reportería

| Hallazgo de Opus | Clasificación final | Acción y razonamiento |
|---|---|---|
| `totalSalesCash` no resta NC efectivo | Confirmado y corregido | Netea NC y reversos POS. La consolidación amplió la corrección a cobros/reversos Catering. |
| `close` sin breakdown USD | Informativo | Existe el flujo dedicado `/cash-arqueo`; no se duplicó contrato en el cierre genérico. |
| Cierre no bloquea órdenes abiertas | Decisión operativa | El turno y la vida de la orden son dominios distintos. Cambiarlo requiere política de negocio. |
| Mes bancario en TZ del host | Confirmado y corregido | Usa límites del mes calendario de la empresa y muestra fechas zonificadas. |
| Compras día/mes agrupadas UTC | Confirmado y corregido | Usa `zonedDateKey` y `zonedMonthKey` con TZ de empresa. |
| Filtro categoría/marca atribuye 100% de montos de orden | Confirmado y corregido | Descuento, impuesto, propina, total y cobro se asignan en centavos por mayor residuo usando únicamente importes persistidos. Falla cerrado si no reconcilia. |
| Top products es all-time | Falso positivo respecto al contrato | La API no acepta rango y el Dashboard lo llama “Demanda histórica”. Netea NC all-time. |
| Funnel cuenta reservas futuras | Confirmado y corregido | Limita reservas al día local actual `[inicio, siguiente medianoche)`. |
| Comisión de canal no se netea con NC | Gap de datos/producto | No existe evento durable que diga si el marketplace devolvió comisión. Netear proporcionalmente inventaría política. Venta e ingreso neto sí descuentan la NC. |
| Variantes de `Sin categoría` | Confirmado y corregido | Se usa una clave canónica para venta, devolución, producto y food cost. |
| `averageTicket` incluye ticket acreditado | Falso positivo | El contrato usa tickets fiscales brutos y NC como contradocumento negativo. Eliminar el ticket mezclaría conteo neto con dinero gross+counterdocument. |

### RR. HH. y tenencia

| Hallazgo de Opus | Clasificación final | Acción y razonamiento |
|---|---|---|
| `AttendanceCorrectionStatus.APPROVED` sin transición persistida | Deuda técnica baja | El flujo aprobado persiste `APPLIED`. Eliminar un valor de enum requiere auditar datos históricos y migración no aditiva; no se arriesgó producción por limpieza cosmética. |
| Fallback 480/60 de permisos | Compatibilidad explícita | Es una constante documentada y coincide con la configuración V4 de referencia. Cuando existe regla activa usa `paidLeaveUnitMinutes`. Volverla obligatoria para empresas sin nómina es una decisión de producto. |
| Fallback `FORTNIGHTLY: '4800'` | Falso positivo como defecto | Solo normaliza alias V4 congelados durante lecturas históricas; nuevas cargas exigen V4 completa y validada. Las pruebas lo confirman. |
| Tenencia fail-closed | Correcto con matiz | `multi` exige empresa plataforma; `single` la prohíbe. ADMIN tenant queda fijado a su empresa. |

Se ejecutaron 93 pruebas focales de nómina, workforce, validación de entorno y tenant scope: todas pasaron.

### Catering, reservas y transversal

| Hallazgo de Opus | Clasificación final | Acción y razonamiento |
|---|---|---|
| Forecast incluye eventos `FINISHED` | Confirmado y corregido | Excluye `CANCELLED` y `FINISHED`; antes duplicaba demanda cuyo inventario ya fue consumido. |
| Reasignación silenciosa de mesa | Gap UX bajo | El backend devuelve la mesa y la UI recarga y la muestra. Falta aviso explícito, pero no hay corrupción ni asignación oculta. |
| No se puede `FINISHED` sin pago total | Contrato contable intencional | `PAID → FINISHED` evita consumo de una venta sin cobrar ni cuenta por cobrar durable. Soportar crédito exige un nuevo dominio. |
| Sin estados separados producción/servicio | Gap de producto | El estado actual cubre cotización, reserva, pago, finalización y cancelación. Agregar estados exige reglas de transición y UX. |
| NC Catering solo total | Gap de producto confirmado | El modelo es una NC única por evento, sin líneas acreditadas, distribución durable por pago ni cantidades devueltas. No se simuló proporcionalidad. |
| Reserva futura puede elegir mesa ocupada hoy | Falso positivo como defecto | Fuera de la ventana cercana se ignora correctamente el estado físico transitorio; los conflictos lógicos siguen bloqueados y check-in falla cerrado. |
| Resolución de IVA duplicada | Deuda técnica | POS calcula autoritativamente y la factura conserva snapshot histórico. Unificar requiere cambio coordinado, no una sustitución local riesgosa. |
| Base URL PedidosYa duplicada | Deuda técnica baja | Ambas ramas usan los mismos valores de producción/sandbox y las pruebas cubren sandbox y timeout. |
| IVA default 15 centralizado | Informativo | No requiere acción. |

Contraflujos Catering certificados: pago y reverso idempotente; factura inmutable; NC total; devolución FIFO exacta; caja neta en cero; reserva/conflicto/cancelación. La NC parcial de Catering sigue fuera del contrato y no debe presentarse como disponible.

## Reparaciones aplicadas

### Código de negocio

- `server/src/services/inventory-consumption.service.ts`
- `server/src/services/recipe-scaling.service.ts`
- `server/src/services/production-order.service.ts`
- `server/src/services/report-production.service.ts`
- `server/src/services/cash-shift.service.ts`
- `server/src/services/bank-reconciliation.service.ts`
- `server/src/services/report.service.ts`
- `server/src/services/report-extended.service.ts`
- `server/src/services/catering.service.ts`
- comentario semántico en `server/src/services/costing.service.ts`

### Regresiones añadidas o ampliadas

- `server/src/tests/unit/cash-shift-summary.test.ts`
- `server/src/tests/unit/report-purchase-state.test.ts`
- `server/src/tests/unit/bank-reconciliation.service.test.ts`
- `server/src/tests/unit/report-timezone.test.ts`
- `server/src/tests/unit/bi-dashboard-metrics.test.ts`
- `server/src/tests/unit/sales-report-reconciliation.test.ts`
- `server/src/tests/unit/catering-status-machine.test.ts`
- `server/src/tests/unit/production.service.test.ts`
- `server/src/tests/unit/recipe-scaling-uom.test.ts`
- `server/src/tests/unit/report-production-physical-scope.test.ts`
- `server/src/tests/unit/transactional-redteam.service.test.ts`

## Revisión de posibles daños introducidos

1. **Prorrateo filtrado:** se validó que una selección parcial no recibe 100% del impuesto/propina y que seleccionar todas las líneas reconcilia exactamente el total de la orden en centavos.
2. **Caja:** el primer arreglo POS no contemplaba Catering en el indicador de ventas en efectivo. La consolidación lo detectó y corrigió antes del cierre.
3. **Zona horaria de compras:** dos unitarios antiguos no mockeaban la nueva dependencia de configuración e intentaban usar una DB local. Se reparó el aislamiento; no era falla de producción.
4. **Yield:** no se inventa conversión entre dimensiones. Mezclas incompatibles fallan con mensaje explícito.
5. **Producción:** la guarda de consumo positivo se evalúa antes y después del lock para evitar carrera; una mezcla con al menos un insumo positivo sigue funcionando.
6. **Forecast Catering:** excluir `FINISHED` es correcto porque ese evento ya publicó el consumo físico; no se excluyen eventos pendientes que todavía demandan inventario.
7. **Agotamiento sin demanda:** `null`/`N/D` reemplaza el 999 sin contaminar ordenamiento ni promedio.

No se detectó una corrección consolidada que dañe el flujo transaccional. La única omisión funcional introducida durante el arreglo fue la lectura incompleta POS/Catering de caja y quedó corregida con prueba.

## Evidencia de validación final

| Gate | Resultado final |
|---|---|
| Server unit | 119 suites, 721/721 pruebas PASS |
| Client unit | 56 archivos, 248/248 pruebas PASS |
| Integración migrada | 13 suites, 50/50 pruebas PASS |
| Migraciones en DB desechable | 48/48 aplicadas |
| Playwright E2E | 46/46 PASS; ejecución real fuera del sandbox |
| TypeScript server/client | PASS |
| ESLint server/client | PASS |
| Build server/client | PASS |
| `git diff --check` | PASS; solo avisos de conversión LF/CRLF |
| TODO/FIXME reales | Ninguno |
| Merge markers reales | Ninguno |

El primer intento de Playwright dentro del sandbox falló con `spawn EPERM`, una restricción de lanzamiento de Chromium. El árbol temporal se cerró de forma explícita y la repetición fuera del sandbox pasó 46/46.

### Harness operativo local

- Warmup liveness/readiness: HTTP 200.
- Carga: 300/300 respuestas exitosas, 929.8 req/s, p95 29.42 ms.
- Soak: 7,703/7,703 respuestas exitosas, 1,539.92 req/s, p95 7.37 ms.
- Webhooks sin firma: 401.
- JSON sobredimensionado: 413.
- WebSocket no autenticado: cierre 4001.
- Readiness después de fallos: 200.

## Limitaciones y riesgos residuales

1. NC parcial de Catering requiere migración, líneas acreditadas, asignación durable de pagos e inventario y reglas de reintento. No está implementada.
2. Devolución de comisión de marketplace requiere un ledger externo confirmado. No debe inferirse de la NC.
3. `Decimal(10,6)` impone un techo real; ampliar precisión requiere decisión financiera y migración.
4. Estados independientes de producción/servicio de Catering y aviso de reasignación son mejoras de producto/UX.
5. El enum histórico `AttendanceCorrectionStatus.APPROVED`, la duplicación de IVA y la URL duplicada son deuda técnica no transaccional.
6. No se inspeccionó ni modificó una base productiva, variables reales, secretos ni despliegue Railway.
7. El worktree ya contenía numerosos cambios de la auditoría anterior y trabajo del usuario. No se hizo reset, commit ni deploy.

## Decisión de liberación

**Código local consolidado:** `GO_CON_CONDICIONES`.

La evidencia actual sí permite afirmar que el árbol local compila, pasa sus pruebas transaccionales y conserva confirmación/contraflujo en los procesos cubiertos. No permite afirmar que producción esté desplegada o configurada correctamente.

Antes de liberar:

1. revisar y versionar intencionalmente el worktree completo;
2. aplicar las 48 migraciones mediante el pipeline previsto;
3. configurar `PLATFORM_TENANCY_MODE`; solo si es `multi`, configurar `PLATFORM_ADMIN_COMPANY_ID`;
4. validar secretos y orígenes productivos;
5. ejecutar smoke en staging/producción para pago, arqueo, consumo/reversa, NC, Catering, reportería y aislamiento tenant;
6. no anunciar NC parcial de Catering ni devolución de comisión como funcionalidades disponibles.

Este documento sustituye las conclusiones operativas de la segunda barrida read-only de Opus, pero conserva aquel informe como evidencia histórica de lo que el auditor observó en su momento.
