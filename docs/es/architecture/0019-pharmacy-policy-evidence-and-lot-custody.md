# 0019: política farmacéutica, evidencia y custodia de lotes

**Idioma:** Español · [English](../../architecture/0019-pharmacy-policy-evidence-and-lot-custody.md)

> Estado: aceptada
> Fecha: 2 de septiembre de 2026

## Contexto

Una farmacia no es solo una etiqueta minorista. Identidad del medicamento,
país, autoridad profesional, receta, lote, retiro y fecha participan en dispensar.
Si fueran solo presentación, una línea vencida, en cuarentena, retirada, no
admitida o sin documentación alcanzaría una venta válida.

Las recetas son sensibles y sync actual no aplica atómicamente medicamento,
política, evidencia, dispensación, retiros y custodia entre dispositivos.
Es más seguro mantener agregados locales hasta definir ese contrato que
presentar replicación parcial como completa.

## Decisión

### Perfil y política efectiva

- `pharmacy` es preset explícito sobre núcleo minorista. Cambia módulos,
  nunca productos o stock.
- `pharmacy_product_profiles` es extensión uno a uno del negocio. Medicina debe
  controlar stock/lotes, sin series; no adopta silenciosamente inventario,
  borradores, lotes, evidencia o identidad de retiro existentes.
- Cambiar requisito de cadena fría con stock/borrador abierto también rechaza.
  Un checkbox no prueba custodia anterior; adopción guiada futura debe poner en
  cuarentena/verificar lotes exactos antes de liberar.
- `PharmacyPolicy` depende de país, fecha y clasificación. La política CO v1
  permite OTC, exige cliente, receta y aprobación profesional vigente para
  medicamentos de receta y mantiene controlados desactivados. País sin
  adaptador revisado permite solo OTC; receta/controlados se rechazan.
- Validez usa día IANA del negocio resuelto en servidor. Toda escritura regulada
  revalida versión regional, país/zona y día bajo escritor inmediato: cambio
  regional concurrente o cruce de medianoche no confirma política vieja.

### Evidencia mínima y autoridad profesional

- Referencia, prescriptor, documento de comprador y notas solo se guardan en
  sobre AES-256-GCM. HMAC separado detecta duplicados sin revelar referencia.
  Listas ordinarias, auditoría y outbox no contienen sobre, digest ni texto plano.
- Aprobar autentica sobre/digest de negocio/producto, revalida política/campos y
  liga a autorización activa por país, sede y día. También autentica credencial
  sellada, digest de país y tipo. Períodos renuevan sin superposición; una
  credencial no cambia de empleado.
- Con varias credenciales, sede exacta precede global; fecha efectiva, creación
  e ID desempatan. Credencial ganadora corrupta bloquea, sin recurrir a una más amplia.
- Completar autentica evidencia de nuevo, verifica aprobador congelado, asigna
  cantidad por vencimiento determinista y avanza versiones.
  `pharmacy_dispensations` congela línea, producto, cliente, política,
  autorización, evidencia, cantidad y día dentro de venta. Borrador no consume.
  Autorización luego revocada, vencida, inactiva, incompatible o corrupta
  bloquea receta aún válida hasta reaprobación explícita de esa fila sellada
  por empleado vigente. Solo cambia vínculo de aprobación, conserva referencia
  y cantidad restante, con auditoría; aprobación aún efectiva no se repite redundantemente.
- Cobro devuelve solo prefijo FEFO requerido por medicamento. Proyección y
  recuperación comparten límite de 200 IDs con completar; demasiada fragmentación
  rechaza en vez de ofrecer preflight imposible. Lookup usa índice de
  negocio/cliente/producto/política.

### Estado de lote, retiro y custodia

- Solo lote activo no vencido en día del negocio es vendible. `expired`,
  `quarantined`, `recalled` y `depleted` no; devolver cantidad no borra estado más fuerte.
- `inventory_lot_events` es append-only: activación, cuarentena, incidente frío,
  retiro, liberación, destrucción, devolución al proveedor y custodia. Reconstruye
  retiro en páginas acotadas nuevas primero hasta probar estado subyacente.
  Destruir/devolver conserva producto, sede, lote, cantidad y estado exactos.
- Retiro congela ámbito producto/lote/proveedor/registro sanitario normalizado
  y materializa lotes. Linaje de transferencias propaga por enlaces no anulados.
  Cerrar retiro no reactiva; liberar separado solo si ningún retiro activo cubre el lote.
- Compras, retornos, transferencias, anulaciones y operaciones exactas conservan
  no vendibilidad y procedencia. Transformación minorista rechaza medicamentos
  hasta un flujo regulado separado revisado.

### Límites de lectura, interfaz, búsqueda y replicación

- Detalle da motivos no sensibles para bloquear solo cambios que rechazará
  el servidor. Cobro recibe requisitos/IDs, nunca PII de receta.
- Búsqueda usa carriles exactos/FTS5 por negocio sobre nombres comercial/genérico,
  ingrediente, fabricante, código, SKU y registro. Carriles compatibles de
  `products.list` y `products.search` evalúan metadatos solo si el negocio tiene
  perfil farmacéutico. Manda propiedad, no preset; salir del preset conserva
  búsqueda. Perfil de 50,000 productos sigue gate con presupuestos separados minorista/farmacia.
- Gerentes/admin operan lotes, evidencia, autorizaciones y retiros. Contactos
  PII de retiro solo admin; gerente recibe IDs; cajero no abre investigación.
- Credencial actual corrupta desactiva aprobación y muestra integridad, pero no
  desconecta lotes/retiros/recuperación no relacionados. Aprobar/cobrar siguen
  rechazando hasta reemplazo administrativo y reaprobación profesional de cada
  receta válida vinculada. Clave de proceso ausente requiere otra recuperación:
  no revoques autorizaciones válidas; restaura clave/servicio protegido para verificarlas.
- Preset controla defaults, no visibilidad del ciclo. Farmacia de Inventario
  sigue descubrible si queda perfil, autorización, receta o retiro incluso
  tras cambiar vertical. La relevancia es del negocio, sin inferir eliminación de estado preservado.
- Perfiles, autorizaciones, recetas, dispensaciones, retiros y eventos son
  `local_only`. Aplicación remota espera codec agregado e intercambio de claves
  para validar/confirmar todo atómicamente. Filas terminales son trazas de
  soporte sujetas a retención; barrerlas nunca borra tablas reguladas, custodia ni auditoría.

## Consecuencias

- Un pago válido no evita política, receta, profesional, lote ni vendibilidad.
  Fallar revierte venta, stock, dispensación, auditoría, bandeja y resultado juntos.
- Evidencia se protege de lecturas ordinarias y autentica en cada decisión
  irreversible. La clave portable vive dentro de SQLCipher; no resiste si
  también se compromete la clave de la base.
- Inventario existente requiere adopción guiada, no historia regulatoria
  inventada. Preparaciones y recetas electrónicas multiproducto siguen diseños futuros separados.
- Son contratos operativos, no certificación legal, guía clínica, permiso de
  controlados, integración de registro, validación de frío ni aprobación de INVIMA u otra autoridad.

## Alternativas rechazadas

- **Solo nombre de preset minorista:** no expresa política, profesional, consumo de receta ni retiro.
- **Receta en notas de producto/venta:** expone PII a catálogo, auditoría, sync,
  inspección de backup y soporte ordinarios.
- **Aprobar sin abrir sobre:** cifrar en reposo no detectaría sustitución/corrupción al dispensar.
- **Reactivar retorno/transferencia:** borra retiro, cuarentena o vencimiento al mover custodia.
- **Receta sin política con aviso:** transforma falta de revisión en override inseguro.
- **Replicar filas independientes:** receptor vendería base antes de recibir restricciones necesarias.

## Evidencia de verificación

- `packages/server/src/__tests__/pharmacy-policy.test.ts`
- `packages/server/src/__tests__/pharmacy.test.ts`
- `packages/server/src/__tests__/pharmacy-keyring.test.ts`
- `packages/server/src/__tests__/inventory-lots-router.test.ts`
- `packages/server/src/__tests__/lot-procurement-transfers.test.ts`
- `packages/server/src/__tests__/inventory-transformations.test.ts`
- `packages/server/src/__tests__/perf-product-search-profile.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/products/ProductFormModal.test.tsx`
- `apps/web/src/features/sales/SalePharmacyEvidenceSection.test.tsx`
- `apps/web/src/features/inventory/PharmacyOperationsPanel.test.tsx`
- Migración `0058_pharmacy_policy_lot_recall.sql`.

Comprobaciones web/Electron también deben probar interfaz→tRPC→SQLCipher,
persistencia al recargar, EN/ES y consola limpia. Dispositivos, revisión legal,
registros y despliegue de producción siguen gates externos.
