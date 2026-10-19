import Fastify from "fastify";
import { compare, report, htmlReport } from "./audit/history.js";
import {
  CreateProjectSchema,
  CreateFlowSchema,
  HealthResponseSchema,
  normalizeLocalUrl,
} from "@accesoqa/shared";
import { pathToFileURL } from "node:url";
import { openDatabase } from "./db/database.js";
import { Repository } from "./db/repository.js";
import { AuditService } from "./audit/service.js";
import type { ScanResult } from "./audit/scanner.js";

export function buildServer(
  options: {
    databasePath?: string;
    scanner?: (url: string) => Promise<ScanResult>;
    logger?: boolean;
    frontendOrigin?: string;
  } = {},
) {
  const db = openDatabase(options.databasePath);
  const repository = new Repository(db);
  const audits = new AuditService(repository, options.scanner);
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN;
  const allowedOrigins = frontendOrigin
    ? [new URL(normalizeLocalUrl(frontendOrigin)).origin]
    : ["http://127.0.0.1:4311", "http://localhost:4311"];
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 65536,
    requestTimeout: 10000,
    connectionTimeout: 10000,
  });
  repository.recoverInterrupted();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const origin = request.headers.origin;
    try {
      normalizeLocalUrl(`http://${request.headers.host}`);
    } catch {
      return reply.code(403).send({ message: "Host no autorizado." });
    }
    if (origin && !allowedOrigins.includes(origin))
      return reply.code(403).send({ message: "Origen no autorizado." });
  });
  app.addHook("onClose", async () => {
    await audits.idle();
    db.close();
  });
  app.get("/api/health", async (_request, reply) => {
    const payload = {
      status: "ok" as const,
      service: "accesoqa-api" as const,
      version: "0.1.0",
    };
    return reply.code(200).send(HealthResponseSchema.parse(payload));
  });
  app.get("/api/projects", async () => repository.projects());
  app.post("/api/projects", async (request, reply) => {
    const input = CreateProjectSchema.safeParse(request.body);
    if (!input.success)
      return reply.code(400).send({
        message: input.error.issues.map((issue) => issue.message).join(" "),
      });
    return reply.code(201).send(repository.createProject(input.data));
  });
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/audits",
    async (request, reply) => {
      try {
        return reply.code(202).send(audits.start(request.params.id));
      } catch (error) {
        if (error instanceof Error && error.message === "BUSY")
          return reply.code(409).send({
            message: "Ya hay una auditoría en curso. Espera a que termine.",
          });
        if (error instanceof Error && error.message === "NOT_FOUND")
          return reply.code(404).send({ message: "Proyecto no encontrado." });
        throw error;
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/audits/latest",
    async (request, reply) => {
      if (!repository.project(request.params.id))
        return reply.code(404).send({ message: "Proyecto no encontrado." });
      return repository.latest(request.params.id);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/audits/:id",
    async (request, reply) => {
      const run = repository.run(request.params.id);
      return (
        run ?? reply.code(404).send({ message: "Auditoría no encontrada." })
      );
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/flows",
    async (request, reply) => {
      if (!repository.project(request.params.id))
        return reply.code(404).send({ message: "Proyecto no encontrado." });
      return repository.flows(request.params.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/flows",
    async (request, reply) => {
      if (!repository.project(request.params.id))
        return reply.code(404).send({ message: "Proyecto no encontrado." });
      const input = CreateFlowSchema.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({
          message: input.error.issues.map((issue) => issue.message).join(" "),
        });
      return reply
        .code(201)
        .send(repository.saveFlow(request.params.id, input.data));
    },
  );
  app.put<{ Params: { id: string } }>(
    "/api/flows/:id",
    async (request, reply) => {
      const flow = repository.flow(request.params.id);
      if (!flow)
        return reply.code(404).send({ message: "Flujo no encontrado." });
      if (audits.busy)
        return reply.code(409).send({
          message:
            "Espera a que termine la auditoría antes de editar un flujo.",
        });
      const input = CreateFlowSchema.safeParse(request.body);
      if (!input.success)
        return reply.code(400).send({
          message: input.error.issues.map((issue) => issue.message).join(" "),
        });
      return repository.saveFlow(flow.projectId, input.data, flow.id);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/flows/:id/audits/latest",
    async (request, reply) => {
      if (!repository.flow(request.params.id))
        return reply.code(404).send({ message: "Flujo no encontrado." });
      return repository.latestFlow(request.params.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/flows/:id/audits",
    async (request, reply) => {
      try {
        return reply.code(202).send(audits.startFlow(request.params.id));
      } catch (error) {
        if (error instanceof Error && error.message === "BUSY")
          return reply.code(409).send({
            message: "Ya hay una auditoría individual o de flujo en curso.",
          });
        if (error instanceof Error && error.message === "NOT_FOUND")
          return reply.code(404).send({ message: "Flujo no encontrado." });
        throw error;
      }
    },
  );
  app.get<{
    Params: { id: string };
    Querystring: { limit?: string; offset?: string };
  }>("/api/projects/:id/audits", async (request, reply) => {
    if (!repository.project(request.params.id))
      return reply.code(404).send({ message: "Proyecto no encontrado." });
    const limit = Number(request.query.limit ?? 20),
      offset = Number(request.query.offset ?? 0);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      return reply.code(400).send({ message: "Paginación inválida." });
    return repository.history(request.params.id, limit, offset);
  });
  app.get<{
    Params: { id: string };
    Querystring: { baseline?: string; current?: string };
  }>("/api/flows/:id/compare", async (request, reply) => {
    const a = repository.run(request.query.baseline ?? ""),
      b = repository.run(request.query.current ?? "");
    if (!a || !b)
      return reply.code(404).send({ message: "Ejecución no encontrada." });
    if (a.flowId !== request.params.id || b.flowId !== request.params.id)
      return reply.code(400).send({
        message: "Las ejecuciones deben pertenecer al flujo indicado.",
      });
    if (!repository.precedes(a.id, b.id))
      return reply
        .code(400)
        .send({ message: "La base debe preceder a la revisión." });
    try {
      return compare(a, b);
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error ? error.message : "Comparación inválida.",
      });
    }
  });
  for (const format of ["json", "html"] as const)
    app.get<{ Params: { id: string } }>(
      "/api/audits/:id/export." + format,
      async (request, reply) => {
        const run = repository.run(request.params.id);
        if (!run)
          return reply.code(404).send({ message: "Auditoría no encontrada." });
        reply
          .header(
            "Content-Disposition",
            'attachment; filename="accesoqa-' + run.id + "." + format + '"',
          )
          .header("X-Content-Type-Options", "nosniff")
          .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          );
        return format === "json"
          ? reply.type("application/json; charset=utf-8").send(report(run))
          : reply.type("text/html; charset=utf-8").send(htmlReport(run));
      },
    );
  app.get<{ Params: { id: string } }>(
    "/api/audits/:id/report",
    async (request, reply) => {
      const run = repository.run(request.params.id);
      return run
        ? report(run)
        : reply.code(404).send({ message: "Auditoría no encontrada." });
    },
  );
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    const code =
      typeof status === "number" && status >= 400 && status < 500
        ? status
        : 500;
    reply.code(code).send({
      message:
        code === 500
          ? "No se pudo completar la operación. Revisa el registro de la API."
          : "Solicitud inválida. Envía datos JSON válidos.",
    });
  });
  return app;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const app = buildServer();
  const port = Number(process.env.API_PORT ?? 4310);
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().catch((error: unknown) => {
        app.log.error(error);
        process.exitCode = 1;
      });
    });
  app.listen({ host: "127.0.0.1", port }).catch((error: unknown) => {
    app.log.error(error);
    process.exitCode = 1;
  });
}
