# Análisis y normalización de Recetas Menu.xlsx

## Resultado

- Fuente: `Recetas Menu.xlsx` (SHA-256 `46c13ed9520540712c1d791a89804884d4392f05e1272f759183ae4e2274019b`).
- Plantilla histórica comparada: `Plantilla_Inventario_Recetas_MiaPitza.xlsx` (SHA-256 `ea76e30de15952e025bba93eef6e7c17e38936559ebe55faaa9627835ece7d50`).
- Total reconciliado: **56 bloques / 240 líneas**.
- Aplicables a `MenuItem -> Recipe`: **13 recetas / 81 líneas válidas**.
- Aplicables a `ProductionRecipe` en estado inicial `DRAFT`: **8 recetas / 42 componentes**.
- Revisión manual obligatoria: **35 bloques / 116 líneas**; además, 1 línea de cantidad cero se excluyó del payload aplicable y permanece documentada como anomalía.
- Hojas excluidas como recetas: `Compras` y `Costo de insumos` (son fuentes de costo/catálogo).

## Método y QA

El libro adjunto y la plantilla se importaron con `@oai/artifact-tool`. Se inspeccionaron valores, fórmulas y estilos del rango usado y se renderizaron y revisaron visualmente las 10 hojas fuente y las 3 hojas de plantilla. La estructura fuente contiene 277 rangos combinados, 1839 fórmulas y 27127 celdas con estilo. La plantilla histórica no contiene fórmulas ni combinaciones.

Se detectaron 294 valores de error: 290 en `Compras`, 2 en `Salsas`, 1 en `Pitzas` y 1 en `Bebidas`. Los errores de hojas de referencia no se copiaron como cantidades de receta. En el primer ciclo el extractor omitía etiquetas `PRECIO POR SERVICIO` sin dos puntos; se corrigió y se repitieron importación, render y reconciliación. La segunda pasada cerró exactamente 56/240 sin bloques ni líneas perdidas.

## Conteos por hoja

| Hoja | Bloques | Líneas | Dominio |
|---|---:|---:|---|
| Salsas | 4 | 24 | Producción (3 aplicables, 1 revisión) |
| Pastas | 10 | 29 | Menú/variantes; 10 en revisión |
| Antipastos | 3 | 21 | Menú; 3 en revisión |
| Pitzas | 16 | 90 | 11 menú, 2 producción, 3 revisión |
| Pitzas nuevas | 6 | 32 | 2 menú, 2 producción, 2 revisión |
| PROMOCION | 1 | 4 | Bundle; revisión |
| Postres | 6 | 27 | 1 producción, 5 revisión |
| Bebidas | 10 | 13 | DIRECT/porcionado/lote; 10 en revisión |
| Compras | 0 | 0 | Referencia de compras/costos |
| Costo de insumos | 0 | 0 | Referencia de costos unitarios |

## Contrato JSON

El archivo mantiene el contrato histórico `schemaVersion: 1` y separa tres grupos:

- `recipes`: 13 destinos existentes de pizza, con `code`, `menuItem`, `sourceName`, 81 ingredientes válidos, SKU productivo revisado y trazabilidad de hoja/fila/celda/fórmula/valor calculado.
- `productionRecipes`: 8 lotes claros con `output`, `yield`, `components` y `status: DRAFT`. No se activa ninguna receta automáticamente.
- `reviewRequired`: 35 bloques dudosos. Cada entrada indica `candidateDomain`, `reasonCodes`, `variantQualifier` y conserva el bloque completo.

Los 13 destinos de menú son: 4 Quesos y Hongos, Basilea, Capresse, Cheese Bar Pie, Della Nonna, Dulce Fiery, La Bianco, La Cotto, La Extra, La Pedronni, La Sussana, Maui Pitza y Pitza Pepperoni. La fuente aporta 82 líneas (81 válidas + 1 cantidad cero excluida) frente a 68 en la plantilla histórica; se preservaron cantidades/unidades válidas del adjunto. La plantilla sólo se usó como evidencia histórica y el mapeo final a producción se registra aparte en `recetas-menu.catalog-map.json`.

## Reconciliación con el catálogo productivo

El dry-run contra la base productiva demostró que los SKU históricos `MP-*` ya no existen y que una importación anterior había asociado ingredientes por similitud de texto. El caso más grave era `Salsa roja -> MIS-000075 (SAL)`. También había productos cuyo catálogo dice `unidad` mientras la receta requiere gramos. No se reutilizan esos registros incompatibles.

El mapa productivo cubre exactamente los 22 ingredientes canónicos de las 81 líneas:

- 14 reutilizan SKU existentes y compatibles. Se reactivan Albahaca, Tomate cherry, Rúcula, Carne Della Nonna y Masa precocida; los dos últimos se tipifican como `INTERMEDIATE`.
- 8 usan SKU reservados `RCP-000001` a `RCP-000008`: Salsa roja, Salsa pesto, Salsa 4 quesos, Queso mozzarella para receta, Mozzarella fresco para receta, Hongos frescos para receta, Reducción de balsámico para receta y Miel envase de mesa.
- Los productos `RCP-*` se crean sin existencias iniciales y con el costo del libro como referencia. No se inventan movimientos de inventario ni costos de compra.
- Para Cebolla morada, Jalapeño, Jamón selva negra, Miel, Pepperoni, Piña hawaiana y Romero se configura `g` como unidad permitida con el factor derivado de `UnitOfMeasure.systemFactor`; su unidad base de inventario (`lb` u `oz`) no se altera.
- La carga de las 13 recetas usa reemplazo acotado a esos 13 `MenuItem`, eliminando las asociaciones heredadas incorrectas sin tocar otros platos.

Las 8 recetas de producción permanecen completas y `DRAFT` en el JSON, pero se excluyen explícitamente de esta carga. Sus componentes todavía mezclan litros, kilogramos, unidades de lata y gramos con productos de base incompatibles; importarlas ahora fabricaría conversiones no sustentadas.

## Decisiones de dominio

- `Salsas`, Carne Della Nonna, Queso Ricotta, Masa Pizza, Masa integral y Brownie son lotes de producción, no consumos directos de venta.
- Focaccia, PAN, Pan de banano, Pan de zanahoria y Té quedan en revisión porque el destino o alguna unidad no está suficientemente definido.
- Vinos con rendimiento 5/8 son porcionado botella→copa; botellas 1:1 son venta DIRECT. Ninguno se importa como receta estándar hasta resolver el producto/MenuItem exacto.
- `PROMOCION!La Sussana` es un bundle y no se asocia al MenuItem pizza homónimo.
- Cheesecake es porcionado/autoconsumo nominal; `Masa para pizza` en Postres está mal rotulada. Ambos quedan en revisión.

## Anomalías principales

- Duplicados/variantes sin código: Canelones x2, Mezzaluna ricotta x2, 19 CRIMES x2 y La Sussana normal/promoción.
- Unidad desconocida o ausente: `cg`, `ch` y Nuez moscada sin cantidad/unidad.
- Maui Pitza contiene `tocino = 0 gr`; la línea no se importa porque `Recipe` exige una cantidad positiva. El hecho fuente permanece en `anomalies`. El respaldo productivo confirmó que Maui no tenía una línea de tocino previa, por lo que el reemplazo acotado no elimina una cantidad válida.
- La Bianco trae Proscciutto `2 GR`, mientras la plantilla histórica dice `2 lámina`. Para el payload aplicable se corrige a `2 unidad` con `unitNormalization: historical_template_correction`; los valores crudos `2`/`GR` permanecen intactos como evidencia.
- Segundo panel 19 CRIMES tiene precio actual 0.
- Los nombres fuente, incluso erratas (mozarellla, Proscciutto, integtal, hawaina), permanecen en `sourceName`; el nombre canónico y SKU sólo aparecen con evidencia de catálogo.

## Uso seguro

El flujo reproducible es:

1. respaldar recetas y catálogo con `backup-recipe-data`;
2. validar/aplicar `prepare-recipe-catalog` (dry-run por defecto);
3. validar/aplicar `import-menu-recipes --replace --allow-review-required --skip-production-recipes`;
4. repetir ambos dry-run y exigir cero creaciones, actualizaciones o eliminaciones.

`--allow-review-required` no importa los 35 bloques dudosos: sólo autoriza el subconjunto aplicable y los conserva como advertencias. `--skip-production-recipes` tampoco descarta información: deja las 8 recetas `DRAFT` en el archivo y registra su exclusión en el reporte. Ambos flags son deliberadamente explícitos y auditados.

## Resultado productivo (2026-07-10)

- Respaldo anterior: 14 `MenuItem`, 71 líneas `Recipe`, 2 `ProductionRecipe`, 5 componentes, 311 productos y 22 unidades.
- Preparación del catálogo: 8 productos `RCP-*` creados, 5 productos reactivados/retipificados y 9 sin cambios; segunda pasada 22/22 sin cambios.
- Import de menú: 13/13 recetas y 81/81 líneas; 47 líneas creadas, 4 ajustadas, 34 asociaciones heredadas incompatibles eliminadas y 30 ya correctas.
- Postcondición externa: `valid=true`, 0 altas, 0 cambios, 0 bajas y 81 líneas sin cambios.
- Respaldo posterior: 84 líneas totales (`81` de las 13 pizzas más `3` del escenario demo preexistente), 319 productos; las 2 recetas productivas demo y sus 5 componentes permanecen intactos.
