# Definir y ejecutar flujos

Un flujo representa una secuencia de acciones con puntos de control. Se asocia a un proyecto y conserva una copia de sus pasos en cada ejecución.

## Crear

1. Selecciona el proyecto y pulsa **Nuevo flujo**.
2. Pon un nombre, por ejemplo **Registro de usuario**.
3. Define los pasos ordenados. El primero debe navegar a una ruta local del origen del proyecto.
4. Marca **Auditar accesibilidad después de este paso** en al menos un paso.
5. Confirma que usarás exclusivamente datos de prueba y guarda.

**Cargar ejemplo de registro** prepara cinco pasos para la demo. La ruta incluye `?modo=corregido`; el nombre y correo son ficticios y no se crea una cuenta real.

## Acciones y localizadores

| Acción | Datos necesarios |
| --- | --- |
| Navegar | Ruta como `/registro?modo=corregido`, sin host ni `//`. |
| Hacer clic | Etiqueta accesible, rol y nombre exacto o data-testid. |
| Completar campo | Localizador y una plantilla ficticia disponible. |
| Verificar visibilidad | Localizador del elemento esperado. |

Prioriza etiqueta o rol/nombre exacto. Usa data-testid cuando sea necesario para un elemento estable. Los localizadores ambiguos o inexistentes hacen fallar el paso. No se admiten CSS, XPath, JavaScript ni comandos. No hay valores libres para introducir contraseñas o credenciales reales.

Ejemplo:

1. Navegar a `/registro?modo=corregido` y auditar.
2. Completar **Nombre completo** con la plantilla de nombre.
3. Completar **Correo electrónico** con la plantilla de correo.
4. Pulsar el botón **Crear cuenta** por rol y nombre.
5. Verificar `data-testid=registration-success` y auditar.

## Orden, edición y confirmaciones

**Agregar paso**, **Subir**, **Bajar** y **Eliminar** ajustan el borrador. Eliminar solicita confirmación. Al guardar cambios de un flujo existente se confirma el reemplazo de su definición. Las ejecuciones previas mantienen sus snapshots. Cancelar edición descarta el borrador; no elimina el flujo guardado.

Límites: 20 pasos, entre 1 y 15 segundos por paso incluyendo axe y 120 segundos en total. No edites un flujo mientras una auditoría está activa. No hay eliminación de flujos o resultados persistidos desde la interfaz.

## Ejecutar y revisar

Pulsa **Ejecutar flujo**. La línea de tiempo distingue pendiente, ejecutándose, completado, fallido y no ejecutado. Si falla un paso se detiene el flujo; los siguientes no se consideran correctos. Se conservan los puntos de control anteriores como evidencia parcial, pero el resultado global permanece fallido.

La matriz por pantallas muestra reglas y elementos observados en los puntos evaluados de esa ejecución. No implica que una pantalla sin checkpoint sea correcta. Para comparación histórica consulta [la guía de auditorías](guia-auditorias.md).

Solo utiliza aplicaciones y datos de prueba autorizados. Un clic puede enviar formularios o modificar el sistema local que estás auditando; la restricción declarativa no convierte esas acciones en reversibles.
