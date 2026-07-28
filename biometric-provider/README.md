# MIA Face Provider

Proveedor facial 1:1 autocontenido para enrolamiento y verificacion con prueba de vida. Es un servicio separado del sistema que lo consume y no expone busqueda 1:N.

## Garantias del contrato

- Recibe de 4 a 6 cuadros en memoria; no persiste fotos ni las incluye en logs.
- Exige exactamente una cara, calidad minima, consistencia de identidad entre cuadros, giro aleatorio y anti-spoofing pasivo.
- Guarda un embedding SFace cifrado con AES-256-GCM; empresa, persona y reto se guardan como HMAC, no en claro.
- Aisla carga y revocacion de cada plantilla por empresa y persona incluso si una referencia opaca se filtra.
- Enrolamiento idempotente por reto, verificacion estrictamente 1:1 y revocacion repetible.
- Un worker interno purga el material cifrado al vencer la retencion, incluso si ningun consumidor vuelve a consultarlo.
- No toma decisiones laborales irreversibles. El sistema consumidor debe conservar revision humana y fallback supervisado.

## Arranque local

1. Copiar `.env.example` a `.env` y generar tres secretos distintos.
2. Instalar dependencias: `python -m pip install -r requirements-dev.txt`.
3. Descargar y verificar modelos: `python scripts/fetch_models.py`.
4. Exportar las variables de `.env` y ejecutar `python -m app`.
5. Comprobar `GET /health`; los endpoints operativos requieren `Authorization: Bearer ...`.

Para Docker: `docker build -t mia-face-provider .` y montar una base compartida MySQL/PostgreSQL mediante `FACE_DATABASE_URL`. SQLite se admite exclusivamente para desarrollo y pruebas de una instancia.

La version 1 crea `face_templates` cuando no existe y valida el contrato de columnas al iniciar. No intenta alterar silenciosamente un esquema anterior: futuras versiones que cambien persistencia deben aplicar primero una migracion SQL versionada y luego desplegar las replicas.

En este repositorio, `docker compose --profile biometrics up --build` levanta el servicio opcional. Configure la API con `HR_FACE_PROVIDER=http`, `HR_FACE_PROVIDER_BASE_URL=http://face-provider:8080` y `HR_FACE_PROVIDER_ALLOW_HTTP_INTERNAL=true`. Esa excepcion sólo admite nombres/IP privados explícitos; fuera de una red interna use HTTPS y mantenga la bandera en `false`.

## Integracion

El consumidor usa:

- `POST /v1/enroll`
- `POST /v1/verify-one-to-one`
- `POST /v1/templates/revoke`
- `GET /health`

Los errores tienen `{ code, message, retryable, requestId }`. Un HTTP 422 describe evidencia corregible; 401 autenticacion; 404/410 plantilla ausente, revocada o expirada; 503 dependencia no disponible.

## Escala y operacion

- Las replicas son stateless y comparten la base de plantillas. Cada worker carga aproximadamente 40 MB de modelos; dimensionar workers segun RAM y CPU.
- `FACE_MAX_CONCURRENCY` limita solicitudes admitidas por worker y `FACE_QUEUE_TIMEOUT_SECONDS` rechaza saturacion con HTTP 503 en vez de crear una cola ilimitada. La escala recomendada es aumentar workers/replicas segun CPU y RAM; el balanceador debe aplicar limites por cliente y TLS.
- Los encabezados de proxy sólo se confian desde `127.0.0.1` por defecto. Configure `FACE_FORWARDED_ALLOW_IPS` con la red exacta del proxy cuando corresponda, nunca `*` en una exposicion publica.
- Se pueden rotar tokens aceptando temporalmente dos valores separados por coma
  en `FACE_AUTH_TOKENS`; el consumidor debe enviar únicamente el token activo.
  En el Compose de la raíz, `HR_FACE_PROVIDER_TOKEN` es el token activo de salida
  y `FACE_AUTH_TOKENS` puede contener `activo,anterior` durante una ventana
  acotada. Retire el anterior al terminar.
- `/metrics` requiere autenticacion y expone conteos/latencias, nunca imagenes, embeddings ni identificadores.
- `/health` falla cerrado si la base de plantillas o el worker de retención no
  están disponibles, y vuelve a `200` sólo después de una purga exitosa. La
  respuesta no expone detalles de la dependencia.
- Los umbrales son configurables, pero deben calibrarse con camaras, iluminacion y poblacion reales antes de ampliar el uso.

`scripts/calibrate_threshold.py` calcula FAR/FRR global y por cohorte desde un CSV
de scores etiquetados, sin tocar producción. El modo normal es únicamente
informativo. Antes de habilitar cámaras reales se debe ejecutar como gate,
declarando los límites y tamaños de muestra aprobados para la operación:

```bash
python scripts/calibrate_threshold.py evidence/scores.csv \
  --gate \
  --threshold "$FACE_MATCH_THRESHOLD" \
  --max-far 0.001 \
  --max-frr <limite-aprobado> \
  --min-genuine <muestras-aprobadas> \
  --min-impostor <muestras-aprobadas> \
  --min-cohort-genuine <muestras-por-camara-o-cohorte> \
  --min-cohort-impostor <muestras-por-camara-o-cohorte> \
  --out evidence/calibration-result.json
```

El comando termina con código 2 si el umbral que se desplegará incumple en el
total o en una sola cohorte. La evidencia separa el umbral sugerido del umbral
evaluado y contiene el SHA-256 del dataset, pero no capturas ni identificadores.
Los valores entre `<...>` deben provenir de una política aprobada; el repositorio
no inventa esos umbrales.

`scripts/load_test.py` ejecuta verificación concurrente contra staging usando
`FACE_LOAD_TEST_TOKEN`; no imprime cuerpos ni respuestas biométricas. Los
archivos temporales de evidencia deben protegerse y eliminarse al finalizar la
prueba según la política de retención aplicable.

## Modelos y licencias

El descargador fija commit y SHA-256 para YuNet, SFace y MiniFAS. Consulte `THIRD_PARTY_NOTICES.md`. Los numeros publicados por los proyectos no sustituyen una validacion local ni garantizan resistencia ante todos los ataques de presentacion RGB.

El CI instala el grafo aislado, ejecuta `pip check`, bloquea vulnerabilidades conocidas con `pip-audit`, verifica los hashes de modelos, aplica Ruff, exige cobertura minima y construye la imagen final. Las actualizaciones de dependencias deben pasar ese mismo gate y la calibracion local antes de liberarse.
