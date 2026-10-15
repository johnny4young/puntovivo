# Evidencia de prenómina de Colombia y límite de aprobación

**Idioma:** Español · [English](../../architecture/0030-colombia-pre-payroll-evidence.md)

Estado: Aceptado

## Decisión

Puntovivo ofrece un espacio de prenómina de Colombia exclusivo para administradores, para preparar, revisar y aprobar evidencia interna trazable. No es un motor de nómina legal, un transmisor de nómina electrónica, un operador PILA ni una certificación jurídica o contable. El texto visible para el usuario y los datos exportados deben conservar ese límite.

Los perfiles de nómina de empleados son registros privados con vigencia definida, separados de las asignaciones laborales operativas. Una corrección de perfil finaliza o anula la evidencia anterior y agrega un sucesor o evento; nunca sobrescribe el historial. Los períodos son ventanas semiabiertas de fechas comerciales de como máximo 31 días y deben caber dentro de una versión de política revisada. Una liquidación regular es única por período. Las liquidaciones de ajuste hacen referencia a una liquidación original aprobada y no pueden generar silenciosamente un segundo salario automático; las correcciones requieren conceptos explícitos revisados.

Cada cálculo crea una nueva revisión inmutable. Una liquidación avanza de manera monótona de `draft` a `reviewed` y luego a `approved`, y la aprobación congela una revisión completa exacta. Las filas aprobadas no pueden editarse ni eliminarse. Las correcciones posteriores son nuevas liquidaciones de ajuste, no modificaciones de evidencia aprobada.

## Autoridad de cálculo y política ante fallos

El servidor deriva el conjunto autorizado de empleados de todos los perfiles de nómina y asignaciones laborales no anulados cuyos intervalos de vigencia intersecan el período. Recorta cada empleado al intervalo activo común y bloquea la operación por seguridad ante evidencia faltante, ambigua, de distintas sedes o países, o sin intersección. Un empleado inactivo sigue formando parte de un período histórico cuando su evidencia de vigencia se superpone con él.

La asistencia por horas se carga como una instantánea transaccional acotada, incluidas las correcciones aprobadas, descansos y conciliaciones. La evidencia abierta, superpuesta o excesiva bloquea al empleado o la liquidación en vez de fabricar horas. Los importes mensuales, las bases de aportes revisadas, la retención, la revisión de prestaciones y los conceptos manuales siguen siendo entradas explícitas del operador. Los cálculos monetarios intermedios usan el contrato compartido de dos decimales de `roundMoney`.

La preparación devuelve un token determinista de autoridad sobre la evidencia exacta de liquidación, empleado, perfil, contrato, asistencia, corrección, conciliación y política que se muestra al administrador. El recálculo vuelve a calcular ese token dentro de la transacción inmediata de escritura antes de insertar cualquier revisión. Un cambio en el origen o en el conjunto de empleados es un conflicto visible; una preparación obsoleta nunca escribe un resultado plausible.

El registro de políticas de Colombia tiene vigencia definida y congela sus URL de fuentes, fecha y hora de revisión, tasas, umbrales, estado legal y limitaciones explícitas en cada revisión de cálculo. Se rechaza un período que cruce una transición de política o que carezca de una política revisada. La política actual sigue siendo transitoria y no puede describirse como una determinación legal definitiva.

## Límite de privacidad, transacción y sincronización

Todas las escrituras de perfiles, períodos, liquidaciones, recálculos, revisiones y aprobaciones usan el sobre de comando (Command Envelope). La autoridad del actor, el tenant activo, el reloj comercial, las filas del dominio, el evento privado del ciclo de vida, la proyección de auditoría con datos mínimos por privacidad y el resultado del comando se confirman o revierten juntos. Los motivos privados, datos de identificación, entidades de aportes, sufijos de cuentas, detalles de asistencia e instantáneas de fuentes del cálculo se omiten de las cargas de auditoría genérica y del diario de comandos.

Las tablas de nómina están deliberadamente ausentes de la outbox de sincronización genérica. La aplicación remota y la replicación entre varios dispositivos permanecen bloqueadas hasta que el cifrado, el intercambio de claves, la propiedad de conflictos, la retención y la entrega al proveedor tengan un contrato explícito revisado. El esquema reserva una estructura restringida de trabajo de proveedor `sandbox_v1` para pruebas de compatibilidad, pero no se expone ningún envío al proveedor como capacidad operativa entregada.

Las lecturas son exclusivas de administradores, tienen alcance de tenant, pueden tener alcance de sede mediante la guarda compartida de tenant y sede, se paginan por clave y están acotadas. Las revisiones y eventos de liquidaciones tienen límites; la interfaz limpia el estado del editor privado después de confirmar, cancelar o cambiar de sujeto.

## Migración y validación

Las migraciones aditivas crean perfiles normalizados, períodos, liquidaciones, revisiones, resultados por empleado, vínculos de fuentes, líneas de conceptos, eventos del ciclo de vida y almacenamiento restringido de trabajos de proveedor. No inventan evidencia histórica de nómina. Los triggers de inmutabilidad y alcance de tenant protegen las rutas directas de SQLite. Las reconstrucciones transitorias de tablas usan el comportamiento heredado de renombrado con alcance limitado y recrean el trigger externo afectado para que las bases nuevas, parcialmente adoptadas, en texto plano y con SQLCipher converjan en la misma estructura.

Las pruebas unitarias y de integración cubren transiciones de políticas, redondeo exacto, superposición de perfiles y períodos, aislamiento por tenant, sede y rol, repetición idempotente, versiones obsoletas, reversión atómica, empleados de períodos parciales, tokens exactos de autoridad, asistencia superpuesta, evidencia por horas en lotes, aprobación inmutable y condiciones de ajuste congeladas desde el origen aprobado. Un recorrido compartido de Playwright ejecuta el mismo ciclo de interfaz a tRPC, SQLite y recarga en web y Electron, comprueba EN/ES y accesibilidad, y verifica que la evidencia genérica no contenga material privado de revisión.

## Consecuencias

- Los administradores deben resolver cada bloqueo mostrado y revisar explícitamente cada decisión de aportes; Puntovivo no infiere hechos legales faltantes.
- La evidencia histórica sigue siendo atribuible aunque cambien los perfiles, contratos, usuarios o políticas actuales.
- Una revisión interna completa puede respaldar la revisión y la entrega a contabilidad, pero no autoriza a pagar, presentar ni transmitir automáticamente la nómina legal.
- La nómina entre varios dispositivos y la compatibilidad con proveedores reales siguen sin estar disponibles, en vez de debilitar la privacidad o elegir silenciosamente un ganador del conflicto.

## Alternativas rechazadas

- **Calcular directamente desde la lista actual de empleados:** omite ingresos, salidas o trabajadores inactivos cuya relación se superpone con el período histórico.
- **Confiar en un arreglo de empleados preparado por la interfaz:** permite cambios de perfil, contrato, asistencia o política entre la revisión y la confirmación.
- **Editar una liquidación aprobada:** destruye la evidencia necesaria para auditoría y corrección posterior.
- **Sincronizar nómina privada mediante la outbox genérica:** carece de un contrato aceptable de claves, retención y conflictos para datos laborales sensibles.
- **Describir las tasas configuradas como cumplimiento certificado:** las pruebas automatizadas no pueden reemplazar la revisión legal, la validación de proveedores, PILA, DIAN ni un piloto real de nómina.
