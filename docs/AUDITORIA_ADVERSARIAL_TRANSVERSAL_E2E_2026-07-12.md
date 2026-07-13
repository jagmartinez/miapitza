# Auditoría adversarial transversal end-to-end

**Proyecto:** Restaurant System / Miapitza
**Fecha de corte:** 2026-07-12
**Tipo de revisión:** tercera pasada independiente, orientada a límites entre módulos, contraflujos, concurrencia, tenant, contratos cliente/API y reconocimiento contable
**Estado del árbol auditado:** candidato local; no desplegado por esta pasada

## 1. Dictamen

### Código: GO

El candidato local supera la compuerta técnica consolidada:

- servidor: 46 suites y 228/228 pruebas unitarias;
- integración MySQL: 9 suites y 35/35 pruebas;
- cliente: 12 archivos y 40/40 pruebas Vitest;
- navegador: 8/8 pruebas Playwright;
- TypeScript, ESLint, builds productivos y `git diff --check`: aprobados.

La pasada encontró defectos reales que no eran visibles revisando pantallas o servicios aislados. Fueron corregidos y cubiertos con regresiones. El código resultante es apto para un despliegue controlado.

### Despliegue inmediato: NO-GO hasta cerrar la lista operativa

Este dictamen no autoriza desplegar automáticamente. Antes de reemplazar la versión productiva deben cumplirse estos puntos:

1. crear un nuevo backup lógico y verificar restauración con el estado productivo inmediatamente anterior al despliegue;
2. revisar manualmente las seis órdenes históricas ambiguas con pagos positivos: IDs `3`, `6`, `10`, `15`, `19`, `23`;
3. aprobar y ejecutar el despliegue controlado de API y cliente;
4. ejecutar smoke post-despliegue de autenticación, POS, pago, factura, caja, cocina, reportes y WebSocket;
5. comprobar persistencia real de archivos a través de un reinicio adicional del servicio; esa prueba fue bloqueada anteriormente por falta de autorización para reiniciar;
6. definir respaldo externo periódico: los backups generados por la API y los uploads residen en el mismo volumen persistente y no sustituyen una copia offsite.

## 2. Enfoque de esta pasada

La revisión anterior validó módulos y ciclos operativos. Esta pasada cambió deliberadamente el ángulo:

1. **Red-team transaccional:** intentar saltar los flujos dedicados, competir operaciones simultáneas y alterar documentos después de movimientos financieros.
2. **Red-team de seguridad:** buscar escalación de privilegios, confianza en claims obsoletos, IDOR entre sucursales, mass assignment, replay y carreras en 2FA.
3. **Red-team cliente/API:** comparar cada acción visible con el rol, precondición y respuesta reales del servidor; revisar offline, blobs, reintentos, fechas y folios.
4. **Reconciliación contable y temporal:** comprobar qué fecha reconoce una venta, qué estados entran en reportes, cómo se tratan reversos y qué zona horaria define el día del negocio.

No se consideró suficiente que una acción “funcionara”. Cada flujo se contrastó contra su cancelación, reverso, concurrencia, aislamiento y reflejo en reportes.

## 3. Hallazgos críticos y correcciones

### 3.1 Órdenes, pagos, inventario y cocina

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| `PATCH status=CANCELLED` podía omitir el flujo dedicado | Cancelación sin reversar inventario, promoción, pagos, mesa ni auditoría | Se rechaza la transición genérica y se exige el endpoint de cancelación | Regresión HTTP y prueba transaccional |
| Era posible cambiar líneas, precios o descuentos con abonos activos | Total de orden distinto del saldo pagado | Bloqueo de orden, relectura dentro de transacción y congelación financiera | Pruebas de abono parcial y mutación |
| `complete()` utilizaba estado leído fuera de la transacción | Carrera con reverso/cancelación | Lock y relectura autoritativa dentro de la misma transacción | Integración POS y regresión transaccional |
| Eliminar una línea ya enviada a cocina podía borrar historia operativa | KDS e inventario incoherentes | Se impide eliminar líneas enviadas; una línea nueva devuelve la orden a estado operativo compatible | Pruebas de órdenes/cocina |
| Liberar una mesa al completar/cancelar ignoraba otras órdenes activas | Mesa marcada libre con consumo abierto | La liberación comprueba otras órdenes activas de la mesa | Integración POS |
| Un pago efectivo podía registrarse mientras el turno cerraba | Movimiento posterior al cierre de caja | Lock de `CashShift` y revalidación de turno abierto en la transacción de pago | Regresión de carrera caja/pago |
| Reversar varios consumos usaba el costo del último `OUT` para toda la cantidad | Distorsión de valoración y COGS | Restauración por valor ponderado pendiente y metadatos/layers correspondientes | Prueba de consumos múltiples |
| El estado `DELIVERED` desaparecía de reportes que solo contaban `PAID` | Ventas reales omitidas | Predicado financiero unificado: `PAID` o `DELIVERED` con `closedAt` no nulo | Unitarias e integración |
| El botón KDS “Todo listo” se mostraba a roles que el endpoint rechazaba | Flujo visible imposible | Contrato de roles alineado entre cliente y API | E2E de contratos |

### 3.2 Caja, factura y conciliación

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| Caja sumaba ventas brutas sin descontar `REV-PAY` | Arqueo sobrestimado después de devolución | Totales netos; se exponen bruto y devoluciones por separado | Unitarias transaccionales |
| Conciliación bancaria contaba pagos revertidos | Depósitos y ventas conciliadas infladas | Filtro obligatorio `Payment.status = ACTIVE` | Prueba de conciliación |
| Números no finitos podían atravesar el validador compartido | `Infinity`/`-Infinity` en cálculos o persistencia | `Number.isFinite` en el middleware común | 5 regresiones numéricas |
| POS bloqueaba tarjeta sin turno, pero el servidor solo exige turno para efectivo | Falso bloqueo operacional | Reglas de acceso por método de pago alineadas | Vitest y E2E |
| Se podía intentar efectivo con turno vencido o de otra sucursal | Caja incorrecta | El modal valida vigencia, usuario/sucursal y método | Pruebas de contrato |
| Parciales podían editarse o reintentarse inconsistentemente | Cobro duplicado o total cambiante | Congelación del parcial e idempotencia de reintentos offline | Vitest de acceso/offline |
| Órdenes imprimía HTML con un folio ficticio | Documento no fiscal presentado como factura | Reimpresión solo desde factura oficial emitida por API | E2E/contrato cliente |
| Historial inventaba números antes de emisión | Folios no autoritativos | Solo muestra `invoiceNumber` oficial | Build y pruebas cliente |

### 3.3 Catering, reservaciones y split bill

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| Catering permitía cambiar conceptos/totales con pagos activos | Saldo pagado diferente del contrato | Líneas financieras congeladas hasta revertir pagos | Regresión transaccional |
| Pagos de catering aceptaban precisión/valores inseguros | Diferencias de centavos o números inválidos | Validación finita y normalización a centavos | Unitarias e integración |
| Delete de catering y reservación tenía ventana TOCTOU | Borrado después de cambio concurrente | Lock y relectura del estado antes de borrar | Regresiones TOCTOU |
| Split por artículos aceptaba duplicados, omisiones o IDs ajenos | División que no reconcilia con la orden | Asignación exacta, única y completa; montos finitos y a centavos | Pruebas de split bill |
| Admin global no podía crear reservación/caja sin sucursal implícita | Flujo empresarial bloqueado | Selectores de sucursal explícitos | E2E de contratos |

### 3.4 Compras, producción, UOM y reportes

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| Tendencias de compras incluían borradores y órdenes emitidas | Gasto reportado antes de recepción | “Compras por día/mes” cuenta solo `RECEIVED` | Regresión de estado de compra |
| Reportes financieros filtraban por apertura de orden (`createdAt`) | Orden cruzando medianoche reconocida en el día equivocado | Ventas y agrupaciones financieras usan `closedAt` | Regresión de venta cruzando medianoche |
| Filtros `YYYY-MM-DD` se interpretaban como UTC | En Managua el día se desplazaba seis horas | Conversión de límites según `Setting.timezone` del tenant | Pruebas Managua y DST |
| Agrupaciones diarias/mensuales/horarias dependían del timezone del contenedor | Totales diferentes local vs producción | Utilidad zonal independiente del host | 4 pruebas de timezone |
| Comparación mensual usaba el mes previo al “ahora”, no al mes B solicitado | Comparación contra periodo incorrecto | Mes A por defecto se deriva de mes B | Regresión de comparación |
| Análisis por día colisionaba semanas de meses distintos | Promedio diario incorrecto | Denominador por fecha local distinta | Regresión julio/agosto |
| Dashboard de producción agrupaba `finishedAt` en UTC | Producción nocturna asignada a otro día | Agrupación según timezone empresarial | Build/tipos y utilidad zonal |
| Cliente usaba `toISOString()` en inputs locales | Fecha avanzaba después de las 18:00 en Nicaragua | Helper local `dateInput` en formularios/reportes afectados | Vitest y E2E |
| Valores de moneda/UOM estaban hardcodeados en varias vistas | Presentación distinta a configuración/maestro | Uso de configuración y unidades autoritativas | Lint, tipos, build y pruebas cliente |

### 3.5 Empresas, sucursales, roles y seguridad

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| Una empresa nueva no recibía settings si ya existían settings de otra empresa | Tenant nuevo incompleto | Empresa + defaults en una sola transacción; backfill idempotente por empresa | 4 pruebas de aprovisionamiento |
| Lectura de settings confiaba en prefijo sin exigir `companyId` | Defensa tenant incompleta ante datos anómalos | Filtro por `companyId` y prefijo | Prueba de aislamiento |
| ADMIN podía renombrar un rol asignado a `SUPERADMIN` | Escalación global | Roles privilegiados y renombres protegidos | Red-team seguridad |
| ADMIN podía modificar/desactivar/resetear SUPERADMIN | Toma de control | Guardas de jerarquía autoritativas | Red-team seguridad |
| Claims y sockets podían quedar válidos tras revocación/cambio de empresa/sucursal | Sesión obsoleta con acceso | Revalidación de sesión, usuario, empresa, sucursal y roles; WebSocket cada 30 s | Pruebas de sesión/socket |
| `mustChangePassword` y expiración eran señales de UI | Usuario podía llamar API sin cambiar contraseña | Bloqueo en middleware, salvo endpoints mínimos | Regresión de seguridad |
| Empresa/sucursal inactiva o `allowedBranches` obsoleto no siempre bloqueaba | Acceso fuera del alcance actual | Validación autoritativa en login/request | Suite de seguridad |
| `/2fa/setup` sobrescribía un 2FA activo | Desactivación/reemplazo sin TOTP | Setup bloqueado si ya está activo | Regresión 2FA |
| Recovery code tenía carrera de replay | Dos usos simultáneos posibles | Consumo compare-and-swap atómico | Regresión concurrente |
| Existían IDOR entre sucursales | Lectura/mutación de recursos hermanos | Scope en menú, recetas, imágenes, modificadores, tickets, precios, merma, alertas y auto-compras | `branch-menu-isolation` |
| Webhook PedidosYa revelaba configuración/aceptaba inactiva | Enumeración e ingreso no autorizado | Respuesta no enumerable, config activa obligatoria y rate limit | Pruebas de webhook |
| Upload validaba extensión/nombre, no siempre contenido/propiedad | Archivo malicioso o fuga cross-tenant | Firma binaria y propietario tenant; invoices solo por endpoint scoped | Unitarias de upload |
| Múltiples controladores aceptaban mass assignment | Campos privilegiados alterables | DTO allowlist en recursos maestros y operativos | Suite de seguridad |
| API key no tenía timezone en el contexto y podía operar con empresa inactiva | Reportes incorrectos o acceso de tenant desactivado | Timezone tenant y validación `company.active` en API key | Build TypeScript |

### 3.6 Cliente, offline y canales

| Hallazgo | Riesgo | Corrección aplicada | Evidencia |
|---|---|---|---|
| Una operación offline de pago podía encolarse varias veces | Cobro duplicado al recuperar conexión | Política de single-flight/idempotencia | 7 pruebas offline |
| Respuestas `blob` podían persistirse en cache offline | Corrupción/consumo excesivo | Exclusión de binarios | Vitest |
| PedidosYa mostraba acciones SUPERADMIN a ADMIN | UI ofrecía acciones que API debe negar | Visibilidad alineada con roles | E2E |
| Webhook UI usaba `config.id` en vez de `companyId` | URL inválida | Identificador tenant y origen API configurado | E2E de contrato |
| `VITE_WS_URL` HTTP/HTTPS generaba URL WebSocket inválida | Tiempo real desconectado | Normalización `http→ws`, `https→wss` | Pruebas WebSocket cliente |

## 4. Matriz transaccional revisada

| Flujo principal | Confirmación | Contraflujo | Reconciliación exigida |
|---|---|---|---|
| Compra | recepción | cancelación previa / bloqueo posterior | stock, FIFO, costo, saldo proveedor |
| Producción | finalizar | cancelar producción | inputs, layers, output, costo histórico |
| Venta POS | pagar | reversar pago / cancelar autorizada | orden, inventario, promoción, caja, factura |
| Cocina | enviar/preparar/listo | cancelación de orden/línea permitida | estados de línea y orden |
| Caja | abrir/movimiento/cerrar | movimiento compensatorio, no delete | bruto, reversos, esperado, arqueo |
| Factura | emitir | reverso bloqueado después de folio | secuencia, impuesto, pagos activos |
| Reserva | confirmar/completar | cancelar/no-show/delete restringido | mesa, sucursal, estado concurrente |
| Catering | reservar/pagar/finalizar | reversar pago/cancelar según estado | conceptos, saldo, inventario, COGS |
| Promoción | aplicar al pago | liberar uso al reversar/cancelar | límite, descuento, orden |
| Delivery/PedidosYa | webhook/aceptar | cancelación autoritativa | tenant, branch, external ID, orden |

## 5. Evidencia final reproducible

```text
server npm test                  46 suites / 228 tests PASS
server npm run test:integration  9 suites / 35 tests PASS (MySQL)
server npm run lint              PASS, 0 errores, 0 warnings
server npm run build             PASS (Prisma generate + TypeScript)

client npm test                  12 archivos / 40 tests PASS
client npm run lint              PASS, 0 errores, 0 warnings
client npm run build             PASS
client npm run test:e2e          8/8 PASS (Chromium)

git diff --check                 PASS
```

Total de casos automatizados de la compuerta: **311**.

Los `console.error` observados durante pruebas negativas corresponden a rechazos intencionales verificados (por ejemplo, cancelación genérica, unidad incompatible y 404 cross-tenant); no representan fallos de suite.

## 6. Riesgos residuales y decisiones pendientes

### Obligatorios antes del nuevo deploy

- Nueva copia y restauración ensayada de la base productiva.
- Revisión humana de las seis órdenes históricas ambiguas con pagos positivos.
- Despliegue API + web del candidato que pasó esta compuerta.
- Smoke post-deploy de los flujos críticos y consulta de logs sin 5xx.

### Operación y resiliencia

- **Backup offsite:** el volumen persistente no es una estrategia offsite. Programar copia cifrada a almacenamiento externo, retención y simulacro de recuperación.
- **Persistencia tras reinicio:** el volumen está montado y escribible por UID 1000, pero falta la prueba autorizada de reinicio adicional conservando un archivo marcador/upload.
- **Observabilidad:** `/health` es liveness; `/api/v1/health` verifica DB. Configurar monitoreo de ambos, alertas 5xx, latencia, uso de volumen y fallos de jobs.
- **Rendimiento cliente:** el chunk dinámico `react-pdf` ronda 1.575 MB. No bloquea lógica, pero debe vigilarse en redes lentas.
- **Esquema legacy:** `User.companyId` sigue nullable y username/email siguen globalmente únicos por compatibilidad. La API falla cerrado cuando falta tenant; una migración futura puede endurecer `NOT NULL` después del backfill.

## 7. Procedimiento de liberación recomendado

1. congelar escrituras o definir una ventana breve de mantenimiento;
2. producir backup lógico y checksum;
3. restaurarlo en base temporal y ejecutar verificación/migraciones;
4. resolver o documentar explícitamente las seis órdenes ambiguas;
5. desplegar API;
6. verificar migraciones, `/health`, `/api/v1/health`, storage y logs;
7. desplegar cliente;
8. ejecutar smoke autenticado por sucursal: login/política de contraseña; caja; orden/cocina/pago/factura; reverso controlado; compra/recepción; producción/UOM; reserva/catering; reportes del día en timezone empresarial;
9. confirmar WebSocket y ausencia de 5xx;
10. conservar artefactos, IDs de deployment, checksum y resultados en este documento o su sucesor.

## 8. Base para futuras revisiones

Toda revisión posterior debe responder, por módulo:

1. ¿Cuál es el estado autoritativo y qué actor puede moverlo?
2. ¿Qué filas deben bloquearse antes de decidir?
3. ¿Qué cambia en confirmación?
4. ¿Qué cambia en cancelación/reverso/devolución?
5. ¿Qué ocurre si ambas operaciones compiten?
6. ¿Cómo se reconcilian cantidad, unidad base, costo, caja, pago, factura y reporte?
7. ¿Qué `companyId` y `branchId` limita cada lookup y cada mutación?
8. ¿La UI ofrece exactamente lo que la API permite?
9. ¿El flujo offline conserva idempotencia y propiedad de usuario/tenant?
10. ¿La fecha representa calendario, apertura, cierre, pago o ejecución, y en qué timezone?

La certificación se invalida si cambia cualquiera de estas áreas sin repetir al menos su prueba focal y la compuerta consolidada: estados de orden/pago, inventario/costeo, UOM, caja, factura, roles/tenant, offline/idempotencia, fechas/timezone, migraciones o storage.
