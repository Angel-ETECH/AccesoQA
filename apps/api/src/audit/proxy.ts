import http from "node:http";
import https from "node:https";
import net from "node:net";
import { normalizeLocalUrl } from "@accesoqa/shared";

// The proxy is the network boundary, including redirects that Chromium follows
// without another Playwright route callback. No remote hostname reaches DNS.
export async function createLoopbackProxy(
  onBlocked: (message: string) => void,
) {
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    return socket;
  };
  const destination = (value: string) => {
    const url = new URL(normalizeLocalUrl(value));
    return {
      url,
      host: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    };
  };
  const server = http.createServer((request, response) => {
    try {
      const { url, host, port } = destination(request.url ?? "");
      const transport = url.protocol === "https:" ? https : http;
      const headers: http.OutgoingHttpHeaders = {
        ...request.headers,
        host: url.host,
      };
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      const upstream = transport.request(
        {
          hostname: host,
          port,
          path: url.pathname + url.search,
          method: request.method,
          headers,
          timeout: 15000,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on("socket", track);
      upstream.on("timeout", () =>
        upstream.destroy(new Error("Tiempo de conexión agotado.")),
      );
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502);
        response.end("Destino local inaccesible.");
      });
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      onBlocked(
        "Se bloqueó una solicitud o redirección a un destino no autorizado.",
      );
      response.writeHead(403);
      response.end("Destino no autorizado.");
    }
  });
  server.on("connection", track);
  server.on("connect", (request, client, head) => {
    try {
      if (
        !/^(localhost|127\.0\.0\.1|\[::1\]):[1-9]\d{0,4}$/i.test(
          request.url ?? "",
        )
      )
        throw new Error("CONNECT inválido");
      const { host, port } = destination(`https://${request.url}`);
      const upstream = track(net.connect({ host, port }));
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    } catch {
      onBlocked("Se bloqueó una conexión HTTPS a un destino no autorizado.");
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No se pudo iniciar el proxy local.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
