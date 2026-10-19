# Arquitectura del MVP local AccesoQA

## Componentes

- `apps/web`: React en `127.0.0.1:4311`. Registra proyectos, solicita auditorías y consulta su estado por polling. Vite reenvía `/api` a Fastify para mantener el mismo origen del navegador.
- `apps/api`: Fastify en `127.0.0.1:4310`. Zod valida las rutas; `AuditService` comparte exclusión mutua para páginas y flujos. `withAuditPage` encapsula Chromium y el proxy; `analyzePage` convierte resultados reales de axe-core. `executeFlow` interpreta las cuatro acciones admitidas. `Repository` es la única capa que ejecuta SQL de negocio.
- `apps/fixture`: sitio React pequeño en `127.0.0.1:4312` para practicar con contenido controlado.
- `packages/shared`: esquemas Zod y tipos que podrán consumir cliente y API.
- `apps/api/src/db`: apertura de SQLite y migraciones, separados de las rutas HTTP.

## Persistencia

Se usa `node:sqlite` de Node 24 para evitar un servicio de base de datos adicional. `openDatabase` activa claves foráneas y WAL, crea la carpeta local y aplica migraciones versionadas de forma transaccional. Las tablas iniciales cubren `projects`, `flows`, `flow_steps`, `audit_runs`, `audit_checkpoints`, `findings` y `manual_checks`. Fechas se guardan como ISO 8601 UTC; IDs como UUID generados por el repositorio.

La base predeterminada vive en `data/accesoqA.sqlite`, independientemente del directorio de trabajo. Se puede cambiar con `ACCESOQA_DB_PATH`. Bases, capturas e informes se excluyen de Git. La migración 2 añade URL solicitada, versión de axe-core y recuento de comprobaciones incompletas. No borra registros anteriores.

`audit_runs` conserva el estado, los tiempos y el error. En las auditorías individuales se insertan el checkpoint y los hallazgos junto al cambio a `completed`, en una transacción. `nodes_json` guarda HTML, selector y explicación por elemento. Al arrancar la API, las ejecuciones interrumpidas se marcan `failed`. La API usa una sola instancia de servicio por proceso.

La migración 3 añade `definition_json` en `flow_steps`, la tabla `flow_step_runs` y la referencia del checkpoint a su paso ejecutado. No elimina datos anteriores. Al crear una ejecución se copian todos los pasos con estado `pending`, su definición y su posición. Se persisten los cambios a `running` y después `completed` o `failed`; un fallo transforma los pasos pendientes a `skipped`, sin fechas de inicio ni resultados inventados. La recuperación tras reinicio también marca el paso activo como fallido y los restantes como no ejecutados.

Cada checkpoint del flujo y sus hallazgos se guardan en una transacción al terminar su análisis. Si falla un paso posterior se conservan esos checkpoints válidos, pero el estado global es `failed` y el recuento global es null. La API devuelve esos resultados como parciales. Al editar un flujo se reemplazan sus definiciones actuales, pero las ejecuciones conservan los snapshots; las referencias a definiciones eliminadas usan `ON DELETE SET NULL`. La última auditoría individual excluye explícitamente las ejecuciones de flujo.

## Contratos compartidos

Zod define creación de proyectos, proyectos, estados, impactos, hallazgos y respuestas de auditoría. `normalizeLocalUrl` admite únicamente las tres grafías explícitas de loopback. Rechaza credenciales, puertos inválidos, controles, barras inversas, hosts públicos/privados, IPs abreviadas, numéricas o codificadas y variantes de localhost con sufijos. Se valida al registrar, antes de ejecutar y en cada solicitud del navegador.

## Controles del motor

El servidor enlaza solo a loopback y rechaza hosts y orígenes ajenos al frontend. Solo acepta datos declarativos validados, sin JavaScript, comandos ni valores libres para credenciales. El cuerpo de una solicitud tiene un máximo de 64 KiB.

Cada análisis crea un proxy HTTP local efímero. Este comprueba cada petición y cada túnel HTTPS CONNECT, incluidos los saltos de redirección que no vuelven a pasar por una ruta de Playwright. Traduce localhost a 127.0.0.1 y [::1] a ::1: ningún hostname remoto llega al resolvedor DNS. Chromium usa ese proxy también para loopback (`<-loopback>` desactiva la excepción implícita). Se desactivan QUIC y UDP WebRTC fuera del proxy. HTTPS mantiene la validación normal de certificados.

El contexto añade un segundo control de solicitudes, bloquea service workers, descargas y todos los WebSockets. Las solicitudes externas hacen fallar la ejecución, incluso cuando el navegador consigue renderizar parte del contenido. Los WebSockets locales también se cierran; no se evalúan aplicaciones dependientes de ellos en esta fase. Los controles son del navegador/proxy, no sustituyen el aislamiento de procesos del sistema operativo para aplicaciones hostiles.

El lanzamiento tiene un máximo de 10 s, la navegación 15 s y el trabajo completo 45 s. `finally` cierra Chromium, el proxy y sus conexiones tanto en éxito como en fallo. El mutex se reserva antes de devolver HTTP 202; una segunda ejecución devuelve 409. El frontend distingue todos los estados y nunca interpreta un fallo como ausencia de errores.

Para flujos, `withAuditPage` mantiene el mismo contexto y aislamiento de red durante toda la secuencia. El límite total es 120 s; cada paso tiene entre 1000 y 15000 ms, incluyendo su análisis. Las rutas declaradas deben empezar por `/` sin host y pertenecer al origen del proyecto. Se verifica el destino después de cada acción. Los localizadores exactos se construyen únicamente con `getByLabel`, `getByRole` o `getByTestId`; no se aceptan selectores CSS/XPath ni métodos aportados por el cliente. `fill` usa exclusivamente la clave de una plantilla ficticia compartida. La promesa de cada acción y su checkpoint se resuelve antes de guardar resultados: un timeout no puede persistir después un checkpoint tardío.

## API

- `GET /api/health`: salud.
- `GET /api/projects` y `POST /api/projects`: listar y registrar.
- `POST /api/projects/:id/audits`: crear una ejecución pendiente (202).
- `GET /api/audits/:id`: consultar estado y hallazgos.
- `GET /api/projects/:id/audits/latest`: recuperar la última ejecución, o null.
- `GET/POST /api/projects/:id/flows`: listar o crear flujos ordenados.
- `PUT /api/flows/:id`: reemplazar nombre y pasos validados; no se permite editar durante una auditoría activa.
- `POST /api/flows/:id/audits`: iniciar flujo con el mismo mutex que las auditorías individuales.
- `GET /api/flows/:id/audits/latest`: consultar la última ejecución del flujo.

`GET /api/audits/:id` sirve ambos tipos de ejecución: incluye `flowId`, `steps`, `checkpoints` y hallazgos asociados a checkpoint y posición. Para páginas, `steps` está vacío. La UI compara los checkpoints de un solo flujo, contando elementos reales por regla; las comparaciones históricas se implementan en el módulo audit/history.ts con las restricciones descritas más abajo.

Las comprobaciones usan `new AxeBuilder({ page }).analyze()` con reglas predeterminadas de axe-core, sin inventar puntuaciones ni filtrar impactos. Los `violations` se persisten como incidencias; `incomplete` se informa por separado y no se presenta como verificación manual terminada. La ausencia de violaciones no prueba conformidad WCAG.

## Fases

Se entregan las fases 1–4: auditorías individuales, flujos declarativos, historial y comparación con exportaciones JSON/HTML.

## Historial y comparación (fase 4)

Migración 4: añade config_key nullable a audit_runs e índice por flujo y fecha. Las ejecuciones nuevas guardan una firma de configuración; las antiguas siguen consultables y exportables, pero no son elegibles para comparación automática. No se modifica ni se borra el historial existente. Las definiciones de pasos ya se almacenan como snapshots.

El módulo audit/history.ts calcula SHA-256 sobre JSON canónico: proyecto, flujo, URL final completa (incluidos query y fragmento) y secuencia de acciones hasta el punto de control. La secuencia incluye posición, rutas, localizadores, plantillas, timeout y flags checkpoint; excluye únicamente etiquetas descriptivas. El identificador del elemento añade regla y target de axe (con arrays de frames/shadow DOM preservados). No incluye HTML, impacto ni texto descriptivo. La versión del algoritmo y configuración se fijan explícitamente; cambios de opciones requieren nueva firma. La versión real de axe se valida por punto.

Los identificadores se derivan determinísticamente de snapshots persistidos, no se confunden con UUID de registros. La escritura elimina nodos duplicados de regla/selector en cada checkpoint; la lectura de ocurrencias también deduplica datos antiguos por identidad. Los recuentos de la nueva sección son elementos por checkpoint, mientras que findingsCount anterior sigue contando reglas por checkpoint para conservar el contrato.

Solo se comparan ejecuciones distintas del mismo flujo/proyecto en orden de inserción. Ambas deben terminar y completar sus pasos y checkpoints esperados. Cada pareja necesita clave equivalente única, motor conocido idéntico y manualReviewCount=0. Si falla una ejecución, todas sus observaciones quedan sin comparar. Si solo algunos puntos son equivalentes, se declara cobertura parcial. Un punto ausente, otra pantalla o un análisis incomplete no demuestra una corrección. La categoría potencialmente corregida expresa una ausencia observada, nunca una corrección confirmada.

Limitaciones: los selectores dinámicos, cambios de DOM, contenido condicionado, autenticación, datos, estados asincrónicos y cambios visuales pueden impedir correspondencia o cambiar el significado del mismo selector. Una URL y secuencia iguales no garantizan un estado idéntico. Se necesita revisión humana; no se calcula puntuación ni se declara conformidad WCAG. El tratamiento de incomplete es deliberadamente conservador: excluye el punto completo, aunque afecte otra regla.

API añadida:
- GET /api/projects/:id/audits?limit=20&offset=0: historial paginado de páginas y flujos (limit 1–100).
- GET /api/audits/:id/report: snapshot, ocurrencias únicas, resumen por impacto/punto y limitaciones.
- GET /api/flows/:id/compare?baseline=UUID&current=UUID: categorías y razones de exclusión.
- GET /api/audits/:id/export.json y export.html: descargas de una ejecución, incluso fallida.

Los informes son generados al solicitarlos; exportedAt corresponde a la descarga y las fechas de ejecución permanecen intactas. HTML autónomo sin JavaScript ni recursos externos: todo contenido variable pasa por escape, incluso URLs, selectores, HTML y errores. Se entrega como adjunto, con nosniff y CSP sandbox. JSON conserva el HTML como dato. Los informes pueden contener fragmentos de las páginas auditadas: aplica la política local de datos y no los subas a Git.

## Revisión de estabilidad del MVP

La separación se mantiene: contratos Zod compartidos, componentes React para página/flujos/historial, rutas Fastify, servicio con mutex, motor de navegador y repositorio SQLite. No se añadieron servicios remotos. Los informes se construyen desde el mismo snapshot que el panel y deduplican por elemento/punto.

La apertura de SQLite aplica busy_timeout=5000 y cierra el descriptor si falla una migración. El cierre de la API espera el servicio de auditoría antes de cerrar SQLite. La entrada del proceso atiende SIGINT/SIGTERM; una terminación forzada se recupera como fallo al siguiente arranque. Solo está soportada una instancia: el mutex y la recuperación son por proceso.

El navegador conserva la promesa de lanzamiento. Si vence el deadline durante launch, espera su resultado y lo cierra sin crear contexto ni ejecutar trabajo tardío. Una bandera de cancelación invalida comprobaciones posteriores. finally limpia temporizador, navegador y proxy, tanto en éxito como en error. Las pruebas aisladas simulan un launch tardío y las pruebas reales comprueban desconexión en éxito, error y timeout, seguida de otra auditoría válida.

El panel aborta solicitudes de historial/detalle/comparación al desmontarse o sustituirse. Actualiza el historial al recibir la finalización de una auditoría del panel; no usa porcentajes inventados. Las confirmaciones nativas protegen la eliminación de pasos del borrador y el reemplazo de una definición existente. No existen endpoints de borrado de datos persistidos.

La navegación móvil oculta los enlaces del menú cerrado para sacarlos del recorrido de teclado; Escape cierra el menú y devuelve el foco al botón. Existe salto al contenido, foco visible y reducción de movimiento. Las tablas mantienen caption, encabezados, detalle textual y contenedor desplazable; los filtros mantienen valores tipados. Las comprobaciones axe son automáticas y no acreditan evaluación manual completa con lectores de pantalla.

## Compilación y comprobación local

npm run build produce dist de los workspaces. npm start ejecuta la API compilada y dos servidores Vite preview, enlazados a loopback en los puertos habituales. El proxy /api se configura también para preview. Se conserva el workspace completo: el paquete compartido exporta TypeScript y se requiere Node 24.

scripts/verify-production.ts inicia procesos/servidores temporales sobre puertos libres y SQLite aislada, comprueba ambas variantes reales de la fixture, registro por pasos, JSON y axe/reflow del panel compilado. Cierra navegador, servidores y proceso API al terminar. La evidencia se guarda bajo data/ y se excluye de Git. Las guías de instalación, proyectos, auditorías, flujos y limitaciones se enlazan desde README.

Las pruebas Vite usan cacheDir temporal por servidor y desactivan HMR; el panel de pruebas predefine dependencias de optimización. Así no comparte cachés con otras suites o con el servidor de desarrollo del usuario.
