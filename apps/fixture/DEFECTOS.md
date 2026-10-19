# Casos de práctica de accesibilidad

La fixture no contiene datos reales ni hace solicitudes a sitios externos. Usa el recurso local `public/sample.svg`.

## `/?modo=problemas`

- El campo de nombre muestra un texto con aria-hidden, sin etiqueta accesible ni placeholder: permite comprobar la regla `label`.
- La imagen de muestra omite el atributo `alt`.
- El aviso de defectos usa texto de contraste deliberadamente bajo.

Estos defectos son intencionales para una auditoría futura. No son resultados de AccesoQA.

## `/?modo=corregido`

El campo tiene etiqueta, la imagen está marcada como decorativa con `alt=""` y el aviso no aparece. Esta página sirve como punto de comparación manual; no representa una certificación WCAG.

## Flujo de registro

`/registro?modo=corregido` y `/registro?modo=problemas` muestran las mismas variantes del formulario. Los campos tienen `data-testid="registration-name"` y `registration-email`; el botón usa `registration-submit`. Al completar nombre y correo con datos ficticios y enviar, se muestra `/confirmacion?modo=...`, con `data-testid="registration-success"`. Solo cambia el estado del navegador: no hay cuentas ni datos reales persistidos.

La confirmación corregida tiene un botón con nombre accesible “Continuar”. En la variante problemática ese mismo botón de icono no tiene nombre (`button-name`). Así se puede observar que las reglas detectadas en el formulario difieren de las de confirmación. `data-testid="not-visible"` es un elemento oculto deliberado para comprobar timeouts de visibilidad.
