# Configuración de impresoras de recibos

**Idioma:** Español · [English](../PRINTER-SETUP.md)

## Impresoras USB en Windows

1. Instala el controlador del sistema operativo adecuado para el modelo.
   Confirma que una página de prueba de Windows se imprima por el puerto y la
   cola USB correctos.
2. En PuntoVivo, abre **Empresa > Dispositivos** y elige **Sistema (diálogo de impresión)**. El nombre del dispositivo en PuntoVivo no selecciona
   ni detecta una impresora del sistema operativo.
3. En **Impresora del sistema en este equipo**, actualiza la lista y selecciona
   la cola real. Los mismos controles están disponibles en los ajustes de
   impresión de recibos de la empresa. Esta preferencia se guarda por empresa
   en esta instalación; no se sincroniza.
4. Configura en el controlador el tamaño del papel según el rollo, por ejemplo,
   58 mm, y elige una plantilla del mismo ancho para las ventas nuevas.
   Las reimpresiones históricas conservan su plantilla guardada: cambiar la
   predeterminada no las modifica.
5. Elige **Imprimir ticket de prueba**, selecciona la impresora en el diálogo
   nativo y revisa el papel. **Verificar registro** solo comprueba el registro
   del periférico. Que el sistema acepte el trabajo no demuestra que haya
   salido papel.
6. Activa la impresión automática si la necesitas. La impresión silenciosa usa
   la cola local seleccionada explícitamente. Los perfiles anteriores sin
   selección abren un diálogo; si la cola seleccionada no está disponible,
   la operación falla sin enviar el trabajo a otra impresora.

Cancelar no programa un reintento. Tras un fallo o tiempo de espera agotado,
revisa la cola de Windows y la impresora antes de volver a intentar: una
finalización tardía podría generar un duplicado. Usa **Actualizar impresoras**
después de reconectar el dispositivo.

## Impresoras ESC/POS de red

Elige **ESC/POS térmica > Red (TCP)** únicamente si la impresora es accesible
por la red local. Ingresa su dirección privada real y el puerto de impresión
compatible (9100–9103). Conectar un cable USB no proporciona una dirección TCP.
El formulario no guarda una IP de ejemplo. Selecciona 58 u 80 mm según el rollo.

Los transportes ESC/POS directos por USB y puerto serie no están implementados.
Cambiar el JSON avanzado a USB o instalar una dependencia de Node no los
habilita. Para una impresora conectada por USB, usa Sistema y el controlador
del sistema operativo.

Al cambiar entre Sistema y ESC/POS se conserva la elección de impresión
automática, se eliminan los campos incompatibles y se mantiene el borrador de
red mientras el formulario está abierto. Guardar otro método invalida el
resultado de la prueba anterior. Las pruebas fallidas muestran el diagnóstico,
además de su estado.

## Recuperación de la cola

Un fallo ESC/POS puede dejar un reintento persistente en la cola. Nunca abre
una segunda impresión por Sistema de forma automática. Revisa **Operaciones**
antes de imprimir otra copia deliberadamente. Cambiar a Sistema una impresora
con un trabajo ESC/POS pendiente deja ese trabajo en estado de fallo definitivo
con un diagnóstico y su contenido original. La verificación de registro de
Sistema no puede completar un trabajo ESC/POS. Después de corregir ESC/POS,
reintenta explícitamente el mismo trabajo en lugar de agregar otra copia.

## Aceptación física

Las pruebas de software y las simulaciones en macOS no certifican el
controlador de Windows ni una impresora física. Windows 11 con Xprinter
XP-58IIIT requiere la aceptación del operador en un próximo release instalado:
página de prueba de Windows, selección de la cola exacta, ticket sintético de
58 mm, textos largos y totales completos, recibo nuevo y reimpresión histórica,
cancelación, desconexión y reconexión, modo silencioso y recuperación de la cola
sin duplicados. Las pruebas unitarias, los PDF, las llamadas nativas
interceptadas y CI no implican aceptación física ni validación en Windows.
