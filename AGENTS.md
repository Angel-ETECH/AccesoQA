# Instrucciones del proyecto

- Implementa solo la fase autorizada y conserva los límites descritos en `README.md`.
- Mantén TypeScript estricto y coloca contratos compartidos en `packages/shared`.
- La API debe enlazarse únicamente a `127.0.0.1`.
- No añadas resultados de auditoría de muestra que parezcan reales.
- Conserva el proxy de loopback y la validación de cada solicitud/redirección. Una solicitud externa bloqueada o un fallo de análisis debe producir estado failed, nunca un resultado limpio.
- La entrega actual incluye auditorías individuales, flujos, historial, comparación conservadora y exportación JSON/HTML autorizados. No infieras correcciones con análisis fallidos, incompletos o puntos no equivalentes.
- Los flujos admiten únicamente navigate, click, fill y visible. Usa localizadores por etiqueta, rol/nombre exacto o data-testid; los valores de relleno son plantillas ficticias predefinidas.
- Conserva el mutex compartido entre flujos y páginas. Un paso fallido debe dejar los pasos pendientes como skipped, nunca completed. Mantén los snapshots de ejecuciones al editar un flujo.
- Nunca guardes secretos, capturas, informes ni bases de datos de uso en Git. Usa `data/` (ignorada por Git).
- La persistencia debe permanecer detrás de `apps/api/src/db`; la lógica HTTP no debe manipular SQL directamente.
- Revisa `docs/architecture.md` antes de cambiar límites entre componentes o el modelo de datos.
- Comandos principales: `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`.
