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

## Pendiente antes de fusionar
- Ensayar la migración `20261120_operational_devices_pin` contra MySQL (`db:rehearse-migrations`) — nunca se ejecutó.
- Re-ejecutar `npx prisma generate` en `server/` cuando no haya un servidor node corriendo (falló por DLL bloqueada).

## Notas para la app móvil (tareas 7–9)
- La pantalla de PIN debe enviar `currentPassword` al configurar el PIN (`PUT /api/auth/me/pin`).
- La tablet de cocina debe repetir `device-login` en silencio con su token guardado al recibir 401 (la sesión dura 8 h).
- Ignorar `mustChangePassword`/`passwordExpired` en respuestas de `device-login`.
- WebSocket: enviar `{type:'AUTH', token}` como primer mensaje en < 5 s.

## Bloqueado por el usuario
- **Fase 0 y tareas 6–9 (app móvil)**: requieren instalar **Android Studio** (JDK + Android SDK) en este equipo y la tablet real para medir rendimiento.

## Cómo retomar
1. `git checkout feat/app-android`
2. Pedir a Claude: "retoma la app Android desde el punto de control".
3. Claude lee este archivo y la bitácora, y continúa con la siguiente tarea pendiente.
