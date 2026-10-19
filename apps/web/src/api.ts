export async function api(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
    : AbortSignal.timeout(10000);
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, signal, headers });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new Error(
        "La API local no respondió en 10 segundos. Comprueba la terminal y vuelve a intentarlo.",
        { cause: error },
      );
    throw new Error(
      "No se pudo conectar con la API local. Comprueba que esté iniciada y vuelve a intentarlo.",
      { cause: error },
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `La API devolvió una respuesta inválida (HTTP ${response.status}). Comprueba el servidor y el proxy local.`,
      { cause: error },
    );
  }
  if (!response.ok)
    throw new Error(
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `No se pudo completar la solicitud (HTTP ${response.status}).`,
    );
  return payload;
}
