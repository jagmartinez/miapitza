# Restaurant Management System - Server

Backend API para el Sistema de Gestión de Restaurante Multisucursal.

## 🚀 Stack Tecnológico

- **Node.js** + **TypeScript**
- **Express.js** - Framework web
- **Prisma** - ORM para MySQL
- **JWT** - Autenticación
- **bcryptjs** - Hash de contraseñas

## 📦 Instalación

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales de MySQL
```

## ⚙️ Configuración

Archivo `.env`:

```env
DATABASE_URL="mysql://root:@localhost:3306/restaurante"
PORT=3001
JWT_SECRET="super_secret_jwt_key_change_"
```

## 🗄️ Base de Datos

```bash
# Generar Prisma Client
npx prisma generate

# Aplicar migraciones (crear tablas)
# Ya se aplicaron manualmente

# Poblar datos iniciales (roles, admin, etc.)
npx tsx prisma/seed.ts

# Crear mesas de ejemplo
npx tsx prisma/create-tables.ts
```

## 🏃 Ejecución

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm run build
npm start
```

El servidor correrá en `http://localhost:3001`

## 📚 API Endpoints

### Auth `/api/auth`

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Registrar usuario | No |
| POST | `/login` | Login | No |

### Users `/api/users`

| Método | Endpoint | Descripción | Roles |
|--------|----------|-------------|-------|
| GET | `/` | Listar usuarios | Todos |
| GET | `/:id` | Ver usuario | Todos |
| PUT | `/:id` | Actualizar usuario | ADMIN, SUPERADMIN |
| DELETE | `/:id` | Eliminar usuario | SUPERADMIN |

### Branches `/api/branches`

| Método | Endpoint | Descripción | Roles |
|--------|----------|-------------|-------|
| GET | `/` | Listar sucursales | Todos |
| GET | `/:id` | Ver sucursal | Todos |
| POST | `/` | Crear sucursal | SUPERADMIN |
| PUT | `/:id` | Actualizar sucursal | ADMIN, SUPERADMIN |
| DELETE | `/:id` | Eliminar sucursal | SUPERADMIN |

### Tables `/api/tables`

| Método | Endpoint | Descripción | Roles |
|--------|----------|-------------|-------|
| GET | `/` | Listar mesas | Todos |
| GET | `/branch/:branchId` | Mesas por sucursal | Todos |
| GET | `/:id` | Ver mesa | Todos |
| POST | `/` | Crear mesa | ADMIN, SUPERADMIN |
| PUT | `/:id` | Actualizar mesa | ADMIN, SUPERADMIN, HOST |
| PATCH | `/:id/status` | Cambiar estado | ADMIN, SUPERADMIN, HOST, MESERO |
| DELETE | `/:id` | Eliminar mesa | ADMIN, SUPERADMIN |

## 🔐 Autenticación

Todas las rutas (excepto `/auth/login` y `/auth/register`) requieren un token JWT.

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

Respuesta:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1...",
    "user": { ... }
  }
}
```

### Usar el Token

```bash
curl http://localhost:3001/api/tables \
  -H "Authorization: Bearer TU_TOKEN_AQUI"
```

## 👥 Usuarios de Prueba

| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | SUPERADMIN |

## 🏗️ Estructura del Proyecto

```
server/
├── src/
│   ├── app.ts                 # Express app
│   ├── controllers/           # Request handlers
│   ├── services/              # Business logic
│   ├── routes/                # API routes
│   ├── middlewares/           # Express middleware
│   └── utils/                 # Utilities
├── prisma/
│   ├── schema.prisma          # Database schema
│   ├── seed.ts                # Initial data
│   └── create-tables.ts       # Sample tables
├── .env                       # Environment variables
├── tsconfig.json              # TypeScript config
└── package.json
```

## 📋 Módulos Implementados

✅ Auth & JWT
✅ Users & Roles
✅ Branches
✅ Tables

## 🔜 Próximos Módulos

- [ ] Reservaciones
- [ ] Menú & Categorías
- [ ] Productos & Recetas
- [ ] Inventario
- [ ] Órdenes (POS)
- [ ] Caja

## 🐛 Troubleshooting

### Error de conexión a MySQL

Verifica que MySQL esté corriendo:
```bash
# Windows
net start MySQL80

# Verificar puerto
netstat -an | findstr 3306
```

### Error en migraciones

Si ya aplicaste las migraciones manualmente:
```bash
npx prisma generate
```

## 📄 Licencia

MIT
