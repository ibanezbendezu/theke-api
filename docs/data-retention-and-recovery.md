# Retención y recuperación para el piloto

## Política inicial

- Archivar conserva la identidad canónica y permite restaurar.
- Eliminar retira el contenido de los sistemas activos y fija `purge_after` a 30 días. El purgado físico solo puede ejecutarse después de esa fecha.
- Eliminar un Proyecto no elimina los Recursos canónicos reutilizados.
- Las operaciones destructivas recalculan impacto en una transacción serializable, requieren una frase exacta y son idempotentes.
- Una restauración de backup debe reaplicar primero la lista de filas con `deleted_at`/`purge_after`; nunca debe reactivar contenido pendiente de purga.

## Objetivos

- RPO: 24 horas.
- RTO: 4 horas.
- Restore drill: mensual, en un entorno aislado, verificando PostgreSQL, objetos y referencias cruzadas.

## Gate externo previo al piloto

Estas acciones requieren credenciales y aprobación operativa; no se consideran activadas por el código del repositorio:

1. Habilitar snapshots diarios y PITR en Railway.
2. Crear un bucket Backblaze B2 privado con Object Lock de 30 días.
3. Programar cada noche `pg_dump` y copia incremental de objetos, con alertas de fallo.
4. Ejecutar y registrar un restore drill completo.
5. Aprobar las políticas de exportación ZIP, eliminación de cuenta y retención de compartidos/comentarios a 90 días.

No debe habilitarse el piloto externo hasta cerrar y evidenciar los cinco puntos.
