# Mia Pitza API

API TypeScript/Express con Prisma y MySQL para el sistema multiempresa Mia
Pitza. Incluye autenticación y RBAC, empresas y sucursales, menú y marcas,
compras, inventario, unidades de medida, producción, promociones, órdenes,
cocina, POS y pagos, caja, facturación, reservaciones, delivery, catering y
reportes.

## Requisitos y configuración

- Node.js 20 o superior.
- MySQL accesible mediante `DATABASE_URL`.
- `JWT_SECRET` propio y no predecible.
- En producción: `TWO_FA_ENCRYPTION_KEY` hexadecimal de 64 caracteres y
  `CLIENT_URL` con los orígenes autorizados.

Copie `.env.example` a `.env` y complete los valores. El proceso valida la
configuración y se niega a iniciar si falta un secreto requerido o se conserva
un valor débil conocido.

```bash
npm install
npm run dev
```

La API escucha en el puerto definido por `PORT` (3000 por defecto). La ruta
`/health` es liveness sin base de datos; `/api/v1/health` comprueba readiness de
la base. La documentación OpenAPI está en `/api/docs` y en producción permanece
deshabilitada si no se configura `DOCS_PASSWORD`.

## Base de datos

En producción aplique únicamente migraciones versionadas:

```bash
npx prisma migrate deploy
npm run seed:base
```

El seed no contiene una contraseña predeterminada. Si se necesita crear el
superadministrador inicial, use una contraseña fuerte mediante la variable
documentada por el propio script y custódiela fuera de logs y repositorios.

Hay comandos explícitos para backup, restauración, ensayo de migraciones y
verificación del baseline en `package.json`. No use `prisma db push` para
desplegar producción.

## Verificación obligatoria

```bash
npm run lint
npm run typecheck
npm run test:unit -- --runInBand
npm run test:integration
npm run build
npm audit --omit=dev
```

Las pruebas de integración necesitan una base cuyo nombre termine en `_test`;
la protección del arnés rechaza por diseño cualquier destino que no sea de
pruebas.

## Seguridad operativa

- No hay usuarios ni contraseñas de demostración válidos para producción.
- Todas las operaciones de negocio deben conservar `companyId` y, cuando
  corresponde, `branchId` en su ámbito transaccional.
- Use `X-Idempotency-Key` para reintentos mutables desde clientes e
  integraciones.
- Los uploads, backups e integraciones contienen datos privados; configure
  almacenamiento persistente, cifrado, retención y permisos antes del go-live.

El alcance certificado, las invariantes, contraflujos, limitaciones y gates de
salida se mantienen en `../docs/CERTIFICACION_TRANSACCIONAL_E2E_2026-07-13.md`.
