# Guía de estilos

**Idioma:** Español · [English](../STYLING.md)

> Actualizado: 9 de abril de 2026

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

El tema también define:

- `--font-sans`
- `--font-mono`
- Espaciado propio.
- Sombras propias.
- Animaciones propias.

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
