# Base de revisión — RH y nómina estatutaria V2

> Documento histórico. La metodología de IR V2 fue sustituida por el motor Art. 19 V3 y su configuración paramétrica V4, descritos en `RH_IR_ART19_V3_20260715.md`. Las conclusiones antiguas sobre cuota fija no representan el comportamiento vigente.

Fecha de corte técnico: 2026-07-15

País y moneda objetivo: Nicaragua, NIO

Rama de trabajo: `codex/rh-nomina-estatutaria`

## 1. Resultado y límite de la revisión

Esta implementación completa el núcleo parametrizable de INSS, INATEC e IR laboral que faltaba en el módulo de RH. Convierte cada corrida regular en un cálculo reproducible por colaborador y separa claramente:

- ingresos y deducciones del colaborador;
- aportes patronales, que son costo de la empresa y no reducen el neto;
- régimen tributario de la actividad económica;
- obligaciones del empleador como agente retenedor de rentas del trabajo.

El documento no constituye dictamen jurídico ni certificación de producción. Antes del primer pago real se exige validación firmada por asesor laboral/tributario nicaragüense y una nómina paralela con datos reales.

## 2. Uso de `C:\nomina` como conocimiento histórico

El proyecto PHP fue leído como especificación funcional histórica, no como autoridad legal ni código para copiar. Sus tablas confirmaron la matriz de resultados esperada:

- salario mensual/quincenal, comisiones, vacaciones, extras y otros ingresos;
- INSS laboral, IR laboral, préstamos y otras deducciones;
- INSS patronal, INATEC, prestaciones y neto;
- una traza intermedia de expectativa anual y tramo de IR.

Parámetros históricos encontrados:

- INSS laboral `0.070`;
- INSS patronal `0.215` para empresas menores al umbral y `0.225` desde 50 colaboradores;
- INATEC `0.020`;
- tabla IR anual de 0%, 15%, 20%, 25% y 30%.

Limitación crítica: `dbsaac.sql` no contiene los procedimientos `CalcularPlanilla` ni `CalcularLiquidacion`. El PHP únicamente los invoca. Por ello la fórmula fue reconstruida desde los resultados históricos y contrastada con fuentes oficiales, sin copiar deuda técnica, SQL ausente ni datos personales.

## 3. Fuentes primarias contrastadas

| Materia | Regla aplicada | Fuente |
|---|---|---|
| INSS integral | Laboral 7%; patronal 21.5% para menos de 50 y 22.5% desde 50 | [INSS — Regímenes de afiliación](https://inss-princ.inss.gob.ni/index.php/tramites-37/10-afiliaciones/13-regimenes-de-afiliacion) y [texto consolidado de seguridad social](https://legislacion.asamblea.gob.ni/Normaweb.nsf/xpNorma.xsp?action=openDocument&documentId=B56E2A9860626A2B062588000059DD68) |
| Base INSS | Remuneración mensual total; sin límite máximo desde 2019; mínimo sectorial salvo período incompleto | [Decreto 06-2019, La Gaceta 21](https://legislacion.asamblea.gob.ni/gacetas/2019/2/g21.pdf) |
| INATEC | Aporte patronal del 2% de planilla | [Tecnológico Nacional](https://www.tecnacional.edu.ni/acerca/) |
| IR laboral | Tarifa progresiva sobre renta neta; cotización laboral INSS deducible | [Ley 822](https://legislacion.asamblea.gob.ni/Diariodebate.nsf/76ed72912dd57e570625698c00773f5d/29db3f80f66e1f5706257b5900630b21) |
| Metodología IR | Expectativa anual, promedio acumulado para ingreso variable y ajuste de retención | [Reglamento de la Ley 822, art. 19](https://legislacion.asamblea.gob.ni/SILEG/Gacetas.nsf/15a7e7ceb5efa9c6062576eb0060b321/9c520cbf65bf930606257aec005d6802/%24FILE/2013-01-15-%20Decreto%20Ejecutivo%20No.%2001-2013%2C%20Reglamento%20de%20la%20Ley%20No.%20822%2C%20Ley%20de%20concertaci%C3%B3n%20tributaria.pdf) |
| Reporte DGI | Deben reportarse todos los asalariados, todos los pagos y el dato INSS | [DGI — aviso de planillas](https://www.dgi.gob.ni/pdfNoticia/2972) |

### Corrección sobre cuota fija

No se implementó la regla automática `SIMPLIFIED_FIXED_QUOTA => IR laboral apagado`. La Ley 822 separa rentas de actividades económicas y rentas del trabajo, y obliga al empleador/agente retenedor a retener mensualmente el IR laboral. El sistema permite registrar cuota fija, pero mantiene la aplicabilidad de IR laboral como decisión independiente. Una excepción sólo puede cargarse con fundamento y evidencia, y requiere revisión por un segundo actor.

## 4. Configuración V2

Cada `PayrollRuleVersion` posee revisiones inmutables, hash SHA-256, vigencia, fuente, evidencia, motivo, cargador y revisor independiente. El cálculo nuevo exige `HR_PAYROLL_PARAMETRIC_V2`; no usa una tasa global ni un fallback.

### 4.1 Régimen empresarial

Valores disponibles:

- `GENERAL`;
- `SIMPLIFIED_FIXED_QUOTA`;
- `SPECIAL`;
- `EXEMPT`;
- `OTHER`.

El valor se congela dentro de la regla efectiva. No se toma de un campo mutable de la empresa, para que una corrida histórica conserve el régimen vigente en su fecha.

### 4.2 INSS

Datos obligatorios:

- aplicabilidad o excepción documentada;
- régimen `INTEGRAL`, `IVM_RP`, facultativo u otro;
- tasa laboral;
- tasas patronales debajo y desde el umbral;
- umbral de tamaño empresarial;
- base mínima mensual del sector;
- conceptos cotizables;
- fuente legal.

El umbral usa el total de colaboradores internos activos de toda la empresa durante el período, no sólo la sucursal seleccionada para la corrida. Si la base calculada queda por debajo del mínimo prorrateado, el sistema aplica el piso y crea `INSS_MINIMUM_BASE_APPLIED` como anomalía bloqueante para revisar jornada o período incompleto.

### 4.3 INATEC

Datos obligatorios:

- aplicabilidad o excepción documentada;
- tasa patronal;
- conceptos que integran la planilla base;
- fuente legal.

INATEC se registra en `PayrollEmployerContribution`; nunca se descuenta al colaborador.

### 4.4 IR laboral

Datos obligatorios:

- aplicabilidad o excepción documentada;
- reconocimiento expreso de independencia respecto al régimen empresarial;
- períodos anuales para semanal, quincenal y mensual;
- conceptos que forman renta bruta gravable;
- tabla progresiva completa;
- metodología y fuente.

La tabla valida continuidad, límites crecientes, base acumulada, tasa entre 0 y 1 y último tramo abierto. Una tabla con huecos, solapes o base inconsistente es rechazada.

Tabla propuesta para transcripción y control, no hardcodeada por el motor:

| Desde | Hasta | Impuesto base | Tasa | Sobre exceso de |
|---:|---:|---:|---:|---:|
| 0.00 | 100,000.00 | 0.00 | 0% | 0.00 |
| 100,000.00 | 200,000.00 | 0.00 | 15% | 100,000.00 |
| 200,000.00 | 350,000.00 | 15,000.00 | 20% | 200,000.00 |
| 350,000.00 | 500,000.00 | 45,000.00 | 25% | 350,000.00 |
| 500,000.00 | en adelante | 82,500.00 | 30% | 500,000.00 |

## 5. Datos del colaborador

El alta/edición ahora captura en la UI los campos que el servidor ya soportaba:

- nombre legal y preferido;
- tipo y número de identificación;
- número de asegurado INSS;
- RUC o identificación tributaria;
- contacto de emergencia, teléfono y relación;
- contacto laboral, domicilio y datos organizacionales.

Una corrida con INSS aplicable crea `MISSING_INSS_NUMBER` si falta el número de asegurado. Una corrida con IR aplicable crea `MISSING_TAX_IDENTIFICATION` si faltan RUC e identificación. Ambas bloquean revisión, aprobación y pago.

## 6. Fórmula reproducible

Para cada colaborador y revisión de cálculo:

1. Se congelan contrato, compensación, asistencia, permisos, extras, frecuencia y cobertura.
2. Cada ingreso declara por separado si integra INSS, INATEC e IR.
3. `INSS base = max(base cotizable, mínimo mensual × 12 / períodos anuales × proporción de servicio)`.
4. `INSS laboral = base INSS × tasa laboral`.
5. `INSS patronal = base INSS × tasa patronal elegida por headcount`.
6. `INATEC = base INATEC × tasa patronal`.
7. `renta neta actual = renta bruta gravable - INSS laboral - otras deducciones legalmente autorizadas`.
8. `renta neta acumulada = histórico pagado del año + renta neta actual`.
9. `expectativa anual = renta acumulada / períodos transcurridos × períodos anuales`.
10. Se aplica la tabla progresiva a la expectativa anual.
11. `objetivo retenido a la fecha = IR anual / períodos anuales × períodos transcurridos`.
12. `ajuste actual = objetivo - IR neto retenido previamente`.
13. Un ajuste positivo crea `IR_LABORAL`; uno negativo crea `IR_LABORAL_DEVOLUCION` y aumenta el neto sin volver a integrar bases.

Todo cálculo monetario usa `Prisma.Decimal` y redondeo `ROUND_HALF_UP` a dos decimales. No usa `Number`, `parseFloat`, cero por excepción ni `catch` silencioso.

## 7. Clasificación de componentes

Los conceptos automáticos reciben banderas desde la configuración congelada. Para un componente manual, el usuario debe declarar y confirmar:

- ingreso gravable de IR;
- ingreso cotizable de INSS;
- ingreso base de INATEC;
- deducción autorizada para renta neta de IR.

Una deducción de préstamo, descuento comercial u otra salida ordinaria no reduce IR por defecto. Toda deducción marcada como autorizada exige una referencia documental. Un componente histórico sin clasificación produce `UNCLASSIFIED_MANUAL_INCOME` y bloquea la corrida.

Las relaciones `CONTRACTOR` e `INTERN` generan `NON_STANDARD_EMPLOYMENT_STATUTORY_REVIEW`. El motor no asume silenciosamente que una relación civil o formativa recibe el mismo tratamiento que una relación laboral; el responsable debe corregir la clasificación, excluir el sujeto o documentar la decisión antes de continuar.

Al agregar cualquier componente manual en estado `CALCULATED`, el servidor vuelve a calcular todas las personas, crea una nueva revisión estatutaria, reemplaza sólo los componentes estatutarios editables y conserva las trazas anteriores append-only.

## 8. Persistencia y trazabilidad

### `PayrollStatutoryCalculation`

Guarda por corrida, revisión y colaborador:

- régimen empresarial y revisión de configuración;
- frecuencia, headcount y base INSS;
- INSS laboral/patronal y tasa seleccionada;
- base y aporte INATEC;
- renta neta actual, deducciones autorizadas e histórico anual;
- períodos, expectativa, IR anual, retenido previo, retención actual y devolución;
- tramo completo usado;
- fingerprint SHA-256 del histórico previo.

### `PayrollEmployerContribution`

Guarda por revisión:

- `INSS_PATRONAL`;
- `INATEC_PATRONAL`;
- base, tasa, importe y referencia a la traza.

Ambas tablas tienen triggers de no actualización y no eliminación. Una nueva revisión inserta filas nuevas.

## 9. Revalidación antes de cada transición

Antes de `REVIEW`, `APPROVED` o `PAID`, el servidor vuelve a comprobar:

- configuración validada e inmutable;
- asistencia y resúmenes congelados;
- exclusividad de cobertura;
- headcount patronal;
- fingerprint, importes y estado de cada nómina histórica usada por IR;
- existencia de clasificación y traza V2 completa en toda planilla pagada previa del año;
- reproducción completa de la fórmula desde bases actuales;
- igualdad entre traza y componentes `INSS_LABORAL`, `IR_LABORAL` y devolución;
- igualdad entre detalle patronal y total de corrida;
- ausencia de anomalías bloqueantes y netos negativos.

Si una nómina anterior se paga, anula o modifica después del cálculo actual, el fingerprint cambia y la transición falla con `HR_PAYROLL_STATUTORY_SOURCE_STALE` hasta recalcular. Si una planilla pagada anterior a V2 no tiene clasificación o traza reproducible, se crea `INCOMPLETE_PRIOR_STATUTORY_HISTORY` y ninguna transición puede aprobarse: se requiere backfill conciliado, no una resolución manual de la anomalía.

## 10. Contraflujos y conciliación

- `CALCULATED -> RECALCULATE`: genera otra revisión estatutaria; no sobrescribe trazas.
- Componente manual: recalcula impuestos y aportes dentro de la misma transacción.
- `PAID -> VOID`: crea `PayrollRunReversal`, revierte bruto, deducciones, aportes patronales y neto; luego crea reversos de componentes, libera cobertura, revierte beneficios y anula recibos.
- Conciliación paralela: compara sin tolerancia bruto, deducciones, aportes patronales, neto y cantidad de personas contra un cálculo externo.
- Exportación CSV/XLSX: incluye INSS laboral, IR, devolución, INSS patronal, INATEC y total patronal por persona.

## 11. Migración y rollback

Migración: `server/prisma/migrations/20260715_hr_statutory_payroll_v2/migration.sql`

Rollback controlado: `server/prisma/migrations/20260715_hr_statutory_payroll_v2/rollback.sql`

La migración es aditiva: agrega banderas a componentes, el monto patronal al reverso y las dos tablas estatutarias. No inventa clasificaciones para planillas antiguas. Antes de desplegarla se debe ensayar sobre un restore reciente, verificar triggers y ejecutar el rollback en una copia desechable. Si existen corridas `PAID` del mismo año fiscal, debe ejecutarse un backfill supervisado que reconstruya conceptos, retenciones y devoluciones contra recibos/declaraciones reales; hasta entonces el motor falla cerrado con `HR_PAYROLL_STATUTORY_HISTORY_INCOMPLETE`.

## 12. Pruebas automatizadas

Casos cubiertos:

- configuración V2 incompleta rechazada;
- tabla progresiva en límites de 100k, 200k, 350k y 500k;
- INSS laboral 7%; patronal 21.5% y 22.5% exactamente desde 50;
- INATEC 2%;
- cuota fija con IR laboral todavía aplicable;
- deducción autorizada distinta de INSS;
- ajuste por sobre-retención y devolución;
- separación y reverso de aportes patronales;
- clasificación obligatoria de manuales;
- bloqueo de histórico pagado sin trazabilidad V2 y soporte obligatorio de deducciones autorizadas;
- endpoints, permisos, no-store, idempotencia y control dual;
- captura visible de identificadores estatutarios.

Gates ejecutados sobre la candidata del 2026-07-15:

- servidor: `103` suites y `548` pruebas unitarias aprobadas;
- cliente: `41` archivos y `157` pruebas aprobadas;
- integración sobre `restaurante_test`: `10` suites y `40` pruebas aprobadas;
- `typecheck`, ESLint y build de servidor/cliente aprobados;
- `prisma validate` y `git diff --check` aprobados.

La integración actual cubre los flujos transaccionales globales existentes; no sustituye la nómina paralela con casos y declaraciones reales. La migración V2 todavía debe ensayarse, incluidos sus triggers y rollback, sobre un restore productivo reciente.

## 13. Secuencia obligatoria para habilitar una empresa

1. Completar identificación tributaria de la empresa y seleccionar el régimen efectivo.
2. Confirmar régimen INSS y contar el universo empresarial completo.
3. Cargar el salario mínimo vigente del sector comercio/restaurantes y su fuente.
4. Transcribir tasas y tabla IR desde fuentes vigentes.
5. Definir conceptos cotizables/gravables y deducciones autorizadas.
6. Cargar fuente, evidencia y motivo en una regla `DRAFT`.
7. Hacer revisión independiente con otro usuario.
8. Activar la regla con vigencia correcta.
9. Completar número INSS e identificación tributaria de cada colaborador.
10. Cerrar asistencia y abrir período de nómina.
11. Calcular y resolver anomalías.
12. Ejecutar una nómina paralela real y conciliar los cinco totales.
13. Obtener firma del responsable laboral/tributario.
14. Aprobar y pagar con segregación de funciones.

## 14. Pendientes que siguen fuera de certificación

- confirmación profesional de la tabla y metodología vigentes en la fecha del primer pago;
- salario mínimo sectorial vigente y tratamiento de jornadas parciales/períodos incompletos;
- nómina paralela con casos reales: salario fijo, variable, alta/baja, bono ocasional, vacaciones y devolución;
- formato/archivo oficial para declaraciones DGI, INSS e INATEC y evidencia de presentación;
- pruebas de carga, soak, caos, hardware y rollback sobre infraestructura candidata;
- backup productivo actual restaurado y verificado;
- despliegue controlado de la candidata congelada;
- custodia documental/DMS y biometría homologada, que son controles separados del cálculo de nómina.

Hasta completar esos puntos, el estado correcto es **motor técnico implementado y verificable; certificación legal/productiva pendiente**.

## 15. Checklist para futuras revisiones

- [ ] ¿Cambió alguna tasa, umbral, tabla o salario mínimo desde la última vigencia?
- [ ] ¿Cada parámetro conserva URL, documento, fecha y responsable?
- [ ] ¿La regla activa cubre exactamente la fecha de la corrida?
- [ ] ¿El régimen empresarial se revisó separado del IR laboral?
- [ ] ¿El headcount incluye toda la empresa y no sólo una sucursal?
- [ ] ¿Todos los ingresos manuales tienen clasificación explícita?
- [ ] ¿Toda deducción marcada para IR posee autorización y soporte?
- [ ] ¿La base mínima aplicada fue revisada para altas, bajas y tiempo parcial?
- [ ] ¿Los históricos pagados y sus reversos reproducen el fingerprint?
- [ ] ¿Aportes patronales, deducciones, neto, recibos y exportación reconcilian?
- [ ] ¿El reverso externo tiene referencia, fecha, método y evidencia?
- [ ] ¿La nómina paralela real quedó firmada sin diferencias?
