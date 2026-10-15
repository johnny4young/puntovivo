# 0010: evidencia de política de horas extra

**Idioma:** Español · [English](../../architecture/0010-labor-overtime-policy.md)

> Estado: aceptada
> Fecha: 15 de julio de 2026

## Decisión

Puntovivo deriva horas extra como evidencia por país y fecha efectiva desde
intervalos inmutables de asistencia; no guarda un total mutable ni afirma un importe final de nómina.

La base revisada vive en `packages/server/src/services/labor/overtime-policy.ts`.
Cada perfil tiene ID estable, fecha efectiva, umbrales diarios/semanales legales cuando pueden demostrarse,
con fuentes oficiales y límites explícitos; el mismo catálogo define recargos
admitidos. `overtime-calculator.ts` resta descansos auditados, divide trabajo
por zona horaria del negocio y asigna tiempo ordinario antes de extra sin
contar los mismos segundos bajo reglas diarias y semanales.

Incluye todos los turnos del empleado en el negocio y la semana laboral completa.
Filtrar sede solo cambia filas visibles; no oculta horas de otra sede ante el
umbral semanal. Los resultados siguen siendo orientativos porque aún faltan
horas contractuales, acuerdos colectivos, festivos/descansos sustituidos y algunos horarios autorizados.

## Alternativas rechazadas

- **Guardar totales por turno:** umbrales y correcciones tienen fecha efectiva;
  los derivados quedarían obsoletos o exigirían reescritura destructiva de historia.
- **Calcular solo sede o página solicitada:** la semana aplica al trabajo del
  empleado en todo el negocio, sin cambiar con paginación ni filtros del gerente.
- **Devolver automáticamente dinero de nómina:** faltan datos contractuales,
  festivos, acuerdos y salarios para afirmar un importe final.
- **Una regla atemporal por país:** Colombia y Chile tienen transiciones
  legisladas; una regla estática clasificaría mal semanas históricas y futuras.

## Impacto de implementación

- `packages/server/src/services/labor/overtime-policy.ts` controla perfiles
  revisados CO, MX, CL, PE y AR, fuentes oficiales y códigos de limitación.
- `packages/server/src/services/labor/overtime-calculator.ts` clasifica de forma
  pura asistencia/descansos en zona del negocio.
- `packages/server/src/services/labor/attendance-report.ts` amplía la ventana a
  semanas completas y todas las sedes para empleados visibles en la página.
- `apps/web/src/features/staff/TeamAttendancePanel.tsx` muestra duración
  ordinaria/extra, recargos, perfil aplicado, procedencia oficial y aviso orientativo.
- Exportaciones futuras de nómina/contabilidad deben consumir duración/categorías
  y sumar contrato/tasas/calendario; no duplicar umbrales por país.

## Mapa de implementación

- Turnos, evidencia de asistencia, horas extra y futuras exportaciones de nómina.
- Repartir propinas por horas debe usar los mismos límites de trabajo neto.
- Nómina electrónica colombiana sigue condicionada, pero consumirá duración
  clasificada y datos específicos de nómina.

Actualizado: 15 de julio de 2026, aceptada.
