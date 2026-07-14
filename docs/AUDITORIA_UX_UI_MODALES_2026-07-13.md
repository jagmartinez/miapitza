# Auditoría UX/UI de modales y paneles laterales

**Fecha:** 2026-07-13  
**Base visual aprobada:** `Nueva Mesa` y `Nueva Reservación`  
**Alcance:** cliente web completo, con énfasis en modales, sidebars, formularios, navegación por pestañas, responsive, accesibilidad y consistencia visual.  
**Resultado:** contrato compartido consolidado; modales prioritarios corregidos; inventario completo revisado; TypeScript, lint, pruebas unitarias, build y E2E en verde.

## 1. Objetivo y criterio de aceptación

La revisión no se limitó a comparar colores. Cada diálogo debía cumplir, según su función:

1. Encabezado estable con título legible y cierre accesible.
2. Navegación por pestañas semántica cuando existan varias etapas o grupos.
3. Un único cuerpo central desplazable, sin perder título ni acciones.
4. Secciones visuales claras, con encabezado, icono y agrupación lógica.
5. Etiquetas asociadas a sus controles y tipos de entrada correctos.
6. Pie estable con `Cancelar` y acción principal en orden consistente.
7. Prevención de envíos duplicados durante operaciones asíncronas.
8. Comportamiento correcto con teclado, Escape, foco y panel cerrado.
9. Adaptación a escritorio, tablet y móvil sin desbordamiento horizontal.
10. Colores obtenidos de tokens del tema, compatibles con modo claro/oscuro.
11. Ausencia de reglas CSS locales capaces de alterar otros módulos.
12. Conservación de contratos API y lógica transaccional salvo validaciones UX seguras.

## 2. Contrato canónico

La anatomía de referencia queda definida así:

```tsx
<Sidebar title="..." width="large">
  <div className="premium-modal-content feature-modal-content">
    <div className="modal-tabs" role="tablist" aria-label="...">
      <button type="button" className="modal-tab" role="tab" aria-selected={active}>
        ...
      </button>
    </div>

    <form className="modal-form-new" onSubmit={handleSubmit}>
      <div className="modal-tab-content">
        <section className="modal-section animate-slide-in">
          <div className="modal-section-header">
            <Icon aria-hidden="true" />
            <h3>Sección</h3>
          </div>

          <div className="modal-form-row">
            <div className="modal-input-group">
              <label className="modal-input-label" htmlFor="field-id">Campo</label>
              <input id="field-id" className="modal-standard-input" />
            </div>
          </div>
        </section>
      </div>

      <div className="modal-footer">
        <Button type="button" variant="ghost">Cancelar</Button>
        <Button type="submit">Guardar</Button>
      </div>
    </form>
  </div>
</Sidebar>
```

### Reglas de implementación

- `premium-modal-content`: ocupa el alto disponible, usa `min-height: 0` y no desplaza el documento.
- `modal-tabs`: permanece fuera del scroll vertical; permite scroll horizontal en móvil.
- `modal-form-new`: organiza cuerpo y footer; no debe ser el contenedor que desplaza toda la interfaz.
- `modal-tab-content`: es el único cuerpo vertical desplazable.
- `modal-section`: agrupa campos que pertenecen al mismo concepto, no se usa sólo como decoración.
- `modal-form-row`: dos columnas en escritorio y una columna en anchos reducidos.
- `modal-footer`: acción secundaria a la izquierda de la primaria; permanece visible.
- Los botones dentro de formularios que no envían datos deben declarar `type="button"`.
- Las pestañas deben ser botones con `role="tab"` y `aria-selected`; no `div` clicables.
- Los selectores tipo tarjeta deben ser botones y exponer `aria-pressed` cuando representen selección.
- Todo control debe tener `label` asociado mediante `htmlFor`/`id` o nombre accesible equivalente.
- Los importes y cantidades deben declarar `min`, `step` e `inputMode` cuando corresponda.
- No crear reglas genéricas como `.input`, `select`, `textarea` o `.modal-*` dentro del CSS de una página sin encapsularlas bajo el módulo.
- No usar colores de superficie hardcodeados; usar `--color-*` y tokens de espaciado/tipografía.

## 3. Infraestructura compartida corregida

### `Modal`

- Separación explícita de header, cuerpo desplazable y acciones.
- Propiedades opcionales retrocompatibles: `description`, `footer`, `closeOnEscape` y `closeOnBackdrop`.
- `aria-labelledby` y `aria-describedby` conectados correctamente.
- Botón de cierre con nombre contextual: `Cerrar <título>`.
- Foco visible y títulos largos protegidos contra ruptura de layout.
- Variantes centrada y lateral conservadas.

### `Sidebar`

- Mismo contrato estructural que `Modal`.
- Panel cerrado marcado como `inert` y `aria-hidden`, evitando tabulación sobre formularios fuera de pantalla.
- Retiro de `inert` antes de aplicar el foco inicial al abrir.
- Escape, restauración de foco, trampa de foco y bloqueo de scroll conservados.
- `closeOnBackdrop` y `closeOnEscape` configurables.
- Bottom sheet móvil, safe areas y `prefers-reduced-motion` contemplados.

### CSS global de modales

- Header, tabs y footer son regiones no desplazables.
- El cuerpo usa `overflow-y: auto`, `overscroll-behavior: contain` y `scrollbar-gutter: stable`.
- Se corrigieron saltos de ancho y scrolls anidados.
- Tabs no comprimen sus etiquetas y se desplazan horizontalmente cuando es necesario.
- Footer distribuye acciones sin cortar botones en móvil.
- Modo oscuro depende de tokens; no se añadieron fondos claros fijos.

## 4. Hallazgos críticos y correcciones

### 4.1 Nueva Receta de Producción

**Antes:** formulario monolítico, alta carga visual, notas presentes en estado/payload pero sin control editable y errores que no orientaban al usuario hacia la sección correcta.

**Después:**

- Pestañas `Receta`, `Componentes` y `Costo` con semántica de tabs.
- Contador visible de componentes.
- Cuerpo desplazable y footer estable.
- Campo `Notas de producción` recuperado.
- Validaciones navegan automáticamente a la pestaña que contiene el error.
- Error de costo o unidad de medida dirige a `Costo`.
- Responsive y dark mode por contrato compartido.

### 4.2 Nuevo Servicio de Catering

**Antes:** contenedor parcial, acciones con estilos inline, labels sin asociación, ausencia de feedback de error y posibilidad de doble envío.

**Después:**

- Formulario semántico bajo el contrato premium.
- Secciones `Información general` y `Análisis de costos y precios`.
- Labels asociados; textarea estándar.
- Importes con `min="0"`, `step="0.01"` e `inputMode="decimal"`.
- Nombre obligatorio validado antes de guardar.
- Error mediante toast.
- Bloqueo de doble envío y texto `Guardando...`.
- Footer estable y consistente.

### 4.3 Contaminación CSS de Catering

Se encontró un defecto transversal: `CateringMod.css` definía reglas genéricas para inputs, selects, textareas, filas, React Select, resúmenes y calendarios. Esas reglas podían modificar silenciosamente modales de otros módulos según el orden de carga.

Corrección:

- Reglas encapsuladas bajo `.catering-page` o `.catering-modal-content`.
- Fondos oscuros forzados eliminados.
- Tabs y footer adaptados a móvil.
- La página deja de sobrescribir el contrato global de modales.

### 4.4 Roles y permisos

**Antes:** formulario legado con clases propias, sin cuerpo desplazable canónico y acciones no alineadas con Mesa/Reservación.

**Después:**

- `premium-modal-content`, `modal-form-new`, `modal-tab-content` y `modal-footer`.
- Labels asociados para nombre y descripción.
- Sección de permisos contenida, desplazable y compatible con móvil.
- Botones `Cancelar`/`Crear o actualizar` consistentes.
- CSS legado sin uso eliminado para evitar dos contratos paralelos.

## 5. Inventario por dominio

Leyenda:

- **Corregido:** requirió cambios locales.
- **Conforme:** ya cumplía el contrato y fue revisado sin cambios.
- **Heredado:** el componente obtiene la corrección mediante `Modal`/`Sidebar` compartido.
- **Especializado:** usa un layout propio justificado por impresión, pago, tabla u operación de alta densidad.

| Dominio | Diálogo o flujo | Estado | Resultado de revisión |
|---|---|---:|---|
| Referencia | Nueva/Editar Mesa | Conforme | Patrón visual base |
| Referencia | Nueva/Editar Reservación | Conforme | Patrón visual y semántico base |
| Empresas | Nueva/Editar Empresa | Conforme | Premium, secciones y footer |
| Sucursales | Nueva/Editar Sucursal | Conforme | Premium, secciones y footer |
| Marcas | Nueva/Editar Marca | Conforme | Premium y footer |
| Categorías | Nueva/Editar Categoría | Conforme | Premium, tabs y footer |
| Usuarios | Nuevo/Editar Usuario | Conforme | Premium, tabs, scroll y footer |
| Seguridad | Nuevo/Editar Rol | Corregido | Migrado desde formulario legado |
| Dashboard | Detalles y resúmenes | Heredado | Modal compartido, contenido de lectura |
| Producción | Nueva/Editar Receta | Corregido | Tabs, notas, navegación de errores |
| Producción | Nueva Orden | Corregido | Clases responsive y acciones estables |
| Producción | Detalle de Orden | Conforme | Secciones y footer |
| Producción | Finalizar Orden | Corregido | Jerarquía y responsive |
| Producción | Anular Orden | Corregido | Acciones móviles consistentes |
| Compras | Nueva/Editar Orden de Compra | Corregido | Estructura y secciones consistentes |
| Compras | Sugerencias de OC | Conforme | Layout existente válido |
| Compras | Recibir Orden | Corregido | Sección de destino y footer estándar |
| Compras | Agregar Ítem | Corregido | Migrado desde contenedor ad hoc |
| Compras | Registrar Pago/Historial | Corregido | Tabs semánticos |
| Compras | Importación | Conforme | Modal externo consistente |
| Inventario | Nuevo/Editar Producto | Corregido | Tabs semánticos y controles teclado |
| Inventario | Ajuste | Conforme | Secciones, scroll y footer |
| Inventario | OC sugerida | Conforme | Layout premium |
| Inventario | Importar Excel | Conforme | Layout premium |
| Bodegas | Nueva/Editar Bodega | Corregido | Encabezado de sección y ayuda |
| Bodegas | Stock | Conforme | Lectura densa justificada |
| Bodegas | Nuevo Traslado | Corregido | Separación Ruta/Producto y grid responsive |
| Bodegas | Historial | Conforme | Modal de lectura |
| Proveedores | Nuevo/Editar Proveedor | Corregido | Tabs Empresa/Contacto/Ubicación accesibles |
| Proveedores | Historial de Precios | Conforme | Tabla especializada |
| Unidades | Nueva/Editar Unidad de Medida | Conforme | Wizard 1-2-3, responsive y footer |
| Catering | Nuevo/Editar Evento | Corregido | Tabs, labels, tipos de input, doble envío |
| Catering | Nuevo/Editar Servicio | Corregido | Contrato premium completo |
| Catering | Pago/Reversión | Conforme | Flujo embebido conservado |
| Menú | Nuevo/Editar Plato | Corregido | Tabs semánticos |
| Menú | Modificadores | Conforme | Interacción especializada válida |
| Promociones | Nueva/Editar Promoción | Corregido | Tabs semánticos |
| Órdenes | Detalle | Heredado | Modal compartido |
| Órdenes | Cancelación | Heredado | Modal compartido |
| Cocina | Detalle de Orden | Heredado | Modal compartido |
| Cocina | Reportar Problema | Heredado | Modal compartido |
| Caja | Apertura | Heredado | Sidebar compartido |
| Caja | Nueva Caja Registradora | Heredado | Sidebar compartido |
| Caja | Ingreso/Retiro | Heredado | Modal compartido |
| Caja | Cierre de Turno | Heredado | Modal compartido |
| Caja | Nuevo Proveedor | Heredado | Modal compartido |
| PedidosYa | Nuevo Mapeo | Heredado | Modal compartido |
| POS | Selección de Mesa | Especializado | Densidad y selección visual justificadas |
| POS | Órdenes de Mesa | Especializado | Listado operativo |
| POS | Pago | Especializado | Flujo transaccional multimedio |
| POS | Impresión de Ticket | Especializado | Vista previa/impresión |

## 6. Archivos modificados

### Base compartida

- `client/src/components/Modal.tsx`
- `client/src/components/Modal.css`
- `client/src/components/Sidebar.tsx`
- `client/src/components/Sidebar.css`
- `client/src/index.css`

### Producción, compras e inventario

- `client/src/pages/ProductionRecipes.tsx`
- `client/src/pages/ProductionRecipes.css`
- `client/src/pages/ProductionOrders.tsx`
- `client/src/pages/ProductionOrders.css`
- `client/src/pages/PurchaseOrders.tsx`
- `client/src/pages/PurchaseOrderForm.tsx`
- `client/src/pages/PurchaseOrderForm.css`
- `client/src/pages/Inventory.tsx`
- `client/src/pages/Inventory.css`
- `client/src/pages/Warehouses.tsx`
- `client/src/pages/Suppliers.tsx`

### Comercial y operación

- `client/src/pages/Catering.tsx`
- `client/src/pages/CateringServices.tsx`
- `client/src/pages/CateringMod.css`
- `client/src/pages/Menu.tsx`
- `client/src/pages/Promotions.tsx`

### Seguridad

- `client/src/pages/RolesPermissions.tsx`
- `client/src/pages/RolesPermissions.css`

## 7. Matriz de validación ejecutada

| Control | Resultado | Evidencia |
|---|---:|---|
| TypeScript | PASS | `tsc --noEmit` |
| ESLint global | PASS | `eslint .` |
| Pruebas unitarias | PASS | 15 archivos, 46/46 pruebas |
| Build producción | PASS | Vite, 2,565 módulos |
| E2E Chromium | PASS | 8/8 escenarios |
| Integridad del diff | PASS | `git diff --check` |
| Visual escritorio | PASS | 1280×720; header/tabs/footer visibles; cuerpo con scroll |
| Visual móvil | PASS | 390×844; una columna; tabs con scroll; sin overflow horizontal |
| Modo oscuro | PASS por contrato | Tokens temáticos; sin nuevos fondos claros hardcodeados |

El primer intento de E2E fue impedido por permisos del sandbox al iniciar Chromium. Se repitió fuera del sandbox autorizado y los 8 escenarios pasaron.

## 8. Checklist obligatorio para futuros modales

### Estructura

- [ ] Usa `Modal` o `Sidebar`; no implementa un overlay nuevo sin justificación.
- [ ] Header, cuerpo y footer son regiones separadas.
- [ ] Sólo `modal-tab-content` desplaza verticalmente.
- [ ] El footer permanece visible a 720 px de alto y en móvil.
- [ ] No existe scroll horizontal del documento.

### Formulario

- [ ] Existe `<form onSubmit>` cuando hay guardado.
- [ ] Cancelar y acciones auxiliares usan `type="button"`.
- [ ] Guardar usa `type="submit"` o una acción única claramente controlada.
- [ ] El guardado asíncrono deshabilita reenvíos y muestra estado.
- [ ] Cada control tiene label/nombre accesible.
- [ ] Cantidades, importes, fechas y teléfonos usan tipos y límites correctos.
- [ ] Los errores dirigen al tab o campo que debe corregirse.

### Pestañas y selección

- [ ] `role="tablist"`, `role="tab"` y `aria-selected`.
- [ ] Son botones, no `div` clicables.
- [ ] Caben o se desplazan horizontalmente en 390 px.
- [ ] Tarjetas seleccionables exponen `aria-pressed` o estado equivalente.

### Accesibilidad

- [ ] Título conectado por `aria-labelledby`.
- [ ] Descripción conectada sólo cuando existe.
- [ ] Escape respeta `closeOnEscape`.
- [ ] El foco entra al diálogo y vuelve al disparador al cerrar.
- [ ] Tab y Shift+Tab permanecen dentro del diálogo.
- [ ] Panel cerrado no recibe foco (`inert`).
- [ ] Botón de cierre tiene nombre contextual.

### CSS y responsive

- [ ] CSS del módulo está encapsulado bajo una clase raíz.
- [ ] No redefine globalmente `.input`, `select`, `textarea`, `.modal-*` o React Select.
- [ ] Usa tokens `--color-*`, `--spacing-*`, `--font-size-*` y radios compartidos.
- [ ] Dos columnas pasan a una en móvil.
- [ ] Se verifica 1280×720 y 390×844 como mínimo.
- [ ] Respeta `prefers-reduced-motion`.

### Regresión

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] `git diff --check`

## 9. Riesgos residuales y trabajo futuro

Ninguno de los siguientes puntos bloquea esta entrega, pero deben permanecer visibles:

1. **Diálogos realmente anidados:** el bloqueo de `body.style.overflow` usa restauración simple. Si se permite abrir un diálogo sobre otro, conviene implementar un contador global de locks.
2. **Pruebas automatizadas de foco:** Playwright cubre rutas y contratos existentes, pero aún falta una suite dedicada a trampa/restauración de foco, Escape, backdrop e `inert`.
3. **Estilos inline históricos:** persisten en algunas vistas complejas, especialmente Menú, Catering financiero, Inventario y Compras. No alteran el contrato corregido, pero deben migrarse gradualmente a clases para reducir deuda visual.
4. **Chunk de PDF:** el build mantiene una advertencia por `react-pdf` (~1.58 MB sin comprimir; ~528 KB gzip). La dependencia ya está separada y se carga bajo demanda; no afecta el arranque ni el layout modal. Una reducción adicional requeriría cambiar el motor o generar contratos en el servidor.
5. **Títulos muy largos en móvil:** se protegen mediante truncado para preservar el botón de cierre. Si el título completo es operacionalmente crítico, debe añadirse descripción secundaria o tooltip, no permitir que rompa el header.

## 10. Proceso recomendado para la siguiente auditoría

1. Actualizar este inventario al crear, eliminar o especializar un diálogo.
2. Comparar primero contra `Nueva Mesa` y `Nueva Reservación`.
3. Ejecutar búsqueda de todos los usos de `Modal` y `Sidebar`.
4. Detectar overlays propios, `div` clicables, estilos inline y selectores CSS globales.
5. Revisar desktop, móvil, teclado, tema oscuro y estados loading/error/disabled.
6. Ejecutar toda la matriz automatizada.
7. Documentar excepciones especializadas con su justificación.

Esta guía constituye la base de aceptación para futuras revisiones UX/UI de diálogos del proyecto.

## 11. Segunda pasada correctiva — 2026-07-14

Una verificación posterior con evidencia visual detectó que tres casos todavía se apartaban del contrato documentado, aunque la primera auditoría los había clasificado como conformes o corregidos.

### Nuevo Evento de Catering

- El selector de platos y `Verificar Stock` no compartían una retícula estable; el botón podía partir su texto en dos líneas.
- `Verificar Stock` utilizaba la variante secundaria verde, compitiendo visualmente con la acción principal.
- Las tablas vacías mostraban solamente su encabezado, sin explicar el siguiente paso.
- El footer no protegía sus etiquetas contra saltos de línea.
- La acción principal decía `Guardar Cambios` incluso al crear un evento nuevo.
- Las tablas de servicios y menú conservaban superficies oscuras hardcodeadas y no respetaban completamente el tema claro.

Corrección aplicada:

- Toolbar responsive de dos columnas: selector flexible y acción auxiliar de ancho estable.
- Acción `Verificar inventario` en variante `ghost`, `type="button"` y texto no divisible.
- Estados vacíos descriptivos para servicios y menú.
- Superficies, bordes, encabezados e inputs migrados a tokens del tema.
- Footer con botones no divisibles y etiqueta contextual `Crear Evento` / `Guardar Cambios`.

### Nueva Caja Registradora

- Las pestañas `General` y `Configuración` eran `div` clicables.
- No exponían `role="tab"`, `aria-selected` ni comportamiento nativo de teclado.

Corrección aplicada:

- Navegación migrada a botones semánticos dentro de `role="tablist"`.
- Estado seleccionado expuesto mediante `aria-selected`.
- Acciones del footer declaradas explícitamente como `type="button"`.

### Cierre de Turno

- `Cancelar` y `Validar Arqueo` usaban el mismo tratamiento verde de acción secundaria.
- Las tres acciones se apilaban verticalmente también en escritorio, aumentando innecesariamente la altura del flujo.

Corrección aplicada:

- `Cancelar` y `Validar Arqueo` migrados a variante `ghost`.
- Acciones distribuidas en tres columnas en escritorio y una columna en móvil.
- Mensajes de validación ocupan la fila completa sin alterar la jerarquía de botones.

### Validación de esta segunda pasada

| Control | Resultado |
|---|---:|
| TypeScript | PASS |
| ESLint | PASS |
| Pruebas unitarias | PASS — 25 archivos, 82 pruebas |
| Build de producción | PASS — 2,609 módulos |
| E2E específico de modales | PASS — 2/2 en Chromium |
| Suite E2E completa | PASS — 16/16 en Chromium |
| Contrato de Catering a 795×862 | PASS — botón no divisible, vacío y footer visibles |
| Contrato de Caja Registradora | PASS — tabs semánticos y estado accesible |

La lección para futuras auditorías es que una estructura con clases canónicas no basta para declarar un modal conforme: también deben verificarse estados vacíos, etiquetas contextuales, jerarquía real de botones, tema claro y anchos intermedios cercanos a 800 px.

## 12. Análisis del chunk `react-pdf`

### Composición

El chunk proviene de `@react-pdf/renderer@4.3.2` y sus motores necesarios:

- `@react-pdf/pdfkit`: escritura del documento PDF.
- `fontkit`: medición y renderizado tipográfico.
- `@react-pdf/layout`: composición de páginas.
- `yoga-layout`: cálculo de layout tipo Flexbox.
- reconciliador React y primitivas del renderer.

El tamaño observado en el build auditado fue:

- `react-pdf.browser-*.js`: aproximadamente 1,576,678 bytes sin comprimir.
- Transferencia gzip estimada por Vite: aproximadamente 528 KB.
- `ContractPDF-*.js`: aproximadamente 11 KB adicionales.

### Aislamiento confirmado

`Catering.tsx` usa dos imports dinámicos dentro de `handleDownloadContract`:

```tsx
const [{ pdf }, { default: ContractPDF }] = await Promise.all([
  import('@react-pdf/renderer'),
  import('../components/ContractPDF'),
]);
```

Por lo tanto:

- No forma parte del bundle inicial.
- No se descarga al iniciar sesión.
- No se descarga al entrar a Dashboard, POS, Cocina, Inventario o Producción.
- No afecta la apertura de los modales corregidos.
- Sólo se solicita al generar un contrato PDF desde Catering.
- El costo se paga una sola vez por sesión mientras el chunk permanezca en caché.

### Validación funcional

Se ejecutó una generación real en memoria usando la misma versión, el mismo renderer y el registro de `Helvetica-Bold`. El resultado comenzó con la firma `%PDF`, confirmando que el motor y la fuente configurada producen un documento válido.

### Decisión

No se aumentó `chunkSizeWarningLimit` para ocultar la advertencia y tampoco se forzó un `manualChunks`, porque el código ya se encuentra correctamente aislado. Dividir internamente `pdfkit`, `fontkit` y `yoga-layout` aumentaría solicitudes sin reducir los bytes necesarios para generar el primer contrato.

La optimización adicional razonable sería mover la generación al backend y descargar un PDF terminado. Eso reduciría el JavaScript del cliente, pero añade carga al servidor y cambia el flujo de generación; debe tratarse como una mejora arquitectónica separada, no como parte de esta corrección UX/UI.
