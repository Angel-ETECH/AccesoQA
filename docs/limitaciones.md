# Limitaciones conocidas del MVP

## Operación local

- Una API y un usuario local. El mutex es por proceso; no hay coordinación distribuida, autenticación, permisos multiusuario ni aislamiento entre proyectos. No inicies dos APIs sobre la misma base ni expongas los puertos a la red.
- Solo HTTP/HTTPS con loopback explícito. No se admiten redes privadas, dominios locales personalizados, servidores públicos ni recursos remotos.
- WebSockets, service workers y descargas están bloqueados. Las aplicaciones que dependan de ellos pueden no funcionar. HTTPS requiere certificados válidos.
- El proxy y el contexto restringen destinos; no son una máquina virtual ni un entorno para ejecutar páginas hostiles. Los scripts normales de la página se ejecutan en Chromium.
- No se ha probado este MVP en Linux/macOS ni con todos los antivirus, proxies corporativos o políticas de navegador.

## Auditoría y flujos

- Axe cubre una parte de la accesibilidad. No hay certificación WCAG, puntuación, informe de cumplimiento ni sustitución de una evaluación humana.
- No se ha realizado una evaluación manual completa con NVDA/JAWS/VoiceOver. La revisión comprueba axe y recorridos concretos de teclado, no todas las combinaciones de ayudas técnicas.
- Viewport del motor: 1365×900, locale es-ES, reglas predeterminadas de axe. No hay matriz de navegadores/dispositivos ni captura automática de pantallas en cada auditoría de uso.
- Los flujos tienen cuatro acciones y plantillas ficticias fijas. No hay login con credenciales reales, archivos, iframes seleccionables manualmente, condiciones, bucles o JavaScript libre.
- Un clic puede tener efectos reales en la aplicación local. Trabaja con copias y datos de prueba.
- Navegación basada en networkidle y comprobaciones inmediatas por paso. Algunas SPAs con cargas diferidas o temporizadores necesitan pasos de visibilidad y localizadores adecuados. No hay garantías sobre estados dinámicos no observados.
- Los timeouts son límites operativos, no porcentaje de progreso. El cierre de Chromium y sus conexiones puede añadir un tiempo breve de limpieza. No hay botón de cancelar una auditoría activa.
- No hay un límite específico de memoria o cantidad de nodos de axe; páginas locales muy grandes pueden consumir recursos elevados.

## Historial, comparación e informes

- Identidad determinista por regla, URL exacta, secuencia previa/punto de control y selector de axe. Los selectores dinámicos o cambios de DOM pueden producir nuevas identidades o ausencias aparentes.
- Misma URL y secuencia no aseguran estado, contenido o datos idénticos. Potencialmente corregida nunca significa corrección confirmada.
- Se registra y compara la versión de axe. La firma actual no captura la versión de Chromium/Playwright; tras actualizarlos revisa los cambios de resultados antes de interpretarlos.
- Se exige análisis completo de ambas ejecuciones. Un fallo global excluye toda inferencia de corrección. Puntos ausentes, versiones/configuración distintas o incomplete excluyen puntos de la comparación.
- Las auditorías anteriores a la migración 4 no tienen firma de configuración; se consultan y exportan pero no se comparan automáticamente.
- El conteo individual agrupa reglas; el historial cuenta elementos únicos por punto. No son puntuaciones y sus números pueden diferir.
- JSON y HTML contienen fragmentos auditados. No hay anonimización, cifrado de archivos, gestión de retención, exportación PDF ni comparación descargable como informe separado.
- Sin edición/eliminación de proyectos ni eliminación de flujos/resultados desde el panel. No hay búsqueda global del historial; se pagina de 20 en 20.

## Persistencia y mantenimiento

- SQLite local con WAL y migraciones transaccionales; se requieren permisos y espacio libre. No hay recuperación automática ante corrupción, disco lleno o fallos de hardware.
- Las copias son manuales; detén la API antes de copiar/restaurar. Una interrupción se recupera como fallo al reiniciar, no se reanuda la auditoría.
- Vite preview sirve la compilación para demostrarla localmente; no es una instalación pública endurecida. Se mantiene el workspace completo y Node 24.
- Se verifican instalación documentada y comandos disponibles en este equipo; una instalación desde cero en otra máquina queda pendiente.

No forman parte del producto pagos, suscripciones, organizaciones empresariales, servicios cloud o IA externa.
