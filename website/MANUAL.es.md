# Mantenimiento del manual de usuario

**Idioma:** Español · [English](MANUAL.md)

Las rutas existentes `/docs` y `/en/docs` renderizan `src/pages-content/Docs.astro`.
Los textos para usuarios están en `src/content/manual/es.json` y `en.json`,
separados de los archivos de idioma de marketing. Conserva los mismos
identificadores estables de tareas y enlaces relacionados en ambos idiomas.
Todo el contenido se renderiza de forma estática; la búsqueda local es una
mejora progresiva y nunca envía consultas a un servicio.

Antes de actualizar instrucciones, inspecciona la pantalla correspondiente de la
aplicación, las restricciones por rol y módulo y el comportamiento del servidor.
Los archivos de referencia están fijados a la versión documentada en `Docs.astro`;
revisa esa etiqueta junto con ambos avisos de versión cuando un nuevo release
se convierta en la referencia. Un PR fusionado no demuestra que exista un
instalador publicado. Mantén los cambios de impresión aún no publicados por
separado hasta que el release los incluya y nunca deduzcas la validación de una
impresora física a partir de pruebas automatizadas. Reutiliza las guías de
migración, atajos, estado y referencias técnicas en lugar de traducirlas aquí.

Ejecuta `pnpm test` y `SITE_BASE_PATH=/ pnpm build` desde `website/`. Las pruebas
de integración de compilación existentes también validan ambos idiomas del
manual, los enlaces internos y las anclas bajo `/`, `/puntovivo` y `/puntovivo/`.
Comprueba la búsqueda, los estados vacíos y de restablecimiento, los enlaces a
tareas después de filtrar, el foco de teclado, el cambio de idioma con un hash
de tarea, el diseño móvil, el contraste del tema y la lectura sin JavaScript en
una vista previa en vivo. Usa un puerto localhost exclusivo y un contexto nuevo
de navegador sin interfaz gráfica; el manual no necesita ningún proceso del
punto de venta ni base de datos del negocio.
