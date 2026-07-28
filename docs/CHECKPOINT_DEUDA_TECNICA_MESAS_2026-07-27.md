# Checkpoint: deuda técnica y ciclo factura-pago-mesa

Fecha: 27 de julio de 2026.

Estado: corrección local completada y validada; todavía no desplegada.

No hubo commit, push, despliegue ni escritura en producción. El árbol de trabajo
preexistente se conserva.

## Solicitud activa

1. Revisar si las correcciones recientes son parches o corrigen la lógica de
   dominio.
2. Corregir que una mesa se libere al emitir una factura todavía no pagada.

## Causa raíz confirmada

La liberación prematura no está aislada en la interfaz. La política central
`server/src/services/table-occupancy-policy.ts` declaraba que la emisión fiscal
cerraba la cuenta de mesa. Esa premisa se propagó a:

- conciliación de mesas individuales y grupos;
- consulta de órdenes activas;
- emisión y reintento idempotente de facturas;
- pago y reverso de pago;
- POS, mapa de mesas y pantalla de órdenes;
- mensajes al operador;
- pruebas unitarias e integración MySQL.

La regla de negocio correcta es:

> Emitir la factura congela el documento fiscal, pero no extingue la deuda. La
> mesa permanece ocupada mientras la orden esté impaga o parcialmente pagada.
> Solo el pago total o una cancelación fiscal/operativa válida libera la cuenta.
> Revertir un pago total vuelve a ocupar la mesa.

## Cambios ya aplicados en este checkpoint

- `table-occupancy-policy.ts` dejó de usar la factura como condición de cierre.
- Se agregó el predicado puro `doesOrderHoldTableAccount`.
- Las consultas autoritativas ahora dependen de estado operativo más
  `financialStatus != PAID`.
- `closeInactiveTableGroupForTable` fue renombrado a
  `reconcileTableGroupForTable` para reflejar que también puede ocupar o
  conservar mesas.
- `OrderService.reconcileTableAfterSettlement` fue renombrado a
  `reconcileTableAccount`; se usa tanto al pagar como al revertir.
- Se corrigieron comentarios y motivos de auditoría del servidor.
- Se comenzaron a adaptar las pruebas unitarias de factura, grupos y pagos.

## Trabajo completado al retomar

1. Se corrigió el cliente:
   - eliminado `PosBucketReleaseTracker`;
   - la factura ya no limpia la mesa;
   - la orden facturada se conserva como cuenta pendiente y no editable;
   - el contexto se limpia solo después del pago total confirmado;
   - los mensajes explican que la mesa permanece ocupada.
2. Se actualizaron las expectativas de integración en
   `pos-operational-flow.integration.test.ts`:
   - factura impaga: `OCCUPIED` y orden visible;
   - pago total: `AVAILABLE`;
   - reverso del pago: `OCCUPIED`;
   - nuevo pago total: `AVAILABLE`.
3. Se agregó una migración aditiva que marca `OCCUPIED` las mesas históricas
   `AVAILABLE` con cuentas `UNPAID`/`PARTIAL`, sin liberar automáticamente otras
   mesas ni reconstruir grupos antiguos.
4. Se añadieron invariantes al auditor de producción para detectar cuentas abiertas
   sobre mesas disponibles.
5. Se ejecutaron pruebas focales, typecheck, builds, integración MySQL y suites
   completas.
6. Se auditó producción en modo de solo lectura: existen cuatro cuentas
   afectadas sobre dos mesas. No se escribió ni migró producción.

## Límite de evidencia

La corrección está validada localmente y contra MySQL desechable. Esto no
equivale a despliegue productivo: la migración nueva aún debe pasar por el
proceso controlado de release y por un smoke remoto posterior.
