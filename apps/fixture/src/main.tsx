import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function Fixture() {
  const [registered, setRegistered] = useState(
    location.pathname === "/confirmacion",
  );
  useEffect(() => {
    document.title = registered
      ? "Registro completado · AccesoQA"
      : "Web de prueba · AccesoQA";
  }, [registered]);
  const fixed =
    new URLSearchParams(location.search).get("modo") === "corregido";
  return (
    <main className="page">
      <header>
        <p className="eyebrow">APLICACIÓN DE PRUEBA LOCAL</p>
        <h1>Registro de cuenta</h1>
        <p>
          Este sitio ficticio permite practicar una futura auditoría de
          accesibilidad.
        </p>
      </header>
      <nav aria-label="Páginas de prueba">
        <a href="/?modo=problemas">Con problemas</a>
        <a href="/?modo=corregido">Corregida</a>
      </nav>
      {!registered && !fixed && (
        <div className="notice">
          Modo con defectos intencionales: formulario sin etiqueta, imagen sin
          texto alternativo y contraste bajo.
        </div>
      )}
      {registered ? (
        <section aria-labelledby="confirmation-title">
          <h2 id="confirmation-title">Registro completado</h2>
          <p
            role="status"
            aria-label="Confirmación de registro"
            data-testid="registration-success"
          >
            Cuenta de prueba creada correctamente.
          </p>
          <p>
            Solo se han usado datos ficticios. No se ha creado ninguna cuenta
            real.
          </p>
          <button
            type="button"
            data-testid="continue-button"
            aria-label={fixed ? "Continuar" : undefined}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
              <path
                d="M4 12h16m-7-7 7 7-7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </button>
        </section>
      ) : (
        <section aria-labelledby="form-title">
          <h2 id="form-title">Crea tu cuenta</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              history.pushState(
                null,
                "",
                `/confirmacion?modo=${fixed ? "corregido" : "problemas"}`,
              );
              setRegistered(true);
            }}
          >
            <span hidden data-testid="not-visible">
              Elemento oculto de prueba
            </span>
            <div className="field">
              {fixed ? (
                <label htmlFor="name">Nombre completo</label>
              ) : (
                <span aria-hidden="true">Nombre completo</span>
              )}
              <input
                id="name"
                data-testid="registration-name"
                required
                placeholder={fixed ? "Nombre completo" : undefined}
              />
            </div>
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                data-testid="registration-email"
                required
              />
            </div>
            <label className="check">
              <input type="checkbox" /> Acepto los términos de prueba
            </label>
            <button type="submit" data-testid="registration-submit">
              Crear cuenta
            </button>
          </form>
          <img
            className="sample"
            src="/sample.svg"
            alt={fixed ? "" : undefined}
          />
        </section>
      )}
      <footer>
        Datos ficticios · Solo para pruebas locales · Modo:{" "}
        {fixed ? "corregido" : "problemas intencionales"}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
