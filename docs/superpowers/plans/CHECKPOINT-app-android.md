# Punto de control — App Android

> Leer esto primero para retomar. Actualizado: 2026-11-21 (Fase 5a NPS cerrada; APK de prueba compila).

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

## Fase 3 (Cocina / KDS) — ✅ código terminado y revisado (2026-11-20)
- Plan: `docs/superpowers/plans/2026-11-21-app-android-fase-3-cocina.md`. Bitácora con decisiones R1–R16: `.superpowers/sdd/2026-11-21-app-android-fase-3-cocina/progress.md` (no versionada).
- Hecho:
  - **Servidor:**
    - device-login con errores tipados: solo `DEVICE_NOT_ACTIVE` (401) desempareja; `KITCHEN_ACCOUNT_UNAVAILABLE` (403) no; errores de BD → 5xx;
    - una sola sesión por tablet (revoca la anterior y cierra su socket);
    - errores KDS tipados, `GET /orders/kitchen/recent`, `kitchenReadyAt`;
    - `ORDER_READY` sin repetir, pero el aviso al mesero se repara en reintentos.
  - **App:**
    - sesión de cocina resistente (no desempareja ante 401 transitorio, la pantalla no se desmonta al renovar cada 8 h, tope de 2 s entre re-logins, jitter en reconexión);
    - cola en vivo por tanda, sonido también tras cola vacía, ping/vigilancia del socket y refresco de seguridad cada 60 s, nunca "Sin comandas" ante error;
    - Listo con deshacer 5 s → ready → release, reintentos con las mismas claves, se rinde a los 2 min;
    - tablero, avisos en banda fija, recientes (10), indicador de conexión;
    - kiosco: pantalla encendida (keep-awake 5.0.1), lock task / fijar pantalla, salida con pulsación larga de 5 s.
- Revisiones: refutador por tarea; finales Opus (servidor) + Opus y Fable 5.2 (app); una ola por lado, re-revisadas y limpias.
- Pruebas: servidor 201 suites / 1753; cliente `tsc` limpio; app 79 archivos / 650; JS inicial 87 KB gzip. Sin migraciones nuevas.
- Diferidos (gate de dispositivo):
  - compilar `KioskPlugin.java` / `MainActivity` y `npx cap sync android`;
  - turno completo sin web: comanda visible ≤ 2 s, Listo/Deshacer, Wi-Fi apagado/encendido, renovación de 8 h, revocar tablet (desempareja) vs desactivar usuario de cocina (no desempareja);
  - fijar pantalla, sonido sin gesto, diseño a 1280×800 y 1024×600.
- Diferidos de código: menores en la bitácora (R6–R16).
- Uso semanal consumido por la Fase 3: ~3 puntos (46 % → 49 %).

## Fase 4 (Mi cuenta en el celular) — ✅ código terminado y revisado (2026-11-20)
- Plan: `docs/superpowers/plans/2026-11-22-app-android-fase-4-mi-cuenta.md`. Bitácora con decisiones R1–R11: `.superpowers/sdd/2026-11-22-app-android-fase-4-mi-cuenta/progress.md` (no versionada).
- Decisiones del usuario: "Por aprobar" solo ADMIN/SUPERADMIN (R11: también se muestra a admins sin ficha de empleado, porque el servidor les permite decidir); push y "mi NPS" pasan a la Fase 5.
- Hecho:
  - **Servidor:** `GET /hr/benefits/me/loan-policy`, cancelar solicitud de préstamo, `hasPin`/`canUsePin` en `/auth/me`, `GET /hr/me/employee`.
  - **App (pantallas de carga diferida):**
    - sesión con cambio de contraseña obligatorio; el re-login del mismo usuario conserva lo escrito y uno distinto lo borra;
    - inicio con Marcar (todas las acciones disponibles), Solicitar, Pendiente para ti y Mis solicitudes;
    - marcaje con cara y GPS, registro facial e idempotencia con la misma clave y el mismo challenge;
    - Mi horario, Mi nómina (PDF), Mi información y PIN;
    - permisos, horas extra, correcciones (con selector de marcajes de hoy) y cambios de turno;
    - préstamos con cuota en vivo;
    - Por aprobar.
- Revisiones: un refutador por tarea; finales Opus (servidor, limpia) y Opus + Fable 5.2 (app: 1 crítico y 12 importantes, todos corregidos); re-revisión limpia.
- Pruebas: servidor 202 suites / 1768; cliente `tsc` limpio; app 100 archivos / 868; JS inicial 88.8 KB gzip. Sin migraciones nuevas.
- Diferidos (gate de dispositivo): cámara, GPS y diálogos de permisos reales; botón atrás sobre la pantalla bloqueante; diseño en vertical.
- Diferidos de código (detalle en la bitácora):
  - corregir marcajes de días anteriores (falta una ruta propia en el servidor);
  - un POST de borrador de permiso que vence por tiempo puede dejar un borrador huérfano (se puede cancelar);
  - 6 menores de la re-revisión;
  - un botón primario por tarjeta en Pendiente/Por aprobar (decisión visual).
- Uso semanal consumido por la Fase 4: ~4 puntos (49 % → 53 %).

## Fase 5a (Encuesta NPS del cliente) — ✅ código terminado y revisado (2026-11-21)
- Plan: `docs/superpowers/plans/2026-11-23-app-android-fase-5a-nps.md`. Bitácora: `.superpowers/sdd/2026-11-23-app-android-fase-5a-nps/progress.md` (no versionada).
- Decisiones del usuario (a mitad de fase):
  - **4 áreas con estrellas:** Atención de {mesero}, Comida (cocina como equipo), Tiempo de espera, Ambiente y limpieza. No hay "servicio en general".
  - **Ranking mensual de meseros:** mínimo 10 opiniones, promedio bayesiano con m=10; destaca al "Mejor mesero del mes".
  - **Tablero web de decisión:** "de nada sirve si no tengo visibilidad".
- Hecho:
  - **Servidor:**
    - modelo `SurveyResponse`, con una respuesta por orden e idempotente;
    - permiso `surveys.view` (ADMIN/SUPERADMIN);
    - `POST /api/v1/surveys`: el dispositivo se deriva de la sesión PIN y el mesero es `order.userId`;
    - endpoints `summary`, `responses` y `ranking` (ventana por defecto del mes, máximo 366 días) y `me`, que se oculta con menos de 3 respuestas;
    - la encuesta se atribuye a la fecha de cierre de la orden.
  - **App, tablet:**
    - "Pedir opinión" tras cobrar abre una encuesta bloqueada: Atrás bloqueado, 60 s de inactividad, "gracias" y vuelta al PIN;
    - si la red falla, la respuesta va a la cola;
    - las encuestas en cola no caducan, nadie puede descartarlas y se eliminan solas si el servidor las rechaza definitivamente.
  - **App, celular:** tarjeta "Mi servicio" con atención, NPS y puesto en el ranking.
  - **Web:** página "Encuestas NPS" con:
    - KPIs, tendencia semanal y promedios por área;
    - mejor mesero del mes y ranking;
    - comparación entre sucursales;
    - alertas de detractores con teléfono y tabla de respuestas.
- Revisiones: un refutador por tarea; finales Opus (todo) + Fable 5.2 (app y web), que encontraron 1 crítico: la ruta `/surveys` en vez de `/v1/surveys`. Hubo una ola de correcciones y una re-revisión; ya está corregido.
- Pruebas: servidor 206 suites / 1829; cliente `tsc` + 97 archivos / 479; app 103 archivos / 914; JS inicial 89.9 KB gzip.
- Migración nueva `20261123_customer_survey`.
- Diferidos (gate de dispositivo):
  - encuesta real contra una orden pagada por Wi-Fi;
  - botón Atrás físico;
  - inactividad mientras se escribe con el teclado;
  - diseño a 1280×800 y 1024×600.
- Diferidos de código (en la bitácora): zona horaria única del ranking (falta zona horaria de empresa), KPI de cobertura de encuestas, "Mi servicio" con NPS oculto bajo 3.
- Uso semanal consumido por la Fase 5a: ~1 punto (53 % → 54 %).

## Entorno de prueba en dispositivo (2026-11-21)
- **Android Studio 2026.2.2 y JDK 17:** Android Studio está instalado y su SDK configurado. Microsoft OpenJDK 17 se instaló porque el Java 25 de Android Studio no sirve para Gradle 8.2.1. Hay que compilar con `JAVA_HOME` apuntando al JDK 17.
- **Compilar el APK de prueba contra esta PC:** `VITE_API_URL=http://192.168.1.4:3000/api npm run build`, luego `CAP_LAN_DEV=1 npx cap sync android` y `./gradlew assembleDebug`. Solo el APK debug permite http; el release no.
- **Servidor:** configuración `api-lan-mobile` en `.claude/launch.json`, con `CLIENT_URL` que incluye `https://localhost`.
- **Migraciones:** las 4 nuevas (`20261120`…`20261123`) se ensayaron en la copia `miapitza_costeo_restore_test` sin errores ni diferencias de esquema, y se aplicaron a la base de prueba `miapitza_costeo_20261119`.
- **Pendiente:** instalar el APK en la tablet o el celular por USB (`adb install`), emparejar el dispositivo desde la web y hacer los gates de dispositivo de las Fases 0–5a. La base de prueba no tiene órdenes pagadas.

## Fase 5b (Inventario: conteo ciego + aprobación) — ✅ código terminado y revisado (2026-11-21)
- Plan: `docs/superpowers/plans/2026-11-24-app-android-fase-5b-inventario.md` (decisiones del controlador al final). Bitácora con rulings R1–R15: `.superpowers/sdd/2026-11-24-app-android-fase-5b-inventario/progress.md` (no versionada).
- Commits: a0f396d (plan) → c29591d, 103392b, 1e00f5d, ba62c04 (servidor) · 3fe48f2, ed03e27, f9494c7, 9ba73cd, 15dd2b5, 42b73a2 (app) · 2185069 (web) · ola final bcd8590, d09e414, 7e92eb2, fc83964, eaf6a5e, 78c3e7d, 96c2c6f.
- Clave: aprobar aplica Δ = contado − existencia al contar (sobre la existencia actual), transacción READ COMMITTED, faltantes pueden dejar existencia negativa; el conteo físico web se bloquea (409 COUNT_SHEET_OPEN) con hoja abierta; el admin puede cancelar un borrador; la app envía la edad del conteo (`X-Counted-Age-Ms`), no la hora del dispositivo; la cola es de referencia contada (abrir Inventario desde Mesas ya no la detiene).
- Revisiones: tarea por tarea + refutador en T3/T6 (encontraron 1 crítico y 8 importantes, todos corregidos); final Opus + Fable (4 importantes, corregidos en una ola; re-revisión limpia).
- Pruebas: servidor 210 suites / 1909; web 99 / 494; app 109 / 1004; JS inicial 90 KB gzip.
- Migración `20261124_inventory_count_sheet`: ensayada en `miapitza_costeo_restore_test` sin drift (solo `face_templates` preexistente) y aplicada a la BD de prueba local.
- **Checklist de despliegue:** MySQL `binlog_format` debe ser ROW o MIXED (la aprobación usa READ COMMITTED); local = MIXED.
- Verificado en vivo (API local): iniciar hoja, hoja ciega sin existencias, guardar 4 líneas, enviar (4 contados / 1 sin contar). Hoja #1 SUBMITTED en BOD Bamboo queda para probar la revisión web.
- Pendiente de verificación manual: revisión visual de `/inventario/conteos` (aprobar/reconteo/cancelar) y la pantalla de conteo en tablet/emulador a ~360 dp. Usuario de prueba `bodega1` (Luis Ramírez) con PIN en `server/.env.local` (`LOCAL_TEST_BODEGA_PIN`).
- Menores diferidos N1–N3 y enlace al Kardex: ✅ corregidos (2026-11-22): indicador neutro «Se conservó un valor más reciente», una pérdida real reemplaza al aviso neutro, aviso «este conteo ya fue cerrado» si la hoja no es borrador, y el enlace del movimiento abre el Kardex con producto, bodega y fecha de aprobación. Pruebas: client 498, mobile 1007.

## Siguiente
- Prueba en emulador 2026-11-22: conteo ciego completo (iniciar → contar → enviar → aprobar → Aprobado) OK. Encontrado y corregido (0303e17): `FOR SHARE` no existe en MariaDB → `LOCK IN SHARE MODE` (fallaba aprobar y movimientos de inventario en MariaDB). Confirmar si producción es MySQL 8 o MariaDB.
- Prueba Mesero+Caja en emulador tablet 1280x800dp (2026-11-22): abrir mesa → pedido → cocina → cobrar efectivo con apertura de turno → factura FAC-1-000009 → liberar mesa OK. Corregido: área vacía por defecto, nombres de mesa cortados, plurales. Pendiente: en teléfono (411dp alto) el ticket del pedido queda aplastado (Modo Mesero es para tablet); ANR al tocar durante el arranque en emulador con GPU por software (vigilar en tablet real Android 9).
- Mi cuenta en emulador (modo Personal, admin con empleado 4) OK: Marcar, Mi horario, Mi nómina. Cocina NO probada: el registro de tablet de cocina falló porque `cocina1` estaba INACTIVE en la BD de prueba (activado 2026-11-22); la app ahora muestra el motivo del servidor (97fd5d3). Pendiente UX: el registro pide 'Sucursal (ID)' y 'Usuario de cocina (ID)' numéricos → cambiar a selector. El emulador quedó sin registrar (pantalla de tipo de dispositivo).
- Tablet en emulador: `adb shell wm size 2560x1600; adb shell wm density 320` (reset: `wm size reset; wm density reset`).
- Emulador estable: `-no-snapshot-load -gpu swiftshader_indirect`; forzar horizontal con `settings put system user_rotation 1`.
- Gates de dispositivo (Fases 0–5b): tablet de servicio, cocina, Mi cuenta, inventario.
- Fase 5c (Push/FCM): necesita que el usuario cree un proyecto de Firebase.
- Emulador: AVD `Medium_Phone_API_37.0`; a veces la ventana queda fuera de pantalla o la imagen en negro (problema de video del emulador).

## Reglas para la Fase 2 (de las revisiones)
- Toda acción de la Fase 2 se protege con `can()`/`canAny()` desde el inicio.
- Fase 3: la tablet de cocina no debe desemparejarse ante cualquier 401 del servidor; evitar sesiones duplicadas en re-login.
- Fase 4: manejar `mustChangePassword`/`passwordExpired` en el celular; la pantalla de PIN envía `currentPassword`.
- Fase 5/6: jitter en reconexión, fallar el build sin `VITE_API_URL`, `npm audit`, quitar paquetes Capacitor sin uso, selectores en la configuración de dispositivo (hoy se escriben IDs), aviso visible ante fallo de almacenamiento seguro.

## Cómo retomar
1. `git checkout feat/app-android`
2. Pedir a Claude: "retoma la app Android desde el punto de control".
3. Claude lee este archivo y la bitácora, y continúa con la siguiente tarea pendiente.

## 2026-11-22 — Selectores de registro y prueba de Cocina (KDS)

- a5143a0: `GET /v1/operational-devices/setup-options` + selectores Sucursal / Usuario de cocina en la app (reemplazan los campos de ID). Register rechaza sucursales inactivas; 401/403 al cargar opciones vuelve al login. Revisado por refutador (Fable): 1 Important + 6 Minor, todos corregidos.
- 51f551c: ticket del mesero usable en pantallas bajas (lista min 140px, panel con scroll y pie fijo bajo max-height 480px).
- 1432bfb: Cocina muestra mesas con nombre tal cual («FDC», no «MFDC»); selects con el estilo de los inputs (48px).
- Emulador: registro de tablet de cocina con selectores OK; KDS muestra la comanda, Iniciar → Listo → «Sin comandas», Recientes (1). Emulador queda registrado como tablet de servicio «Servicio 1».
- Pendiente: 5c Push/FCM (archivos de Firebase), pruebas en hardware real (Android 9), motor de BD de producción y binlog.

## 2026-11-22 (tarde) — Alineación al mockup + revisión funcional

- Mockups de diseño (20-nov) recuperados del transcript a `scratchpad/mock/` (HTML + PNG renderizados con Edge headless). Auditoría Opus: 92 diferencias.
- Commits: 485acd3 (tema monocromo, botones, selección, seg, Tabler icons 3.52.0), 8c59c5c (todas las pantallas), 523578f (nombre de sucursal vía device-roster/device-login), f087cfe (correcciones funcionales + visual ronda 1), 18f4270 (plano en px con ResizeObserver — container units colapsaban el plano en el WebView; PIN arriba), + ronda 2 (total estable con IVA de la empresa, KDS altura/sonido, Mi cuenta).
- Revisión funcional (Opus/Fable): 0 Critical; Importantes corregidos (filtro Por cobrar, roster PIN, Listo colgado, overflow KDS). M-6 (cerrar turno con mesas sin cobrar) queda como decisión de producto (falta API de conteo).
- Revisión visual por capturas del emulador (Fable x2): los High corregidos y verificados en emulador (barra de estado oscura, nombres uniformes, total C$ 667 antes y después de enviar, plano arriba).
- Lección: las pruebas jsdom no detectan layout; verificar SIEMPRE en el emulador. Evitar container query units y `align-content` en bloques (Chrome nuevo lo aplica).
- KDS: umbrales vienen del servidor (kds_warning_minutes=3, kds_urgent_minutes=10 por defecto) — ajustar en configuración web si se desea.
- Pendiente: 5c Push/FCM (archivos Firebase), hardware real Android 9 (WebView viejo: aspect-ratio/cq no soportados — el plano ya usa px), M-6.
