# ✅ WebSocket Implementation - Testing Checklist

**Fecha**: 2025-12-12  
**Sprint**: 1 - Día 1  
**Implementado por**: Antigravity AI

---

## 📋 Resumen de Implementación

### Archivos Creados
- ✅ `server/src/services/websocket.service.ts` - Servicio centralizado de WebSocket

### Archivos Modificados
- ✅ `server/src/app.ts` - Integración de WebSocket con servidor HTTP
- ✅ `server/src/controllers/order.controller.ts` - Notificaciones de órdenes
- ✅ `server/src/controllers/table.controller.ts` - Notificaciones de mesas
- ✅ `server/package.json` - Dependencias `ws` y `@types/ws`

### Funcionalidades Implementadas

#### WebSocket Service
- ✅ Gestión de conexiones de clientes
- ✅ Heartbeat para detectar conexiones muertas (30s)
- ✅ Broadcasting a todos los clientes
- ✅ Envío a cliente específico
- ✅ Generación de IDs únicos
- ✅ Graceful shutdown

#### Eventos Implementados
- ✅ `ORDER_CREATED` - Cuando se crea una orden
- ✅ `ORDER_UPDATE` - Cuando cambia el estado de una orden
- ✅ `ORDER_SENT_TO_KITCHEN` - Cuando se envía orden a cocina
- ✅ `ORDER_READY` - Cuando una orden está lista
- ✅ `ORDER_COMPLETED` - Cuando se completa una orden
- ✅ `ORDER_CANCELLED` - Cuando se cancela una orden
- ✅ `TABLE_STATUS_CHANGED` - Cuando cambia el estado de una mesa
- ✅ `CONNECTED` - Mensaje de bienvenida al conectar
- ✅ `PING/PONG` - Heartbeat

---

## 🧪 Plan de Testing

### 1. Testing Básico de Conexión

#### Test 1.1: Servidor Inicia Correctamente
- [ ] Ejecutar `npm run dev` en servidor
- [ ] Verificar mensaje: `🔌 [websocket]: WebSocket server is ready`
- [ ] Verificar mensaje: `⚡️[server]: Server is running at http://localhost:3001`
- [ ] No hay errores en consola

**Estado**: ✅ PASADO (verificado en Step 93)

#### Test 1.2: Health Check Incluye WebSocket
```bash
curl http://localhost:3001/api/health
```

**Respuesta esperada**:
```json
{
  "status": "ok",
  "message": "Restaurant System API is running",
  "websocket": {
    "enabled": true,
    "clients": 0
  }
}
```

- [ ] Endpoint responde correctamente
- [ ] `websocket.enabled` es `true`
- [ ] `websocket.clients` muestra número de clientes conectados

---

### 2. Testing de Conexión Cliente

#### Test 2.1: Cliente se Conecta
**Método**: Abrir frontend en navegador

**Pasos**:
1. [ ] Abrir consola del navegador
2. [ ] Navegar a la aplicación
3. [ ] Verificar mensaje: `✅ WebSocket connected`
4. [ ] No hay errores de conexión

**Verificación en servidor**:
- [ ] Mensaje en consola: `✅ Client connected: client_xxxxx (Total: 1)`

#### Test 2.2: Cliente Recibe Mensaje de Bienvenida
**Verificación en cliente**:
- [ ] Recibe mensaje tipo `CONNECTED`
- [ ] Mensaje incluye `clientId` y `timestamp`

#### Test 2.3: Múltiples Clientes
**Pasos**:
1. [ ] Abrir aplicación en 2 pestañas diferentes
2. [ ] Verificar que ambas se conectan

**Verificación en servidor**:
- [ ] Total de clientes aumenta: `(Total: 2)`

---

### 3. Testing de Heartbeat

#### Test 3.1: Heartbeat Funciona
**Pasos**:
1. [ ] Conectar cliente
2. [ ] Esperar 30 segundos
3. [ ] Verificar que conexión sigue activa

**Verificación**:
- [ ] Cliente no se desconecta
- [ ] No hay mensajes de "dead connection" en servidor

#### Test 3.2: Detección de Conexión Muerta
**Pasos**:
1. [ ] Conectar cliente
2. [ ] Cerrar navegador abruptamente (sin cerrar pestaña)
3. [ ] Esperar 30-60 segundos

**Verificación en servidor**:
- [ ] Mensaje: `💀 Terminating dead connection: client_xxxxx`
- [ ] Total de clientes disminuye

---

### 4. Testing de Eventos de Órdenes

#### Test 4.1: ORDER_CREATED
**Pasos**:
1. [ ] Conectar cliente WebSocket
2. [ ] Crear una orden desde POS
3. [ ] Verificar que se recibe evento

**Evento esperado**:
```json
{
  "type": "ORDER_UPDATE",
  "payload": {
    "orderId": 123,
    "status": "CREATED",
    "order": { ... },
    "timestamp": "2025-12-12T..."
  }
}
```

**Verificación**:
- [ ] Evento recibido en tiempo real
- [ ] `orderId` correcto
- [ ] `status` es "CREATED"
- [ ] `order` incluye datos completos

#### Test 4.2: ORDER_SENT_TO_KITCHEN
**Pasos**:
1. [ ] Crear orden
2. [ ] Enviar a cocina
3. [ ] Verificar evento

**Evento esperado**:
```json
{
  "type": "ORDER_SENT_TO_KITCHEN",
  "payload": {
    "order": { ... },
    "timestamp": "2025-12-12T..."
  }
}
```

**Verificación**:
- [ ] Evento recibido en cocina
- [ ] Orden aparece en pantalla de cocina
- [ ] Datos completos de orden

#### Test 4.3: ORDER_READY
**Pasos**:
1. [ ] Desde cocina, marcar orden como lista
2. [ ] Verificar evento en POS

**Evento esperado**:
```json
{
  "type": "ORDER_READY",
  "payload": {
    "orderId": 123,
    "tableNumber": "5",
    "timestamp": "2025-12-12T..."
  }
}
```

**Verificación**:
- [ ] POS recibe notificación
- [ ] Muestra alerta visual/sonora
- [ ] Incluye número de mesa

#### Test 4.4: ORDER_COMPLETED
**Pasos**:
1. [ ] Completar orden (pagar)
2. [ ] Verificar evento

**Verificación**:
- [ ] Evento `ORDER_UPDATE` con status "COMPLETED"
- [ ] Orden desaparece de cocina
- [ ] Mesa se libera

#### Test 4.5: ORDER_CANCELLED
**Pasos**:
1. [ ] Cancelar orden
2. [ ] Verificar evento

**Verificación**:
- [ ] Evento `ORDER_UPDATE` con status "CANCELLED"
- [ ] Orden se marca como cancelada en todas las pantallas

---

### 5. Testing de Eventos de Mesas

#### Test 5.1: TABLE_STATUS_CHANGED
**Pasos**:
1. [ ] Cambiar estado de mesa (AVAILABLE → OCCUPIED)
2. [ ] Verificar evento

**Evento esperado**:
```json
{
  "type": "TABLE_STATUS_CHANGED",
  "payload": {
    "tableId": 5,
    "status": "OCCUPIED",
    "table": { ... },
    "timestamp": "2025-12-12T..."
  }
}
```

**Verificación**:
- [ ] Evento recibido en tiempo real
- [ ] UI actualiza estado de mesa
- [ ] Color/icono cambia correctamente

---

### 6. Testing de Broadcasting

#### Test 6.1: Broadcast a Múltiples Clientes
**Pasos**:
1. [ ] Abrir 3 pestañas (2 POS, 1 Cocina)
2. [ ] Crear orden desde POS 1
3. [ ] Verificar que todos reciben evento

**Verificación**:
- [ ] POS 1 recibe evento
- [ ] POS 2 recibe evento
- [ ] Cocina recibe evento
- [ ] Servidor muestra: `📢 Broadcast ORDER_UPDATE to 3 clients`

---

### 7. Testing de Reconexión

#### Test 7.1: Reconexión Automática del Cliente
**Pasos**:
1. [ ] Conectar cliente
2. [ ] Detener servidor (`Ctrl+C`)
3. [ ] Esperar 5 segundos
4. [ ] Reiniciar servidor

**Verificación en cliente**:
- [ ] Mensaje: `🔌 WebSocket disconnected`
- [ ] Mensaje: `🔄 Attempting to reconnect...`
- [ ] Mensaje: `✅ WebSocket connected`
- [ ] Reconexión exitosa

---

### 8. Testing de Integración Completa

#### Test 8.1: Flujo POS → Cocina → POS
**Escenario**: Orden completa desde creación hasta entrega

**Pasos**:
1. [ ] **POS**: Crear orden para Mesa 5
   - Verificar: Evento `ORDER_CREATED`
2. [ ] **POS**: Enviar a cocina
   - Verificar: Evento `ORDER_SENT_TO_KITCHEN`
3. [ ] **Cocina**: Recibir orden
   - Verificar: Orden aparece en pantalla
4. [ ] **Cocina**: Marcar como en preparación
   - Verificar: Evento `ORDER_UPDATE` status "PREPARING"
5. [ ] **Cocina**: Marcar como lista
   - Verificar: Evento `ORDER_READY`
6. [ ] **POS**: Recibir notificación
   - Verificar: Alerta "Orden #X lista - Mesa 5"
7. [ ] **POS**: Completar orden
   - Verificar: Evento `ORDER_COMPLETED`

**Resultado esperado**:
- [ ] Todos los eventos se reciben en tiempo real
- [ ] No hay retrasos > 500ms
- [ ] UI se actualiza correctamente en cada paso
- [ ] No hay errores en consola

---

## 🐛 Bugs Conocidos / Issues

### Issues Encontrados
_Ninguno hasta el momento_

### Bugs a Verificar
- [ ] ¿Qué pasa si se envía orden sin mesa?
- [ ] ¿Qué pasa si se desconectan todos los clientes?
- [ ] ¿Memory leaks con muchas conexiones?
- [ ] ¿Rendimiento con 50+ clientes simultáneos?

---

## 📊 Métricas de Rendimiento

### Latencia
- [ ] Tiempo entre evento y recepción: ___ ms (objetivo: <200ms)
- [ ] Tiempo de reconexión: ___ s (objetivo: <5s)

### Estabilidad
- [ ] Uptime durante testing: ___ % (objetivo: 100%)
- [ ] Conexiones exitosas: ___ / ___ (objetivo: 100%)
- [ ] Eventos perdidos: ___ (objetivo: 0)

### Escalabilidad
- [ ] Clientes simultáneos probados: ___
- [ ] Memoria usada con 10 clientes: ___ MB
- [ ] CPU con 10 clientes: ___ %

---

## ✅ Criterios de Aceptación

Para considerar la implementación de WebSocket como **COMPLETA**, se deben cumplir:

- [x] Servidor compila sin errores
- [x] Servidor inicia con WebSocket habilitado
- [ ] Cliente se conecta correctamente
- [ ] Heartbeat funciona
- [ ] Todos los eventos de órdenes funcionan
- [ ] Eventos de mesas funcionan
- [ ] Broadcasting funciona con múltiples clientes
- [ ] Reconexión automática funciona
- [ ] Flujo completo POS → Cocina → POS funciona
- [ ] No hay memory leaks
- [ ] Latencia < 200ms
- [ ] Sin errores en consola

---

## 🎯 Próximos Pasos

1. **Inmediato**: Testing manual de conexión cliente
2. **Hoy**: Completar todos los tests de este checklist
3. **Mañana**: Verificar endpoints y continuar con Día 2 del sprint

---

## 📝 Notas de Implementación

### Decisiones Técnicas
- **Librería**: `ws` (más ligera y simple que `socket.io`)
- **Heartbeat**: 30 segundos (balance entre detección rápida y overhead)
- **Reconexión**: 5 segundos (suficiente para no saturar)
- **Broadcasting**: A todos los clientes (futuro: rooms por sucursal)

### Mejoras Futuras
- [ ] Rooms/Channels por sucursal
- [ ] Autenticación de conexiones WebSocket
- [ ] Compresión de mensajes
- [ ] Rate limiting
- [ ] Métricas y monitoring
- [ ] Logs estructurados de eventos

---

**Estado**: 🟡 Implementado - Pendiente Testing  
**Última actualización**: 2025-12-12 15:58
