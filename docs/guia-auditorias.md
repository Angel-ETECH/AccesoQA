# Auditorías, historial e informes

## Auditar una página

1. Selecciona un proyecto y comprueba la URL mostrada.
2. Pulsa **Ejecutar auditoría**. Solo puede haber una ejecución activa, individual o de flujo.
3. Espera el estado final. El panel consulta el progreso automáticamente; no hay porcentaje estimado.
4. Revisa el resumen y filtra por impacto. Abre el detalle para consultar regla, referencia técnica, selector, HTML y explicación.

| Estado | Interpretación |
| --- | --- |
| Pendiente | La solicitud se guardó y espera el inicio del motor. |
| Ejecutándose | Chromium está trabajando. |
| Completada | El análisis terminó; revisa incidencias y comprobaciones pendientes de revisión manual. |
| Fallida | Hubo un error. No equivale a cero problemas. |

El límite total es 45 segundos para páginas. La navegación y conexión tienen sus propios límites. Un servidor inaccesible, respuesta HTTP de error, timeout o solicitud no autorizada produce fallo. Puedes corregir el problema y ejecutar otra auditoría: la ejecución fallida permanece en el historial.

## Consultar resultados anteriores

La sección **Historial y comparación** muestra páginas y flujos ordenados por fecha, 20 por página. Se actualiza al terminar auditorías en este panel; **Actualizar historial** permite sincronizar manualmente. **Anterior/Siguiente** recorren las páginas. Abre **Ver ejecución** para consultar una ejecución específica, incluidos pasos fallidos y resultados parciales.

Los recuentos del historial representan elementos por punto de control. La tabla individual agrupa por regla; por ello una regla que afecte a varios nodos puede producir más elementos que filas. No hay puntuación de accesibilidad.

## Comparar revisiones

1. Selecciona una ejecución de flujo en **Base de comparación**.
2. Elige otra posterior del mismo flujo en **Revisión posterior**. Puedes conservar la base y cambiar de página del historial.
3. Pulsa **Comparar ejecuciones** y revisa cobertura, motivos de exclusión y detalles.

- **Nueva**: elemento/regla observado solo en la revisión equivalente.
- **Persistente**: la identidad aparece en ambas.
- **Potencialmente corregida**: ya no aparece tras un análisis completo equivalente; necesita revisión humana.
- **Sin comparar**: no hay evidencia equivalente suficiente.

Las ejecuciones deben estar completas, con pasos terminados y puntos esperados presentes. Se exige misma secuencia previa, URL final exacta, motor/configuración y cero incomplete en cada punto comparable. Si falla una ejecución no se infieren correcciones. Las auditorías anteriores a la firma de configuración se conservan sin comparación automática.

## Exportar

Abre una ejecución y pulsa **Exportar JSON** o **Exportar HTML**. JSON conserva datos estructurados, identificadores, resumen, estado y limitaciones. HTML es un archivo autónomo sin JavaScript ni recursos externos; muestra el contenido auditado escapado como texto. También puedes exportar una auditoría fallida para documentar el error.

Los archivos pueden contener fragmentos de páginas y datos visibles. Guárdalos localmente según tu política de datos. No los subas al repositorio. La ausencia de incidencias automáticas no acredita cumplimiento WCAG.
