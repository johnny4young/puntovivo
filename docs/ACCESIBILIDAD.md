# Accesibilidad en Puntovivo

> Documento orientado a equipo comercial, pre-venta y auditores.
> Para el detalle de ingeniería ver [A11Y.md](./A11Y.md).

Puntovivo se diseña para que cualquier operador pueda usar el punto de venta sin barreras: con teclado, con lector de pantalla, con baja visión, o con limitaciones motrices. Este documento explica el compromiso de accesibilidad del producto y cómo se respalda con evidencia técnica revisable.

## Compromiso

Puntovivo se construye para cumplir **WCAG 2.2 nivel AA** — el estándar internacional de accesibilidad publicado por el W3C que cubre contraste de color, navegación por teclado, etiquetas accesibles, manejo de foco, y compatibilidad con lectores de pantalla. La conformidad no es un esfuerzo aislado sino una regla de calidad continua: cada cambio que toca la interfaz pasa por las mismas verificaciones automáticas que protegen al producto contra regresiones.

## Por qué importa en Latinoamérica

Varios países de la región tienen marcos regulatorios que exigen criterios de accesibilidad en software comercial y de servicios:

- **Colombia — Ley 1346 de 2009** ratifica la Convención sobre los Derechos de las Personas con Discapacidad (CDPD) y obliga al Estado y a sectores regulados a garantizar acceso a información y comunicaciones, incluyendo soluciones de software comercial.
- **México — NMX-R-050-SCFI-2006** es la norma mexicana de accesibilidad en espacios y servicios comerciales; en el ámbito digital se complementa con el marco federal de inclusión y con criterios WCAG adoptados por la administración pública.

Cumplir WCAG 2.2 AA permite que Puntovivo se proponga sin objeciones a:

- clientes enterprise con políticas de compras inclusivas,
- licitaciones públicas y procesos con cliente gubernamental,
- cadenas con empleados que requieren adaptaciones razonables en su puesto de cajero o administrativo.

No se promete una "certificación" emitida por un tercero: se ofrece un contrato de conformidad verificable, sostenido por gates automáticos en cada cambio del producto.

## Cómo se demuestra el compromiso

El cumplimiento de WCAG 2.2 AA está respaldado por tres mecanismos automáticos que corren en cada cambio del código, antes de que llegue a producción. Si alguno detecta una regresión, el cambio no se libera.

### 1. Validación axe-core en pruebas de componente

Cada componente de la interfaz puede declararse como "rastreado por accesibilidad" llamando a un helper interno que ejecuta **axe-core** — el motor de auditoría WCAG mantenido por Deque Systems, líder de la industria. El helper aplica el conjunto de reglas WCAG 2 A + AA y detiene la integración si encuentra una violación seria o crítica. La cobertura crece con cada nuevo componente sumado al producto.

### 2. Gate de contraste sobre el sistema de diseño

Los colores base del producto se modelan en el espacio perceptual OkLCh para mantener contrastes consistentes. Un verificador automático recorre cada combinación crítica del tema — fondo / texto, tarjeta / texto, botón primario / etiqueta, botón destructivo / etiqueta, popovers, paneles secundarios — y exige un mínimo de **4.5:1** (texto corporal WCAG AA) en cada par. Si una propuesta de cambio de tema baja el contraste por debajo del piso, la integración se detiene hasta que el diseñador ajuste el color.

### 3. Smoke de accesibilidad sobre las pantallas más usadas

Cada vez que se integra un cambio, una suite **Playwright** abre las pantallas más usadas del producto en Chromium real — `/login`, `/dashboard`, `/sales` (cajero y administrador), `/inventory`, `/customers`, `/products`, `/purchases`, `/orders`, `/quotations`, `/company`, `/audit-logs` — e inyecta axe-core sobre cada una. Si alguna acumula una violación seria o crítica, el cambio se rechaza.

Adicionalmente la misma suite vigila que ninguna pantalla emita errores de consola al cargarse, lo que evita que problemas accesibles silenciosos pasen desapercibidos.

## Convenciones de diseño aplicadas

- Botones sólo con ícono (campana, menú, perfil) declaran etiqueta accesible.
- Secciones colapsables y menús declaran su estado expandido y la región que controlan.
- Los modales reutilizan un componente compartido con trampa de foco, cierre con Escape y retorno de foco al disparador.
- El significado de un estado nunca se transmite únicamente con color — siempre acompaña una etiqueta de texto o un ícono.
- Los atajos de teclado del cajero se declaran con `aria-keyshortcuts` para que los lectores de pantalla los anuncien.

## Cobertura actual y trabajo en curso

Los tres gates anteriores son la línea base que todo cambio debe respetar. En paralelo se avanzan:

- una verificación end-to-end de la pantalla `/ventas` operada solamente con teclado,
- una revisión con lectores de pantalla (VoiceOver y NVDA) sobre los flujos de cajero y administrador,
- la extensión del smoke a pantallas con módulos opcionales activos (KDS, display de cliente, surface táctil).

Estas piezas se rastrean en el roadmap interno como sub-ítems del ticket de accesibilidad y se publican aquí cuando aterrizan.

## Cómo verificarlo

Cualquier auditor externo o cliente puede solicitar acceso al código y ejecutar los mismos gates que corren en integración continua. El detalle técnico y los comandos exactos viven en [A11Y.md](./A11Y.md). Cualquier hallazgo se considera un defecto que el equipo de producto resuelve en la integración correspondiente.
