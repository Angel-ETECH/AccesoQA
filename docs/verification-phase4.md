# Verificación de fase 4 — Historial y comparación

Fecha: 19 de octubre de 2026. Proyecto: `C:\Users\LENOVO\Desktop\AccesoQA`.

## Resultado

- Suite completa: **62 pruebas aprobadas en 6 archivos**, 0 fallos; duración de la última ejecución: 34,77 s.
- Se conservan las 45 pruebas anteriores de auditorías individuales, seguridad de destinos locales, flujos, persistencia e interfaz.
- Se añadieron 16 pruebas de comparación/exportación (incluidos casos parametrizados) y 1 recorrido de interfaz móvil.
- Compilación de web, API, fixture y contratos compartidos: correcta.
- TypeScript de los cuatro workspaces: sin errores.
- ESLint: sin errores.

## Comandos ejecutados

El Node global del equipo es 22. Se utilizó Node 24 temporalmente:

```powershell
npm exec --yes --package=node@24 -- npm test
npm exec --yes --package=node@24 -- npm run build
npm exec --yes --package=node@24 -- npm run typecheck
npm exec --yes --package=node@24 -- npm run lint
```

También se ejecutó primero el archivo `apps/api/src/audit/history.test.ts`: 16/16 aprobadas.

## Casos comprobados

| Caso | Resultado observado |
| --- | --- |
| Nueva incidencia | La revisión añade button-name y se clasifica como nueva. |
| Incidencia persistente | image-alt conserva identidad entre revisiones. |
| Ausencia tras revisión completa | Se clasifica como potencialmente corregida, nunca corrección definitiva. |
| Ejecución fallida, pendiente o en curso | Cero incidencias declaradas potencialmente corregidas; cobertura no disponible. |
| Punto ausente, URL distinta o secuencia modificada | No se infiere corrección. |
| Axe incomplete, motor distinto o configuración desconocida/diferente | Se excluye la comparación y se explica la causa. |
| Duplicados de regla/elemento | Se almacena un solo nodo; el resumen cuenta un elemento. |
| Cambio de HTML o impacto | Conserva identificador cuando regla, pantalla, punto y selector son equivalentes. |
| Flujo distinto, misma ejecución o orden inverso | Solicitud rechazada. |
| Historial paginado | Conserva ejecuciones completadas y fallidas; valida límites y offset. |
| Exportación JSON | Conserva ejecución, pasos, HTML original, identificadores y recuentos; un fallo mantiene findingsCount nulo. |
| Exportación HTML | Escapa HTML y scripts; Chromium no ejecuta el contenido ni solicita recursos externos. Adjunto con CSP y nosniff. |
| Interfaz móvil, 390 px | Consulta dos ejecuciones reales, compara, abre informe, descarga JSON y no desborda horizontalmente. |

La prueba de revisiones reales utiliza un servidor HTTP temporal en loopback con la misma URL para tres versiones: imagen sin alternativa, imagen más botón sin nombre y pantalla corregida. Cada versión se analiza con Playwright y axe, y los resultados se guardan en SQLite antes de compararlos. Las pruebas unitarias usan datos controlados únicamente dentro del código de pruebas; no se agregaron resultados ficticios a los proyectos del usuario.

La primera ejecución completa detectó claves React duplicadas entre el panel de flujos y el historial. Se corrigieron usando claves distintas y se repitió la suite completa con éxito.

## Límites de interpretación

Las comparaciones solo aplican a puntos equivalentes con motor y configuración conocidos, en ejecuciones completas. La misma URL y secuencia no prueban que datos y estado dinámico sean idénticos. Cambios de selectores pueden cambiar la identidad; toda ausencia sigue siendo potencial y requiere revisión humana. Un análisis con revisiones manuales pendientes excluye el punto completo de la comparación.

Las ejecuciones anteriores a la migración 4 conservan su historial pero tienen config_key nulo y no se comparan automáticamente. No se calcula puntuación ni se declara cumplimiento WCAG. La explicación técnica está en `docs/architecture.md`.

Las pruebas usan bases y servidores temporales; no borran ni sustituyen el historial de desarrollo. Los informes se generan al descargarlos y no se guardan automáticamente en el repositorio.
