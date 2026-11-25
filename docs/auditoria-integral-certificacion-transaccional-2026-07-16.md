# Auditoría integral y certificación transaccional local

| Campo | Resultado |
|---|---|
| Repositorio | `C:\restaurant` |
| Fecha | 2026-07-16 |
| Documento revisado | `docs/auditoria-produccion-2026-07-16.md` (Grok 4.5 High Fast) |
| Alcance | Revisión, reparación, contraflujos, reconciliación, seguridad, silencios y validación local |
| Veredicto del árbol local | **APROBADO para promoción controlada a staging** |
| Veredicto de producción | **NO CERTIFICADO todavía**: faltan migrar, configurar y probar el entorno real |

## 1. Conclusión ejecutiva

El informe de Grok encontró problemas reales, pero su veredicto `LISTO_CON_CONDICIONES` no estaba sostenido por la evidencia que él mismo presentó. Solo había ejecutado typecheck y unidades del servidor; además dejó como “aceptados” vacíos que sí afectaban la integridad transaccional: factura fiscal de Catering, reversos genéricos de inventario, devolución fiscal parcial y reportería temporal de contraflujos.

También introdujo correcciones con efectos peligrosos. La más crítica fue recalcular y volver a sincronizar el impuesto durante la emisión de una factura: una factura debe congelar la venta ya autorizada, no reescribirla usando la configuración vigente. Otros cambios podían liberar una mesa reservada por otro proceso, dejar ítems `PREPARED` en estados incoherentes o permitir administración multiempresa cuando faltaba configuración.

La pasada actual reparó esos puntos y amplió la verificación a servidor, cliente, migraciones reales sobre una base desechable, flujos integrados, navegador y harness operativo. El resultado es una certificación del **árbol local actual**, no del despliegue productivo.

## 2. Qué estaba bien, qué estaba mal y qué fue falso positivo

| Hallazgo de Grok | Evaluación | Resultado actual |
|---|---|---|
| Drift `tax_rate` / `taxRate` | Correcto y de alto impacto | Alias de lectura, escritura canónica y servidor autoritativo |
| KDS podía quedar `READY` con líneas nunca enviadas | Correcto | `READY` exige todas las líneas enviadas y terminadas; una línea no enviada reabre el ciclo |
| `PREPARED` activo sin BOM | Correcto para `PREPARED`; no aplica a `DIRECT` | Alta/edición de metadatos y receta es atómica; un nuevo `PREPARED` queda inactivo hasta tener BOM |
| Costos FIFO/WAC y COGS podían usar el costo actual como historia | Correcto y crítico | Proveniencia persistida, costo conocido vs. ausente, replay cronológico y fail-closed |
| Overrides multiempresa inseguros | Correcto y crítico | `PLATFORM_TENANCY_MODE=single|multi` obligatorio en producción; operador anclado a una empresa explícita |
| Errores UI convertidos a cero/null | Correcto | Errores visibles y `N/D` para costo histórico ausente; cero válido sigue siendo cero |
| Falta explícita de `closedAt: { not: null }` junto con `gte/lte` | **Falso positivo funcional** | SQL/Prisma ya excluye `NULL` al comparar por rango; se conserva el helper por claridad, no como reparación funcional |
| `DIRECT` sin receta no descuenta inventario | **No es bug por sí solo** | Es un diseño de catálogo; solo `PREPARED` exige BOM. Si debe consumir stock, debe modelarse como receta |
| “La consolidación no alteró lógica de negocio” | Incorrecto | Hubo cambios en impuesto, reservas, estados, costos y autorización; algunos cambiaban el flujo |
| `LISTO_CON_CONDICIONES` con solo unitarias server | Conclusión no sustentada | Ahora sí existen gates de cliente, integración, migraciones, E2E y harness; producción sigue pendiente |

## 3. Correcciones de Grok que dañaban o podían dañar el flujo

### 3.1 Facturación e impuesto

La emisión de factura re-sincronizaba el impuesto actual y podía alterar subtotal, impuesto o total de una venta ya pagada. Se corrigió para que la emisión:

- no modifique los importes comerciales ya confirmados;
- valide la reconciliación antes de congelar el snapshot;
- falle de forma explícita si la venta histórica no cuadra;
- mantenga inmutable la identidad fiscal, cliente, tasa, líneas y numeración.

### 3.2 Reservaciones y mesas

El uso directo de `Table.status=RESERVED/AVAILABLE` no registraba quién poseía el hold. Cancelar o mover una reserva podía liberar una mesa que otro flujo ya había ocupado o reservado. Se eliminó esa mutación física insegura; la disponibilidad se deriva de reservaciones activas dentro de una ventana configurable única. El check-in crea la orden, completa la reserva y ocupa la mesa en una sola transacción.

### 3.3 Menú y recetas

Exigir receta sin coordinar metadatos, activación y BOM podía dejar un ítem parcialmente actualizado. La operación ahora es atómica y un `PREPARED` nuevo no se publica hasta que su receta de venta es válida. `DIRECT` conserva su semántica sin BOM.

### 3.4 Multiempresa

El comportamiento anterior era fail-open cuando `PLATFORM_ADMIN_COMPANY_ID` estaba vacío. Ahora la producción exige modo de tenencia explícito; en modo multi, el operador de plataforma debe pertenecer a la empresa configurada. Un `ADMIN` del tenant administra solo su empresa y los roles operativos siguen limitados por sucursal.

### 3.5 Costos históricos

Se eliminaron sustituciones silenciosas de un costo histórico ausente por el costo vigente o por cero. Los movimientos llevan proveniencia, los ceros confirmados se distinguen de datos faltantes y los reportes fallan o muestran `N/D` cuando la evidencia no es íntegra.

## 4. Certificación por flujo y contraflujo

| Flujo | Confirmación | Cancelación / reverso / devolución | Reconciliación verificada |
|---|---|---|---|
| POS y cocina | orden → envío por ola → preparación → `READY` → entrega | cancelación dedicada; no se puede saltar por update genérico | estado de líneas, orden, KDS y mesa |
| Venta y factura POS | factura inmutable → pagos parciales/finales → cierre | anulación impaga; notas parciales acumulables; nota total | líneas, impuestos, pago, caja, factura, stock y reportes |
| Nota de crédito parcial | cantidad por línea e importes prorrateados con redondeo acumulado | reintento idempotente y concurrencia serializada | no excede cantidad, dinero, pago ni stock originales |
| Catering | cotización/reserva → pago → factura → finalización → consumo | reverso de pago y nota fiscal total, con o sin retorno físico | secuencia fiscal compartida, caja, pagos, FIFO y costo exacto |
| Inventario manual | `IN`/`OUT` valorizado e idempotente | movimiento compensatorio inmutable | stock, capas FIFO, WAC, costo e historial |
| Merma | confirmación y salida física valorizada | reverso inmutable | stock y reporte de merma netos |
| Transferencia | salida origen + entrada destino | reverso de ambas piernas | cantidades, capas, costo, tenant y sucursal |
| Producción | consumo de insumos + salida terminada | cancelación con restauración exacta | capas FIFO, WAC, movimientos y reporte de producción |
| Reservación | disponibilidad derivada y check-in atómico | cancelación/no-show sin liberar estado ajeno | reserva, orden y mesa |
| Compra a crédito | recepción, costo, capas y pagos | reverso de pagos; reverso de recepción solo sin deuda activa | saldo, inventario y valor |
| Caja y bancos | movimientos por tipo semántico y turno válido | reembolsos por nota y reversos fechados | arqueo, método, fecha del evento y conciliación neta |
| Reportería | venta bruta en `closedAt` | nota negativa en `issuedAt`; retorno de costo en `movement.createdAt` | dashboard, ventas, usuario, producto, categoría, canal, banco, food cost y margen |
| RRHH | asistencia/horario → cálculo → aprobación → pago | cancelación de horarios, reverso/void con doble control | fuentes congeladas, importes y trazas inmutables |
| Delivery/PedidosYa | secretos válidos, webhook firmado e idempotencia | estado fallido persistido y reintento seguro | no existe éxito ficticio ni secreto incorrecto tolerado |

## 5. Silencios peligrosos y fallbacks

Se corrigieron o bloquearon los siguientes patrones:

- `catch` de cargas operativas que solo registraba consola: ahora hay estado de error visible.
- WebSocket que podía dejar un socket obsoleto o reconectar sin límite: se limpia la instancia, aplica backoff y expone error.
- secretos cifrados con clave equivocada o payload corrupto: fallan cerrados; no se reinterpretan como texto legacy.
- 2FA corrupto: no se deshabilita ni se acepta silenciosamente.
- costo ausente mostrado como `0`: ahora es `N/D` o bloqueo explícito.
- conversión UOM inválida convertida a 1:1/0: ahora aborta la transacción.
- COGS duplicado por receta y ledger: el ledger físico es autoritativo; receta × WAC solo es fallback explícito cuando nunca existió ledger.
- reportes que reescribían el pasado al consultar el estado actual: ventas, notas y retornos se reconocen por la fecha de su propio evento.
- respuestas externas ficticias de sincronización: el fallo queda persistido y llega al operador.

## 6. Evidencia ejecutada

| Gate | Resultado |
|---|---|
| Server typecheck | PASS |
| Client typecheck | PASS |
| Server lint `--max-warnings=0` | PASS |
| Client lint `--max-warnings=0` | PASS |
| Server build | PASS |
| Client build | PASS; warning no bloqueante: chunk `react-pdf` de ~1.58 MB |
| Server unit | **118 suites / 708 pruebas PASS** |
| Client tests | **56 archivos / 248 pruebas PASS** |
| Migraciones + integración | **48 migraciones aplicadas; 13 suites / 50 pruebas PASS** en base MySQL desechable |
| Playwright E2E | **46/46 PASS**; el primer intento en sandbox falló solo porque Windows bloqueó `spawn`, la ejecución autorizada pasó |
| Release harness | **120/120** carga y **2862/2862** soak; p95 27.96 ms y 11.45 ms; webhooks sin firma 401, JSON grande 413, WS no autenticado 4001, readiness 200 |
| `git diff --check` | PASS; solo avisos de normalización LF/CRLF |

## 7. Límites y condiciones de promoción

Esta auditoría **no** afirma que producción esté certificada. Antes de liberar:

1. respaldar la base productiva y ejecutar las cuatro migraciones nuevas de esta pasada;
2. configurar `PLATFORM_TENANCY_MODE` y, si es multiempresa, `PLATFORM_ADMIN_COMPANY_ID`;
3. validar secretos, URLs, storage persistente, flags demo, biometría y claves de cifrado;
4. inventariar filas legacy que quedaron deliberadamente fail-closed: costos sin evidencia, Catering sin snapshot fiscal, ventas acreditadas sin pago histórico y secretos legacy pendientes de volver a guardar;
5. ejecutar smoke en staging/producción para POS, nota parcial/total, caja, banco, Catering, inventario, producción, reservas y RRHH;
6. decidir la política contractual de comisiones/reembolsos de cada canal externo; no se inventó una regla contable sin evidencia del proveedor;
7. optimizar el chunk de `react-pdf` si el tiempo de carga real lo exige.

Hasta cumplir esos puntos, el estado correcto es: **árbol local validado; despliegue productivo pendiente**.

## 8. Integridad del trabajo

- El informe original de Grok se conservó sin sobrescribir.
- No se hizo commit, push, despliegue ni mutación de la base productiva.
- El árbol ya estaba ampliamente modificado; no se descartó ni se reseteó trabajo preexistente.
- Las nuevas migraciones y los datos legacy usan políticas aditivas/fail-closed; no inventan importes ni fechas cuando falta evidencia durable.
