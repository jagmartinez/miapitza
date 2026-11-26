# Revisión de deuda técnica: factura, pago y ocupación de mesas

Fecha: 27 de julio de 2026.

Estado: corrección implementada y validada localmente. No desplegada.

## Conclusión

La falla no era solamente visual. La política central trataba la emisión de la
factura como cierre de la cuenta de mesa. Esa premisa era incorrecta y se había
propagado por servidor, cliente, grupos físicos, consultas activas, mensajes y
pruebas.

La regla autoritativa queda así:

> La factura vuelve inmutable la venta fiscal. El pago total extingue la deuda y
> libera la mesa. Una orden impaga o parcialmente pagada conserva la mesa. La
> reversión del pago reabre la deuda y vuelve a ocuparla. Una cancelación válida
> puede liberar la mesa por su propio contraflujo.

## Corrección estructural

- Se eliminó la factura como predicado de liberación.
- La ocupación se deriva de estado de orden más `financialStatus`.
- `OPEN`, `SENT_TO_KITCHEN`, `IN_PREPARATION`, `READY` y `DELIVERED` conservan
  la mesa mientras no estén `PAID`.
- La conciliación de mesa y de grupo usa la misma política.
- La emisión idempotente de factura concilia, pero no libera.
- El pago total concilia y libera dentro de la misma transacción.
- La reversión del pago concilia y vuelve a ocupar.
- El POS conserva la cuenta facturada, bloquea su edición y limpia el contexto
  únicamente después de confirmar el pago total.
- Las cuentas entregadas cuyo pago fue revertido siguen recuperables desde POS.
- Los cambios manuales, eliminación y consolidación de mesas ya no pueden
  ignorar deuda entregada.

## Reparación de datos

La migración `20260727_hold_unpaid_table_accounts` es deliberadamente
unidireccional:

- cambia a `OCCUPIED` solo mesas `AVAILABLE` con cuentas `UNPAID` o `PARTIAL`;
- no libera ninguna mesa;
- no mezcla ni reescribe facturas;
- no reconstruye grupos físicos históricos por inferencia.

El auditor productivo falla si encuentra una cuenta pendiente sobre una mesa
disponible y entrega una muestra de IDs técnicos sin datos de clientes.

## Evidencia productiva de solo lectura

La auditoría contra Railway encontró:

- 4 cuentas `READY` + `UNPAID` + factura `ISSUED`;
- 2 mesas afectadas: IDs 5 y 11;
- órdenes afectadas: 37, 38, 39 y 40;
- ninguna tiene grupo físico activo;
- 0 deriva de estado financiero;
- 0 inventario negativo;
- 0 totales de orden negativos;
- 0 pagos activos no positivos;
- 0 órdenes pagadas sin ítems;
- la migración correctiva aún no está aplicada.

Los cuatro registros confirman la causa: al liberar la mesa al facturar se
permitió abrir una segunda cuenta sobre la misma mesa. El nuevo código impide
repetirlo. Tras migrar, el POS recuperará las cuentas antiguas una por una, en
orden de creación, sin fusionar documentos fiscales.

## Validación

- Cliente: 74 archivos, 338 pruebas aprobadas.
- Servidor: 145 suites, 907 pruebas aprobadas.
- Integración MySQL migrada: 11 pruebas aprobadas.
- Ledger desechable: 60/60 migraciones aplicadas, 19 invariantes aprobados.
- TypeScript cliente y servidor: aprobado.
- Build de producción cliente y servidor: aprobado.
- `git diff --check`: aprobado.

La integración cubre:

1. factura impaga conserva `OCCUPIED`;
2. la cuenta facturada sigue visible;
3. pago total cambia a `AVAILABLE`;
4. reversión cambia a `OCCUPIED`;
5. nuevo pago cambia a `AVAILABLE`;
6. pago, entrega y reversión conservan inventario y estado operativo;
7. deuda entregada se recupera desde POS;
8. una entrega antigua no libera una cuenta nueva;
9. cancelación válida libera sin dejar estado huérfano;
10. el cierre de caja reconcilia las ventas resultantes.

## Riesgo residual y decisión

La corrección tiene GO técnico para un release controlado, no para declarar
producción ya corregida. Antes del GO operativo faltan:

1. construir un artefacto limpio que no mezcle cambios ajenos del árbol sucio;
2. confirmar el alcance exacto que se versionará;
3. desplegar la migración y la aplicación en el orden controlado;
4. verificar que el auditor productivo pase con 60 migraciones y cero cuentas
   pendientes sobre mesas disponibles;
5. ejecutar smoke remoto de factura impaga, pago total y reversión.

No hubo commit, push, migración productiva ni despliegue durante esta revisión.
