# 0040: avisos push al dueño desde el servidor local

**Idioma:** Español · [English](../../architecture/0040-owner-web-push.md)

> Estado: Aceptado
> Fecha: 2026-11-22

## Contexto

El dueño sigue la tienda desde el Companion en el teléfono. Una aprobación que
espera en caja, un relevo recibido o el día sellado solo se veían con el
Companion abierto. El servidor es local primero: puede estar sin conexión y
nunca debe esperar a un teléfono para cerrar una venta, un relevo o el día.

## Decisión

- Web Push estándar (RFC 8030) con VAPID (RFC 8292) y cifrado aes128gcm
  (RFC 8291), sobre `node:crypto` y sin dependencias nuevas. El servicio push
  que eligió el navegador solo transporta texto cifrado que no puede leer; el
  cifrado coincide con el vector de prueba de RFC 8291.
- Un par de llaves VAPID por instalación, creado al primer uso y guardado en
  `app_settings` con la mitad privada sellada (AES-256-GCM) con una llave
  derivada de la llave de la base de datos, que el escritorio guarda en el
  llavero del sistema. Sin llave de base de datos no hay avisos. Un par sellado
  con una llave anterior se reemplaza y sus suscripciones se descartan; cada
  persona vuelve a activar los avisos.
- `push_subscriptions` (migración aditiva 0107) guarda una fila por endpoint
  del navegador, de una sola persona, con las llaves del navegador selladas y
  atadas al endpoint. Es local de la instalación y nunca se sincroniza. Volver
  a suscribir un endpoint lo pasa a quien lo hizo solo con las mismas llaves
  del navegador; cada persona tiene diez como máximo. Cada fila guarda la
  versión de sesión del dueño al activar, así revocar sus sesiones silencia
  todos sus teléfonos hasta que vuelva a activar los avisos.
- Se activa por persona desde el Companion, para administradores y gerentes con
  el módulo Companion encendido. Cerrar sesión en el Companion quita primero
  este teléfono.
- Tres eventos: una solicitud de aprobación espera (a quienes su rol permite
  aprobarla), se recibe un relevo de caja y se sella el día (administradores y
  gerentes). Nadie recibe aviso de su propia acción. El texto se arma en el
  servidor en el idioma elegido al activar; los nombres de clientes nunca viajan.
- El envío ocurre después de confirmar la escritura, no se espera y nunca lanza
  errores al procedimiento. Los endpoints deben ser hosts HTTPS públicos en el
  puerto por defecto y se fija su DNS en cada envío, con la misma política de
  destino de los webhooks. Un 404 o 410 elimina la suscripción. No hay cola ni
  reintentos: un aviso tardío de una aprobación o un relevo es peor que ninguno.

## Consecuencias

- Una instalación con internet llega al teléfono del dueño a través del
  servicio push del navegador; una sin conexión simplemente no envía nada.
- Las solicitudes creadas en otro nodo y replicadas por sincronización no
  avisan desde el nodo que las recibe; avisa el nodo que tomó la solicitud.
- El service worker del Companion gana los manejadores `push` y
  `notificationclick`; un toque abre o enfoca el Companion y nunca sale de su
  origen.
