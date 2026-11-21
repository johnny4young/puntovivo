# 0038: zonas de la caja por perfil de negocio

**Idioma:** Español · [English](../../architecture/0038-register-zones-by-profile.md)

> Estado: Aceptado
> Fecha: 21 de noviembre de 2026

## Contexto

Los presets de módulos encienden o apagan superficies completas (POS táctil,
pantalla de cocina, mesas), pero Vender de escritorio se veía igual para todos
los negocios. Una droguería veía teclas de un toque y un atajo de fiado que no
usa, y una tienda veía la propina de restaurante en cada cobro.

## Decisión

- `packages/shared/src/register-zones.ts` es el registro único de zonas de la
  caja y de la matriz por perfil. Tienda cubre la tienda de barrio y el
  minimercado, así que lleva la unión de sus zonas. Un negocio sin perfil
  conserva todas las zonas.
- La barra única y el cobro (total, Cobrar, novedades) quedan siempre
  encendidos.
- El administrador ajusta zonas sueltas en `tenants.settings.registerZones` con
  `registerZones.set`, auditado. Un valor igual al del perfil borra el ajuste y
  la zona vuelve a seguir al perfil; los ajustes sobreviven a un cambio de
  perfil.
- Los ajustes llegan a cada caja por la proyección de ajustes de `auth.me`, al
  iniciar sesión, cambiar de usuario o reiniciar, igual que el perfil del
  negocio. `useRegisterZone` resuelve perfil, ajuste y módulo en el cliente.
- Sentar un ticket en una mesa pasa por el aviso de suspender, así que la zona
  de mesas también muestra Suspender.
- Los módulos siguen siendo la puerta de las superficies: una zona que necesita
  un módulo (mesas necesita servicio en mesa, cotización necesita cotizaciones)
  solo aparece con ese módulo activo.
- Toda zona fuera del motor se puede cambiar.
- Las zonas solo ocultan controles de la caja. Precios, promociones,
  cumplimiento (lote, fórmula) y ventas ya en espera siguen funcionando con su
  zona apagada.

## Consecuencias

- Sin migración: el ajuste vive en el JSON de ajustes existente.
- Zonas conectadas hoy: teclas de un toque, teclas por valor, fiado (la barra de
  cuenta con su abono, Fiar junto a Cobrar y el cobro), ventas en espera, avisos de descuento por vencimiento
  (líneas del ticket, teclas y búsqueda de productos), el selector de unidad en
  la búsqueda de productos, el aviso de cotización, acciones de mesa al
  suspender, propina y dividir cuenta.
- Con la zona de unidades apagada, la búsqueda de productos vende la unidad
  base; un código de barras de una presentación sigue vendiendo esa
  presentación.
- El POS táctil conserva su grilla de catálogo; las zonas dan forma a Vender de
  escritorio y a su vista de teléfono.
