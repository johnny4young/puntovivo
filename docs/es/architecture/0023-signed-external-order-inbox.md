# ADR-0023: Intención de pedido externo firmada y autoridad local de venta

**Idioma:** Español · [English](../../architecture/0023-signed-external-order-inbox.md)

Estado: Aceptado

## Contexto

Un pedido externo es una solicitud de otro sistema, no evidencia de que esta tienda haya aceptado precios, reservado bienes, cobrado un pago o emitido un documento fiscal. Los reintentos, las cancelaciones recibidas fuera de orden y una respuesta perdida no deben duplicar esos efectos.

## Decisión

### Autenticación e identidad persistente

El contrato genérico `sandbox_v1` entra por el transporte tRPC existente en `externalOrders.receive`. No tiene sesión bearer ni tenant/sede suministrados por quien llama. Un identificador aleatorio de conector localiza una credencial habilitada perteneciente a una sede. HMAC-SHA256 v1 vincula un separador de dominio, identificador de conector, marca de tiempo entera Unix en milisegundos, nonce y el cuerpo exacto del evento en UTF-8 (como máximo 64 KiB). La ventana de firma de cinco minutos y el estado de conector/tenant/sede/módulo se vuelven a comprobar bajo el escritor inmediato.

La credencial consta de 32 bytes criptográficamente aleatorios codificados como base64url canónico. Un administrador la crea o rota explícitamente. El almacenamiento AES-GCM vincula el texto cifrado con la identidad del tenant y del conector; ni el texto plano ni el cifrado se devuelven en proyecciones, resultados de repetición de comandos o registros de auditoría. El runtime independiente puede usar `PUNTOVIVO_EXTERNAL_ORDER_KEY`, una clave de envoltura estable separada de 64 dígitos hexadecimales; de lo contrario, se aplica la fuente de clave existente de webhook/base de datos. Esto nunca flexibiliza el cifrado obligatorio de la base de datos en producción. Cambiar la fuente de envoltura no es una migración de credenciales. La rotación del conector invalida de inmediato la clave de firma anterior sin eliminar los acuses persistentes.

Una transacción almacena conjuntamente la intención del pedido, el acuse inmutable del evento, el nonce de transporte, la transición versionada y la outbox local mínima de operaciones. El mismo identificador de evento debe conservar el mismo hash del cuerpo. Los reintentos exactos de transporte devuelven el acuse original; un nonce firmado nuevo puede reintentar el mismo evento después de avanzar el estado. El nonce se retiene durante la validez de la firma; los acuses de eventos permanecen persistentes. Una cancelación que llega antes de la creación almacena una marca de cancelación que una creación posterior no puede reabrir. Una creación de origen nunca escribe filas de venta, pago, inventario ni fiscalidad.

### Aceptación comercial explícita

Los gerentes/administradores revisan los productos locales resueltos a partir de SKU activos propios de unidad base, la moneda local, los componentes tributarios, los precios y la política de cantidades. Los totales del proveedor se muestran solo para comparar. Una huella de cotización vincula la versión de la bandeja de entrada y los datos del catálogo local; cambiarla borra el consentimiento de la interfaz. El operador debe confirmar los precios locales antes de aceptar. Los controles pendientes de aceptación/rechazo no pueden competir desde la interfaz.

La aceptación llama al núcleo existente de ventas nuevas con una referencia de uso interno exclusivo. El escritor inmediato de ventas repite la comprobación de catálogo propio/líneas/totales, crea un borrador suspendido, reserva sus bienes, encola el trabajo de cocina configurado, vincula la versión de la bandeja de entrada, registra auditoría/outbox y completa la protección del comando original. No hay una brecha entre crear y vincular. Un plan pendiente de medios de pago no es un pago recibido. El flujo existente de ventas suspendidas controla la reanudación, la autorización de sesión de caja, la liquidación y el comportamiento fiscal. La aceptación externa no puede autorizar una modificación de precio ni tratar una afirmación de pago del origen como evidencia local de pago.

### Cancelación y recuperación

Una intención no aceptada puede ser rechazada por un operador o cancelada por su origen. Una cancelación del origen después de la aceptación pasa a `cancel_requested` y bloquea el cobro del borrador y el avance de la entrega. No reembolsa, libera inventario ni anula una venta. Un operador descarta un borrador no pagado o revierte explícitamente una venta pagada con los comandos auditados existentes, y después resuelve cualquier solicitud de cancelación restante. El descarte/anulación del borrador participa en la misma transacción local de cancelación. Los borradores vinculados al exterior no se pueden dividir en cuentas independientes sin seguimiento.

Los fallos inesperados de almacenamiento se asignan a un código de API seguro y estable. Como el fallo puede ocurrir después de la confirmación original, el renderizador conserva el sobre de comando original para reintentar cuando el resultado es incierto. Las lecturas entre tenants/sedes siguen protegidas, incluida la proyección mínima de estado de venta vinculada. Estos agregados son solo locales hasta que la sincronización pueda conservar su grafo completo de autorización, acuses y actividad comercial.

## Consecuencias

El operador puede configurar conectores, revisar/rechazar solicitudes, rotar/deshabilitar credenciales y acceder al borrador o venta vinculados desde la aplicación. La falta de configuración de envoltura bloquea la operación con un mensaje que indica cómo resolverla. Ningún remitente recibe confianza implícita para cambiar precios locales, cobrar fondos o emitir reembolsos.

Este es un adaptador genérico de entorno de pruebas, no compatibilidad ni certificación para un agregador real. Las firmas, asignaciones, reglas de acuse, requisitos de retención y conciliación específicos de cada proveedor requieren evidencia separada antes de su adopción en vivo.

## Alternativas rechazadas

- Tratar datos firmados como venta/pago: la autenticidad no es autoridad comercial.
- Desduplicar en memoria: un reinicio borraría la evidencia necesaria para impedir la repetición.
- Deshacer pagos automáticamente al cancelar: el origen no tiene autoridad local de reembolso.
- Devolver una clave de firma almacenada: los administradores rotan las credenciales en lugar de recuperarlas.
- Analizar respuestas arbitrarias del simulador con `response.json()`: un tiempo de espera no limita la memoria.

## Verificación

Las pruebas con SQLite migrado cubren manipulación de MAC/cuerpo, conflictos de nonce/evento, duplicados concurrentes, marcas de cancelación, autorización y reversión de escrituras tardías. Los reinicios históricos en texto plano y con SQLCipher conservan las credenciales selladas y el estado exacto de acuses/eventos/nonces, sin pedidos inventados. Los recorridos web reales usan la interfaz para administrar conectores y cobrar, HTTP firmado para eventos de origen y SQLite de solo lectura para conciliar existencias/pagos. El simulador del operador rechaza redirecciones y consume como máximo 64 KiB de bytes de respuesta antes de analizar JSON. Electron, los controles completos de candidato y cualquier calificación con proveedores reales siguen siendo requisitos separados; las pruebas focalizadas no los sustituyen.
