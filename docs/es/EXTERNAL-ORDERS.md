# Pedidos externos: operación sandbox local

**Idioma:** Español · [English](../EXTERNAL-ORDERS.md)

## Qué hace esta función

Con el módulo Entregas activo, gerentes y administradores abren **Pedidos externos**
en recepción. Una solicitud recibida no crea venta, reserva existencias ni cobra.
El contrato firmado genérico es un punto de integración sandbox, no una
integración certificada para un agregador o proveedor de entregas.

## Configurar un conector

1. Asegura almacenamiento cifrado de credenciales. Escritorio usa su fuente de
   clave de base. Independiente puede proporcionar `PUNTOVIVO_EXTERNAL_ORDER_KEY`
   estable, de 64 caracteres hexadecimales que representen 32 bytes aleatorios.
   Producción también requiere `PUNTOVIVO_DB_KEY`; son requisitos separados.
2. Como administrador, elige sede de destino y abre **Conectores**.
3. Crea un conector, genera su clave segura y guárdala en el almacén privado
   del sistema emisor. Confirma que la guardaste antes de enviar.
4. Entrega al emisor el ID del conector y endpoint tRPC firmado. No incluyas
   claves, direcciones ni datos de clientes en capturas o mensajes de soporte.
5. Rota explícitamente cuando haga falta: la clave anterior deja de funcionar
   inmediatamente. Desactivar detiene entradas firmadas, sin borrar pedidos recibidos.

Las claves guardadas nunca se recuperan. Se admiten hasta 100 conectores por sede.
Conserva la clave de envoltura tras reiniciar. Cambiarla no vuelve a cifrar
credenciales anteriores; restaura la configuración original o rota explícitamente
credenciales del conector antes de esperar que el emisor vuelva a autenticarse.

## Revisar, cobrar y cancelar

Selecciona una solicitud y elige **Revisar precios locales**. Cada código refiere
al SKU activo local de unidad base; los productos fraccionarios requieren su
política habitual de cantidad. Artículos, moneda o políticas no admitidos se
rechazan. Compara cotización de origen con precios locales y confirma con el
origen antes de marcar consentimiento explícito. **Aceptar y crear borrador**
reserva existencias y envía preparación de cocina configurada, pero no cobra.
El núcleo habitual de venta requiere sesión de caja abierta autorizada.

Usa **Abrir ventas suspendidas**, selecciona el borrador identificado por el
pedido de origen y reanúdalo para cobrar. Una venta vinculada completada ofrece
sus detalles y creación de entrega admisible; crear entrega no cobra otra vez.

Una cancelación de origen posterior a aceptar bloquea cobro y despacho. Descarta
un borrador sin pagar o emite devolución completa de la venta pagada vinculada
antes de resolver la solicitud. No hay reembolso automático. El historial distingue
eventos firmados del origen y decisiones del operador. Una cancelación anterior
a los detalles sigue cancelada aunque esos detalles lleguen después.

## Ejercitar el sandbox firmado

Crea un archivo de evento UTF-8 ordinario con datos sintéticos, por ejemplo:

```json
{
  "schemaVersion": 1,
  "eventId": "sandbox-create-1",
  "orderId": "sandbox-order-1",
  "kind": "order.created",
  "order": {
    "customerName": "Sandbox customer",
    "address": "Sandbox address",
    "currencyCode": "COP",
    "quotedTotal": 12500,
    "items": [{ "productCode": "LOCAL-SKU", "quantity": 1 }]
  }
}
```

Guarda la clave mostrada una sola vez en un archivo privado, con permisos solo
del propietario en Unix. Nunca la pases como argumento de línea de comandos.
Desde la raíz:

```sh
pnpm --filter @puntovivo/server exec tsx src/scripts/simulate-external-order.ts \
  --origin http://127.0.0.1:8090 \
  --connector=CONNECTOR_ID \
  --secret-file /absolute/private/key-file \
  --event-file /absolute/sandbox/create.json \
  --repeat 2
```

Conserva la forma `--connector=ID`: los IDs generados pueden comenzar con guion
que, de otro modo, el parser interpreta como opción. No quites caracteres del ID.

Repetir envía exactamente el mismo sobre. Agrega `--fresh-retry` para conservar
bytes e identidad del evento regenerando fecha, nonce y firma. Ambos deben
producir una sola solicitud. Solo acepta HTTP loopback u orígenes HTTPS explícitos;
rechaza redirecciones. Registra número de intento, estado HTTP y si un recibo
válido reconoce la identidad de evento/pedido enviada. Un HTTP 200 arbitrario
no implica éxito. Nunca registra credenciales, datos de clientes ni cuerpos de respuesta.

Para cancelar, envía otro archivo de evento:

```json
{
  "schemaVersion": 1,
  "eventId": "sandbox-cancel-1",
  "orderId": "sandbox-order-1",
  "kind": "order.cancelled",
  "reason": "Sandbox cancellation"
}
```

Envía primero cancelación para probar entrega desordenada. Reutiliza un ID de
evento solo con el mismo cuerpo exacto; cambiarlo produce conflicto. La fecha
firmada vale cinco minutos. No hay bucle automático de reintento ni campo de pago de origen.

## Límites operativos

La autoridad es la base local de la tienda. Los grafos de bandeja y conectores
no se aplican remotamente por sincronización genérica. Adaptadores de proveedores
reales, retención legal, conciliación, hardware y despliegue firmado requieren
validación externa. Consulta [la decisión arquitectónica](../architecture/0023-signed-external-order-inbox.md).
