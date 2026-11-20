# Punto de control — App Android

> Leer esto primero para retomar. Actualizado: 2026-11-20 (Fase 2b cerrada).

## Dónde estamos
- Rama: `feat/app-android` (creada desde `codex/rh-nomina-estatutaria` @ 6d548af). No publicada (sin push).
- Diseño aprobado: `docs/superpowers/specs/2026-11-19-app-android-design.md`.
- Plan fases 0–1: `docs/superpowers/plans/2026-11-19-app-android-fases-0-1.md`.
- Bitácora de ejecución (no versionada): `.superpowers/sdd/2026-11-19-app-android-fases-0-1/progress.md` — contiene todas las decisiones ("Ruling") y hallazgos menores diferidos.

## Regla de consumo
Usar hasta el **80 %** del límite semanal. Revisar uso antes de cada tarea; al llegar, detenerse y actualizar este archivo. Reinicio semanal: 2026-11-25.

## Estado de tareas (Fase 1, backend)
| Tarea | Estado |
|---|---|
| 1 Esquema dispositivos + PIN | ✅ hecho y revisado |
| 2 Servicio/rutas de dispositivos (`/api/v1/operational-devices`) | ✅ |
| 3 PIN login | ✅ |
| 4 Login tablet cocina | ✅ |
| 5 WebSocket AUTH | ✅ |
| Revisión final de rama (opus) + oleada de correcciones | ✅ limpia |

Pruebas: `npm run test:unit` 191 suites / 1499 tests en verde; `tsc --noEmit` limpio.

## Estado de tareas (Fase 1, app móvil `mobile/`) — actualizado 2026-11-20
| Tarea | Estado |
|---|---|
| 6 Esqueleto Capacitor + tema oscuro | ✅ (proyecto `android/` generado, minSdk 28) |
| 7 Sesión segura, HTTP y tiempo real | ✅ |
| 8 Configuración de dispositivo, PIN y bloqueo | ✅ |
| 9 Modos por tipo de dispositivo, permisos y orientación | ✅ |
| Revisión final de la capa móvil (opus) + correcciones | ✅ limpia |

Pruebas: `cd mobile && npx vitest run` 89/89; `tsc` limpio; JS inicial 76 KB gzip (límite 250 KB).

## Pendiente para cerrar la Fase 1 (gate)
- Instalar **Android Studio** (JDK + SDK): generar APK y hacer las verificaciones manuales (a)–(d) del Task 9 en la tablet real.
- **Fase 0** (prototipo de rendimiento en la tablet real) — se puede hacer junto con lo anterior.
- Ensayar la migración `20261120_operational_devices_pin` contra MySQL (`db:rehearse-migrations`) — nunca se ejecutó.
- En la tablet: comprobar que el bloqueo de 2 min funcione tras despertar la pantalla.

## Fase 2 (Modo Mesero) — ✅ código terminado y revisado (2026-11-20)
- Plan: `docs/superpowers/plans/2026-11-20-app-android-fase-2-mesero.md` (12 tareas: 5 backend, 7 app). Bitácora con todas las decisiones: `.superpowers/sdd/2026-11-20-app-android-fase-2-mesero/progress.md` (no versionada).
- Decisiones del usuario: cobra el **cajero con su PIN**; Fase 2 = **cupón + descuento manual con PIN de supervisor**; promociones automáticas en una fase propia. Revisión final de la app: Opus + **Fable 5.2 como segunda opinión** (repetir así en fases siguientes).
- Revisiones: refutador por tanda; revisión final backend (opus) + ola de correcciones; revisión final app (opus + fable) + ola + seguimiento. Todo cerrado; menores diferidos en la bitácora.
- Pruebas: servidor 197 suites / 1700; app 53 archivos / 421; `tsc` limpio; JS inicial 84 KB gzip (límite 250).
- Migraciones nuevas sin ensayar en MySQL: `20261121_waiter_mode`, `20261122_discount_authorized_percent` (bloquean `Order`/`OrderItem` al aplicarse → desplegar fuera de horario).
- Pendiente del gate (al final, cuando se instale Android Studio): prueba punta a punta en tablet real (abrir mesa, modificador, enviar, KDS listo, entregar, descuento autorizado, cajero cobra dividido; repetir con Wi-Fi apagado) y revisar diseño a 1280×800 y 1024×600.
- Diferidos relevantes para fases siguientes: imprimir/enviar factura y mosaico "Factura"/⋯ (Fase 2b); `maxDiscountPercent` solo configurable por SQL (falta UI admin); suscriptor de `storage-error` y aviso de listos tras reconexión (Fase 6); tests con BD real (al ensayar migraciones).
- Uso semanal consumido por la Fase 2: ~5 puntos (39 % → 44 %).

## Fase 2b (Caja) — ✅ código terminado y revisado (2026-11-20)
- Plan: `docs/superpowers/plans/2026-11-21-app-android-fase-2b-caja.md`. Bitácora con decisiones R1–R14 y W1–W10: `.superpowers/sdd/2026-11-21-app-android-fase-2b-caja/progress.md` (no versionada).
- Hecho:
  - **Servidor:**
    - errores tipados `CASH_*`;
    - arqueo a ciegas aplicado en el servidor (solo con el turno abierto; incluye resumen, preview, count, detalle, reporte y el mensaje de tolerancia);
    - `exchange_rate_usd`, `GET /cash-shifts/cash-settings`, fondo sugerido y encabezado del reporte;
    - `salesByMethod`, y nota, descuentos y propinas en el reporte (cada uno se cuenta una sola vez);
    - el resumen queda restringido a CASHIERS.
  - **App:**
    - abrir turno (también desde el cobro), turno activo y movimientos;
    - arqueo a ciegas y cierre, con total exacto al centavo como el servidor y forzar cierre solo ADMIN;
    - "Turnos abiertos" para supervisor;
    - reporte, historial y ticket de 48 columnas;
    - compartir el PDF de factura;
    - bloqueo de 10 min mientras se cuenta.
- Revisiones:
  - refutador por tanda;
  - finales: Opus backend, más Opus y Fable 5.2 en la app;
  - una ola de correcciones, re-revisada y limpia.
- Pruebas: servidor 200 suites / 1735 (herméticas, sin BD); cliente `tsc` limpio; app 67 archivos / 546; JS inicial 87 KB gzip.
- Sin migraciones nuevas.
- Diferidos (gate de dispositivo):
  - revisar el diseño a 1280×800 y 1024×600;
  - `npx cap sync android` y compartir por FileProvider;
  - elegir y probar la impresora ESC/POS (hoy `print` es un stub con respaldo de compartir);
  - turno completo en tablet real.
- Diferidos de código:
  - pagos de catering en `salesByMethod`;
  - índice `(registeredById, createdAt)` en Payment;
  - la hoja de compartir sigue abierta sobre el bloqueo;
  - PDF del reporte de cierre.
- Uso semanal consumido por la Fase 2b: ~2 puntos (44 % → 46 %).

## Siguiente
- Fase 3 (Cocina / KDS en tablet fija). Primero escribir su plan (ver "Reglas para la Fase 2": no desemparejar ante cualquier 401, evitar sesiones duplicadas).

## Reglas para la Fase 2 (de las revisiones)
- Toda acción de la Fase 2 se protege con `can()`/`canAny()` desde el inicio.
- Fase 3: la tablet de cocina no debe desemparejarse ante cualquier 401 del servidor; evitar sesiones duplicadas en re-login.
- Fase 4: manejar `mustChangePassword`/`passwordExpired` en el celular; la pantalla de PIN envía `currentPassword`.
- Fase 5/6: jitter en reconexión, fallar el build sin `VITE_API_URL`, `npm audit`, quitar paquetes Capacitor sin uso, selectores en la configuración de dispositivo (hoy se escriben IDs), aviso visible ante fallo de almacenamiento seguro.

## Cómo retomar
1. `git checkout feat/app-android`
2. Pedir a Claude: "retoma la app Android desde el punto de control".
3. Claude lee este archivo y la bitácora, y continúa con la siguiente tarea pendiente.
