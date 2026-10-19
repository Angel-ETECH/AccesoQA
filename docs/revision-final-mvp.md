# Revisión final integral — AccesoQA MVP local

**Fecha:** 19 de octubre de 2026.
**Proyecto:** `C:\Users\LENOVO\Desktop\AccesoQA`.
**Entorno comprobado:** Windows, Node v24.22.0 mediante npm exec, Chromium de Playwright instalado.

## Resultado y alcance

El proyecto dispone de un recorrido local demostrable: registrar proyectos, auditar páginas, ejecutar registro por pasos, consultar historial, comparar ejecuciones equivalentes y descargar informes. Se mantuvieron Fastify, React, los contratos Zod y SQLite; no se añadieron pagos, suscripciones, servicios cloud, usuarios empresariales ni IA externa.

La revisión combina inspección de código, pruebas automatizadas, navegación real con Chromium, axe sobre el panel, inspección visual de capturas y lectura de integridad de la base de uso. No es una certificación de seguridad ni de cumplimiento WCAG.

## Problemas corregidos

| Problema | Corrección |
| --- | --- |
| README todavía describía la fase 3 y negaba comparaciones ya disponibles | Se reescribió el README con instalación, demostración, modo compilado, comandos, datos y solución de problemas. |
| El historial vacío no indicaba cómo empezar | Mensajes de carga y estado vacío con el siguiente paso útil. |
| Historial requería actualizar manualmente tras cada ejecución | Sincronización al finalizar una auditoría del panel; se conserva el botón de actualización. |
| Estados históricos aparecían en inglés | Etiquetas en español para ejecuciones y pasos. |
| Un detalle anterior podía seguir visible al solicitar otro | Se limpia el detalle y se abortan solicitudes sustituidas/al desmontar; se evita iniciar acciones de detalle simultáneas. |
| Selector de revisión podía mantener un valor que ya no figuraba en la página del historial | Se invalida la revisión no visible y se conserva la base seleccionada al paginar. |
| Selector de historial provocaba 4 px de desbordamiento móvil al poblarse | Ancho y mínimo del select y su contenedor flexible corregidos; verificado a 390 px. |
| Menú móvil cerrado seguía siendo candidato al recorrido de teclado | Se oculta mediante visibility; Escape cierra el menú y devuelve el foco al botón. |
| Foco y animación necesitaban un comportamiento global claro | Foco visible y respeto de prefers-reduced-motion. |
| Eliminar un paso o reemplazar una definición no pedía confirmación | Confirmaciones nativas, con pruebas de aceptar y rechazar. No se añadieron borrados de proyectos, flujos o resultados persistidos. |
| Filtro de un punto de control podía dejar contenido vacío sin explicar el motivo | Mensaje específico para cero incidencias o ninguna coincidencia con el impacto seleccionado. |
| Fallos de conexión o respuestas HTML del proxy mostraban errores técnicos | Mensajes comprensibles para conexión, timeout y respuesta inválida; se preservan cancelaciones y errores de validación. |
| Deadline durante el lanzamiento podía dejar un Chromium tardío fuera del cierre | Se conserva la promesa de launch y se cierra el navegador aunque termine después del timeout, sin crear contexto tardío. |
| Errores de cierre inesperado del motor resultaban poco claros | Mensaje específico de Chromium, conservando la indicación de instalación cuando falta el ejecutable. |
| Apertura SQLite podía dejar el descriptor abierto si fallaba una migración | Cierre en error y busy_timeout de 5 s. Se mantienen transacciones, WAL y claves foráneas. |
| No había comando para demostrar las webs compiladas con el proxy correcto | npm start sirve API compilada y preview de ambos dist; proxy de preview explícito y puertos locales. |
| Pruebas de interfaz podían recibir recargas del servidor de desarrollo | Cachés temporales independientes, dependencias del panel predefinidas y HMR desactivado en pruebas. |

## Revisión por área

1. **Arquitectura:** SQL de negocio permanece en Repository; rutas, orquestación, navegador, proxy y comparación están separados. Los contratos son compartidos y estrictos. Se amplió TypeScript al script de verificación.
2. **URLs y flujos:** se preservan loopback explícito, validación de solicitudes/redirecciones y controles de origen. Solo cuatro acciones declarativas y valores ficticios; sin comandos ni JavaScript aportado por el usuario. El mutex sigue compartido entre páginas y flujos.
3. **Validaciones/errores:** se comprobaron payloads inválidos, URLs no permitidas, servidor inaccesible, respuestas HTTP de error, timeouts, recursos bloqueados y mensajes del cliente.
4. **Accesibilidad del panel:** axe automático en escritorio y móvil, resultados con tabla/detalle, editor y menú abierto; comprobaciones concretas de salto al contenido y Escape/foco. Cero violaciones automáticas en los estados comprobados. No equivale a evaluación manual completa.
5. **Responsive:** comprobaciones de ancho y capturas a 1440 y 390 px. Se corrigió el desbordamiento reproducido del historial; las tablas conservan desplazamiento interno.
6. **UX:** estados vacíos, feedback, etiquetas, confirmaciones, filtros y consulta de errores revisados. No se añadieron porcentajes de progreso ni puntuaciones.
7. **SQLite:** migraciones idempotentes, reapertura, snapshots y recuperación de ejecuciones interrumpidas cubiertos por pruebas. Comprobación adicional de la base real en solo lectura: quick_check=ok, sin errores de claves foráneas, 2 proyectos y 4 ejecuciones completadas, migraciones 1–4 presentes.
8. **Chromium:** mensajes de instalación ausente/cierre inesperado y deadline durante launch probados de forma aislada.
9. **Recursos:** pruebas reales verifican navegador desconectado después de éxito, fallo y timeout y permiten otra auditoría posterior. El motor cierra proxy/sockets en finally; API espera el servicio antes de cerrar SQLite. El script de producción cierra sus procesos, servidores y navegador.
10. **Pruebas:** se mantuvieron las pruebas anteriores y se ampliaron cobertura de lifecycle, API cliente, accesibilidad, teclado, confirmaciones y compilación real. Sin resultados ficticios agregados a los proyectos de uso.
11. **Datos/exportación:** permanecen identificadores deterministas, deduplicación y comparación conservadora. JSON conserva datos y estado; HTML escapa contenido, sin JavaScript ni recursos externos. Un fallo sigue con recuento global nulo y no acredita correcciones.
12. **Instalación:** guías actualizadas para Node 24, npm ci, instalación de Chromium, inicialización, desarrollo, compilación local, copias y resolución de errores. No se reinstaló desde cero en otra máquina.

## Pruebas ejecutadas

Los comandos se ejecutaron con el prefijo `npm exec --yes --package=node@24 --` porque el Node global del equipo es 22.

| Comando | Resultado |
| --- | --- |
| npm run lint | Correcto; sin errores. |
| npm run typecheck | Correcto en cuatro workspaces y scripts. |
| npm run test:unit | 8 pruebas aprobadas en 3 archivos. |
| npm test | 76 pruebas aprobadas en 9 archivos; repetición final con cachés aisladas, 42,09 s. |
| npm run test:integration | 68 pruebas aprobadas en 6 archivos; repetición con cachés aisladas, 54,18 s. |
| npm run build | Correcto: panel, API, fixture y paquete compartido. |
| npm run test:production | Correcto sobre API compilada y webs dist; evidencia descrita debajo. |
| npm audit --json | 0 vulnerabilidades reportadas por el registro en esta ejecución; no garantiza ausencia de vulnerabilidades desconocidas. |
| GET http://127.0.0.1:4310/api/health | status: ok en la API de desarrollo existente. |
| GET panel 4311 y demo 4312 | HTTP 200 en ambas aplicaciones de desarrollo. |
| PRAGMA quick_check / foreign_key_check | ok / sin errores, sobre la base real en modo de solo lectura. |

Las pruebas de integración incluyen API, navegación real, seguridad de destinos, SQLite, flujos, comparación, exportaciones, recursos y UI; el archivo del comparador también contiene casos puros. No se suman los subconjuntos a la suite completa como si fueran pruebas diferentes.

### Demostración real de producción

Última comprobación registrada: **2026-10-19T22:40:26.467Z**; duración **7,535 s**. Servidores temporales de loopback y base aislada; API iniciada desde `apps/api/dist/server.js`, ambas webs desde Vite preview de sus dist.

- Demo defectuosa: **color-contrast, image-alt y label** detectadas realmente.
- Demo corregida: **0 hallazgos automáticos** en el análisis completo observado.
- Flujo de registro: **5 pasos completados**, **2 checkpoints**.
- Exportación JSON de la demo defectuosa: **3 elementos únicos**, ID de ejecución conservado.
- Panel compilado: **0 violaciones axe** a **1440 y 390 px** y **sin desbordamiento horizontal** en ambas vistas.
- Se inspeccionaron visualmente las capturas de escritorio y móvil. También se cubren tablas con incidencias en los recorridos de interfaz.

Evidencia local: `data/reports/mvp-production-verification.json`, `data/screenshots/mvp-production-1440.png` y `data/screenshots/mvp-production-390.png`. Son archivos ignorados por Git. Los servidores de prueba no sustituyen ni borran los datos del usuario.

### Fallos encontrados durante la revisión

Una primera repetición detectó el desbordamiento del selector y dos aserciones responsive fallaron; se corrigió y se repitieron. La comprobación TypeScript del nuevo script detectó que el servidor de Vite también puede tiparse como HTTP/2; se añadió comprobación de capacidad antes de closeAllConnections.

Otra repetición de integración tuvo un fallo por destrucción del contexto de navegación al capturar la interfaz de desarrollo. Se aisló la caché de Vite, se fijaron dependencias de optimización y se desactivó HMR en los servidores de prueba. El informe conserva esta incidencia; no se ocultó con reintentos automáticos de aserciones.

## Documentación entregada

- `README.md`: instalación completa, demostración, modo compilado, verificación, copias y diagnóstico.
- `docs/guia-proyectos.md`: alta de proyectos y destinos aceptados.
- `docs/guia-auditorias.md`: ejecución, estados, historial, comparación e informes.
- `docs/guia-flujos.md`: acciones, localizadores, datos ficticios, orden y límites.
- `docs/architecture.md`: componentes, seguridad, SQLite, comparación y limpieza.
- `docs/limitaciones.md`: restricciones y aspectos pendientes.
- Este informe: `docs/revision-final-mvp.md`.

## Aspectos pendientes y límites

- Instalación limpia en otra máquina y validación en Linux/macOS.
- Revisión manual completa con lector de pantalla, ampliación/zoom y otras combinaciones de ayudas técnicas. Las pruebas de teclado ejecutadas son recorridos específicos.
- No se sometió a carga prolongada, disco lleno, corrupción real, límites de memoria o páginas hostiles. No hay reparación automática, aislamiento de sistema operativo ni coordinación entre múltiples APIs.
- Se admite una sola API y una sola auditoría activa; sin autenticación/multiusuario ni exposición pública. Vite preview es para demostración local.
- Sin cancelación desde el panel, eliminación de proyectos/resultados, retención automática o copias programadas.
- Flujos restringidos a cuatro acciones y datos ficticios. No hay soporte para WebSockets, service workers, descargas, dependencias remotas o credenciales reales.
- La comparación depende de URL/secuencia/selector y motor/configuración conocidos; cambios dinámicos pueden alterar la identidad. Las ejecuciones antiguas sin configuración no se comparan automáticamente. Toda corrección es potencial y requiere revisión humana.
- Los informes conservan fragmentos de la web analizada; no hay anonimización ni cifrado incorporado.

No se identificó un bloqueo reproducible para el recorrido local comprobado. Los límites anteriores permanecen explícitos; no se declara cumplimiento WCAG ni preparación para despliegue público.
