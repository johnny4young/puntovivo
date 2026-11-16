# Guía de estilos

**Idioma:** Español · [English](../STYLING.md)

> Actualizado: 15 de noviembre de 2026

## Herramientas actuales

Puntovivo usa:

- Tailwind CSS v4 mediante el plugin Vite.
- Variables CSS en `styles/theme.css`, importadas por `index.css`.
- `class-variance-authority` para variantes de componentes.
- `tailwind-merge` mediante el helper compartido `cn()`.

Archivos principales:

- [index.css](../../apps/web/src/index.css)
- [theme.css](../../apps/web/src/styles/theme.css)
- [utils.ts](../../apps/web/src/lib/utils.ts)

## Modelo de tema

La aplicación admite:

- `light`
- `dark`
- `system`

El estado se administra mediante:
[ThemeProvider.ts](../../apps/web/src/components/feedback/ThemeProvider.ts).

Comportamiento:

- El navegador conserva preferencias en localStorage.
- Escritorio también las sincroniza mediante el puente Electron.
- El proveedor alterna la clase `dark` del elemento raíz.

## Sistema de color

`styles/theme.css` define:

- Variables semánticas OKLCH de fondo, texto, borde, etc.
- Paletas propias:
  - primaria
  - secundaria
  - éxito
  - advertencia
  - peligro

Se consumen en clases Tailwind como:

- `bg-primary-50`
- `text-secondary-700`
- `border-warning-500`

## Tokens de tipografía y disposición

Las fuentes van incluidas (ver [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)):

- `font-sans` (Instrument Sans): texto de la interfaz.
- `font-display` (Bricolage Grotesque, ancho 88): títulos. `h1`–`h3` la usan por defecto.
- `font-numeric` (Bricolage Grotesque, ancho 80, cifras tabulares): dinero y conteos.
- `font-mono` (DM Mono): códigos, SKU y teclas (`.pv-kbd`).

Roles de la paleta: tinta sobre papel frío para la interfaz; azul (`primary`)
para el estado en vivo y el foco; naranja solo para Cobrar (`bg-cobrar`,
`Button variant="charge"`); el `rail` marino para la navegación y el símbolo.
La severidad usa `SeverityMark`, que combina forma y color: rombo = bloquea,
medio círculo = antes de cerrar, círculo vacío = cuando pueda, check = listo.

Reglas: sin barra de color en el borde izquierdo de filas, tarjetas o avisos
(use un fondo teñido, el peso, un ícono o un borde completo); una acción
principal por pantalla; contraste de texto de al menos 4.5:1 en claro y oscuro
(`scripts/check-contrast.mjs`).

## Patrón de variantes de componentes

Las primitivas usan CVA cuando importan las variantes, como botones e insignias.

Patrón habitual:

1. Define clases base.
2. Define variantes nombradas.
3. Define variantes predeterminadas.
4. Combina mediante `cn()`.

Así se tipan las APIs y se evita repetir condiciones de clases.

## Patrones actuales de experiencia

### Colores de respuesta

- Éxito usa verde.
- Advertencias usan ámbar.
- Acciones destructivas/errores usan rojo.
- Superficies informativas/neutras usan la paleta secundaria.

### Lenguaje de tarjetas y paneles

La aplicación prefiere:

- Paneles redondeados.
- Bordes sutiles.
- Fondos secundarios claros para información neutra.
- Tarjetas de estado coloreadas para advertencias, éxito y resúmenes.

### Pantallas basadas en tablas

Las tablas siguen siendo un modelo de interacción dominante.
Los estilos compartidos incluyen:

- Franja de exportación.
- Esqueletos de carga.
- Estado de reintento/error.
- Navegación con teclado.

## Reglas para interfaz nueva

- Usa primitivas compartidas antes de inventar componentes base.
- Usa clases de paleta semántica en vez de hexadecimales puntuales.
- Mantén acciones destructivas coherentes con confirmaciones existentes.
- Mantén estilos específicos dentro de la función salvo que sean reutilizables.
- Prefiere ampliar tokens de `index.css` o APIs de variantes antes de crear utilidades aisladas.

## Aspectos pendientes conocidos

- El tamaño de dependencias de exportación/informes sigue generando avisos de build.
- Algunos módulos tienen mejor adaptación a pantallas que otros.
- El trabajo visual futuro debe seguir alineando pantallas antiguas con primitivas de tablas y respuesta.
