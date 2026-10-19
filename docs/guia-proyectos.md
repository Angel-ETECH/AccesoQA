# Crear proyectos

1. Inicia AccesoQA y la aplicación local que quieres evaluar.
2. En **Proyectos**, escribe un nombre descriptivo y la **URL de la página autorizada**.
3. Usa una URL como `http://127.0.0.1:4312/?modo=problemas`. Se admiten HTTP/HTTPS con `localhost`, `127.0.0.1` y `[::1]`, con puerto válido opcional.
4. Pulsa **Registrar proyecto**. El proyecto queda seleccionado y guardado en SQLite.
5. Selecciona otro proyecto desde el control de proyecto en la sección de auditoría.

El registro valida el formato y el destino local; no prueba que el servidor esté iniciado. La conectividad se comprueba al ejecutar la auditoría. No incluyas usuarios ni contraseñas en la URL. No se admiten hosts públicos, IPs de red privada, direcciones abreviadas o variantes de localhost.

Todos los recursos de la página deben ser locales. Google Fonts, CDN, analítica y peticiones remotas harán fallar una auditoría si se intentan cargar. Usa una copia autorizada con recursos locales.

El MVP no tiene eliminación de proyectos ni edición de su URL. Para otro destino registra un proyecto distinto; los flujos y resultados anteriores permanecen en el original. No manipules SQLite mientras la API está ejecutándose.

## Ejemplos de demostración

- **Demo con problemas**: `http://127.0.0.1:4312/?modo=problemas`.
- **Demo corregida**: `http://127.0.0.1:4312/?modo=corregido`.

Son dos proyectos separados para mostrar auditorías individuales. Para comparar revisiones históricas usa el mismo flujo, URL y secuencia sobre versiones sucesivas del contenido.
