# Régimen empresarial y catálogo de pagos — nómina V4

Fecha de corte técnico: 2026-07-15

## 1. Decisión implementada

La configuración `HR_PAYROLL_PARAMETRIC_V4` congela, por empresa y versión de regla:

- régimen `GENERAL`: plantilla inicial con cálculo de IR laboral;
- régimen `SIMPLIFIED_FIXED_QUOTA`: plantilla inicial sin cálculo de IR laboral;
- regímenes `SPECIAL`, `EXEMPT` y `OTHER`: aplicabilidad explícita;
- fuente del régimen y fundamento obligatorio cuando IR no aplica;
- catálogo único de conceptos de pago.

El motor no decide por el texto del nombre ni por una lista de viáticos hardcodeada. Lee `companyTaxRegime.incomeTaxApplicability` y `paymentConceptCatalog` desde la revisión validada, hasheada e inmutable. La plantilla facilita los valores solicitados para general y simplificado, pero la activación continúa requiriendo carga de fuente y validación por un segundo actor.

Un cambio de régimen dentro del mismo ejercicio no se mezcla silenciosamente con el histórico. La corrida falla con `HR_PAYROLL_COMPANY_TAX_REGIME_CHANGED` hasta liquidar y documentar el cambio.

## 2. Catálogo autoritativo de conceptos

Cada entrada guarda:

| Campo | Propósito |
|---|---|
| `code` | Identificador único, estable y ajeno al nombre visible |
| `name` | Descripción para formularios, componentes y recibos |
| `type` | `INCOME` o `DEDUCTION` |
| `socialSecurityApplicable` | Integra o no la base del INSS laboral/patronal |
| `trainingContributionApplicable` | Integra o no la base de INATEC |
| `incomeTaxTreatment` | `REGULAR_FIXED`, `REGULAR_VARIABLE`, `OCCASIONAL` o `null` |
| `incomeTaxDeductible` | Autoriza una deducción para renta neta; sólo en `DEDUCTION` |
| `sourceReference` | Fuente legal, contractual, política y/o comprobantes |

No se aceptan códigos duplicados. Una deducción no puede integrar INSS, INATEC ni declarar tratamiento de ingreso. Un ingreso no puede declararse como deducción autorizada. Si INSS, INATEC o IR aplican globalmente, el catálogo debe contener por lo menos un ingreso que alimente la obligación correspondiente.

## 3. Conceptos iniciales no sujetos

La plantilla deja con INSS `false`, INATEC `false` e IR `null`:

- `VIATICOS_ALIMENTACION`;
- `VIATICOS_TRANSPORTE`;
- `VIATICOS_HOSPEDAJE`;
- `VIATICOS_OTROS`;
- `REEMBOLSO_DEPRECIACION`.

Estos valores no son una excepción codificada en el motor. Son registros editables de la plantilla que deben respaldarse con política, contrato, comprobantes y validación legal antes de activar la regla. Si aparece otra clase de viático o reembolso se agrega una fila; no se modifica código fuente.

## 4. Flujo transaccional

1. El propietario crea una regla `DRAFT` para su empresa.
2. Selecciona el régimen y confirma su efecto sobre IR.
3. Revisa cada concepto y sus banderas independientes.
4. Carga fuente, evidencia y motivo.
5. El servidor valida estructura, unicidad y coherencia, genera el hash y crea una revisión append-only.
6. Otro actor valida o rechaza la revisión.
7. Sólo una revisión `VALIDATED` puede activar la regla.
8. La corrida congela la revisión usada.
9. Al agregar un pago manual, la UI sólo permite seleccionar un concepto del catálogo; sus banderas son de sólo lectura.
10. El servidor vuelve a comparar código, tipo y todas las banderas. Una alteración falla con `HR_PAYROLL_COMPONENT_CLASSIFICATION_MISMATCH`; un código inexistente falla con `HR_PAYROLL_PAYMENT_CONCEPT_NOT_CONFIGURED`.
11. Revisión, aprobación y pago recalculan contra el catálogo congelado; cualquier divergencia falla cerrada.

## 5. Compatibilidad V3

Las cargas y activaciones nuevas exigen V4. Una configuración V3 previamente congelada se normaliza en memoria para consultar, recalcular o ejecutar un contraflujo histórico:

- las listas V3 se transforman en entradas únicas del catálogo;
- se conserva exactamente la aplicabilidad de IR que tenía V3;
- no se reescribe la fila histórica ni su hash;
- no se permite cargar una nueva revisión V3.

Por tanto, el cambio no transforma retroactivamente una corrida pagada ni convierte una empresa histórica de general a simplificada.

## 6. Regresiones obligatorias

- general con salario gravable produce IR progresivo;
- simplificado con el mismo salario produce IR cero y conserva INSS aplicable;
- viático y depreciación con banderas `false/null` no alteran base INSS ni IR;
- intento de enviar un viático con INSS `true` es rechazado;
- nombres diferentes no alteran el cálculo: sólo cuenta la definición congelada por código;
- cambio de régimen dentro del ejercicio es bloqueado;
- componentes automáticos ausentes del catálogo generan `UNCONFIGURED_PAYMENT_CONCEPT`;
- código duplicado o definición incoherente impiden cargar la configuración;
- reglas V3 históricas continúan legibles, pero una carga nueva V3 es rechazada.

## 7. Límite legal y operativo

La parametrización implementa la decisión operativa solicitada, pero no sustituye un dictamen tributario. Antes de producción deben firmarse específicamente:

- correspondencia entre régimen empresarial y obligación de retener IR laboral;
- tratamiento de cada tipo de viático según su naturaleza y soporte;
- tratamiento de depreciación, uso de vehículo, reembolsos y pagos similares;
- catálogo completo de ingresos y deducciones usado por la empresa;
- resultado de nómina paralela por régimen.

La regla debe activarse sólo después de que esas conclusiones estén reflejadas en la fuente y evidencia de la revisión V4.

## 8. Evidencia técnica del corte

- servidor: 104 suites y 575 pruebas unitarias aprobadas;
- cliente: 41 archivos y 159 pruebas aprobadas;
- integración MySQL migrada: 11 suites y 42 pruebas aprobadas;
- TypeScript y ESLint sin advertencias;
- prueba transaccional de viático adulterado rechazada;
- viático y depreciación válidos agregados sin variar INSS ni IR;
- compatibilidad de lectura V3 y rechazo de nuevas cargas V3 verificados.
