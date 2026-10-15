# Registros de decisiones arquitectónicas

**Idioma:** Español · [English](../../architecture/README.md)

Este directorio reúne decisiones duraderas que restringen la implementación.
Consulta [`../ARCHITECTURE.md`](../ARCHITECTURE.md) para la visión actual y estos
registros para el razonamiento de límites todavía activos.

## Ciclo de vida

- **Propuesta:** abierta a revisión, aún no vinculante.
- **Aceptada:** vinculante para código nuevo o modificado.
- **Sustituida:** conserva razonamiento histórico y enlaza su reemplazo.
- **Rechazada:** se conserva si es probable volver a considerar esa alternativa.

Los registros nuevos usan la siguiente secuencia de cuatro dígitos e incluyen
contexto, decisión, consecuencias, alternativas y evidencia. Cronogramas,
estimaciones y colas privadas no pertenecen a los ADR.

## Índice de decisiones

| Registro                                                               | Decisión                                         | Estado   |
| ---------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| [ADR-0001](0001-local-store-authority.md)                              | Autoridad local de tienda                        | Aceptada |
| [ADR-0002](0002-command-envelope.md)                                   | Sobre de comando                                 | Aceptada |
| [ADR-0003](0003-outbox-taxonomy.md)                                    | Taxonomía de bandejas                            | Aceptada |
| [ADR-0004](0004-conflict-policy.md)                                    | Política de conflictos                           | Aceptada |
| [ADR-0005](0005-sync-payload-contract.md)                              | Contrato de payload de sincronización            | Aceptada |
| [ADR-0006](0006-local-data-security.md)                                | Seguridad de datos locales                       | Aceptada |
| [ADR-0007](0007-module-activation.md)                                  | Activación de módulos                            | Aceptada |
| [ADR-0008](0008-authority-node-runtime-modes.md)                       | Modos de ejecución del nodo de autoridad         | Aceptada |
| [ADR-0009](0009-money-storage-and-validation.md)                       | Almacenamiento y validación de dinero            | Aceptada |
| [ADR-0010](0010-labor-overtime-policy.md)                              | Política de horas extra                          | Aceptada |
| [ADR-0011](0011-product-search-vectors.md)                             | Vectores de búsqueda de productos                | Aceptada |
| [ADR-0012](0012-audit-chain-external-freshness.md)                     | Frescura externa de auditoría                    | Aceptada |
| [ADR-0013](0013-quotation-conversion-and-supplier-payables.md)         | Conversión de cotizaciones y deuda a proveedores | Aceptada |
| [ADR-0014](0014-normalized-sale-returns-and-store-credit.md)           | Devoluciones normalizadas y crédito de tienda    | Aceptada |
| [ADR-0015](0015-retail-counts-and-replenishment.md)                    | Conteos minoristas y reposición                  | Aceptada |
| [ADR-0016](0016-server-authoritative-promotions-and-customer-value.md) | Promociones y valor del cliente                  | Aceptada |
| [ADR-0017](0017-vertical-profiles-site-gs1.md)                         | Perfiles verticales y autoridad GS1 por sede     | Aceptada |
| [ADR-0018](0018-lot-procurement-and-transformations.md)                | Compras por lote y transformaciones              | Aceptada |
| [ADR-0019](0019-pharmacy-policy-evidence-and-lot-custody.md)           | Política farmacéutica y custodia regulada        | Aceptada |
| [ADR-0020](0020-restaurant-service-check-model.md)                     | Servicio de restaurante y cuentas                | Aceptada |
| [ADR-0021](0021-durable-kitchen-preparation.md)                        | Preparación persistente de cocina                | Aceptada |
| [ADR-0022](0022-reservation-fulfillment-boundary.md)                   | Reservas y límites de despacho                   | Aceptada |
| [ADR-0023](0023-signed-external-order-inbox.md)                        | Bandeja firmada de pedidos externos              | Aceptada |
| [ADR-0024](0024-effective-employment-terms.md)                         | Condiciones laborales efectivas                  | Aceptada |
| [ADR-0025](0025-operational-employee-absences.md)                      | Ausencias operativas                             | Aceptada |
| [ADR-0026](0026-recurring-employee-availability.md)                    | Disponibilidad recurrente efectiva               | Aceptada |
| [ADR-0027](0027-recurring-schedule-publication.md)                     | Publicación de horarios recurrentes              | Aceptada |
| [ADR-0028](0028-employee-shift-exchanges.md)                           | Intercambio de turnos con consentimiento         | Aceptada |
| [ADR-0029](0029-attendance-reconciliation-and-operational-cost.md)     | Conciliación de asistencia y costo laboral       | Aceptada |
| [ADR-0030](0030-colombia-pre-payroll-evidence.md)                      | Evidencia de prenómina colombiana                | Aceptada |
| [ADR-0031](0031-human-review-of-ai-payment-proposals.md)               | Revisión humana de propuestas de pago de IA      | Aceptada |

## Patrones reutilizables de implementación

Los patrones documentan estructuras probadas que apoyan varias decisiones.
No son cronológicos ni contienen responsables de planificación.

| Patrón                                                 | Decisiones complementarias   | Código                                            |
| ------------------------------------------------------ | ---------------------------- | ------------------------------------------------- |
| [Diario de operaciones](patterns/operation-journal.md) | ADR-0001, ADR-0002, ADR-0003 | `packages/server/src/services/operation-journal/` |
| [Núcleo de bandejas](patterns/outbox-kernel.md)        | ADR-0003                     | `packages/server/src/lib/outbox/`                 |

## Límite documental

La arquitectura pública describe restricciones actuales y razonamiento estable.
Planificación, traspasos, prioridades y estimaciones pertenecen a un documento
privado ignorado. Las guías enlazan código, pruebas o un ADR, nunca identificadores internos de tickets.
