# Proveedor biometrico facial autoalojado

## Decision y alcance

La plataforma integra un microservicio reutilizable que hace enrolamiento y verificacion facial 1:1. No implementa identificacion 1:N, vigilancia, reconocimiento continuo ni decisiones laborales automaticas. Una falla o resultado incierto conserva el marcaje en revision y la alternativa manual supervisada.

## Flujo transaccional

1. La API principal crea un reto de cinco minutos y deriva en servidor `TURN_LEFT` o `TURN_RIGHT` desde su nonce.
2. El navegador ejecuta una prueba guiada de seis cuadros: cuenta regresiva frontal, captura de referencia, aviso visible `AHORA GIRA`, tres segundos para obedecer y cinco cuadros con progreso visible mientras la persona mantiene el giro. Los cuadros existen solo en memoria.
3. La API consume el reto una sola vez y envia evidencia, empresa, persona y politica al proveedor por HTTPS autenticado.
4. El proveedor valida formato, una sola cara, calidad, identidad constante, prueba activa y anti-spoofing pasivo.
5. En enrolamiento cifra el embedding y devuelve una referencia UUID opaca. La API principal cifra de nuevo esa referencia antes de guardarla.
6. En marcaje carga la plantilla por empresa/persona y compara exclusivamente 1:1.
7. Al revocar o reenrolar, la API registra primero el cambio y una solicitud durable de purga; el proveedor acepta revocaciones repetidas.

El proveedor no revoca la plantilla previa al crear una nueva. Esa compensacion ocurre despues del commit de la API principal, evitando que una falla intermedia destruya el enrolamiento vigente.

La interfaz distingue deliberadamente **captura** de **validacion**: el punto rojo y el contador confirman que el telefono esta tomando cuadros; solo la respuesta del proveedor, despues del consentimiento y la confirmacion, puede afirmar que el giro correcto fue detectado. Si detecta movimiento hacia el lado opuesto devuelve un error especifico para repetir siguiendo la flecha.

## Invariantes de seguridad

- TLS y Bearer de al menos 256 bits en produccion; dos tokens simultaneos permiten rotacion sin corte.
- Claves distintas para AES-256-GCM y HMAC de identificadores.
- Base MySQL o PostgreSQL compartida en produccion; SQLite solo para una instancia local.
- La version inicial crea su tabla al arrancar y valida todas las columnas; una base antigua o incompleta falla cerrada. Toda evolucion posterior debe desplegar una migracion explicita antes de subir replicas nuevas.
- Cuerpos, cuadros, dimensiones, cantidad de rostros, concurrencia y tiempos limitados.
- Modelos fijados por commit y SHA-256; el contenedor falla al arrancar si falta o cambia un artefacto.
- Sin CORS, documentacion deshabilitada en produccion, respuestas `no-store` y logs estructurados sin datos biometricos.
- La referencia filtrada no cruza empresas ni personas porque carga y revocacion vuelven a comprobar ambos HMAC.

## Contraflujos

| Flujo | Contraflujo | Resultado esperado |
|---|---|---|
| Enrolar | Misma solicitud/reto repetido | Devuelve la misma referencia, sin plantilla duplicada |
| Reenrolar | Falla antes del commit principal | La plantilla anterior sigue utilizable; la nueva se compensa por revocacion |
| Reenrolar | Commit confirmado | La cola durable purga la referencia anterior |
| Verificar | No coincide | HTTP 200 con `matched=false`; no se confunde con caida tecnica |
| Evidencia | Foto/pantalla, giro incorrecto, varias caras o baja calidad | HTTP 422 con codigo corregible y un reto nuevo |
| Proveedor | Modelo/base no disponibles | HTTP 503; marcaje a revision/fallback segun politica |
| Revocar | Repeticion o plantilla ya ausente | HTTP 200 idempotente; la cola puede cerrar el trabajo |
| Retencion | Plantilla expirada | Se invalida y exige reenrolamiento |

## Limites y liberacion

La prueba RGB reduce ataques comunes pero no equivale a sensor de profundidad ni elimina deepfakes o presentaciones sofisticadas. Antes de declarar uso general se debe ejecutar una prueba local representativa por tipo de telefono, iluminacion, tono de piel, lentes y condiciones de sucursal; medir falsos rechazos y falsas aceptaciones; ajustar umbrales versionados; y mantener revision humana.

La liberacion requiere pruebas unitarias/contrato, prueba real de modelos, carga con concurrencia esperada, simulacion de base caida, revocacion/reintento y smoke E2E desde un telefono real.
