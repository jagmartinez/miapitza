# Punto de control — App Android

> Leer esto primero para retomar. Actualizado: 2026-11-20.

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

## Fase 2 (Modo Mesero) — plan escrito 2026-11-20
- Plan: `docs/superpowers/plans/2026-11-20-app-android-fase-2-mesero.md` (12 tareas: 5 backend, 7 app). Pendiente de aprobación del usuario antes de ejecutar.
- Decisiones del usuario: cobra el **cajero con su PIN**; Fase 2 = **cupón + descuento manual con PIN de supervisor**; promociones automáticas en una fase propia.
- Inventario de API: `.superpowers/sdd/2026-11-20-app-android-fase-2-mesero/api-inventory.md` (no versionado).

## Reglas para la Fase 2 (de las revisiones)
- Toda acción de la Fase 2 se protege con `can()`/`canAny()` desde el inicio.
- Fase 3: la tablet de cocina no debe desemparejarse ante cualquier 401 del servidor; evitar sesiones duplicadas en re-login.
- Fase 4: manejar `mustChangePassword`/`passwordExpired` en el celular; la pantalla de PIN envía `currentPassword`.
- Fase 5/6: jitter en reconexión, fallar el build sin `VITE_API_URL`, `npm audit`, quitar paquetes Capacitor sin uso, selectores en la configuración de dispositivo (hoy se escriben IDs), aviso visible ante fallo de almacenamiento seguro.

## Cómo retomar
1. `git checkout feat/app-android`
2. Pedir a Claude: "retoma la app Android desde el punto de control".
3. Claude lee este archivo y la bitácora, y continúa con la siguiente tarea pendiente.
